'use strict';
/* ================= 基礎工具 ================= */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const h = (t, a = {}, ...c) => { const e = document.createElement(t); for (const k in a) { if (k === 'class') e.className = a[k]; else if (k === 'html') e.innerHTML = a[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), a[k]); else e.setAttribute(k, a[k]); } c.flat().forEach(x => x != null && e.append(x)); return e; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtMB = b => (b / 1048576).toFixed(b > 104857600 ? 0 : 1) + ' MB';
const fmtHM = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const fmtMD = d => (d.getMonth() + 1) + '/' + d.getDate();
function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms); }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

/* ================= 設定 ================= */
const DEF = {
  gkey: '', ghToken: '', ghRepo: 'IanLin1120/ai-photo-editor', cloudKey: '', cloudOn: true, cloudStrength: 1,
  theme: 'auto', acc: 'terra', mat: 'liquid', gA: .38,
  autoAI: true, tmplAmt: 1, lensAuto: true,
  exp: { fmt: 'jpeg', q: 95, size: 'full', long: 4000, name: 'keep', pattern: '{原檔名}_AI', folder: 'AI修圖', exif: true, gps: true, mtime: true, maker: false },
  autoUpd: true, view: null
};
function deepMerge(a, b) { const o = Array.isArray(a) ? [...a] : { ...a }; for (const k in b) { o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a && typeof a[k] === 'object' && !Array.isArray(a[k])) ? deepMerge(a[k], b[k]) : b[k]; } return o; }
let CFG = deepMerge(DEF, lsGet('aip.cfg', {}));
function saveCfg() { lsSet('aip.cfg', CFG); }

/* ================= 原生橋接（APK） ================= */
const isApp = !!window.APN;
const NAT = {
  call(fn, ...a) { try { if (window.APN && APN[fn]) return APN[fn](...a); } catch (e) { console.warn('NAT', fn, e); } return null; },
  json(fn, ...a) { const r = this.call(fn, ...a); try { return r ? JSON.parse(r) : null; } catch (e) { return null; } }
};
const CBS = {};
window.onNativePick = (id, json) => { const f = CBS[id]; delete CBS[id]; if (f) f(JSON.parse(json || '[]')); };
window.onNetDone = (id, json) => { const f = CBS[id]; delete CBS[id]; if (f) f(JSON.parse(json || '{}')); };
window.onNetProgress = (id, done, tot) => { const f = CBS[id + ':p']; if (f) f(done, tot); };
window.onNativeEvent = function (type, data) {
  if (type === 'perm' && window.Settings) Settings.renderPerm();
  if (type === 'resume' && window.App) App.onResume();
  if (type === 'apk') toast(data === 'ok' ? 'APK 下載完成，請依畫面指示安裝' : 'APK 下載失敗，請稍後再試或到 GitHub 下載');
};
/* 原生大檔傳輸（雲端上傳／下載用）。web 版退回 fetch */
function netFile(method, url, headers, upload, download, onProg) {
  return new Promise(res => { const id = 'n' + uid(); CBS[id] = res; if (onProg) CBS[id + ':p'] = onProg; NAT.call('netFile', id, method, url, JSON.stringify(headers || {}), upload || '', download || ''); })
    .finally(() => { });
}

/* ================= 外觀 ================= */
function applyLook() {
  const dark = CFG.theme === 'dark' || (CFG.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.acc = CFG.acc;
  document.body.classList.remove('liquid', 'paper', 'noglass');
  document.body.classList.add(CFG.mat === 'paper' ? 'paper' : CFG.mat === 'solid' ? 'noglass' : 'liquid');
  document.documentElement.style.setProperty('--gA', CFG.gA);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  $('meta[name=theme-color]').content = bg;
  NAT.call('setDark', dark);
  if (window.Geo && Geo.map) Geo.onTheme();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => CFG.theme === 'auto' && applyLook());

/* ================= 抽屜、進度 ================= */
let sheetClose = null;
function openSheet(html, onClose) { $('#shB').innerHTML = html; $('#sheet').classList.remove('hide'); sheetClose = onClose || null; $('#sheet .shBg').onclick = closeSheet; }
function closeSheet() { $('#sheet').classList.add('hide'); const f = sheetClose; sheetClose = null; if (f) f(); }
function ask(title, html, btns) {
  return new Promise(res => {
    openSheet(`<h3>${title}</h3><div style="line-height:1.6">${html}</div><div class="acts">${btns.map((b, i) => `<button class="btn ${i === 0 ? 'pri' : ''}" data-i="${i}">${b}</button>`).join('')}</div>`, () => res(-1));
    $$('#shB [data-i]').forEach(b => b.onclick = () => { sheetClose = null; closeSheet(); res(+b.dataset.i); });
  });
}
const Prog = {
  cancel: false,
  show(t, s) { this.cancel = false; $('#progT').textContent = t; $('#progS').textContent = s || ''; $('#progB').style.width = '0%'; $('#prog').classList.remove('hide'); $('#progX').onclick = () => { this.cancel = true; $('#progS').textContent = '取消中…'; }; NAT.call('keepScreen', true); },
  set(p, s) { $('#progB').style.width = clamp(p * 100, 0, 100).toFixed(1) + '%'; if (s != null) $('#progS').textContent = s; },
  hide() { $('#prog').classList.add('hide'); NAT.call('keepScreen', false); }
};

/* ================= IndexedDB（照片清單、縮圖、修圖設定） ================= */
const IDB = {
  db: null,
  open() { return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => { const r = indexedDB.open('aip', 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' }); if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); }; r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
  async all() { const d = await this.open(); return new Promise(res => { const r = d.transaction('photos').objectStore('photos').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); },
  async put(p) { const d = await this.open(); const o = Object.assign({}, p); delete o._file; delete o._bytes; return new Promise(res => { const t = d.transaction('photos', 'readwrite'); t.objectStore('photos').put(o); t.oncomplete = () => res(true); t.onerror = () => res(false); }); },
  async del(id) { const d = await this.open(); return new Promise(res => { const t = d.transaction('photos', 'readwrite'); t.objectStore('photos').delete(id); t.oncomplete = () => res(true); }); },
  async kvGet(k) { const d = await this.open(); return new Promise(res => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); }); },
  async kvSet(k, v) { const d = await this.open(); return new Promise(res => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); }); }
};

/* ================= 讀取照片位元組 ================= */
const RAW_EXT = /\.(arw|dng|nef|nrw|cr2|cr3|raf|orf|rw2|pef|srw|x3f|3fr|iiq|erf|mrw|kdc|dcr|sr2|srf)$/i;
async function photoBytes(p, off, len) {
  if (p._file) { const f = off != null ? p._file.slice(off, len ? off + len : undefined) : p._file; return new Uint8Array(await f.arrayBuffer()); }
  if (isApp && p.src && p.src.pickId) {
    const u = location.origin + '/pick/' + p.src.pickId + (off != null ? `?off=${off}${len ? '&len=' + len : ''}` : '');
    const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('無法讀取原檔（' + r.status + '）');
    return new Uint8Array(await r.arrayBuffer());
  }
  throw new Error('原檔已無法讀取，請重新匯入');
}
/* 把位元組交給原生寫成檔案（分段 base64） */
async function saveBytes(bytes, name, mime, folder, takenMs, onProg) {
  if (!isApp) { const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: mime })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); return 'download'; }
  const id = NAT.call('saveOpen', name, mime, folder || '', takenMs || 0); if (!id) throw new Error('無法建立檔案（請確認儲存權限）');
  const CH = 768 * 1024;
  for (let o = 0; o < bytes.length; o += CH) {
    const sub = bytes.subarray(o, Math.min(o + CH, bytes.length)); let s = '';
    for (let i = 0; i < sub.length; i += 0x8000) s += String.fromCharCode.apply(null, sub.subarray(i, i + 0x8000));
    if (!NAT.call('saveChunk', id, btoa(s))) { NAT.call('saveAbort', id); throw new Error('寫入失敗（空間不足？）'); }
    if (onProg) onProg(Math.min(1, (o + CH) / bytes.length));
    if ((o / CH) % 8 === 7) await sleep(0);
  }
  return NAT.call('saveClose', id) || '';
}
