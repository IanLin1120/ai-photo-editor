/* ================= 版本與更新（GitHub：IanLin1120/ai-photo-editor） =================
   小改版：從 GitHub Pages 下載新的 index.html，存在手機裡，下次開啟直接使用（不用重裝 APK）
   大改版：version.json 的 minApk 比手機上的 APK 新 → 提示下載新 APK
   也可以挑任一版本的 APK 下載安裝 */
const GH = { user: 'IanLin1120', repo: 'ai-photo-editor',
  get pages() { return `https://${this.user.toLowerCase()}.github.io/${this.repo}/`; },
  get web() { return `https://github.com/${this.user}/${this.repo}`; } };
const Upd = {
  esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  gt(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const p = x[i] || 0, q = y[i] || 0; if (p !== q) return p > q; } return false; },
  apk() { return (isApp && NAT.call('version')) || ''; },
  /* App 正常開啟：清除失敗計數；之後自動檢查（最多 6 小時一次） */
  boot() {
    try { localStorage.removeItem('aip.otaFail'); } catch (e) {}
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.onResume(); try { Editor.extBack(); } catch (e) {} } });
    // v1.18.1：從手機相簿編輯回來時 App 若被系統重新開啟，啟動後也會自動取回
    setTimeout(() => { try { if (lsGet('aip.extPend', null)) { Editor.extWatch(); if (!document.hidden) Editor.extBack(true); } } catch (e) {} }, 2500);
    // v1.17：每次開啟 App 都自動檢查（App 一直開著時，回到 App 且距離上次檢查超過 30 分鐘也會再檢查）；只有真的有新版本才跳出提示
    if (CFG.autoUpd === false) return;
    setTimeout(() => this.auto(), 4000);
  },
  auto() {
    if (CFG.autoUpd === false || this.isOpen() || (window.Exporter && Exporter.ctl)) return;
    lsSet('aip.updAt', Date.now()); this.check(false);
  },
  async manifest() { const r = await fetch(GH.pages + 'version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error(r.status === 404 ? 'GitHub 上還沒有發布版本（請確認已開啟 GitHub Pages）' : 'HTTP ' + r.status); return r.json(); },
  idb() { return new Promise((res, rej) => { const q = indexedDB.open('aip-ota', 1); q.onupgradeneeded = () => q.result.createObjectStore('f'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async store(html) { const db = await this.idb(); await new Promise((res, rej) => { const t = db.transaction('f', 'readwrite'); t.objectStore('f').put(html, 'html'); t.oncomplete = res; t.onerror = () => rej(t.error); }); db.close(); },
  async check(manual) {
    const say = (t) => { const st = $('#updSt'); if (st) st.textContent = t; };
    try {
      say('檢查中…'); const v = await this.manifest(); lsSet('aip.updLast', { v, t: Date.now() }); const apk = this.apk();
      const apkNew = isApp && apk && v.apkName && this.gt(v.apkName, apk), must = isApp && v.minApk && apk && this.gt(v.minApk, apk);
      const apkDlg = (must) => {
        say(`有新版 APK v${v.apkName || v.app}${must ? '（需要重新安裝）' : ''}`);
        this.dialog(`🎉 有新版 APK v${this.esc(v.apkName || v.app)}`, `${v.notes ? this.esc(v.notes) + '<br><br>' : ''}${must ? '這次是大改版（手機端程式有更新），需要安裝新的 APK。' : '手機端程式有更新，建議安裝新的 APK。'}${this.native() ? '按「下載並安裝」會直接在 App 裡下載，完成後跳出系統的「更新」確認；' : ''}會直接覆蓋舊版，圖庫與修圖紀錄都會保留。`,
          [[this.native() ? '⬇ 下載並安裝' : '⬇ 下載最新版 APK', () => this.installLatest()], ['稍後', () => { if (!must) lsSet('aip.apkSnooze', { v: v.apkName, t: Date.now() }); }]]);
      };
      if (must) { apkDlg(true); return; }
      const snz = lsGet('aip.apkSnooze', null), snoozed = !manual && snz && snz.v === v.apkName && Date.now() - snz.t < 12 * 3600e3;
      if (apkNew && !this.gt(v.app, APP_VERSION)) { if (!snoozed) apkDlg(false); else say(`有新版 APK v${v.apkName}`); return; }
      if (!this.gt(v.app, APP_VERSION)) { say(`已經是最新版本 v${APP_VERSION}`); if (manual) toast('已經是最新版本 v' + APP_VERSION); return; }
      if (!isApp) { say(`有新版本 v${v.app}`); if (manual) this.dialog('有新版本 v' + this.esc(v.app), '網頁版請重新整理或開啟 GitHub 上的最新網頁版。', [['🌐 開啟網頁版', () => this.open(GH.pages)], ['稍後', null]]); return; }
      say(`下載新版本 v${v.app}…`);
      const r = await fetch(GH.pages + 'index.html?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      if (html.indexOf(`const APP_VERSION = '${v.app}'`) < 0 || html.length < 1000000) throw new Error('下載不完整，稍後再試');
      await this.store(html); lsSet('aip.ota', { ver: v.app, minApk: v.minApk || '' }); try { localStorage.removeItem('aip.otaFail'); } catch (e) {}
      say(`已下載 v${v.app}，重新開啟後套用`);
      this.dialog(`已下載新版本 v${this.esc(v.app)}`, v.notes ? this.esc(v.notes) : '介面與功能更新', [['🔄 立即套用', () => location.reload()], ['下次開啟時套用', null]]);
    } catch (e) { say('無法檢查更新：' + e.message); if (manual) toast('無法檢查更新：' + e.message, 4000); }
  },
  /* 版本清單：apks.json（GitHub Pages 的 apk/ 資料夾） */
  async releases() {
    this.dialog('⬇ 下載 APK', '<div id="relL" class="sub">讀取 GitHub 版本清單中…</div>', [['關閉', null]]);
    try {
      const r = await fetch(GH.pages + 'apks.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error(r.status === 404 ? '找不到版本清單（請確認已開啟 GitHub Pages）' : 'HTTP ' + r.status);
      const L = await r.json(), apk = this.apk();
      $('#relL').innerHTML = L.length ? L.map((x, i) => `<div class="relR"><div class="grow"><b>v${this.esc(x.v)}</b>${i === 0 ? ' <span class="tyTag" style="background:#5f9a5a">最新</span>' : ''}${apk && x.v === apk ? ' <span class="tyTag" style="background:#a2613a">目前安裝</span>' : ''}
        <div class="sub">${this.esc(x.date || '')}${x.size ? '・' + (x.size / 1048576).toFixed(1) + ' MB' : ''}</div>${x.notes ? `<div class="sub relN">${this.esc(x.notes).replace(/\n/g, '<br>')}</div>` : ''}</div>
        <button class="btn sm ${i === 0 ? 'pri' : ''}" data-v="${this.esc(x.v)}" data-u="${this.esc(GH.pages + 'apk/' + encodeURIComponent(x.file))}">⬇</button></div>`).join('') : '<div class="sub">GitHub 上還沒有可下載的 APK</div>';
      $$('#relL [data-u]').forEach((b) => (b.onclick = () => this.install(b.dataset.u, b.dataset.v)));
    } catch (e) { $('#relL').textContent = '⚠️ 無法讀取版本清單：' + e.message; }
  },
  open(u) { if (isApp) NAT.call('openUrl', u); else window.open(u, '_blank'); },
  /* ---------- v1.14：App 內下載並安裝（不用到瀏覽器、不用自己找檔案） ---------- */
  native() { return !!(isApp && window.AIP2 && AIP2.installApk); },
  async installLatest() {
    try { const r = await fetch(GH.pages + 'apks.json?t=' + Date.now(), { cache: 'no-store' }); const L = await r.json(); if (!L.length) throw new Error('沒有可下載的 APK'); this.install(GH.pages + 'apk/' + encodeURIComponent(L[0].file), L[0].v); }
    catch (e) { toast('無法取得版本清單：' + e.message, 4000); this.releases(); }
  },
  install(url, v) {
    if (!this.native()) { this.open(url); toast('已用瀏覽器開始下載，完成後點通知安裝（直接覆蓋安裝，資料會保留）', 5000); return; }
    if (!AIP2.canInstall()) {
      this.pend = { url, v };
      this.dialog('需要允許安裝', '第一次在 App 內更新，需要允許「AI修圖軟體」安裝應用程式。按「前往設定」打開「允許來自這個來源的應用程式」，回到 App 後會自動繼續下載安裝。', [['前往設定', () => AIP2.askInstall()], ['改用瀏覽器下載', () => { this.pend = null; this.open(url); }], ['取消', () => { this.pend = null; }]]);
      return;
    }
    this.pend = null; this.instUrl = url;
    this.dialog(`⬇ 更新到 v${this.esc(v || '')}`, '<div id="apkTx" class="sub">準備下載…</div><div class="prog" style="margin-top:8px"><i id="apkBar" style="width:0%"></i></div>', [['在背景繼續', null]]);
    AIP2.installApk(url);
  },
  onResume() { if (CFG.autoUpd !== false && Date.now() - lsGet('aip.updAt', 0) > 30 * 60e3) setTimeout(() => this.auto(), 1500); if (this.pend && this.native() && AIP2.canInstall()) { const p = this.pend; this.pend = null; setTimeout(() => this.install(p.url, p.v), 400); } },
  onApk(d) {
    try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch (e) { return; }
    const tx = $('#apkTx'), bar = $('#apkBar'), set = (t, p) => { if (tx) tx.textContent = t; if (bar && p != null) bar.style.width = Math.round(p * 100) + '%'; };
    if (d.state === 'download') set(d.pct >= 0 ? `下載中 ${Math.round(d.pct * 100)}%` : '下載中…', d.pct >= 0 ? d.pct : null);
    else if (d.state === 'installing') set('下載完成，準備安裝…', 1);
    else if (d.state === 'confirm') set('請在系統視窗按「更新」；安裝完成後重新開啟 App 就是新版本（圖庫與修圖紀錄都保留）', 1);
    else if (d.state === 'done') { set('✓ 安裝完成', 1); toast('✓ 已更新完成', 3000); }
    else if (d.state === 'error') { const u = this.instUrl; this.dialog('更新沒有完成', this.esc(d.msg || '未知錯誤') + '<br><br>可以改用瀏覽器下載 APK，再點通知安裝（直接覆蓋舊版）。', [['改用瀏覽器下載', () => u && this.open(u)], ['關閉', null]]); }
  },
  dialog(title, html, btns) {
    let el = $('#updSheet'); if (!el) { el = h('div', { id: 'updSheet' }); document.body.append(el); }
    el.innerHTML = `<div class="plBg"></div><div class="plBox glass"><div class="lab"><span>${title}</span></div><div style="margin:6px 0 12px;line-height:1.6">${html}</div><div class="acts">${btns.map((b, i) => `<button class="btn ${i === 0 ? 'pri' : ''}" data-i="${i}">${b[0]}</button>`).join('')}</div></div>`;
    el.classList.add('on'); const close = () => el.classList.remove('on'); el.querySelector('.plBg').onclick = close;
    el.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { const f = btns[+b.dataset.i][1]; close(); if (f) f(); }));
  },
  isOpen() { const el = $('#updSheet'); return !!(el && el.classList.contains('on')); },
  closeDlg() { const el = $('#updSheet'); if (el) el.classList.remove('on'); },
  card(card) {
    const last = lsGet('aip.updLast', null), apk = this.apk(), ota = window.__OTA || (lsGet('aip.ota', null) || {}).ver;
    const row = (ic, t, s, fn, id) => { const r = h('div', { class: 'setRow', onclick: fn }, h('span', { class: 'ic' }, ic), h('div', { class: 'grow' }, h('b', null, t), h('div', { class: 'sub' }, s), id ? h('div', { class: 'sub', id }, last ? '上次檢查 ' + new Date(last.t).toLocaleString('zh-TW', { hour12: false }).slice(0, -3) + (last.v && this.gt(last.v.app, APP_VERSION) ? '・有新版本 v' + last.v.app : '') : '') : null), h('span', null, '›')); return r; };
    const sw = h('input', { type: 'checkbox' }); sw.checked = CFG.autoUpd !== false; sw.onchange = () => { CFG.autoUpd = sw.checked; saveCfg(); };
    return card('🔄 版本與更新',
      h('label', { class: 'lab' }, h('span', null, '自動更新', h('div', { class: 'sub' }, '開啟 App 時從 GitHub 下載最新版介面與功能（不用重新安裝 APK）；大改版才需要下載新 APK')), h('span', { class: 'sw' }, sw, h('span'))),
      row('🔄', '檢查更新', `目前版本 v${APP_VERSION}${isApp ? '・APK v' + (apk || '?') : '・網頁版'}${window.__OTA ? '（已線上更新）' : ''}`, () => this.check(true), 'updSt'),
      isApp ? row('⬇', '下載 APK 到手機', '可選最新版或任一舊版本', () => this.releases()) : null,
      isApp && (window.__OTA || ota) ? row('↩️', '還原為 APK 內建版本', '線上更新後有問題時使用（v' + (window.APP_BUILTIN || '') + '）', () => this.dialog('還原為 APK 內建版本？', '會刪除線上下載的新版介面，改回這支 APK 內建的版本。圖庫與修圖紀錄不受影響。', [['還原', () => { try { localStorage.removeItem('aip.ota'); } catch (e) {} location.replace(location.pathname + '#builtin'); location.reload(); }], ['取消', null]])) : null,
      row('🌐', '網頁版', GH.pages.replace('https://', ''), () => this.open(GH.pages)),
      row('📦', 'GitHub 儲存庫', '所有版本的 APK、更新說明', () => this.open(GH.web)));
  }
};
