package com.ian.aiphoto;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START = "https://" + HOST + "/index.html";
    WebView web;
    GeolocationPermissions.Callback geoCb;
    String geoOrigin;
    String pendingPerm;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#efe5d3"));
        w.setNavigationBarColor(Color.parseColor("#efe5d3"));
        setLight(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#efe5d3"));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " AIPhoto/" + BuildInfo.VERSION);
        web.addJavascriptInterface(new Bridge(this), "APN");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath() == null ? "/" : u.getPath();
                if (path.startsWith("/pick/")) return pickFile(path.substring(6), u.getQueryParameter("off"), u.getQueryParameter("len"));
                if (path.startsWith("/cache/")) return cacheFile(path.substring(7));
                if (path.equals("/p")) return proxy(u.getQueryParameter("u"));
                return asset(path);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLoc()) { cb.invoke(origin, true, false); return; }
                geoCb = cb; geoOrigin = origin; pendingPerm = "loc";
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 11);
            }
        });
        if (b != null) web.restoreState(b); else web.loadUrl(START);
    }

    /* ===== 線上更新：GitHub 下載的新版介面放在 files/www/，比 APK 內建的新才使用 ===== */
    File otaFile() { return new File(getFilesDir(), "www/index.html"); }
    JSONObject otaMeta() { try { return new JSONObject(new String(Net.readAll(new FileInputStream(new File(getFilesDir(), "www/meta.json"))), "UTF-8")); } catch (Exception e) { return null; } }
    static int cmpVer(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parseInt(x[i]) : 0, q = i < y.length ? parseInt(y[i]) : 0;
            if (p != q) return p < q ? -1 : 1;
        }
        return 0;
    }
    static int parseInt(String s) { try { return Integer.parseInt(s.replaceAll("[^0-9]", "")); } catch (Exception e) { return 0; } }
    boolean otaUsable() {
        JSONObject m = otaMeta();
        if (m == null || !otaFile().exists()) return false;
        if (m.optInt("minApk", 0) > BuildInfo.CODE) return false;
        if (cmpVer(m.optString("ver", "0"), BuildInfo.VERSION) <= 0) return false;
        return true;
    }

    static String mime(String path) {
        return path.endsWith(".html") ? "text/html" : path.endsWith(".js") || path.endsWith(".mjs") ? "text/javascript" : path.endsWith(".css") ? "text/css"
                : path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".png") ? "image/png" : path.endsWith(".json") ? "application/json" : "application/octet-stream";
    }
    WebResourceResponse asset(String path) {
        if (path.equals("/") || path.isEmpty()) path = "/index.html";
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        try {
            if (path.equals("/index.html") && otaUsable()) return new WebResourceResponse("text/html", "utf-8", 200, "OK", h, new FileInputStream(otaFile()));
            InputStream in = getAssets().open(path.substring(1));
            String m = mime(path);
            return new WebResourceResponse(m, m.startsWith("text") || m.contains("json") ? "utf-8" : null, 200, "OK", h, in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, null);
        }
    }

    /* ===== 選擇照片（系統檔案選擇器，取得永久讀取權，重開 App 仍可讀取原檔） ===== */
    final Map<String, Uri> picks = new HashMap<>();
    String pickCb;
    void pick(String cb, boolean multi) {
        pickCb = cb;
        runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multi)
                    .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "application/octet-stream", "image/x-sony-arw", "image/x-adobe-dng", "image/tiff"});
            try { startActivityForResult(i, 31); } catch (Exception e) { js("window.onNativePick&&onNativePick(" + JSONObject.quote(cb) + ",'[]')"); }
        });
    }
    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != 31) return;
        JSONArray out = new JSONArray();
        if (res == RESULT_OK && data != null) {
            java.util.List<Uri> L = new java.util.ArrayList<>();
            if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) L.add(data.getClipData().getItemAt(i).getUri());
            else if (data.getData() != null) L.add(data.getData());
            for (Uri u : L) {
                try { getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception e) { }
                JSONObject o = describe(u);
                if (o != null) out.put(o);
            }
        }
        js("window.onNativePick&&onNativePick(" + JSONObject.quote(pickCb) + "," + JSONObject.quote(out.toString()) + ")");
    }
    JSONObject describe(Uri u) {
        try {
            String id = Integer.toHexString(u.toString().hashCode()) + Long.toHexString(System.nanoTime() & 0xffff);
            picks.put(id, u);
            JSONObject o = new JSONObject();
            o.put("id", id); o.put("uri", u.toString());
            try (Cursor c = getContentResolver().query(u, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME), z = c.getColumnIndex(OpenableColumns.SIZE), m = c.getColumnIndex("last_modified");
                    if (n >= 0) o.put("name", c.getString(n));
                    if (z >= 0) o.put("size", c.getLong(z));
                    if (m >= 0) o.put("mtime", c.getLong(m));
                }
            }
            return o;
        } catch (Exception e) { return null; }
    }
    /* 重開 App 後，用存下來的 uri 重新登記 */
    String reopen(String uri) {
        try { Uri u = Uri.parse(uri); JSONObject o = describe(u); if (o == null) return ""; getContentResolver().openFileDescriptor(u, "r").close(); return o.toString(); } catch (Exception e) { return ""; }
    }
    InputStream openPick(Uri u) throws Exception {
        Uri x = u;
        if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission("android.permission.ACCESS_MEDIA_LOCATION") == PackageManager.PERMISSION_GRANTED && "media".equals(u.getAuthority())) {
            try { x = MediaStore.setRequireOriginal(u); } catch (Exception e) { x = u; }
        }
        return getContentResolver().openInputStream(x);
    }
    WebResourceResponse pickFile(String id, String off, String len) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-store");
        Uri u = picks.get(id);
        if (u == null) return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, null);
        try {
            InputStream in = openPick(u);
            if (off != null) {
                long o = Long.parseLong(off), skipped = 0;
                while (skipped < o) { long k = in.skip(o - skipped); if (k <= 0) break; skipped += k; }
                if (len != null) in = new LimitedStream(in, Long.parseLong(len));
            }
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 500, "Error", h, null);
        }
    }
    static class LimitedStream extends java.io.FilterInputStream {
        long left;
        LimitedStream(InputStream in, long n) { super(in); left = n; }
        @Override public int read() throws java.io.IOException { if (left <= 0) return -1; int c = super.read(); if (c >= 0) left--; return c; }
        @Override public int read(byte[] b, int o, int l) throws java.io.IOException { if (left <= 0) return -1; int n = super.read(b, o, (int) Math.min(l, left)); if (n > 0) left -= n; return n; }
    }
    WebResourceResponse cacheFile(String name) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-store");
        try {
            File f = new File(getCacheDir(), new File(name).getName());
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, new FileInputStream(f));
        } catch (Exception e) { return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, null); }
    }

    /* ===== 寫入：相簿（MediaStore Pictures/資料夾）或 App 暫存 ===== */
    static class Sink { OutputStream out; Uri uri; File file; long taken; String name; }
    final Map<String, Sink> sinks = new HashMap<>();
    String saveOpen(String name, String mime, String folder, long takenMs) {
        try {
            Sink k = new Sink(); k.taken = takenMs; k.name = name;
            if (folder != null && folder.startsWith("cache:")) {
                k.file = new File(getCacheDir(), new File(name).getName());
                k.out = new java.io.BufferedOutputStream(new java.io.FileOutputStream(k.file), 1 << 20);
            } else if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + (folder == null || folder.isEmpty() ? "AI修圖" : folder));
                if (takenMs > 0) v.put(MediaStore.Images.Media.DATE_TAKEN, takenMs);
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri col = mime.startsWith("image/") ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) : MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                k.uri = getContentResolver().insert(col, v);
                if (k.uri == null) return "";
                k.out = new java.io.BufferedOutputStream(getContentResolver().openOutputStream(k.uri), 1 << 20);
            } else {
                File d = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), folder == null || folder.isEmpty() ? "AI修圖" : folder);
                d.mkdirs();
                k.file = new File(d, name);
                k.out = new java.io.BufferedOutputStream(new java.io.FileOutputStream(k.file), 1 << 20);
            }
            String id = "s" + System.nanoTime();
            sinks.put(id, k);
            return id;
        } catch (Exception e) { return ""; }
    }
    boolean saveChunk(String id, String b64) {
        Sink k = sinks.get(id); if (k == null) return false;
        try { k.out.write(android.util.Base64.decode(b64, android.util.Base64.DEFAULT)); return true; } catch (Exception e) { return false; }
    }
    String saveClose(String id) {
        Sink k = sinks.remove(id); if (k == null) return "";
        try {
            k.out.close();
            String path = "";
            if (k.uri != null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(k.uri, v, null, null);
                try (Cursor c = getContentResolver().query(k.uri, new String[]{MediaStore.MediaColumns.DATA}, null, null, null)) {
                    if (c != null && c.moveToFirst()) path = c.getString(0);
                } catch (Exception e) { }
                // 檔案時間＝拍攝時間（相簿 App 依此排序）
                if (k.taken > 0 && path != null && !path.isEmpty()) { try { new File(path).setLastModified(k.taken); } catch (Exception e) { } }
                return k.uri.toString() + "|" + (path == null ? "" : path);
            }
            if (k.file != null) {
                if (k.taken > 0) k.file.setLastModified(k.taken);
                if (!k.file.getParentFile().equals(getCacheDir())) { try { android.media.MediaScannerConnection.scanFile(this, new String[]{k.file.getAbsolutePath()}, null, null); } catch (Exception e) { } }
                return "file|" + k.file.getAbsolutePath();
            }
            return "";
        } catch (Exception e) { return ""; }
    }
    void saveAbort(String id) {
        Sink k = sinks.remove(id); if (k == null) return;
        try { k.out.close(); } catch (Exception e) { }
        try { if (k.uri != null) getContentResolver().delete(k.uri, null, null); if (k.file != null) k.file.delete(); } catch (Exception e) { }
    }

    /* ===== 雲端（GitHub）大檔上傳／下載：在背景執行緒，完成後回呼 JS ===== */
    void netFile(String cb, String method, String url, String headers, String upload, String download) {
        new Thread(() -> {
            JSONObject r = new JSONObject();
            try {
                java.net.HttpURLConnection c = null; String u = url;
                for (int hop = 0; hop < 5; hop++) {
                    c = (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
                    c.setConnectTimeout(20000); c.setReadTimeout(300000); c.setInstanceFollowRedirects(false);
                    c.setRequestMethod(method);
                    JSONObject h = new JSONObject(headers == null || headers.isEmpty() ? "{}" : headers);
                    boolean cross = hop > 0 && !new java.net.URL(u).getHost().endsWith("github.com");
                    for (java.util.Iterator<String> it = h.keys(); it.hasNext(); ) { String k = it.next(); if (cross && k.equalsIgnoreCase("Authorization")) continue; c.setRequestProperty(k, h.getString(k)); }
                    if (upload != null && !upload.isEmpty() && hop == 0) {
                        File f = new File(getCacheDir(), new File(upload).getName());
                        c.setDoOutput(true); c.setFixedLengthStreamingMode(f.length());
                        try (InputStream in = new FileInputStream(f); OutputStream o = c.getOutputStream()) { byte[] b = new byte[1 << 16]; int n; long done = 0, tot = f.length(), last = 0;
                            while ((n = in.read(b)) > 0) { o.write(b, 0, n); done += n; if (done - last > (1 << 21)) { last = done; js("window.onNetProgress&&onNetProgress(" + JSONObject.quote(cb) + "," + done + "," + tot + ")"); } } }
                    }
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) { u = new java.net.URL(new java.net.URL(u), c.getHeaderField("Location")).toString(); c.disconnect(); continue; }
                    break;
                }
                int code = c.getResponseCode(); r.put("status", code);
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                if (download != null && !download.isEmpty() && code < 300) {
                    File f = new File(getCacheDir(), new File(download).getName());
                    long tot = c.getContentLengthLong(), done = 0, last = 0;
                    try (OutputStream o = new java.io.FileOutputStream(f)) { byte[] b = new byte[1 << 16]; int n; while ((n = in.read(b)) > 0) { o.write(b, 0, n); done += n; if (done - last > (1 << 21)) { last = done; js("window.onNetProgress&&onNetProgress(" + JSONObject.quote(cb) + "," + done + "," + tot + ")"); } } }
                    r.put("file", f.getName()); r.put("size", f.length());
                } else if (in != null) r.put("text", new String(Net.readAll(in), "UTF-8"));
            } catch (Exception e) { try { r.put("status", 0); r.put("text", String.valueOf(e)); } catch (Exception x) { } }
            js("window.onNetDone&&onNetDone(" + JSONObject.quote(cb) + "," + JSONObject.quote(r.toString()) + ")");
        }).start();
    }
    void delCache(String name) { try { new File(getCacheDir(), new File(name).getName()).delete(); } catch (Exception e) { } }

    WebResourceResponse proxy(String url) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        if (url == null || !url.startsWith("https://")) return new WebResourceResponse("text/plain", "utf-8", 400, "Bad Request", h, null);
        try {
            Net.Resp r = Net.open(url, null, 30000);
            String m = r.mime == null ? "application/octet-stream" : r.mime.split(";")[0].trim();
            return new WebResourceResponse(m, m.contains("json") || m.startsWith("text") ? "utf-8" : null, r.code, r.code < 300 ? "OK" : "Error", h, r.stream);
        } catch (Exception e) { return new WebResourceResponse("text/plain", "utf-8", 502, "Bad Gateway", h, null); }
    }

    /** 用系統下載管理員下載 APK，完成後跳出安裝畫面 */
    long dlId = -1;
    void downloadApk(String url, String name) {
        try {
            android.app.DownloadManager dm = (android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            android.app.DownloadManager.Request q = new android.app.DownloadManager.Request(Uri.parse(url))
                    .setTitle(name).setDescription("AI修圖軟體 安裝檔").setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            dlId = dm.enqueue(q);
            android.content.BroadcastReceiver br = new android.content.BroadcastReceiver() {
                public void onReceive(android.content.Context c, Intent i) {
                    long id = i.getLongExtra(android.app.DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id != dlId) return;
                    try { unregisterReceiver(this); } catch (Exception e) { }
                    Uri u = dm.getUriForDownloadedFile(id);
                    js("window.onNativeEvent&&onNativeEvent('apk'," + JSONObject.quote(u == null ? "fail" : "ok") + ")");
                    if (u == null) return;
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(u, "application/vnd.android.package-archive")
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception e) { }
                }
            };
            android.content.IntentFilter f = new android.content.IntentFilter(android.app.DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(br, f, 0x2); else registerReceiver(br, f);
        } catch (Exception e) { js("window.onNativeEvent&&onNativeEvent('apk','fail')"); }
    }

    boolean hasLoc() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    void setLight(boolean light) {
        View d = getWindow().getDecorView();
        int f = d.getSystemUiVisibility();
        if (light) f |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        else f &= ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        d.setSystemUiVisibility(f);
    }
    void setDark(boolean dark) {
        runOnUiThread(() -> {
            int c = Color.parseColor(dark ? "#1d1812" : "#efe5d3");
            getWindow().setStatusBarColor(c); getWindow().setNavigationBarColor(c); web.setBackgroundColor(c); setLight(!dark);
        });
    }
    void keepScreen(boolean on) {
        runOnUiThread(() -> { if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
    }
    void requestPerm(String kind) {
        runOnUiThread(() -> {
            pendingPerm = kind;
            if ("loc".equals(kind)) requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 11);
            else if ("notif".equals(kind)) { if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 12); else openAppSettings(); }
            else if ("media".equals(kind)) {
                if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.READ_MEDIA_IMAGES", "android.permission.ACCESS_MEDIA_LOCATION"}, 14);
                else if (Build.VERSION.SDK_INT >= 29) requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, "android.permission.ACCESS_MEDIA_LOCATION"}, 14);
                else requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE}, 14);
            }
            else if ("install".equals(kind)) { try { startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); } catch (Exception e) { } }
        });
    }
    void openAppSettings() {
        runOnUiThread(() -> { try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); } catch (Exception e) { } });
    }
    void openUrl(String u) { runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u))); } catch (Exception e) { } }); }
    void share(String uri, String mime) {
        runOnUiThread(() -> { try { startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, Uri.parse(uri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "分享照片")); } catch (Exception e) { } });
    }
    void js(String code) { runOnUiThread(() -> { if (web != null) web.evaluateJavascript(code, null); }); }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == 11 && geoCb != null) { geoCb.invoke(geoOrigin, hasLoc(), false); geoCb = null; }
        js("window.onNativeEvent&&onNativeEvent('perm'," + JSONObject.quote(pendingPerm == null ? "" : pendingPerm) + ")");
    }
    @Override protected void onResume() { super.onResume(); if (web != null) js("window.onNativeEvent&&onNativeEvent('resume')"); }
    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); if (web != null) web.saveState(o); }
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.onAndroidBack?String(window.onAndroidBack()):'false'", v -> { if (v == null || !v.contains("true")) moveTaskToBack(true); });
    }
}
