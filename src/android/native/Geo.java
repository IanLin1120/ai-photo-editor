package com.ian.aiphoto;

import android.content.pm.PackageManager;
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

    static class Js {
        @JavascriptInterface public boolean has() { return act != null && Geo.has(act); }
        @JavascriptInterface public void request() {
            final MainActivity a = act; if (a == null) return;
            a.runOnUiThread(new Runnable() { public void run() { a.requestPermissions(PERMS, REQ_LOC); } });
        }
    }
}
