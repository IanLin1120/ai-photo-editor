package com.ian.aiphoto;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.provider.MediaStore;
import android.database.Cursor;
import android.content.ContentUris;
import android.content.pm.ResolveInfo;
import java.util.List;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;
import android.net.Uri;
import android.os.Message;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/* v1.13：地圖「目前位置」需要的定位權限。包住原本的 WebChromeClient（選檔、主控台訊息照舊），只多處理定位。 */
public class Geo {
    static final int REQ_LOC = 77;
    static final String[] PERMS = { "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION" };
    static MainActivity act;
    static Uri editSrc; static long editT0, editMod; static boolean editTemp = true;
    static long modified(MainActivity a, Uri u) {
        try { Cursor c = a.getContentResolver().query(u, new String[] { MediaStore.Images.Media.DATE_MODIFIED, MediaStore.Images.Media.SIZE }, null, null, null); if (c == null) return 0; try { return c.moveToFirst() ? c.getLong(0) * 1000003L + c.getLong(1) : 0; } finally { c.close(); } } catch (Throwable t) { return 0; }
    }
    static GeolocationPermissions.Callback pendCb;
    static String pendOrigin;

    static boolean has(MainActivity a) {
        return a.checkSelfPermission(PERMS[0]) == PackageManager.PERMISSION_GRANTED || a.checkSelfPermission(PERMS[1]) == PackageManager.PERMISSION_GRANTED;
    }

    public static void install(final MainActivity a) {
        act = a;
        final WebView w = a.web;
        if (w == null) return;
        try { w.getSettings().setGeolocationEnabled(true); } catch (Throwable t) { }
        w.addJavascriptInterface(new Js(), "AIP2");
        final WebChromeClient base = w.getWebChromeClient();
        w.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) { return base != null ? base.onShowFileChooser(v, cb, p) : false; }
            @Override public boolean onConsoleMessage(ConsoleMessage m) { return base != null ? base.onConsoleMessage(m) : false; }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (has(act)) { cb.invoke(origin, true, false); return; }
                pendCb = cb; pendOrigin = origin;
                act.requestPermissions(PERMS, REQ_LOC);
            }
        });
    }

    /* 由 MainActivity.onRequestPermissionsResult 呼叫；回傳 true 表示已處理 */
    /* v1.17：App 從「最近使用」被滑掉（Activity 結束、不是旋轉螢幕）→ 通知網頁取消進行中的匯出 */
    public static void onDestroy(MainActivity a) {
        try {
            if (a.isChangingConfigurations()) return;
            WebView w = a.web; if (w != null) w.evaluateJavascript("window.onNativeEvent&&onNativeEvent('closed','')", null);
        } catch (Throwable t) { }
    }

    public static boolean onPerm(MainActivity a, int code) {
        if (code != REQ_LOC) return false;
        boolean ok = has(a);
        if (pendCb != null) { try { pendCb.invoke(pendOrigin, ok, false); } catch (Throwable t) { } pendCb = null; }
        a.js("window.onNativeEvent&&onNativeEvent('perm','loc')");
        return true;
    }

    /* ---------- v1.14：App 內下載並安裝新版 APK（PackageInstaller，系統會跳出「要更新這個應用程式嗎？」） ---------- */
    static final String ACT_STATUS = "com.ian.aiphoto.INSTALL_STATUS";
    static boolean rcvReg = false;
    static void report(String state, double pct, String msg) {
        try { JSONObject o = new JSONObject(); o.put("state", state); o.put("pct", pct); o.put("msg", msg == null ? "" : msg);
            if (act != null) act.js("window.onNativeEvent&&onNativeEvent('apk'," + JSONObject.quote(o.toString()) + ")"); } catch (Throwable t) { }
    }
    static void download(String url, File out) throws Exception {
        String u = url;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setInstanceFollowRedirects(false); c.setConnectTimeout(20000); c.setReadTimeout(60000);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) { u = new URL(new URL(u), c.getHeaderField("Location")).toString(); c.disconnect(); continue; }
            if (code != 200) throw new Exception("HTTP " + code);
            long len = c.getContentLengthLong(), got = 0; long last = 0;
            InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out); byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) > 0) { os.write(buf, 0, n); got += n; long now = System.currentTimeMillis(); if (now - last > 400) { last = now; report("download", len > 0 ? (double) got / len : -1, null); } }
            os.close(); in.close(); c.disconnect();
            if (len > 0 && got != len) throw new Exception("下載不完整");
            return;
        }
        throw new Exception("轉址太多次");
    }
    static void install(File f) throws Exception {
        final Context app = act.getApplicationContext();
        if (!rcvReg) {
            BroadcastReceiver r = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) {
                    int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999);
                    if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                        Intent conf = (Intent) i.getParcelableExtra(Intent.EXTRA_INTENT);
                        if (conf != null) { conf.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); try { (act != null ? act : c).startActivity(conf); } catch (Throwable t) { report("error", 0, t.toString()); } }
                        report("confirm", 1, null);
                    } else if (st == PackageInstaller.STATUS_SUCCESS) report("done", 1, null);
                    else report("error", 0, i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
                }
            };
            IntentFilter flt = new IntentFilter(ACT_STATUS);
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(r, flt, 2 /* RECEIVER_EXPORTED */); else app.registerReceiver(r, flt);
            rcvReg = true;
        }
        PackageInstaller pi = app.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        sp.setAppPackageName(app.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) sp.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = pi.createSession(sp);
        PackageInstaller.Session s = pi.openSession(id);
        OutputStream os = s.openWrite("app.apk", 0, f.length()); InputStream in = new FileInputStream(f); byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        s.fsync(os); os.close(); in.close();
        Intent it = new Intent(ACT_STATUS).setPackage(app.getPackageName());
        PendingIntent pin = PendingIntent.getBroadcast(app, id, it, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? 33554432 /* FLAG_MUTABLE */ : 0));
        report("installing", 1, null);
        s.commit(pin.getIntentSender()); s.close();
    }

    static class Js {
        @JavascriptInterface public boolean canInstall() { return act != null && act.getPackageManager().canRequestPackageInstalls(); }
        @JavascriptInterface public void askInstall() {
            final MainActivity a = act; if (a == null) return;
            a.runOnUiThread(new Runnable() { public void run() { try { a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))); } catch (Throwable t) { } } });
        }
        @JavascriptInterface public void installApk(final String url) {
            new Thread(new Runnable() { public void run() {
                try { File f = new File(act.getCacheDir(), "update.apk"); report("download", 0, null); download(url, f); install(f); }
                catch (Throwable t) { report("error", 0, t.getMessage() == null ? t.toString() : t.getMessage()); }
            } }).start();
        }
        /* v1.18：用手機內建相簿（例如 OPPO 相簿的「AI 圖像助理 → AI 消除」）編輯剛存好的那張 → 回到 App 後取回結果，相片名稱維持原本的 */
        @JavascriptInterface public String editLast(final String pkgPref) {
            final MainActivity a = act; if (a == null) return "{\"ok\":false,\"err\":\"no activity\"}";
            Uri u = null; synchronized (MainActivity.lastSaved) { if (!MainActivity.lastSaved.isEmpty()) u = MainActivity.lastSaved.get(MainActivity.lastSaved.size() - 1); }
            if (u == null) return "{\"ok\":false,\"err\":\"沒有暫存檔\"}";
            final Uri src = u; editSrc = src; editTemp = true; editT0 = System.currentTimeMillis() / 1000 - 3; editMod = modified(a, src);
            final Intent it = new Intent(Intent.ACTION_EDIT); it.setDataAndType(src, "image/jpeg");
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            String used = "";
            try {
                List<ResolveInfo> L = a.getPackageManager().queryIntentActivities(it, 0);
                String[] pref = (pkgPref == null || pkgPref.isEmpty() ? "com.coloros.gallery3d,com.oplus.gallery,com.oneplus.gallery,com.oppo.gallery3d" : pkgPref).split(",");
                for (String p : pref) for (ResolveInfo r : L) if (r.activityInfo != null && p.equals(r.activityInfo.packageName)) { if (used.isEmpty()) { it.setClassName(r.activityInfo.packageName, r.activityInfo.name); used = p; } }
                JSONObject o = new JSONObject(); o.put("ok", true); o.put("pkg", used); o.put("src", src.toString()); o.put("t0", editT0); o.put("mod", editMod); org.json.JSONArray arr = new org.json.JSONArray(); for (ResolveInfo r : L) if (r.activityInfo != null) arr.put(r.activityInfo.packageName); o.put("apps", arr);
                final boolean direct = !used.isEmpty();
                a.runOnUiThread(new Runnable() { public void run() { try { a.startActivity(direct ? it : Intent.createChooser(it, "用哪個 App 編輯")); } catch (Throwable t) { a.js("window.toast&&toast('找不到可以編輯相片的 App')"); } } });
                return o.toString();
            } catch (Throwable t) { return "{\"ok\":false,\"err\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}"; }
        }
        /* v1.19.2：用指定的 App 開啟（例如 Lightroom：把原始 RAW 分享過去修圖，存回相簿後由 App 取回）
           mode = "send"（分享／匯入）或 "edit"（編輯）；uri 空白＝剛存好的暫存 JPG */
        @JavascriptInterface public String openWith(final String uriStr, final String pkg, final String mode) {
            final MainActivity a = act; if (a == null) return "{\"ok\":false,\"err\":\"no activity\"}";
            try {
                Uri u = null; boolean temp = uriStr == null || uriStr.isEmpty();
                if (temp) { synchronized (MainActivity.lastSaved) { if (!MainActivity.lastSaved.isEmpty()) u = MainActivity.lastSaved.get(MainActivity.lastSaved.size() - 1); } } else u = Uri.parse(uriStr);
                if (u == null) return "{\"ok\":false,\"err\":\"沒有檔案\"}";
                String mime = null; try { mime = a.getContentResolver().getType(u); } catch (Throwable t) { }
                if (mime == null) mime = "image/*";
                final Intent it;
                if ("send".equals(mode)) { it = new Intent(Intent.ACTION_SEND); it.setType(mime); it.putExtra(Intent.EXTRA_STREAM, u); it.setClipData(android.content.ClipData.newRawUri("", u)); }
                else { it = new Intent(Intent.ACTION_EDIT); it.setDataAndType(u, mime); }
                it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | ("send".equals(mode) ? 0 : Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
                if (pkg != null && !pkg.isEmpty()) { it.setPackage(pkg); if (it.resolveActivity(a.getPackageManager()) == null) return "{\"ok\":false,\"err\":\"notInstalled\"}"; }
                editSrc = u; editTemp = temp; editT0 = System.currentTimeMillis() / 1000 - 3; editMod = modified(a, u);
                a.runOnUiThread(new Runnable() { public void run() { try { a.startActivity(it); } catch (Throwable t) { a.js("window.toast&&toast('無法開啟該 App')"); } } });
                JSONObject o = new JSONObject(); o.put("ok", true); o.put("src", u.toString()); o.put("t0", editT0); o.put("mod", editMod); o.put("mime", mime); return o.toString();
            } catch (Throwable t) { return "{\"ok\":false,\"err\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}"; }
        }
        @JavascriptInterface public boolean hasApp(String pkg) { try { return act != null && act.getPackageManager().getLaunchIntentForPackage(pkg) != null; } catch (Throwable t) { return false; } }
        /* v1.18.1：App 在背景被系統關掉再開時，原本記在記憶體裡的資料會不見 → 由網頁把記錄傳回來 */
        @JavascriptInterface public String editResult3(String src, double t0, double mod, boolean temp) { editTemp = temp; return editResult2(src, t0, mod); }
        @JavascriptInterface public String editResult2(String src, double t0, double mod) {
            try { if (src != null && !src.isEmpty()) editSrc = Uri.parse(src); if (t0 > 0) editT0 = (long) t0; if (mod != 0) editMod = (long) mod; } catch (Throwable t) { }
            return editResult();
        }
        /* 找編輯結果：① 編輯期間新增的相片（另存新檔）② 原檔被覆寫 */
        @JavascriptInterface public String editResult() {
            final MainActivity a = act; if (a == null || editSrc == null) return "{\"state\":\"none\"}";
            try {
                JSONObject o = new JSONObject(); long srcId = -1; try { srcId = ContentUris.parseId(editSrc); } catch (Throwable t) { }
                Uri base = MediaStore.Images.Media.EXTERNAL_CONTENT_URI; Uri hit = null; String name = "";
                Cursor c = a.getContentResolver().query(base, new String[] { MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME }, "(" + MediaStore.Images.Media.DATE_ADDED + ">=? OR " + MediaStore.Images.Media.DATE_MODIFIED + ">=?)", new String[] { String.valueOf(editT0), String.valueOf(editT0) }, MediaStore.Images.Media.DATE_MODIFIED + " DESC");
                if (c != null) { try { while (c.moveToNext()) { long id = c.getLong(0); if (id == srcId) continue; hit = ContentUris.withAppendedId(base, id); name = c.getString(1); break; } } finally { c.close(); } }
                String state = "none";
                if (hit != null) state = "new"; else if (modified(a, editSrc) > editMod) { hit = editSrc; state = "same"; }
                o.put("state", state);
                if (hit != null) { String key = "ext" + System.currentTimeMillis(); MainActivity.pickedUris.put(key, hit); o.put("key", key); o.put("name", name); o.put("uri", hit.toString()); }
                return o.toString();
            } catch (Throwable t) { return "{\"state\":\"error\",\"err\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}"; }
        }
        /* 刪掉 App 自己建立的暫存檔（不會刪到相簿裡別的相片） */
        @JavascriptInterface public boolean editCleanup() {
            final MainActivity a = act; if (a == null || editSrc == null) return false;
            if (!editTemp) { editSrc = null; return false; }   // 不是 App 自己建立的暫存檔（例如原始 RAW）：絕對不刪
            try { a.getContentResolver().delete(editSrc, null, null); editSrc = null; return true; } catch (Throwable t) { return false; }
        }
        @JavascriptInterface public boolean has() { return act != null && Geo.has(act); }
        @JavascriptInterface public void request() {
            final MainActivity a = act; if (a == null) return;
            a.runOnUiThread(new Runnable() { public void run() { a.requestPermissions(PERMS, REQ_LOC); } });
        }
    }
}
