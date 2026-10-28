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
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import java.util.ArrayList;
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
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Vibrator;
import android.os.VibrationEffect;
import android.database.ContentObserver;
import android.graphics.PixelFormat;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

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
    static final Handler main = new Handler(Looper.getMainLooper());
    static PowerManager.WakeLock wl;

    /* 找編輯結果：回傳 { state, uri, name, size } */
    /* v1.21.2：開始編輯時先記下相簿目前的狀態（基準），之後只把「真的新增的相片」或「原檔大小改變」當成修好的結果。
       剛存好的暫存檔、Lightroom 副本在系統掃描完成時會更新時間（之前會被誤判成已經修好）→ 開始後 6 秒內的變動一律併入基準 */
    static java.util.HashMap<Long, String> baseSig; static long editStart = 0, srcSize = -1;
    static long sizeOf(MainActivity a, Uri u) { try { Cursor c = a.getContentResolver().query(u, new String[] { MediaStore.Images.Media.SIZE }, null, null, null); if (c == null) return -1; try { return c.moveToFirst() ? c.getLong(0) : -1; } finally { c.close(); } } catch (Throwable t) { return -1; } }
    static Cursor recent(MainActivity a, long since) {
        String[] cols = Build.VERSION.SDK_INT >= 29 ? new String[] { MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.SIZE, MediaStore.Images.Media.DATE_MODIFIED, MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.IS_PENDING }
            : new String[] { MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.SIZE, MediaStore.Images.Media.DATE_MODIFIED, MediaStore.Images.Media.DATE_ADDED };
        return a.getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cols, "(" + MediaStore.Images.Media.DATE_ADDED + ">=? OR " + MediaStore.Images.Media.DATE_MODIFIED + ">=?)", new String[] { String.valueOf(since), String.valueOf(since) }, MediaStore.Images.Media.DATE_MODIFIED + " DESC");
    }
    static void snapshot(MainActivity a) {
        editStart = System.currentTimeMillis(); baseSig = new java.util.HashMap<Long, String>(); srcSize = editSrc != null ? sizeOf(a, editSrc) : -1;
        try { Cursor c = recent(a, editStart / 1000 - 900); if (c != null) { try { while (c.moveToNext()) baseSig.put(c.getLong(0), c.getLong(3) + ":" + c.getLong(2)); } finally { c.close(); } } } catch (Throwable t) { }
    }
    static Object[] find(MainActivity a) {
        long srcId = -1; try { srcId = ContentUris.parseId(editSrc); } catch (Throwable t) { }
        Uri base = MediaStore.Images.Media.EXTERNAL_CONTENT_URI; Uri hit = null; String name = ""; long size = 0;
        boolean have = baseSig != null && editStart > 0, grace = have && System.currentTimeMillis() - editStart < 6000;
        Cursor c = recent(a, have ? editStart / 1000 - 900 : editT0);
        if (c != null) { try { while (c.moveToNext()) {
            long id = c.getLong(0); if (id == srcId) continue; long sz = c.getLong(2); if (sz <= 0) continue;
            if (c.getColumnCount() > 5 && c.getInt(5) != 0) continue;   // 還在寫入中
            if (have) { if (baseSig.containsKey(id)) continue; if (grace || c.getLong(4) < editStart / 1000 - 2) { baseSig.put(id, c.getLong(3) + ":" + sz); continue; } }
            else if (c.getLong(4) < editT0 + 3) continue;   // App 重新啟動後沒有基準：只認開始編輯之後才新增的相片
            hit = ContentUris.withAppendedId(base, id); name = c.getString(1); size = sz; break;
        } } finally { c.close(); } }
        String state = "none";
        if (hit != null) state = "new";
        else if (editSrc != null) {
            long sz = sizeOf(a, editSrc);
            if (have) { if (grace || srcSize <= 0) { if (sz > 0) srcSize = sz; } else if (sz > 0 && sz != srcSize) { hit = editSrc; state = "same"; size = sz; } }
            else { long m = modified(a, editSrc); if (m > editMod) { hit = editSrc; state = "same"; size = m; } }
        }
        return new Object[] { state, hit, name, size };
    }
    static boolean canManage(Context a) { try { return Build.VERSION.SDK_INT >= 31 && MediaStore.canManageMedia(a); } catch (Throwable t) { return false; } }
    static void buzz(String pattern) {
        try {
            Vibrator v = (Vibrator) act.getSystemService(Context.VIBRATOR_SERVICE); if (v == null || !v.hasVibrator()) return;
            long[] p = { 0, 180, 110, 180 };
            if (pattern != null && !pattern.isEmpty()) { String[] s = pattern.split(","); p = new long[s.length]; for (int i = 0; i < s.length; i++) p[i] = Long.parseLong(s[i].trim()); }
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(p, -1)); else v.vibrate(p, -1);
        } catch (Throwable t) { }
    }
    /* ---------- 浮動提示視窗 ---------- */
    static LinearLayout pop; static Runnable popAuto;
    /* v1.21.1：提示窗配色跟 App 一致（由網頁傳入目前主題的顏色） */
    static int cBg = 0xFFF6EEE1, cFg = 0xFF3A2A1F, cSub = 0xFF6E5B4A, cAcc = 0xFFA2613A, cLine = 0x33A2613A;
    static void hidePopup() { try { if (pop != null) ((WindowManager) act.getApplicationContext().getSystemService(Context.WINDOW_SERVICE)).removeView(pop); } catch (Throwable t) { } pop = null; if (popAuto != null) main.removeCallbacks(popAuto); }
    static void bringBack() {
        try { Context app = act.getApplicationContext(); Intent i = new Intent(app, MainActivity.class); i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT); app.startActivity(i); } catch (Throwable t) { }
    }
    static boolean popup(final String title, final String text, final String btn) {
        if (act == null) return false;
        try { if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(act)) return false; } catch (Throwable t) { return false; }
        main.post(new Runnable() { public void run() {
            try {
                hidePopup();
                final Context app = act.getApplicationContext(); final float d = app.getResources().getDisplayMetrics().density; final int sh = app.getResources().getDisplayMetrics().heightPixels;
                WindowManager wm = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);
                LinearLayout box = new LinearLayout(app); box.setOrientation(LinearLayout.VERTICAL); int pd = (int) (18 * d); box.setPadding(pd, (int) (16 * d), pd, (int) (12 * d));
                GradientDrawable bg = new GradientDrawable(); bg.setColor(cBg); bg.setCornerRadius(24 * d); bg.setStroke((int) (1.5f * d), cLine); box.setBackground(bg); box.setElevation(16 * d);
                LinearLayout head = new LinearLayout(app); head.setOrientation(LinearLayout.HORIZONTAL); head.setGravity(Gravity.CENTER_VERTICAL);
                try { android.widget.ImageView ic = new android.widget.ImageView(app); ic.setImageDrawable(app.getApplicationInfo().loadIcon(app.getPackageManager())); int is = (int) (40 * d); LinearLayout.LayoutParams il = new LinearLayout.LayoutParams(is, is); il.setMargins(0, 0, (int) (12 * d), 0); head.addView(ic, il); } catch (Throwable t) { }
                LinearLayout tx = new LinearLayout(app); tx.setOrientation(LinearLayout.VERTICAL);
                TextView t1 = new TextView(app); t1.setText(title); t1.setTextColor(cFg); t1.setTextSize(17); t1.setTypeface(null, android.graphics.Typeface.BOLD); tx.addView(t1);
                TextView t2 = new TextView(app); t2.setText(text); t2.setTextColor(cSub); t2.setTextSize(14); t2.setPadding(0, (int) (3 * d), 0, 0); tx.addView(t2);
                head.addView(tx, new LinearLayout.LayoutParams(0, -2, 1f)); box.addView(head);
                LinearLayout row = new LinearLayout(app); row.setOrientation(LinearLayout.HORIZONTAL); row.setGravity(Gravity.END); row.setPadding(0, (int) (12 * d), 0, 0);
                TextView later = new TextView(app); later.setText("稍後"); later.setTextColor(cAcc); later.setTextSize(15); later.setPadding((int) (18 * d), (int) (10 * d), (int) (18 * d), (int) (10 * d));
                GradientDrawable lb = new GradientDrawable(); lb.setColor((cAcc & 0x00FFFFFF) | 0x1A000000); lb.setCornerRadius(22 * d); later.setBackground(lb);
                later.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { hidePopup(); } });
                TextView go = new TextView(app); go.setText(btn == null || btn.isEmpty() ? "切回 AI修圖" : btn); go.setTextColor(Color.WHITE); go.setTextSize(15); go.setTypeface(null, android.graphics.Typeface.BOLD); go.setPadding((int) (22 * d), (int) (10 * d), (int) (22 * d), (int) (10 * d));
                GradientDrawable gb = new GradientDrawable(); gb.setColor(cAcc); gb.setCornerRadius(22 * d); go.setBackground(gb);
                LinearLayout.LayoutParams gl = new LinearLayout.LayoutParams(-2, -2); gl.setMargins((int) (10 * d), 0, 0, 0); go.setLayoutParams(gl);
                go.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { hidePopup(); bringBack(); } });
                row.addView(later); row.addView(go); box.addView(row);
                box.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { hidePopup(); bringBack(); } });
                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT);
                lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL; lp.y = (int) (sh * 0.26); int m = (int) (14 * d);
                box.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
                LinearLayout wrap = new LinearLayout(app); wrap.setPadding(m, 0, m, 0); wrap.addView(box, new LinearLayout.LayoutParams(-1, -2));
                wm.addView(wrap, lp); pop = wrap;
                popAuto = new Runnable() { public void run() { hidePopup(); } }; main.postDelayed(popAuto, 90000);
            } catch (Throwable t) { }
        } });
        return true;
    }
    /* ---------- 原生相簿監看 ---------- */
    static ContentObserver obs; static String wTitle, wText, lastSig = ""; static long watchUntil = 0; static boolean checking = false;
    static final Runnable tick = new Runnable() { public void run() { main.removeCallbacks(tick); long nx = check(); if (obs != null) main.postDelayed(tick, nx); } };
    static void startWatch() {
        stopWatch(); if (act == null) return; watchUntil = System.currentTimeMillis() + 45 * 60 * 1000L; lastSig = "";
        obs = new ContentObserver(main) { @Override public void onChange(boolean self) { main.removeCallbacks(tick); main.postDelayed(tick, 250); } };
        try { act.getContentResolver().registerContentObserver(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, obs); } catch (Throwable t) { }
        main.postDelayed(tick, 1200);
    }
    static void stopWatch() { if (obs != null) { try { act.getContentResolver().unregisterContentObserver(obs); } catch (Throwable t) { } } obs = null; main.removeCallbacks(tick); }
    /* 回傳下次檢查的間隔（毫秒）：剛看到新檔案時 0.6 秒後再確認一次大小（確定寫完），平常每 1.2 秒 */
    static long check() {
        if (act == null || editSrc == null || obs == null) return 1200;
        if (System.currentTimeMillis() > watchUntil) { stopWatch(); return 1200; }
        try {
            Object[] f = find(act); Uri hit = (Uri) f[1]; if (hit == null) { lastSig = ""; return 1200; }
            String sig = hit.toString() + ":" + f[3];
            if (!sig.equals(lastSig)) { lastSig = sig; return 600; }   // 等檔案寫完（大小連續兩次一樣）
            stopWatch();
            buzz(null);
            String t = wTitle == null ? "✓ 修圖結果已儲存" : wTitle, x = wText == null ? "點這裡切回 AI修圖" : wText;
            if (!popup(t, x, "切回 AI修圖")) new Js().alert(t, x);
            JSONObject o = new JSONObject(); o.put("state", (String) f[0]); o.put("uri", hit.toString()); o.put("name", (String) f[2]);
            act.js("window.onNativeEvent&&onNativeEvent('extFound'," + JSONObject.quote(o.toString()) + ")");
        } catch (Throwable t) { }
        return 1200;
    }

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
            final Uri src = u; editSrc = src; editTemp = true; editT0 = System.currentTimeMillis() / 1000 - 3; editMod = modified(a, src); snapshot(a);
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
                editSrc = u; editTemp = temp; editT0 = System.currentTimeMillis() / 1000 - 3; editMod = modified(a, u); snapshot(a);
                a.runOnUiThread(new Runnable() { public void run() { try { a.startActivity(it); } catch (Throwable t) { a.js("window.toast&&toast('無法開啟該 App')"); } } });
                JSONObject o = new JSONObject(); o.put("ok", true); o.put("src", u.toString()); o.put("t0", editT0); o.put("mod", editMod); o.put("mime", mime); return o.toString();
            } catch (Throwable t) { return "{\"ok\":false,\"err\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}"; }
        }
        /* v1.20：橫幅通知（會浮在 Lightroom 等其他 App 的畫面上方），點一下回到這個 App */
        @JavascriptInterface public void alert(String title, String text) {
            final MainActivity a = act; if (a == null) return;
            try {
                NotificationManager nm = (NotificationManager) a.getSystemService(Context.NOTIFICATION_SERVICE);
                if (Build.VERSION.SDK_INT >= 26) { NotificationChannel ch = new NotificationChannel("aiphoto_alert", "修圖流程提醒", NotificationManager.IMPORTANCE_HIGH); ch.enableVibration(true); ch.setVibrationPattern(new long[] { 0, 120, 80, 120 }); nm.createNotificationChannel(ch); }
                Intent i = new Intent(a, MainActivity.class); i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                PendingIntent pi = PendingIntent.getActivity(a, 7701, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(a, "aiphoto_alert") : new Notification.Builder(a);
                b.setSmallIcon(a.getApplicationInfo().icon).setContentTitle(title).setContentText(text).setAutoCancel(true).setContentIntent(pi)
                 .setCategory(Notification.CATEGORY_REMINDER).setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_VIBRATE)
                 .addAction(new Notification.Action.Builder(null, "繼續修圖", pi).build());
                nm.notify(7701, b.build()); buzz(null);
            } catch (Throwable t) { }
        }
        @JavascriptInterface public void alertSettings() {
            final MainActivity a = act; if (a == null) return;
            a.runOnUiThread(new Runnable() { public void run() { try {
                Intent i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS); i.putExtra(Settings.EXTRA_APP_PACKAGE, a.getPackageName()); i.putExtra(Settings.EXTRA_CHANNEL_ID, "aiphoto_alert"); a.startActivity(i);
            } catch (Throwable t) { try { Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS); i.putExtra(Settings.EXTRA_APP_PACKAGE, a.getPackageName()); a.startActivity(i); } catch (Throwable t2) { } } } });
        }
        @JavascriptInterface public void alertClear() { try { ((NotificationManager) act.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(7701); } catch (Throwable t) { } }
        /* v1.20：刪除相簿裡其他 App 存的相片（Lightroom 副本、手機相簿另存的那張）— 系統會在這個 App 裡跳出一次確認 */
        @JavascriptInterface public boolean deleteMedia(String json) {
            final MainActivity a = act; if (a == null) return false;
            try {
                org.json.JSONArray arr = new org.json.JSONArray(json); final ArrayList<Uri> L = new ArrayList<Uri>();
                for (int k = 0; k < arr.length(); k++) L.add(Uri.parse(arr.getString(k)));
                if (L.isEmpty()) return false;
                if (Build.VERSION.SDK_INT >= 30) {
                    final PendingIntent pi = MediaStore.createDeleteRequest(a.getContentResolver(), L);
                    if (!canManage(a)) buzz("0,60,60,60");   // 系統確認視窗跳出時震動提醒
                    a.runOnUiThread(new Runnable() { public void run() { try { a.startIntentSenderForResult(pi.getIntentSender(), 7781, null, 0, 0, 0); } catch (Throwable t) { a.js("window.toast&&toast('無法刪除：" + "'+'" + "')"); } } });
                } else { for (Uri u : L) { try { a.getContentResolver().delete(u, null, null); } catch (Throwable t) { } } }
                return true;
            } catch (Throwable t) { return false; }
        }
        /* v1.21.2：「媒體管理」特殊權限（Android 12 以上）：允許後刪除相簿副本不用每次按「允許」 */
        @JavascriptInterface public boolean canManageMedia() { return act != null && canManage(act); }
        @JavascriptInterface public void askManageMedia() {
            final MainActivity a = act; if (a == null || Build.VERSION.SDK_INT < 31) return;
            a.runOnUiThread(new Runnable() { public void run() { try { a.startActivity(new Intent("android.settings.REQUEST_MANAGE_MEDIA", Uri.parse("package:" + a.getPackageName()))); } catch (Throwable t) { try { a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + a.getPackageName()))); } catch (Throwable t2) { } } } });
        }
        @JavascriptInterface public boolean hasApp(String pkg) { try { return act != null && act.getPackageManager().getLaunchIntentForPackage(pkg) != null; } catch (Throwable t) { return false; } }
        /* v1.18.1：App 在背景被系統關掉再開時，原本記在記憶體裡的資料會不見 → 由網頁把記錄傳回來 */
        @JavascriptInterface public String editResult3(String src, double t0, double mod, boolean temp) { editTemp = temp; return editResult2(src, t0, mod); }
        @JavascriptInterface public String editResult2(String src, double t0, double mod) {
            try { Uri u = src != null && !src.isEmpty() ? Uri.parse(src) : null; if (baseSig == null || editSrc == null || (u != null && !u.equals(editSrc))) { baseSig = null; editStart = 0; if (u != null) editSrc = u; if (t0 > 0) editT0 = (long) t0; if (mod != 0) editMod = (long) mod; } } catch (Throwable t) { }
            return editResult();
        }
        /* 找編輯結果：① 編輯期間新增的相片（另存新檔）② 原檔被覆寫 */
        @JavascriptInterface public String editResult() {
            final MainActivity a = act; if (a == null || editSrc == null) return "{\"state\":\"none\"}";
            try {
                Object[] f = find(a); JSONObject o = new JSONObject(); o.put("state", (String) f[0]);
                Uri hit = (Uri) f[1];
                if (hit != null) { String key = "ext" + System.currentTimeMillis(); MainActivity.pickedUris.put(key, hit); o.put("key", key); o.put("name", (String) f[2]); o.put("uri", hit.toString()); }
                return o.toString();
            } catch (Throwable t) { return "{\"state\":\"error\",\"err\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}"; }
        }
        /* v1.21：震動（所有完成通知都會震動） */
        @JavascriptInterface public void vibrate(String pattern) { buzz(pattern); }
        /* v1.21：匯出時保持 CPU 運作（螢幕關閉也繼續），結束後放開 */
        @JavascriptInterface public void wake(boolean on) {
            try {
                if (on) { if (wl == null) { PowerManager pm = (PowerManager) act.getSystemService(Context.POWER_SERVICE); wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "aiphoto:export"); wl.setReferenceCounted(false); } wl.acquire(3 * 60 * 60 * 1000L); }
                else if (wl != null && wl.isHeld()) wl.release();
            } catch (Throwable t) { }
        }
        /* v1.21：浮動提示視窗（顯示在其他 App 上面、螢幕下方約 1/3 的位置） */
        @JavascriptInterface public boolean canOverlay() { try { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(act); } catch (Throwable t) { return false; } }
        @JavascriptInterface public void askOverlay() {
            final MainActivity a = act; if (a == null) return;
            a.runOnUiThread(new Runnable() { public void run() { try { a.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + a.getPackageName()))); } catch (Throwable t) { } } });
        }
        @JavascriptInterface public boolean popup(String title, String text, String btn) { return Geo.popup(title, text, btn); }
        @JavascriptInterface public void popupTheme(String bg, String fg, String sub, String acc) {
            try { cBg = Color.parseColor(bg); cFg = Color.parseColor(fg); cSub = Color.parseColor(sub); cAcc = Color.parseColor(acc); cLine = (cAcc & 0x00FFFFFF) | 0x44000000; } catch (Throwable t) { }
        }
        @JavascriptInterface public void popupClear() { main.post(new Runnable() { public void run() { hidePopup(); } }); }
        /* v1.21：在原生端監看相簿（網頁在背景時計時器會被系統放慢，所以改由原生監看）
           找到結果 → 震動＋浮動提示（沒有權限就用橫幅通知）＋ onNativeEvent('extFound') */
        @JavascriptInterface public void watch(String src, double t0, double mod, final String title, final String text) {
            try { Uri u = src != null && !src.isEmpty() ? Uri.parse(src) : null; if (baseSig == null || editSrc == null || (u != null && !u.equals(editSrc))) { baseSig = null; editStart = 0; if (u != null) editSrc = u; if (t0 > 0) editT0 = (long) t0; if (mod != 0) editMod = (long) mod; } } catch (Throwable t) { }
            wTitle = title; wText = text; main.post(new Runnable() { public void run() { startWatch(); } });
        }
        @JavascriptInterface public void unwatch() { main.post(new Runnable() { public void run() { stopWatch(); } }); }
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
