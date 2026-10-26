/* ================= 基礎工具 ================= */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) { const v = attrs[k]; if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function getP(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setP(o, p, v) { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; }
function deepMerge(a, b) { const o = Array.isArray(a) ? [...a] : { ...a }; for (const k in b) { o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a && typeof a[k] === 'object' && !Array.isArray(a[k])) ? deepMerge(a[k], b[k]) : clone(b[k]); } return o; }
let toastT = 0;
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
/* 讓出執行緒但不使用計時器：App 在背景時 setTimeout 會被瀏覽器大幅延遲（最久 1 分鐘一次），MessageChannel 不受影響 */
function yieldNow() { return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); }); }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function fmtBytes(n) { return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB'; }
function b64ToBytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function bytesToB64(u8) { let s = ''; const C = 0x8000; for (let i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C)); return btoa(s); }
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function canvasBlob(c, type, q) { return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('編碼失敗'))), type, q)); }


/* ================= 影像方向（EXIF Orientation） =================
   部分 Android WebView 解碼時不會依 EXIF 轉正直拍相片，這裡先偵測，必要時手動轉正。 */
const ORI_PROBE = "/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDFoooryz7w/9k=";
let _oriApplies = null;
async function bmp(blob) { try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { return await createImageBitmap(blob); } }
async function browserAppliesOrientation() {
  if (_oriApplies != null) return _oriApplies;
  try { const b = await bmp(new Blob([b64ToBytes(ORI_PROBE)], { type: 'image/jpeg' })); _oriApplies = b.height > b.width; b.close(); } catch (e) { _oriApplies = true; }
  return _oriApplies;
}
/* 解碼並依 EXIF 方向轉正，回傳 ImageBitmap 或 canvas */
async function jpegRawSize(blob) {
  try { const u = new Uint8Array(await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer()); if (u[0] !== 0xff || u[1] !== 0xd8) return null; let o = 2;
    while (o + 9 < u.length) { if (u[o] !== 0xff) { o++; continue; } const m = u[o + 1]; const len = (u[o + 2] << 8) | u[o + 3];
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { h: (u[o + 5] << 8) | u[o + 6], w: (u[o + 7] << 8) | u[o + 8] };
      o += 2 + len; } } catch (e) {} return null;
}
async function decodeOriented(blob, ori) {
  const bm = await bmp(blob); ori = ori | 0;
  if (ori <= 1 || ori > 8) return bm;
  // 以原始像素尺寸判斷瀏覽器是否已轉正（直拍：寬高互換）
  if (ori >= 5) { const raw = await jpegRawSize(blob); if (raw && raw.w !== raw.h) { if (bm.width === raw.h && bm.height === raw.w) return bm; } else if (await browserAppliesOrientation()) return bm; }
  else if (await browserAppliesOrientation()) return bm;
  const w = bm.width, hh = bm.height, swap = ori >= 5; const c = mkCanvas(swap ? hh : w, swap ? w : hh); const x = c.getContext('2d');
  const T = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, hh], 4: [1, 0, 0, -1, 0, hh], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, hh, 0], 7: [0, -1, -1, 0, hh, w], 8: [0, -1, 1, 0, 0, w] }[ori];
  x.setTransform(...T); x.drawImage(bm, 0, 0); bm.close(); return c;
}

/* ================= 設定 ================= */
const DEF_CFG = {
  theme: 'auto', acc: 'terra', mat: 'liquid', gA: .38, prevLong: 2048, histo: true, hud: 'histo',
  exp: { fmt: 'orig', q: 100, size: 'orig', long: 4096, meta: 'all', sub444: true },
  ai: { model: 'fast', tile: 256, smooth: true, worker: true }, sort: 'added', sortRev: false, libView: 'grid'
};
let CFG = deepMerge(clone(DEF_CFG), lsGet('aip.cfg', {}));
function saveCfg() { lsSet('aip.cfg', CFG); }

/* ================= 原生橋接 (APK) ================= */
const isApp = !!window.AIP;
const NAT = {
  call(fn, ...a) { try { if (window.AIP && AIP[fn]) return AIP[fn](...a); } catch (e) { console.warn('NAT', fn, e); } return null; },
  json(fn, ...a) { const r = this.call(fn, ...a); try { return r ? JSON.parse(r) : null; } catch (e) { return null; } }
};
/* 背景前景服務：多個工作（匯入、RAW 預覽、雲端 AI、背景匯出）共用一個通知，全部結束才停止 */
const BG = {
  act: {}, t: 0, timer: 0,
  set(k, text, pct) { this.act[k] = { text, pct, at: Date.now() }; this.push(); },
  end(k) { delete this.act[k]; const ks = Object.keys(this.act); if (!ks.length) { clearTimeout(this.timer); this.timer = 0; NAT.call('bgStop'); } else this.push(true); },
  push(now) {
    const go = () => { this.timer = 0; this.t = Date.now(); const ks = Object.keys(this.act); if (!ks.length) return; const a = ks.map((k) => this.act[k]).sort((x, y) => y.at - x.at)[0]; NAT.call('bgStart', ks.length > 1 ? `${a.text}（另有 ${ks.length - 1} 項背景工作）` : a.text, a.pct == null ? -1 : a.pct); };
    if (now || Date.now() - this.t > 900) { clearTimeout(this.timer); go(); } else if (!this.timer) this.timer = setTimeout(go, 900);
  }
};
window.onNativeEvent = function (type, data) {
  if (type === 'resume') { try { Library.render(); } catch (e) {} try { if (Cloud.active().length && Cloud.ready()) Cloud.run(); } catch (e) {} try { Upd.onResume(); } catch (e) {} return false; }
  if (type === 'picked') Library.onNativePicked(typeof data === 'string' ? JSON.parse(data) : data);
  else if (type === 'back') return App.back();
  else if (type === 'perm') Settings.render();
  else if (type === 'http') Cloud.onHttp(typeof data === 'string' ? JSON.parse(data) : data);
  else if (type === 'apk') { try { Upd.onApk(data); } catch (e) {} }
  return false;
};

function applyLook() {
  const dark = CFG.theme === 'dark' || (CFG.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.acc = CFG.acc;
  document.body.classList.remove('liquid', 'paper', 'noglass');
  document.body.classList.add(CFG.mat === 'paper' ? 'paper' : CFG.mat === 'solid' ? 'noglass' : 'liquid');
  document.documentElement.style.setProperty('--gA', CFG.gA);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const m = $('meta[name=theme-color]'); if (m) m.content = bg;
  NAT.call('setDark', dark);
  if (window.Editor && Editor.active) Editor.requestDisplay();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => CFG.theme === 'auto' && applyLook());

/* ================= IndexedDB ================= */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('aiphoto', 2);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ['photos', 'presets']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); for (const s of ['files', 'thumbs', 'prev', 'ai', 'raw']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
      r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error);
    });
  },
  async tx(store, mode, fn) { const d = await this.open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('儲存空間不足')); }); },
  get(store, key) { return this.tx(store, 'readonly', (s) => s.get(key)); },
  put(store, val, key) { return this.tx(store, 'readwrite', (s) => (key === undefined ? s.put(val) : s.put(val, key))); },
  del(store, key) { return this.tx(store, 'readwrite', (s) => s.delete(key)); },
  all(store) { return this.tx(store, 'readonly', (s) => s.getAll()); },
};

/* ================= 編輯參數 ================= */
const ID_CURVE = [[0, 0], [1, 1]];
/* 曲線模板（0–255）：修圖師常用的經典曲線形狀，依場景命名。rgb＝亮度曲線，r/g/b＝單色曲線（未列出＝不變） */
const CURVE_PRESETS = [
  { g: '基本對比', items: [
    { id: 'lin', name: '線性（還原）', desc: '不做任何曲線調整', rgb: null },
    { id: 'med', name: '中等對比（Lightroom 經典）', desc: '與 Lightroom「中等對比」相近的柔和 S 曲線，適合大多數照片', rgb: [[0, 0], [32, 22], [64, 56], [128, 128], [192, 196], [255, 255]] },
    { id: 'strong', name: '強烈對比（Lightroom 經典）', desc: '更明顯的 S 曲線，適合陰天、灰平的風景與建築', rgb: [[0, 0], [32, 16], [64, 50], [128, 128], [192, 202], [255, 255]] },
    { id: 'soft', name: '人像柔和 S', desc: '只輕微加深暗部、提亮亮部，膚色過渡自然', rgb: [[0, 0], [64, 59], [128, 128], [192, 198], [255, 255]] }] },
  { g: '保護高光與暗部', items: [
    { id: 'protect', name: '防死白防死黑（保留層次）', desc: '白點下移、黑點上移：最亮處不死白、最暗處不死黑，中間調保留對比', rgb: [[0, 12], [64, 66], [128, 128], [192, 190], [255, 243]] },
    { id: 'hlprotect', name: '高光保護（大光比、天空）', desc: '亮部彎曲收斂，天空、雲、白牆保留細節；暗部不動', rgb: [[0, 0], [128, 130], [192, 186], [230, 222], [255, 244]] },
    { id: 'night', name: '夜景燈光保護', desc: '燈光、招牌不爆白，暗部略提亮但保留黑色深度', rgb: [[0, 6], [48, 50], [128, 136], [200, 202], [235, 226], [255, 240]] },
    { id: 'landscape', name: '風景通透', desc: '加強中間調對比讓畫面清透，兩端略保護', rgb: [[0, 4], [48, 40], [128, 132], [200, 212], [255, 250]] }] },
  { g: '底片與霧面', items: [
    { id: 'matte', name: '霧面底片（Matte）', desc: '黑點大幅提起的經典霧面感，配合暗部收緊，柔和有質感', rgb: [[0, 38], [40, 46], [128, 128], [220, 226], [255, 244]] },
    { id: 'vintage', name: '復古褪色', desc: '黑點提起、白點壓低，紅色暖、藍色在亮部收斂，像老照片', rgb: [[0, 32], [128, 126], [255, 236]], r: [[0, 18], [128, 132], [255, 248]], b: [[0, 12], [128, 122], [255, 214]] },
    { id: 'japan', name: '日系清新（低對比明亮）', desc: '暗部抬亮、整體輕盈，暗部微微帶青藍，適合人像、咖啡廳、旅行', rgb: [[0, 24], [70, 92], [160, 182], [255, 250]], r: [[0, 0], [128, 125], [255, 252]], b: [[0, 14], [128, 132], [255, 250]] },
    { id: 'moody', name: '暗調情緒（Moody）', desc: '整體壓暗、黑點微提、亮部收斂，帶一點冷調，適合陰天、森林、街景', rgb: [[0, 18], [64, 48], [128, 112], [192, 178], [255, 232]], b: [[0, 20], [128, 130], [255, 242]] }] },
  { g: '電影與色調', items: [
    { id: 'tealorange', name: '電影青橙（Teal & Orange）', desc: '暗部偏青、亮部與膚色偏橙，好萊塢常見配色，適合城市與人像', rgb: [[0, 8], [64, 56], [128, 128], [192, 200], [255, 248]], r: [[0, 0], [64, 58], [192, 204], [255, 255]], g: [[0, 4], [128, 128], [255, 252]], b: [[0, 20], [64, 72], [192, 184], [255, 238]] },
    { id: 'sunset', name: '夕陽暖調', desc: '中間調偏暖、亮部帶金黃，適合黃昏、日出、暖色燈光', rgb: [[0, 0], [64, 60], [128, 130], [192, 198], [255, 252]], r: [[0, 0], [128, 142], [255, 255]], b: [[0, 0], [128, 112], [255, 238]] },
    { id: 'cross', name: '交叉沖印（Cross Process）', desc: '紅綠加強對比、藍色暗部提起亮部壓低，鮮明有個性', rgb: null, r: [[0, 0], [64, 46], [192, 212], [255, 255]], g: [[0, 0], [64, 54], [192, 206], [255, 255]], b: [[0, 42], [255, 204]] },
    { id: 'cold', name: '清冷藍調', desc: '暗部與中間調偏藍、紅色略降，適合雪景、雨天、海邊', rgb: [[0, 6], [128, 128], [255, 250]], r: [[0, 0], [128, 120], [255, 250]], b: [[0, 16], [128, 140], [255, 255]] }] },
  { g: '黑白', items: [
    { id: 'bwhigh', name: '黑白高反差（街頭）', desc: '黑更黑、白更亮，強烈的街頭紀實感（搭配黑白設定檔）', rgb: [[0, 0], [48, 26], [128, 128], [208, 232], [255, 255]] },
    { id: 'bwsoft', name: '黑白柔和（銀鹽）', desc: '保留灰階層次、黑點微提，像傳統銀鹽相紙', rgb: [[0, 14], [64, 62], [128, 130], [200, 204], [255, 246]] }] }
];
const DEF_EDIT = {
  v: 1, profile: 'color', profileAmt: 100,
  wb: 'shot', temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  curve: { rgb: clone(ID_CURVE), r: clone(ID_CURVE), g: clone(ID_CURVE), b: clone(ID_CURVE), par: { h: 0, l: 0, d: 0, s: 0, s1: 25, s2: 50, s3: 75 } },
  vibrance: 0, saturation: 0,
  hsl: { hue: [0, 0, 0, 0, 0, 0, 0, 0], sat: [0, 0, 0, 0, 0, 0, 0, 0], lum: [0, 0, 0, 0, 0, 0, 0, 0] },
  bw: [0, 0, 0, 0, 0, 0, 0, 0], mono: false, toning: { h: 35, s: 0 }, fade: 0,
  grade: { sh: { h: 220, s: 0, l: 0 }, mid: { h: 40, s: 0, l: 0 }, hi: { h: 45, s: 0, l: 0 }, glob: { h: 30, s: 0, l: 0 }, blend: 50, balance: 0 },
  texture: 0, clarity: 0, dehaze: 0,
  vig: { amt: 0, mid: 50, round: 0, feather: 50, hl: 0 },
  grain: { amt: 0, size: 25, rough: 50 },
  sharp: { amt: 0, rad: 1.0, det: 25, mask: 0 },
  nr: { lum: 0, ldet: 50, lcon: 0, col: 0, cdet: 50, csm: 50 },
  ai: { on: false, amt: 60, model: 'fast', chroma: 60 },
  optics: { ca: false, purple: 0, green: 0, dist: 0, vigCorr: 0, prof: { on: false, key: '', name: '', d: 100, v: 100, tca: true, p: null, camCrop: 0 } },
  geo: { upright: 'off', dist: 0, vert: 0, horiz: 0, rot: 0, aspect: 0, scale: 100, ox: 0, oy: 0, constrain: true },
  crop: { x: 0, y: 0, w: 1, h: 1, angle: 0, rot90: 0, flipH: false, flipV: false, ratio: 'free' },
  sky: { on: false, preset: 'cumulus', amt: 100, exp: 0, temp: 0, edge: 40, gaps: 30, haze: 35, relight: 30, pos: 0, flip: false },
  aiEnh: { amt: 0 }, atm: { on: false, kind: 'rays', amt: 100, glow: 50 },
  masks: [], heal: [], loc: null
};
const DEF_MASK_ADJ = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, temp: 0, tint: 0, saturation: 0, clarity: 0, dehaze: 0, texture: 0, sharp: 0 };
function normEdit(e) { return deepMerge(clone(DEF_EDIT), clone(e || {})); }
function isDefault(e) { const a = clone(e), b = clone(DEF_EDIT); const pf = findProfile(a.profile); if (pf && pf.d && !Object.keys(pf.d).length && !pf.kind) a.profile = 'color'; delete a.ai.model; delete b.ai.model; return JSON.stringify(a) === JSON.stringify(b); }

/* ---- 設定檔（Profile）：在使用者參數之上疊加的基礎調性 ---- */
const PROFILES = [
  { id: 'color', name: 'Adobe 色彩', g: '基本', d: {} },
  { id: 'vivid', name: 'Adobe 鮮豔', g: '基本', d: { contrast: 14, saturation: 16, vibrance: 14, clarity: 4 } },
  { id: 'land', name: 'Adobe 風景', g: '基本', d: { contrast: 6, vibrance: 16, dehaze: 6, hsl: { sat: [0, 0, 6, 14, 10, 16, 0, 0], lum: [0, 0, 0, -6, 0, -8, 0, 0] } } },
  { id: 'portrait', name: 'Adobe 人像', g: '基本', d: { contrast: -6, highlights: -6, clarity: -4, hsl: { sat: [-4, -8, 0, 0, 0, 0, 0, 0], lum: [2, 6, 0, 0, 0, 0, 0, 0] } } },
  { id: 'neutral', name: 'Adobe 中性', g: '基本', d: { contrast: -22, highlights: -12, shadows: 12, saturation: -6 } },
  { id: 'mono', name: 'Adobe 單色', g: '基本', d: { mono: true, contrast: 10 } },
  { id: 'vintage', name: '復古 01', g: '創意', d: { fade: 40, saturation: -22, contrast: -8, grade: { sh: { h: 210, s: 18 }, hi: { h: 42, s: 22 } } } },
  { id: 'film', name: '電影 01', g: '創意', d: { contrast: 12, saturation: -8, fade: 15, grade: { sh: { h: 190, s: 28 }, hi: { h: 35, s: 24 } } } },
  { id: 'warm', name: '暖陽', g: '創意', d: { temp: 18, vibrance: 10, grade: { hi: { h: 40, s: 15 } } } },
  { id: 'cool', name: '冷冽', g: '創意', d: { temp: -16, saturation: -5, grade: { sh: { h: 215, s: 20 } } } },
  { id: 'matte', name: '霧面', g: '創意', d: { fade: 55, contrast: -10, saturation: -10 } },
  { id: 'bwhi', name: '黑白 高反差', g: '黑白', d: { mono: true, contrast: 40, clarity: 15, bw: [10, 10, 5, -10, -15, -25, -10, 5] } },
  { id: 'bwsoft', name: '黑白 柔和', g: '黑白', d: { mono: true, contrast: -15, fade: 20 } },
  { id: 'sepia', name: '棕褐', g: '黑白', d: { mono: true, toning: { h: 35, s: 55 } } },
];

/* ---- 相機比對設定檔：依 EXIF 廠牌自動帶入（模擬各廠內建風格） ---- */
const g2 = (sh, hi) => ({ grade: Object.assign({}, sh ? { sh: { h: sh[0], s: sh[1] } } : {}, hi ? { hi: { h: hi[0], s: hi[1] } } : {}) });
const CAM_PROFILES = {
  SONY: { label: 'SONY', def: 'sony_st', list: [
    ['sony_st', 'Camera ST', {}], ['sony_pt', 'Camera PT', { contrast: -6, saturation: -6, clarity: -4, hsl: { lum: [3, 6, 0, 0, 0, 0, 0, 0], sat: [-3, -6, 0, 0, 0, 0, 0, 0] } }],
    ['sony_nt', 'Camera NT', { contrast: -18, saturation: -16, highlights: -8, shadows: 6 }], ['sony_vv', 'Camera VV', { contrast: 12, saturation: 20, vibrance: 6 }],
    ['sony_vv2', 'Camera VV2', { contrast: 10, saturation: 26, vibrance: 10, hsl: { sat: [4, 6, 6, 8, 8, 10, 0, 0] } }],
    ['sony_fl', 'Camera FL', Object.assign({ contrast: 8, saturation: -14, fade: 14, highlights: -8 }, g2([195, 20], [40, 12]))],
    ['sony_in', 'Camera IN', Object.assign({ contrast: -10, saturation: -22, fade: 24, temp: 4 }, g2(null, [45, 10]))],
    ['sony_sh', 'Camera SH', { exposure: 0.15, contrast: -14, highlights: -16, shadows: 10, saturation: -6, temp: 3 }],
    ['sony_bw', 'Camera BW', { mono: true, contrast: 8 }], ['sony_se', 'Camera SE', { mono: true, toning: { h: 32, s: 50 } }]] },
  FUJIFILM: { label: 'FUJIFILM', def: 'fuji_provia', list: [
    ['fuji_provia', 'PROVIA/標準', {}], ['fuji_velvia', 'Velvia/鮮豔', { contrast: 15, saturation: 24, vibrance: 6 }], ['fuji_astia', 'ASTIA/柔和', { contrast: -6, highlights: -10, saturation: 6, hsl: { lum: [2, 6, 0, 0, 0, 0, 0, 0] } }],
    ['fuji_cc', 'CLASSIC CHROME', Object.assign({ contrast: 10, saturation: -24, highlights: -10, shadows: -4 }, g2([200, 12], [40, 6]))],
    ['fuji_nh', 'PRO Neg. Hi', { contrast: 8, saturation: -10, hsl: { lum: [0, 4, 0, 0, 0, 0, 0, 0] } }], ['fuji_ns', 'PRO Neg. Std', { contrast: -10, saturation: -16 }],
    ['fuji_eterna', 'ETERNA/電影', Object.assign({ contrast: -24, saturation: -30, fade: 10, shadows: 10 }, g2([190, 10], null))],
    ['fuji_cn', 'CLASSIC Neg.', Object.assign({ contrast: 16, saturation: -14, hsl: { hue: [0, 0, -6, 10, 0, -6, 0, 0] } }, g2([180, 22], [35, 16]))],
    ['fuji_nn', 'NOSTALGIC Neg.', Object.assign({ temp: 8, contrast: 4, saturation: -4, shadows: 6 }, g2([30, 10], [42, 22]))], ['fuji_reala', 'REALA ACE', { contrast: 5, saturation: 4 }],
    ['fuji_acros', 'ACROS', { mono: true, contrast: 16, grain: { amt: 12 } }], ['fuji_mono', 'MONOCHROME', { mono: true }], ['fuji_sepia', 'SEPIA', { mono: true, toning: { h: 35, s: 50 } }]] },
  CANON: { label: 'Canon', def: 'canon_std', list: [
    ['canon_std', 'Camera Standard', {}], ['canon_pt', 'Camera Portrait', { contrast: -6, saturation: -4, hsl: { lum: [2, 6, 0, 0, 0, 0, 0, 0] } }], ['canon_ls', 'Camera Landscape', { contrast: 8, saturation: 12, hsl: { sat: [0, 0, 6, 14, 6, 14, 0, 0] } }],
    ['canon_nt', 'Camera Neutral', { contrast: -18, saturation: -14 }], ['canon_ff', 'Camera Faithful', { contrast: -12, saturation: -10 }], ['canon_fd', 'Camera Fine Detail', { texture: 15, sharp: { amt: 30 } }], ['canon_mono', 'Camera Monochrome', { mono: true, contrast: 6 }]] },
  NIKON: { label: 'Nikon', def: 'nikon_sd', list: [
    ['nikon_sd', 'Camera Standard', {}], ['nikon_nl', 'Camera Neutral', { contrast: -16, saturation: -14 }], ['nikon_vi', 'Camera Vivid', { contrast: 12, saturation: 20 }],
    ['nikon_pt', 'Camera Portrait', { contrast: -6, saturation: -6, hsl: { lum: [2, 6, 0, 0, 0, 0, 0, 0] } }], ['nikon_ls', 'Camera Landscape', { contrast: 8, saturation: 10, hsl: { sat: [0, 0, 6, 12, 6, 12, 0, 0] } }],
    ['nikon_fl', 'Camera Flat', { contrast: -32, saturation: -18, highlights: -10, shadows: 14 }], ['nikon_mc', 'Camera Monochrome', { mono: true }]] },
  PANASONIC: { label: 'Panasonic', def: 'pana_std', list: [
    ['pana_std', 'Camera Standard', {}], ['pana_vivid', 'Camera Vivid', { contrast: 12, saturation: 18 }], ['pana_nat', 'Camera Natural', { contrast: -10, saturation: -8 }], ['pana_flat', 'Camera Flat', { contrast: -30, saturation: -20 }],
    ['pana_ls', 'Camera Landscape', { contrast: 8, saturation: 10 }], ['pana_pt', 'Camera Portrait', { contrast: -6, saturation: -4 }], ['pana_cd', 'Cinelike D', { contrast: -26, saturation: -12, highlights: -15 }],
    ['pana_cv', 'Cinelike V', { contrast: 10, saturation: -6, fade: 8 }], ['pana_mono', 'Camera Monochrome', { mono: true }], ['pana_lmono', 'L.Monochrome', { mono: true, contrast: 20, blacks: -12 }]] },
  OLYMPUS: { label: 'OM / Olympus', def: 'oly_nat', list: [
    ['oly_nat', 'Camera Natural', {}], ['oly_vivid', 'Camera Vivid', { contrast: 10, saturation: 18 }], ['oly_muted', 'Camera Muted', { contrast: -14, saturation: -16 }],
    ['oly_pt', 'Camera Portrait', { contrast: -6, saturation: -4 }], ['oly_mono', 'Camera Monotone', { mono: true }]] },
  RICOH: { label: 'RICOH / PENTAX', def: 'ric_std', list: [
    ['ric_std', 'Camera Standard', {}], ['ric_vivid', 'Camera Vivid', { contrast: 12, saturation: 18 }], ['ric_pf', 'Positive Film', Object.assign({ contrast: 12, saturation: 8 }, g2([210, 10], [40, 10]))],
    ['ric_nf', 'Negative Film', Object.assign({ contrast: -6, saturation: -16, fade: 12 }, g2([190, 14], [30, 12]))], ['ric_muted', 'Camera Muted', { contrast: -12, saturation: -18 }], ['ric_mono', 'Camera Monochrome', { mono: true, contrast: 10 }]] },
  LEICA: { label: 'Leica', def: 'leica_std', list: [['leica_std', 'Camera Standard', {}], ['leica_vivid', 'Camera Vivid', { contrast: 10, saturation: 16 }], ['leica_nat', 'Camera Natural', { contrast: -10, saturation: -8 }], ['leica_mono', 'Camera Monochrome', { mono: true, contrast: 14 }]] },
};
function camKey(make) {
  const m = String(make || '').toUpperCase();
  if (m.includes('SONY')) return 'SONY'; if (m.includes('FUJI')) return 'FUJIFILM'; if (m.includes('CANON')) return 'CANON'; if (m.includes('NIKON')) return 'NIKON';
  if (m.includes('PANASONIC') || m.includes('LUMIX')) return 'PANASONIC'; if (m.includes('OLYMPUS') || m.includes('OM DIGITAL') || m.startsWith('OM ')) return 'OLYMPUS';
  if (m.includes('RICOH') || m.includes('PENTAX')) return 'RICOH'; if (m.includes('LEICA')) return 'LEICA'; return null;
}
const PROFILE_MAP = new Map();
for (const p of PROFILES) PROFILE_MAP.set(p.id, p);
for (const k in CAM_PROFILES) for (const [id, name, d] of CAM_PROFILES[k].list) PROFILE_MAP.set(id, { id, name, g: '相機比對', cam: k, d });
/* 自訂風格檔（使用者匯入 .cube / .xmp） */
const CustomProfiles = { list: [], map: new Map(), set(list) { this.list = list; this.map = new Map(list.map((p) => [p.id, p])); } };
function findProfile(id) { return PROFILE_MAP.get(id) || CustomProfiles.map.get(id) || null; }

function addDelta(x, d, a) {
  for (const k in d) {
    const v = d[k];
    if (typeof v === 'number') x[k] = (x[k] || 0) + v * a;
    else if (typeof v === 'boolean') x[k] = x[k] || (v && a > 0);
    else if (Array.isArray(v) && Array.isArray(v[0])) { const cur = x[k]; const ident = !cur || (cur.length === 2 && cur[0][1] === 0 && cur[1][1] === 1); if (ident && a > 0) x[k] = v.map(([px, py]) => [px, px + (py - px) * a]); }
    else if (Array.isArray(v)) x[k] = (x[k] || v.map(() => 0)).map((y, i) => y + (v[i] || 0) * a);
    else if (v && typeof v === 'object') {
      if (!x[k]) x[k] = {};
      if ('h' in v && 's' in v) { if (!x[k].s) { x[k].h = v.h; x[k].s = v.s * a; } x[k].l = (x[k].l || 0) + (v.l || 0) * a; }
      else addDelta(x[k], v, a);
    }
  }
}
function effective(e) {
  const x = clone(e); const p = findProfile(e.profile); const amt = (e.profileAmt == null ? 100 : e.profileAmt) / 100;
  if (p && p.d) addDelta(x, p.d, amt);
  if (p && p.kind === 'lut') x._lut = { id: p.id, amt };
  if (x.optics.ca && !x.optics.purple && !x.optics.green) { x.optics.purple = 55; x.optics.green = 35; }
  // AI 降噪的「彩噪消除」：以亮度為導引的大範圍色度平滑（清掉 AI 降噪後殘留的低頻色斑）
  if (x.ai && x.ai.on && x.ai.chroma > 0) { x.nr.col = Math.max(x.nr.col || 0, x.ai.chroma); x.nr.csm = Math.max(x.nr.csm || 0, 60); }
  return x;
}

/* ---- 內建預設集（絕對值，可調整「數量」） ---- */
const PRESETS = [
  { g: '人像', items: [
    { id: 'p_skin', name: '自然膚色', e: { exposure: 0.1, contrast: -6, highlights: -18, shadows: 12, clarity: -8, texture: -12, vibrance: 8, hsl: { sat: [0, -8, -4, 0, 0, 0, 0, 0], lum: [4, 10, 0, 0, 0, 0, 0, 0] } } },
    { id: 'p_soft', name: '柔光', e: { exposure: 0.2, contrast: -15, highlights: -25, shadows: 20, clarity: -18, dehaze: -6, fade: 12, vibrance: 5 } },
    { id: 'p_high', name: '高調', e: { exposure: 0.55, contrast: -10, highlights: -30, shadows: 35, whites: 15, saturation: -10, clarity: -6 } },
    { id: 'p_moody', name: '情緒暗調', e: { exposure: -0.25, contrast: 18, highlights: -35, shadows: -8, saturation: -14, vig: { amt: -25, mid: 40, feather: 70 }, grade: { sh: { h: 200, s: 16, l: 0 }, hi: { h: 38, s: 14, l: 0 } } } },
  ] },
  { g: '風景', items: [
    { id: 'l_vivid', name: '鮮明', e: { contrast: 15, highlights: -30, shadows: 25, clarity: 15, dehaze: 10, vibrance: 25, saturation: 5 } },
    { id: 'l_golden', name: '黃金時刻', e: { temp: 20, tint: 6, contrast: 10, highlights: -20, shadows: 15, vibrance: 15, grade: { hi: { h: 38, s: 30, l: 0 }, sh: { h: 25, s: 10, l: 0 } } } },
    { id: 'l_blue', name: '藍調時刻', e: { temp: -18, tint: 5, contrast: 8, highlights: -15, shadows: 10, vibrance: 12, grade: { sh: { h: 225, s: 25, l: 0 }, hi: { h: 260, s: 10, l: 0 } } } },
    { id: 'l_haze', name: '去霧山景', e: { dehaze: 35, contrast: 8, clarity: 12, highlights: -20, vibrance: 10 } },
    { id: 'l_green', name: '森林綠意', e: { vibrance: 18, hsl: { hue: [0, 0, -10, -12, 0, 0, 0, 0], sat: [0, 0, 10, 15, 8, 0, 0, 0], lum: [0, 0, 5, -8, 0, 0, 0, 0] }, clarity: 8, shadows: 15 } },
  ] },
  { g: '黑白', items: [
    { id: 'b_classic', name: '經典黑白', e: { mono: true, contrast: 18, highlights: -10, shadows: 10, clarity: 8 } },
    { id: 'b_hard', name: '高反差', e: { mono: true, contrast: 45, whites: 20, blacks: -25, clarity: 22, bw: [10, 15, 10, -10, -20, -30, -10, 5] } },
    { id: 'b_soft', name: '柔和灰階', e: { mono: true, contrast: -18, fade: 22, highlights: -15 } },
    { id: 'b_film', name: '底片顆粒', e: { mono: true, contrast: 20, grain: { amt: 35, size: 30, rough: 60 }, vig: { amt: -15, mid: 45, feather: 75 } } },
  ] },
  { g: '電影感', items: [
    { id: 'c_teal', name: '青橙', e: { contrast: 15, highlights: -20, shadows: 5, saturation: -5, hsl: { hue: [0, -5, 0, 25, 0, -10, 0, 0], sat: [0, 10, -10, -20, 10, 10, 0, 0] }, grade: { sh: { h: 190, s: 32, l: 0 }, hi: { h: 34, s: 26, l: 0 } } } },
    { id: 'c_faded', name: '褪色底片', e: { contrast: -8, fade: 35, saturation: -15, grain: { amt: 18, size: 25, rough: 50 }, grade: { sh: { h: 205, s: 15, l: 0 }, hi: { h: 45, s: 12, l: 0 } } } },
    { id: 'c_noir', name: '暗黑', e: { exposure: -0.3, contrast: 30, shadows: -15, saturation: -35, vig: { amt: -35, mid: 35, feather: 60 }, clarity: 10 } },
  ] },
  { g: '夜景', items: [
    { id: 'n_city', name: '城市夜景', e: { ai: { on: true, amt: 70 }, contrast: 12, highlights: -40, shadows: 20, clarity: 10, vibrance: 15, temp: -6 } },
    { id: 'n_star', name: '星空', e: { ai: { on: true, amt: 80 }, contrast: 20, dehaze: 15, clarity: 20, temp: -12, highlights: -20, shadows: 10, blacks: -10 } },
  ] },
  { g: '美食', items: [
    { id: 'f_warm', name: '暖色美味', e: { exposure: 0.15, temp: 10, contrast: 8, shadows: 12, vibrance: 20, texture: 15, hsl: { sat: [5, 10, 8, 0, 0, 0, 0, 0] } } },
    { id: 'f_fresh', name: '清新明亮', e: { exposure: 0.3, contrast: 5, highlights: -15, shadows: 20, whites: 10, vibrance: 15, temp: -4 } },
  ] },
  { g: '街拍', items: [
    { id: 's_grit', name: '粗獷', e: { contrast: 25, clarity: 30, texture: 20, saturation: -20, vig: { amt: -20, mid: 50, feather: 60 } } },
    { id: 's_pastel', name: '粉彩', e: { exposure: 0.2, contrast: -12, fade: 25, saturation: -10, vibrance: 10, grade: { hi: { h: 330, s: 12, l: 0 }, sh: { h: 190, s: 10, l: 0 } } } },
  ] },
];
function lerpDeep(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => (typeof v === 'number' && typeof b[i] === 'number' ? v + (b[i] - v) * t : t >= .5 ? clone(b[i]) : clone(v)));
  if (a && b && typeof a === 'object' && typeof b === 'object') { const o = {}; for (const k in b) o[k] = k in a ? lerpDeep(a[k], b[k], t) : clone(b[k]); for (const k in a) if (!(k in b)) o[k] = clone(a[k]); return o; }
  return t >= .5 ? clone(b) : clone(a);
}
/* 套用預設集：以 base 為起點，預設集定義的欄位覆寫，amount 0–200 */
function applyPreset(base, pe, amt) {
  base = normEdit(base); const target = deepMerge(clone(base), pe);
  const t = amt / 100;
  if (t <= 1) return lerpDeep(base, target, t);
  const out = lerpDeep(base, target, t); return out; // 線性外插（>100%）
}
const COPY_GROUPS = {
  '基本': ['wb', 'temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'profile', 'profileAmt'],
  '色調曲線': ['curve'], '天空置換': ['sky'], '色彩': ['vibrance', 'saturation', 'hsl', 'bw', 'mono', 'grade', 'toning', 'fade'],
  '效果': ['texture', 'clarity', 'dehaze', 'vig', 'grain'], '細節/AI 降噪': ['sharp', 'nr', 'ai'], '光學': ['optics'],
  '幾何': ['geo'], '裁切': ['crop'], '遮色片': ['masks'], '修復': ['heal'], '位置（GPS）': ['loc']
};
function pickGroups(e, groups) { const o = {}; for (const g of groups) for (const k of COPY_GROUPS[g] || []) o[k] = clone(e[k]); return o; }


/* ================= 風格檔匯入 ================= */
function parseCube(text) {
  let N = 0, dmin = [0, 0, 0], dmax = [1, 1, 1], title = ''; const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l[0] === '#') continue;
    const up = l.toUpperCase();
    if (up.startsWith('TITLE')) { title = l.replace(/^TITLE\s*/i, '').replace(/"/g, ''); continue; }
    if (up.startsWith('LUT_3D_SIZE')) { N = parseInt(l.split(/\s+/)[1]); continue; }
    if (up.startsWith('LUT_1D_SIZE')) throw new Error('不支援 1D LUT，請使用 3D LUT（.cube）');
    if (up.startsWith('DOMAIN_MIN')) { dmin = l.split(/\s+/).slice(1).map(Number); continue; }
    if (up.startsWith('DOMAIN_MAX')) { dmax = l.split(/\s+/).slice(1).map(Number); continue; }
    if (/^[A-Z_]/.test(up)) continue;
    const t = l.split(/\s+/).map(Number); if (t.length >= 3 && t.every((v) => isFinite(v))) vals.push(t[0], t[1], t[2]);
  }
  if (!N || vals.length < N * N * N * 3) throw new Error('LUT 格式不正確');
  if (N > 65) throw new Error('LUT 尺寸過大（最大 65）');
  const data = new Uint8Array(N * N * N * 4);
  // .cube：R 變化最快，其次 G，再 B → 圖集座標 (r + b*N, g)
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const i = ((b * N + g) * N + r) * 3, o = (g * N * N + b * N + r) * 4;
    for (let c = 0; c < 3; c++) data[o + c] = Math.round(clamp((vals[i + c] - dmin[c]) / ((dmax[c] - dmin[c]) || 1), 0, 1) * 255);
    data[o + 3] = 255;
  }
  return { N, data, title };
}
function deltaOf(abs, def) {
  const d = {};
  for (const k in abs) {
    const a = abs[k], b = def ? def[k] : undefined;
    if (typeof a === 'number') { if (typeof b === 'number' ? Math.abs(a - b) > 1e-9 : a !== 0) d[k] = a - (typeof b === 'number' ? b : 0); }
    else if (typeof a === 'boolean') { if (a && !b) d[k] = true; }
    else if (Array.isArray(a)) { if (Array.isArray(a[0])) { if (JSON.stringify(a) !== JSON.stringify(b)) d[k] = clone(a); } else if (a.some((v, i) => v !== (b ? b[i] : 0))) d[k] = a.map((v, i) => v - (b ? b[i] || 0 : 0)); }
    else if (a && typeof a === 'object') {
      if ('h' in a && 's' in a && !('l' in a && Object.keys(a).length > 3)) { if (a.s || a.l) d[k] = { h: a.h, s: a.s, l: a.l || 0 }; }
      else { const sub = deltaOf(a, b || {}); if (Object.keys(sub).length) d[k] = sub; }
    }
  }
  return d;
}
/* Lightroom / Camera Raw 的 .xmp 預設集或描述檔（crs: 參數） */
function parseCrsXmp(text) {
  const get = (k) => { let m = text.match(new RegExp('crs:' + k + '="([^"]*)"')); if (m) return m[1]; m = text.match(new RegExp('<crs:' + k + '>([^<]*)</crs:' + k + '>')); return m ? m[1] : null; };
  const n = (k) => { const v = get(k); return v == null || v === '' ? null : parseFloat(v); };
  const seq = (k) => { const m = text.match(new RegExp('<crs:' + k + '>\\s*<rdf:Seq>([\\s\\S]*?)</rdf:Seq>')); if (!m) return null; const pts = [...m[1].matchAll(/<rdf:li>\s*([\d.]+)\s*,\s*([\d.]+)\s*<\/rdf:li>/g)].map((x) => [+x[1] / 255, +x[2] / 255]); return pts.length >= 2 ? pts : null; };
  const e = clone(DEF_EDIT); let cnt = 0; const S = (path, v, f = (x) => x) => { if (v == null || !isFinite(v)) return; setP(e, path, f(v)); cnt++; };
  S('exposure', n('Exposure2012') ?? n('Exposure')); S('contrast', n('Contrast2012')); S('highlights', n('Highlights2012')); S('shadows', n('Shadows2012'));
  S('whites', n('Whites2012')); S('blacks', n('Blacks2012')); S('temp', n('IncrementalTemperature')); S('tint', n('IncrementalTint'));
  S('vibrance', n('Vibrance')); S('saturation', n('Saturation')); S('texture', n('Texture')); S('clarity', n('Clarity2012')); S('dehaze', n('Dehaze'));
  const C = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
  C.forEach((c, i) => { S('hsl.hue.' + i, n('HueAdjustment' + c)); S('hsl.sat.' + i, n('SaturationAdjustment' + c)); S('hsl.lum.' + i, n('LuminanceAdjustment' + c)); S('bw.' + i, n('GrayMixer' + c)); });
  if (/crs:ConvertToGrayscale="True"|<crs:ConvertToGrayscale>True/.test(text)) { e.mono = true; cnt++; }
  for (const [z, k] of [['sh', 'Shadow'], ['mid', 'Midtone'], ['hi', 'Highlight'], ['glob', 'Global']]) { S(`grade.${z}.h`, n(`ColorGrade${k}Hue`)); S(`grade.${z}.s`, n(`ColorGrade${k}Sat`)); S(`grade.${z}.l`, n(`ColorGrade${k}Lum`)); }
  if (n('ColorGradeShadowSat') == null) { S('grade.sh.h', n('SplitToningShadowHue')); S('grade.sh.s', n('SplitToningShadowSaturation')); S('grade.hi.h', n('SplitToningHighlightHue')); S('grade.hi.s', n('SplitToningHighlightSaturation')); }
  S('grade.blend', n('ColorGradeBlending')); S('grade.balance', n('SplitToningBalance'));
  S('curve.par.s', n('ParametricShadows')); S('curve.par.d', n('ParametricDarks')); S('curve.par.l', n('ParametricLights')); S('curve.par.h', n('ParametricHighlights'));
  S('curve.par.s1', n('ParametricShadowSplit')); S('curve.par.s2', n('ParametricMidtoneSplit')); S('curve.par.s3', n('ParametricHighlightSplit'));
  for (const [k, c] of [['ToneCurvePV2012', 'rgb'], ['ToneCurvePV2012Red', 'r'], ['ToneCurvePV2012Green', 'g'], ['ToneCurvePV2012Blue', 'b']]) { const q = seq(k); if (q) { e.curve[c] = q; cnt++; } }
  S('vig.amt', n('PostCropVignetteAmount')); S('vig.mid', n('PostCropVignetteMidpoint')); S('vig.round', n('PostCropVignetteRoundness')); S('vig.feather', n('PostCropVignetteFeather')); S('vig.hl', n('PostCropVignetteHighlightContrast'));
  S('grain.amt', n('GrainAmount')); S('grain.size', n('GrainSize')); S('grain.rough', n('GrainFrequency'));
  S('sharp.amt', n('Sharpness')); S('sharp.rad', n('SharpenRadius')); S('sharp.det', n('SharpenDetail')); S('sharp.mask', n('SharpenEdgeMasking'));
  S('nr.lum', n('LuminanceSmoothing')); S('nr.ldet', n('LuminanceNoiseReductionDetail')); S('nr.lcon', n('LuminanceNoiseReductionContrast'));
  S('nr.col', n('ColorNoiseReduction')); S('nr.cdet', n('ColorNoiseReductionDetail')); S('nr.csm', n('ColorNoiseReductionSmoothness'));
  S('optics.purple', n('DefringePurpleAmount')); S('optics.green', n('DefringeGreenAmount')); if (e.optics.purple || e.optics.green) e.optics.ca = true;
  S('optics.dist', n('LensManualDistortionAmount')); S('optics.vigCorr', n('VignetteAmount'));
  S('geo.vert', n('PerspectiveVertical')); S('geo.horiz', n('PerspectiveHorizontal')); S('geo.rot', n('PerspectiveRotate')); S('geo.scale', n('PerspectiveScale')); S('geo.aspect', n('PerspectiveAspect')); S('geo.ox', n('PerspectiveX')); S('geo.oy', n('PerspectiveY'));
  let name = null; const nm = text.match(/<crs:Name>\s*<rdf:Alt>\s*<rdf:li[^>]*>([^<]+)<\/rdf:li>/) || text.match(/crs:Name="([^"]+)"/) || text.match(/crs:PresetName="([^"]+)"/); if (nm) name = nm[1];
  const hasTable = /RGBTable|LookTable/.test(text);
  if (!cnt && !hasTable) throw new Error('檔案中找不到 Lightroom 參數');
  return { abs: e, d: deltaOf(e, DEF_EDIT), name, hasTable, cnt };
}

/* ================= 影像分析（自動） ================= */
function imgData(src, long) {
  const s = Math.min(1, long / Math.max(src.width, src.height)); const c = mkCanvas(src.width * s, src.height * s);
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, c.width, c.height); return x.getImageData(0, 0, c.width, c.height);
}
const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)), l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
function autoWB(id) {
  let r = 0, g = 0, b = 0, n = 0; const d = id.data;
  for (let i = 0; i < d.length; i += 4) { const R = s2l(d[i] / 255), G = s2l(d[i + 1] / 255), B = s2l(d[i + 2] / 255); const m = Math.max(R, G, B); if (m > 0.97 || m < 0.02) continue; r += R; g += G; b += B; n++; }
  if (!n) return { temp: 0, tint: 0 };
  r /= n; g /= n; b /= n;
  const temp = clamp(Math.log(b / r) / 0.72 * 100 * 0.85, -100, 100);
  const tint = clamp(Math.log(g / Math.sqrt(r * b)) / 0.24 * 100 * 0.8, -100, 100);
  return { temp: Math.round(temp), tint: Math.round(tint) };
}
function autoTone(id, iso) {
  const isoF = iso >= 6400 ? 0.4 : iso >= 3200 ? 0.55 : iso >= 1600 ? 0.75 : 1;
  const d = id.data; const hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < d.length; i += 4) { const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; hist[y | 0]++; n++; }
  const pct = (p) => { let c = 0; const t = n * p; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= t) return i / 255; } return 1; };
  const p005 = pct(.005), p05 = pct(.05), p50 = pct(.5), p95 = pct(.95), p995 = pct(.995);
  const ev = clamp(Math.log2(s2l(0.42) / Math.max(s2l(p50), 1e-3)) * 0.5, -1.5, 1.2);
  const shift = (v) => l2s(clamp(s2l(v) * Math.pow(2, ev), 0, 4));
  const q05 = shift(p05), q95 = shift(p95), q995 = shift(p995), q005 = shift(p005);
  return {
    exposure: Math.round(ev * 100) / 100,
    contrast: Math.round(clamp((0.62 - (q95 - q05)) * 60, -15, 25)),
    highlights: Math.round(clamp(-(q95 - 0.78) * 220, -70, 0)),
    shadows: Math.round(clamp((0.16 - q05) * 180, 0, 32) * isoF),
    whites: Math.round(clamp((0.97 - q995) * 100, -40, 30)),
    blacks: Math.round(clamp((0.02 - q005) * 200, -30, 8) - (1 - isoF) * 10),
    vibrance: 12, saturation: 3
  };
}
/* 自動水平：邊緣方向統計 */
function autoLevel(id) {
  const { width: W, height: H, data: d } = id; const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  const bins = new Float32Array(241); // -12..12 度，0.1 度
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = L[i + 1 - W] + 2 * L[i + 1] + L[i + 1 + W] - L[i - 1 - W] - 2 * L[i - 1] - L[i - 1 + W];
    const gy = L[i + W - 1] + 2 * L[i + W] + L[i + W + 1] - L[i - W - 1] - 2 * L[i - W] - L[i - W + 1];
    const m = Math.hypot(gx, gy); if (m < 60) continue;
    let a = Math.atan2(gy, gx) * 180 / Math.PI; // 邊緣法線方向
    a = ((a % 90) + 90) % 90; if (a > 45) a -= 90; // 相對水平/垂直的偏差
    if (Math.abs(a) > 12) continue; bins[Math.round((a + 12) * 10)] += m;
  }
  let best = 120, bv = 0; for (let i = 3; i < 238; i++) { let s = 0; for (let k = -3; k <= 3; k++) s += bins[i + k]; if (s > bv) { bv = s; best = i; } }
  return -((best / 10) - 12);
}
/* 天空偵測（區域成長） */
function detectSky(id) {
  const { width: W, height: H, data: d } = id; const N = W * H;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), V = new Float32Array(N);
  for (let i = 0; i < N; i++) { R[i] = d[i * 4] / 255; G[i] = d[i * 4 + 1] / 255; B[i] = d[i * 4 + 2] / 255; V[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i]; }
  const grad = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; grad[i] = Math.abs(V[i + 1] - V[i - 1]) + Math.abs(V[i + W] - V[i - W]); }
  const cand = (i) => { const blue = B[i] - R[i]; return V[i] > 0.28 && grad[i] < 0.09 && (blue > 0.02 || (V[i] > 0.62 && Math.max(R[i], G[i], B[i]) - Math.min(R[i], G[i], B[i]) < 0.16)); };
  const m = new Uint8Array(N); const q = [];
  for (let y = 0; y < Math.max(2, H * 0.06); y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (cand(i)) { m[i] = 1; q.push(i); } }
  while (q.length) { const i = q.pop(); const x = i % W, y = (i / W) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (j < 0 || m[j]) continue; const dc = Math.abs(R[j] - R[i]) + Math.abs(G[j] - G[i]) + Math.abs(B[j] - B[i]);
      if (cand(j) && dc < 0.09) { m[j] = 1; q.push(j); } } }
  // 柔化
  const out = new Uint8Array(N * 4); let cnt = 0; const vals = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, c = 0; for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) { const yy = y + j, xx = x + k; if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue; s += m[yy * W + xx]; c++; } const v = s / c; const i = y * W + x; out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = Math.round(v * 255); out[i * 4 + 3] = 255; if (m[i]) { cnt++; vals.push(V[i]); } }
  let ys = []; for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x++) c += m[y * W + x]; if (c > W * 0.04) ys.push(y); }
  const ybot = ys.length ? (ys[Math.floor(ys.length * 0.97)] + 1) / H : 0.5;
  vals.sort((a, b) => a - b); const lmin = vals.length ? l2s(s2l(vals[Math.floor(vals.length * 0.03)])) * 0.92 : 0.3;
  return { data: out, W, H, frac: cnt / N, ybot, lmin: Math.min(lmin, vals.length ? vals[Math.floor(vals.length * 0.03)] : 0.3) };
}
/* 修復：自動尋找來源 */
function findHealSource(id, cx, cy, r) {
  const { width: W, height: H, data: d } = id; const lum = (x, y) => { x = clamp(Math.round(x), 0, W - 1); y = clamp(Math.round(y), 0, H - 1); const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const ring = (x, y) => { const a = []; for (let k = 0; k < 24; k++) { const t = k / 24 * Math.PI * 2; for (const rr of [1.15, 1.5]) a.push(lum(x + Math.cos(t) * r * rr, y + Math.sin(t) * r * rr)); } return a; };
  const dr = ring(cx, cy); let best = null, bs = 1e18;
  for (const dist of [2.3, 3, 4]) for (let k = 0; k < 24; k++) {
    const t = k / 24 * Math.PI * 2; const x = cx + Math.cos(t) * r * dist, y = cy + Math.sin(t) * r * dist;
    if (x - r < 0 || y - r < 0 || x + r >= W || y + r >= H) continue;
    const cr = ring(x, y); let s = 0; for (let i = 0; i < cr.length; i++) for (let c = 0; c < 3; c++) s += (cr[i][c] - dr[i][c]) ** 2;
    let m = [0, 0, 0], v = 0; const inn = []; for (let j = 0; j < 12; j++) { const tt = j / 12 * Math.PI * 2; inn.push(lum(x + Math.cos(tt) * r * .5, y + Math.sin(tt) * r * .5)); } inn.push(lum(x, y));
    for (const p of inn) for (let c = 0; c < 3; c++) m[c] += p[c] / inn.length; for (const p of inn) for (let c = 0; c < 3; c++) v += (p[c] - m[c]) ** 2;
    s += v * 2 + dist * 200; if (s < bs) { bs = s; best = [x, y]; }
  }
  return best || [cx + r * 2.5, cy];
}

/* ================= 修復貼片 ================= */
const HealCache = new Map();
/* base: 影像來源（ImageBitmap/Canvas），bw,bh: 其尺寸；回傳 {canvas, x, y}（base 座標） */
function healPatch(spot, base, bw, bh, tag) {
  const L = Math.max(bw, bh); const r = Math.max(1.5, spot.r * L);
  const key = tag + '|' + bw + '|' + JSON.stringify(spot); const hit = HealCache.get(key); if (hit) return hit;
  const R = Math.ceil(r) + 2, S = R * 2;
  const cx = spot.x * bw, cy = spot.y * bh, sx = spot.sx * bw, sy = spot.sy * bh;
  const cv = mkCanvas(S, S), cx2 = cv.getContext('2d', { willReadFrequently: true });
  cx2.drawImage(base, cx - R, cy - R, S, S, 0, 0, S, S); const D = cx2.getImageData(0, 0, S, S);
  cx2.clearRect(0, 0, S, S); cx2.drawImage(base, sx - R, sy - R, S, S, 0, 0, S, S); const Sd = cx2.getImageData(0, 0, S, S);
  const out = cx2.createImageData(S, S); const feather = clamp(spot.feather == null ? .5 : spot.feather, 0.02, 1), op = spot.opacity == null ? 1 : spot.opacity;
  const bpts = []; const NB = 40;
  if (spot.mode !== 'clone') for (let k = 0; k < NB; k++) {
    const t = k / NB * Math.PI * 2; const px = R + Math.cos(t) * r * 0.97, py = R + Math.sin(t) * r * 0.97; const diff = [0, 0, 0]; let c = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = clamp(Math.round(px + i), 0, S - 1), yy = clamp(Math.round(py + j), 0, S - 1); const q = (yy * S + xx) * 4; for (let ch = 0; ch < 3; ch++) diff[ch] += D.data[q + ch] - Sd.data[q + ch]; c++; }
    bpts.push([px, py, diff[0] / c, diff[1] / c, diff[2] / c]);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + .5 - R, dy = y + .5 - R, dist = Math.hypot(dx, dy); if (dist > r) continue;
    const t = clamp((dist / r - (1 - feather)) / feather, 0, 1); const a = op * (1 - t * t * (3 - 2 * t)); const q = (y * S + x) * 4;
    let o0 = 0, o1 = 0, o2 = 0;
    if (bpts.length) { let ws = 0; for (const b of bpts) { const w = 1 / ((x - b[0]) ** 2 + (y - b[1]) ** 2 + 1); ws += w; o0 += b[2] * w; o1 += b[3] * w; o2 += b[4] * w; } o0 /= ws; o1 /= ws; o2 /= ws; }
    out.data[q] = Sd.data[q] + o0; out.data[q + 1] = Sd.data[q + 1] + o1; out.data[q + 2] = Sd.data[q + 2] + o2; out.data[q + 3] = a * 255;
  }
  cx2.putImageData(out, 0, 0);
  const res = { canvas: cv, x: cx - R, y: cy - R }; if (HealCache.size > 300) HealCache.clear(); HealCache.set(key, res); return res;
}
/* 把修復貼片畫到 region canvas。region: base 座標的 {x,y,w,h}，scale：canvas 像素/基底像素 */
function drawHeals(ctx, heal, base, bw, bh, region, scale, tag) {
  for (const sp of heal || []) {
    const L = Math.max(bw, bh), r = sp.r * L * 1.1; const cx = sp.x * bw, cy = sp.y * bh;
    if (cx + r < region.x || cy + r < region.y || cx - r > region.x + region.w || cy - r > region.y + region.h) continue;
    const p = healPatch(sp, base, bw, bh, tag);
    ctx.drawImage(p.canvas, (p.x - region.x) * scale, (p.y - region.y) * scale, p.canvas.width * scale, p.canvas.height * scale);
  }
}

/* ================= 筆刷遮色片點陣化 ================= */
function rasterBrush(m, SW, SH, rect, cw, ch) {
  const c = mkCanvas(cw, ch), x = c.getContext('2d'); const L = Math.max(SW, SH);
  const kx = cw / (rect[2] * SW), ky = ch / (rect[3] * SH);
  for (const st of m.p.strokes || []) {
    x.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
    const rad = Math.max(0.6, st.size * L * kx), fe = clamp(st.feather == null ? .5 : st.feather, 0.01, 1), flow = st.flow == null ? 1 : st.flow;
    const pts = st.pts; if (!pts.length) continue;
    const dab = (px, py) => { const X = (px - rect[0]) * SW * kx, Y = (py - rect[1]) * SH * ky; if (X < -rad || Y < -rad || X > cw + rad || Y > ch + rad) return; const g = x.createRadialGradient(X, Y, rad * (1 - fe), X, Y, rad); g.addColorStop(0, `rgba(255,255,255,${flow})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(X, Y, rad, 0, Math.PI * 2); x.fill(); };
    dab(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const dist = Math.hypot((bx - ax) * SW * kx, (by - ay) * SH * ky); const n = Math.max(1, Math.ceil(dist / (rad * 0.3))); for (let k = 1; k <= n; k++) dab(ax + (bx - ax) * k / n, ay + (by - ay) * k / n); }
  }
  return c;
}
