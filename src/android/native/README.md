# 原生程式（classes.dex）

沿用 v1.10.1 的 classes.dex，v1.13.0 起用 smali 加了兩處呼叫（apktool 2.10）：

1. `MainActivity.setClients()` 最後：`invoke-static {p0}, Lcom/ian/aiphoto/Geo;->install(Lcom/ian/aiphoto/MainActivity;)V`
2. `MainActivity.onRequestPermissionsResult()` 開頭（super 之後）：`Geo.onPerm(this, requestCode)` 回傳 true 就直接 return

`Geo.java`（本資料夾）提供地圖「目前位置」的定位權限：包住原本的 WebChromeClient，多處理 `onGeolocationPermissionsShowPrompt`，並提供 JS 介面 `AIP2.has()`／`AIP2.request()`。

v1.14.0：`Geo.java` 加入 App 內更新：`AIP2.installApk(url)` 下載 APK 後用 PackageInstaller 安裝（系統跳出更新確認，直接覆蓋舊版），進度以 `onNativeEvent('apk', …)` 回報；`AIP2.canInstall()`／`AIP2.askInstall()` 處理「允許安裝不明應用程式」。

v1.17.0：`MainActivity.onDestroy()` 開頭加入 `Geo.onDestroy(this)`：App 從最近使用中被滑掉（不是旋轉螢幕）時通知網頁 `onNativeEvent('closed')`，取消進行中的匯出。

v1.21.0：`Geo.java` 加入 `AIP2.vibrate`（震動）、`AIP2.wake`（匯出時 PARTIAL_WAKE_LOCK，螢幕關閉也繼續）、`AIP2.canOverlay/askOverlay/popup/popupClear`（螢幕下方 1/3 的浮動提示窗，SYSTEM_ALERT_WINDOW）、`AIP2.watch/unwatch`（原生 ContentObserver 監看 Lightroom／手機相簿存檔，找到就震動＋提示並發出 `onNativeEvent('extFound')`）。
