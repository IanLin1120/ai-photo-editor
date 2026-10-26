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
        @JavascriptInterface public boolean has() { return act != null && Geo.has(act); }
        @JavascriptInterface public void request() {
            final MainActivity a = act; if (a == null) return;
            a.runOnUiThread(new Runnable() { public void run() { a.requestPermissions(PERMS, REQ_LOC); } });
        }
    }
}
