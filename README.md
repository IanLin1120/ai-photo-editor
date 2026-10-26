# AI修圖軟體

Android 修圖 App（WebView + 原生外殼）。

**v1.11.0 起以 v1.10.1 為基礎**：讀取／新增照片、圖庫、調色與影調引擎（WebGL2）、AI 降噪（OIDN）、雲端降噪、鏡頭校正、紫邊／綠邊、自訂檔名、EXIF 保留都沿用 v1.10.1。新增：

- 📍 **地點搜尋地圖（行跡導航樣式）**：全螢幕地圖、上方搜尋列，「G」Google 地圖搜尋結果排前面（設定裡填 Google Maps API 金鑰），長按地圖放圖釘、可拖曳微調；座標寫入 EXIF GPS 與 XMP。
- 🔄 **版本與更新**：設定 →「版本與更新」。小改版開 App 時自動下載新介面（不用重裝）；大改版下載新 APK；可選任一版本的 APK 下載。

## 儲存庫內容

| 路徑 | 用途 |
|---|---|
| `index.html`、`version.json` | 線上更新用（App 透過 GitHub Pages 讀取） |
| `apk/`、`apks.json` | 所有版本的 APK 與清單 |
| `src/` | 原始碼：`base/parts/`（以 v1.10.1 為基礎的本體，拆成多個檔案方便修改）＋ `web/`（新增模組）＋ `build.py`（組合）＋ `android/`（原生外殼，沿用 v1.10.1 的 classes.dex） |

## 設定

1. 儲存庫 *Settings → Pages*：Source 選 **Deploy from a branch**，Branch 選 `main` / `(root)`。
2. App →「設定」→「📍 地點搜尋」貼上 Google Maps API 金鑰（需啟用 Places API (New)）。
3. 雲端 AI 降噪：照 App 設定頁「雲端」卡片的步驟，另建一個**私人**儲存庫（例如 `aiphoto-cloud`）。不要用這個公開的儲存庫，雲端降噪的暫存相片在公開儲存庫會被看到。

## 發佈新版

```bash
VER=1.11.1 CODE=20 MINAPK=1.11.0 NOTES="說明" python3 src/build.py   # 小改版：minApk 不變 → 手機自動線上更新
cp src/dist/gh/index.html src/dist/gh/version.json .
# 大改版（改了原生程式）才需要：
KS=/路徑/release.p12 KS_PASS=密碼 VER=1.12.0 CODE=21 bash src/android/build.sh   # 再把 APK 放進 apk/，apks.json 最前面加一筆
```

簽章金鑰不放在這裡，請自行保管。
