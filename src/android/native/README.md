# 原生程式（classes.dex）

沿用 v1.10.1 的 classes.dex，v1.13.0 起用 smali 加了兩處呼叫（apktool 2.10）：

1. `MainActivity.setClients()` 最後：`invoke-static {p0}, Lcom/ian/aiphoto/Geo;->install(Lcom/ian/aiphoto/MainActivity;)V`
2. `MainActivity.onRequestPermissionsResult()` 開頭（super 之後）：`Geo.onPerm(this, requestCode)` 回傳 true 就直接 return

`Geo.java`（本資料夾）提供地圖「目前位置」的定位權限：包住原本的 WebChromeClient，多處理 `onGeolocationPermissionsShowPrompt`，並提供 JS 介面 `AIP2.has()`／`AIP2.request()`。

v1.14.0：`Geo.java` 加入 App 內更新：`AIP2.installApk(url)` 下載 APK 後用 PackageInstaller 安裝（系統跳出更新確認，直接覆蓋舊版），進度以 `onNativeEvent('apk', …)` 回報；`AIP2.canInstall()`／`AIP2.askInstall()` 處理「允許安裝不明應用程式」。
