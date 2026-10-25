package com.ian.aiphoto;

import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/** 網頁（window.APN）呼叫原生功能的橋接 */
public class Bridge {
    final MainActivity a;
    Bridge(MainActivity a) { this.a = a; }

    @JavascriptInterface public void pick(String cb, boolean multi) { a.pick(cb, multi); }
    @JavascriptInterface public String reopen(String uri) { return a.reopen(uri); }
    @JavascriptInterface public String saveOpen(String name, String mime, String folder, double takenMs) { return a.saveOpen(name, mime, folder, (long) takenMs); }
    @JavascriptInterface public boolean saveChunk(String id, String b64) { return a.saveChunk(id, b64); }
    @JavascriptInterface public String saveClose(String id) { return a.saveClose(id); }
    @JavascriptInterface public void saveAbort(String id) { a.saveAbort(id); }
    @JavascriptInterface public void netFile(String cb, String method, String url, String headers, String upload, String download) { a.netFile(cb, method, url, headers, upload, download); }
    @JavascriptInterface public void delCache(String name) { a.delCache(name); }
    @JavascriptInterface public void keepScreen(boolean on) { a.keepScreen(on); }
    @JavascriptInterface public void share(String uri, String mime) { a.share(uri, mime); }

    @JavascriptInterface
    public String perms() {
        try {
            JSONObject o = new JSONObject();
            o.put("loc", a.hasLoc());
            o.put("notif", Build.VERSION.SDK_INT < 33 || a.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED);
            boolean media = Build.VERSION.SDK_INT >= 29 ? a.checkSelfPermission("android.permission.ACCESS_MEDIA_LOCATION") == PackageManager.PERMISSION_GRANTED
                    : a.checkSelfPermission("android.permission.WRITE_EXTERNAL_STORAGE") == PackageManager.PERMISSION_GRANTED;
            o.put("media", media);
            o.put("install", Build.VERSION.SDK_INT < 26 || a.getPackageManager().canRequestPackageInstalls());
            return o.toString();
        } catch (Exception e) { return "{}"; }
    }
    @JavascriptInterface public void requestPerm(String kind) { a.requestPerm(kind); }
    @JavascriptInterface public void openAppSettings() { a.openAppSettings(); }
    @JavascriptInterface public void openUrl(String u) { a.openUrl(u); }
    @JavascriptInterface public void setDark(boolean d) { a.setDark(d); }

    @JavascriptInterface public String version() { JSONObject m = a.otaUsable() ? a.otaMeta() : null; return "v" + (m != null ? m.optString("ver") + "（線上更新）・APK v" : "") + BuildInfo.VERSION; }
    @JavascriptInterface
    public String appInfo() {
        try { JSONObject o = new JSONObject(); o.put("apk", BuildInfo.VERSION); o.put("code", BuildInfo.CODE); JSONObject m = a.otaMeta(); o.put("ota", m != null && a.otaUsable() ? m.optString("ver") : ""); return o.toString(); }
        catch (Exception e) { return "{}"; }
    }
    @JavascriptInterface
    public boolean writeApp(String html, String ver, int minApk) {
        try {
            java.io.File d = new java.io.File(a.getFilesDir(), "www"); d.mkdirs();
            java.io.File t = new java.io.File(d, "index.html.tmp");
            try (java.io.FileOutputStream o = new java.io.FileOutputStream(t)) { o.write(html.getBytes("UTF-8")); }
            if (!t.renameTo(new java.io.File(d, "index.html"))) return false;
            JSONObject m = new JSONObject(); m.put("ver", ver); m.put("minApk", minApk); m.put("at", System.currentTimeMillis());
            try (java.io.FileOutputStream o = new java.io.FileOutputStream(new java.io.File(d, "meta.json"))) { o.write(m.toString().getBytes("UTF-8")); }
            return true;
        } catch (Exception e) { return false; }
    }
    @JavascriptInterface public void resetApp() { new java.io.File(a.getFilesDir(), "www/index.html").delete(); new java.io.File(a.getFilesDir(), "www/meta.json").delete(); }
    @JavascriptInterface public void downloadApk(String url, String name) { a.runOnUiThread(() -> a.downloadApk(url, name)); }
    @JavascriptInterface public boolean canInstall() { return Build.VERSION.SDK_INT < 26 || a.getPackageManager().canRequestPackageInstalls(); }
    @JavascriptInterface public void askInstall() { a.requestPerm("install"); }
}
