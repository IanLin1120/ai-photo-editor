/* 線上更新開機程式：手機上若已下載比 APK 內建更新的介面版本，就改用新版（存在 IndexedDB）。
   新版連續兩次沒有正常開啟 → 自動退回 APK 內建版本。網址加上 #builtin 也會強制使用內建版本。 */
(function () {
  var B = '__VER__'; window.APP_BUILTIN = B;
  if (window.__OTA || location.hash.indexOf('builtin') >= 0) return;
  var v = null; try { v = JSON.parse(localStorage.getItem('aip.ota') || 'null'); } catch (e) {}
  function gt(a, b) { a = String(a).split('.').map(Number); b = String(b).split('.').map(Number); for (var i = 0; i < Math.max(a.length, b.length); i++) { var p = a[i] || 0, q = b[i] || 0; if (p !== q) return p > q; } return false; }
  if (!v || !gt(v.ver, B)) return;
  var apk = ''; try { apk = window.AIP && AIP.version ? AIP.version() : ''; } catch (e) {}
  if (v.minApk && apk && gt(v.minApk, apk)) return;               // 新介面需要更新的 APK：先用內建版本
  var fails = +(localStorage.getItem('aip.otaFail') || 0);
  if (fails >= 2) { localStorage.removeItem('aip.ota'); localStorage.removeItem('aip.otaFail'); return; }
  localStorage.setItem('aip.otaFail', String(fails + 1));
  document.write('<plaintext style="display:none">');   // 讓後面內建版本的內容不執行
  var back = function () { localStorage.removeItem('aip.ota'); location.replace(location.pathname + '#builtin'); location.reload(); };
  try {
    var rq = indexedDB.open('aip-ota', 1);
    rq.onupgradeneeded = function () { rq.result.createObjectStore('f'); };
    rq.onerror = back;
    rq.onsuccess = function () {
      try {
        var g = rq.result.transaction('f').objectStore('f').get('html');
        g.onerror = back;
        g.onsuccess = function () {
          var html = g.result;
          if (typeof html !== 'string' || html.indexOf("const APP_VERSION = '" + v.ver + "'") < 0) { back(); return; }
          window.__OTA = v.ver; document.open(); document.write(html); document.close();
        };
      } catch (e) { back(); }
    };
  } catch (e) { back(); }
})();
