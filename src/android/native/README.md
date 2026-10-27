# 原生程式（classes.dex）

沿用 v1.10.1 的 classes.dex，v1.13.0 起用 smali 加了兩處呼叫（apktool 2.10）：

1. `MainActivity.setClients()` 最後：`invoke-static {p0}, Lcom/ian/aiphoto/Geo;->install(Lcom/ian/aiphoto/MainActivity;)V`
2. `MainActivity.onRequestPermissionsResult()` 開頭（super 之後）：`Geo.onPerm(this, requestCode)` 回傳 true 就直接 return

`Geo.java`（本資料夾）提供地圖「目前位置」的定位權限：包住原本的 WebChromeClient，多處理 `onGeolocationPermissionsShowPrompt`，並提供 JS 介面 `AIP2.has()`／`AIP2.request()`。

v1.14.0：`Geo.java` 加入 App 內更新：`AIP2.installApk(url)` 下載 APK 後用 PackageInstaller 安裝（系統跳出更新確認，直接覆蓋舊版），進度以 `onNativeEvent('apk', …)` 回報；`AIP2.canInstall()`／`AIP2.askInstall()` 處理「允許安裝不明應用程式」。

v1.17.0：`MainActivity.onDestroy()` 開頭加入 `Geo.onDestroy(this)`：App 從最近使用中被滑掉（不是旋轉螢幕）時通知網頁 `onNativeEvent('closed')`，取消進行中的匯出。

v1.18.0：`AIP2.editLast()`／`editResult()`／`editCleanup()`：把剛存的暫存 JPEG 用手機內建相簿（優先 OPPO／ColorOS 相簿）的編輯器開啟，回到 App 後找出編輯結果（另存的新相片或覆寫的原檔）交給網頁取回。Manifest 加入 `<queries>`（ACTION_EDIT image/*）。

v1.19.2：`AIP2.openWith(uri, pkg, mode)`（分享或編輯到指定 App，例如 Lightroom）、`hasApp(pkg)`、`editResult3`；原始檔（非 App 暫存）絕不刪除。Manifest `<queries>` 加入 SEND image/* 與 com.adobe.lrmobile。

v1.20.0：`AIP2.alert(title,text)`（高優先通知頻道 aiphoto_alert，會以橫幅浮在其他 App 上）、`alertClear()`、`alertSettings()`；`deleteMedia(json)` 以 MediaStore.createDeleteRequest 刪除其他 App 存的副本（系統確認）。
