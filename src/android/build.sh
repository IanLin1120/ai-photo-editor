#!/bin/bash
# AI修圖軟體 APK 建置：aapt2 + javac + d8 + uber-apk-signer（與台灣即時天氣預報同一套工具鏈）
# 用法：VER=1.0.0 CODE=1 bash build.sh     （簽章金鑰 keys/release.p12 不放進 GitHub）
set -e
SDK=${SDK:-/home/claude/sdk}
AAPT=$SDK/node_modules/aaptjs3/bin/x64/linux/aapt2
JAR=$SDK/android-34.jar
D8="java -cp ${JADX:-/home/claude/tools/jadx/lib/jadx-1.5.1-all.jar} com.android.tools.r8.D8"
KS="${KS:-$(realpath "$(dirname "$0")/../../keys/release.p12")}"
VER=${VER:-1.0.0}; CODE=${CODE:-1}
cd "$(dirname "$0")"
rm -rf build && mkdir -p build/gen build/cls
[ -d assets ] || { echo "缺少 assets/（先執行 src/build.py）"; exit 1; }
printf 'package com.ian.aiphoto;\n\npublic class BuildInfo {\n    public static final String VERSION = "%s";\n    public static final int CODE = %s;\n}\n' "$VER" "$CODE" > src/com/ian/aiphoto/BuildInfo.java
$AAPT compile --dir res -o build/res.zip
$AAPT link -o build/base.apk -I $JAR --manifest AndroidManifest.xml --min-sdk-version 26 --target-sdk-version 34 \
  --version-code $CODE --version-name $VER -A assets --java build/gen build/res.zip --no-compress-regex '\.(wasm|png|jpg)$'
javac -nowarn --release 11 -encoding UTF-8 -cp $JAR -d build/cls $(find src build/gen -name '*.java') 2>&1 | grep -v "JAVA_TOOL\|warning\|^Note" || true
$D8 --release --min-api 26 --lib $JAR --output build $(find build/cls -name '*.class') 2>&1 | grep -v JAVA_TOOL || true
(cd build && zip -q base.apk classes.dex)
java -jar $SDK/uber.jar --apks build/base.apk --ks "$KS" --ksAlias aiphoto --ksPass "$KS_PASS" --ksKeyPass "$KS_PASS" -o build/out 2>&1 | grep -E "error|ERROR|Success|VERIFY" | grep -v JAVA_TOOL || true
mkdir -p ../../dist && cp build/out/*-aligned-signed.apk "../../dist/AI修圖軟體_v$VER.apk"
ls -la ../../dist
