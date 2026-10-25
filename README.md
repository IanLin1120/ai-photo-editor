# AI修圖軟體

Android RAW 修圖 App（WebView + 原生外殼）。相機描述檔調色、AI 自動調整、AI 氛圍感、鏡頭校正、紫邊／綠邊消除、降噪、地點寫入 EXIF、雲端 AI 降噪、OTA 更新。

## 這個儲存庫放了什麼

| 路徑 | 用途 |
|---|---|
| `index.html`、`version.json`、`lib/libraw/` | App 網頁本體。App 透過 GitHub Pages 檢查 `version.json`，有新版就下載 `index.html`（小更新，不用重裝） |
| `apk/`、`apks.json` | 完整 APK。設定 →「版本與更新」可選任一版本下載安裝 |
| `.github/workflows/cloud-denoise.yml`、`cloud/` | 雲端 AI 降噪（GitHub Actions：SCUNet 降噪 + 與手機同一份修圖引擎全解析度輸出） |
| `src/` | 原始碼（`src/web` 介面與修圖引擎、`src/android` 原生外殼、`src/build.py` 打包） |

**簽章金鑰（`keys/release.p12`）不放在這裡**，請自己保管。之後所有 APK 都要用同一把金鑰簽，否則手機會無法覆蓋安裝。

## 第一次設定

1. 在 GitHub 建立 **公開（Public）** 儲存庫 `ai-photo-editor`，把這個資料夾的全部內容上傳到 `main`。
   - 網頁拖曳上傳有時會漏掉隱藏資料夾 `.github`；若漏了，用 *Add file → Create new file*，檔名打 `.github/workflows/cloud-denoise.yml`，貼上內容。
   - 公開儲存庫的 Actions 免費；照片是 AES-256 加密後才上傳，放在草稿 Release（別人看不到），處理完自動刪除。
2. 儲存庫 *Settings → Pages*：Source 選 **Deploy from a branch**，Branch 選 `main` / `(root)`。
3. 手機安裝 `apk/AI修圖軟體_v1.0.0.apk`。
4. App →「設定」：
   - **Google Maps API 金鑰**：Google Cloud 主控台啟用 *Places API (New)*，建立金鑰貼上（可和行跡導航共用）。
   - **GitHub 權杖**：GitHub → Settings → Developer settings → *Fine-grained tokens*，只選 `ai-photo-editor`，權限 **Contents、Actions、Secrets** 設為 Read and write。權杖只存在手機裡。
   - **雲端 → 加密金鑰 →「自動設定」**：App 會產生金鑰並寫進儲存庫 Secret `CLOUD_KEY`。

## 發佈更新

```bash
# 小更新（只改網頁）：
VER=1.0.1 CODE=1 NOTES="說明" python3 src/build.py      # 產生 dist/gh/ → 覆蓋儲存庫根目錄的 index.html、version.json

# 大更新（改了 Android 外殼）：
VER=1.1.0 CODE=2 MINAPK=2 python3 src/build.py
KS=/你的路徑/release.p12 KS_PASS=你的密碼 VER=1.1.0 CODE=2 bash src/android/build.sh
# 把 APK 放進 apk/，並在 apks.json 最前面加一筆
```

建置需要：Python 3、Node（`tweetnacl`、`blakejs`、`libraw-wasm` 放在 `$SDK/node_modules`）、Java 17、`android-34.jar`、aapt2、D8、uber-apk-signer（路徑見 `src/android/build.sh`）。

## 授權

- LibRaw（libraw-wasm）：LGPL 2.1 / CDDL 1.0
- MapLibre GL JS：BSD-3-Clause；地圖圖資 OpenFreeMap / OpenStreetMap 貢獻者
- SCUNet（`cloud/network_scunet.py`、模型權重來自 cszn/KAIR）：Apache-2.0
