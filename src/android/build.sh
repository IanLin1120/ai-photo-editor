#!/bin/bash
# 用法：VER=1.11.0 CODE=19 KS=/路徑/release.p12 KS_PASS=密碼 bash src/android/build.sh
# 原生程式沿用 v1.10.1 的 classes.dex（讀取、新增照片、儲存、雲端連線都和舊版相同）；只換 assets/index.html
set -e
cd "$(dirname "$0")"
SDK=${SDK:-/home/claude/sdk}; AAPT=$SDK/node_modules/aaptjs3/bin/x64/linux/aapt2; JAR=$SDK/android-34.jar
: "${KS:?請設定 KS=簽章金鑰路徑}" "${KS_PASS:?請設定 KS_PASS=金鑰密碼}"
rm -rf build && mkdir -p build/assets
cp ../dist/index.html build/assets/index.html
sed -e "s/__CODE__/$CODE/" -e "s/__VER__/$VER/" AndroidManifest.xml > build/AndroidManifest.xml
$AAPT compile --dir res -o build/res.zip
$AAPT link -o build/base.apk -I $JAR --manifest build/AndroidManifest.xml --min-sdk-version 26 --target-sdk-version 34 \
  --stable-ids ids.txt -A build/assets build/res.zip --no-compress-regex '\.(png)$'
cp classes.dex build/ && (cd build && zip -q base.apk classes.dex)
java -jar $SDK/uber.jar --apks build/base.apk --ks "$KS" --ksAlias aiphoto --ksPass "$KS_PASS" --ksKeyPass "$KS_PASS" -o build/out 2>&1 | grep -E "error|ERROR|Success" | grep -v JAVA_TOOL || true
mkdir -p ../dist && cp build/out/*-aligned-signed.apk "../dist/AI修圖軟體_v$VER.apk" && ls -la "../dist/AI修圖軟體_v$VER.apk"
