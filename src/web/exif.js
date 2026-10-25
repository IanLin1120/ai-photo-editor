/* ================= EXIF：讀取 RAW／JPG 的中繼資料、寫入輸出檔 =================
   - 讀：TIFF 架構（ARW、DNG、NEF、TIFF）與 JPEG APP1；Sony SR2 加密區（鏡頭校正參數）
   - 寫：JPEG 插入 APP1（保留原始 EXIF＋新的 GPS），16-bit TIFF 內嵌 EXIF
   - 拍攝時間（DateTimeOriginal）原封不動保留；修改時間 DateTime 也設成拍攝時間 */
(function (G) {
'use strict';
const TYPES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
function reader(buf, off, le) {
  const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  return {
    dv, le, len: buf.byteLength,
    u8: o => dv.getUint8(o), u16: o => dv.getUint16(o, le), u32: o => dv.getUint32(o, le),
    i16: o => dv.getInt16(o, le), i32: o => dv.getInt32(o, le), f32: o => dv.getFloat32(o, le), f64: o => dv.getFloat64(o, le)
  };
}
/* 讀一個 IFD，回傳 {tag:{type,count,raw:Uint8Array(原始位元組), val}} 與下一個 IFD 位置 */
function readIFD(R, base, off, maxN) {
  const out = {}; if (off <= 0 || off + 2 > R.len) return { tags: out, next: 0 };
  const n = R.u16(base + off); if (n > (maxN || 1000)) return { tags: out, next: 0 };
  for (let i = 0; i < n; i++) {
    const e = base + off + 2 + i * 12; if (e + 12 > R.len) break;
    const tag = R.u16(e), type = R.u16(e + 2), count = R.u32(e + 4), sz = (TYPES[type] || 1) * count;
    let vo = sz <= 4 ? e + 8 : base + R.u32(e + 8);
    if (vo + sz > R.len || sz > 64e6) continue;
    out[tag] = { type, count, off: vo, raw: new Uint8Array(R.dv.buffer, R.dv.byteOffset + vo, sz).slice(), val: readVal(R, type, count, vo) };
  }
  const nx = base + off + 2 + n * 12; return { tags: out, next: nx + 4 <= R.len ? R.u32(nx) : 0 };
}
function readVal(R, type, count, o) {
  const a = [], lim = Math.min(count, 4096);
  switch (type) {
    case 2: { let s = ''; for (let i = 0; i < count; i++) { const c = R.u8(o + i); if (!c) break; s += String.fromCharCode(c); } try { s = decodeURIComponent(escape(s)); } catch (e) { } return s.trim(); }
    case 1: case 7: for (let i = 0; i < lim; i++) a.push(R.u8(o + i)); break;
    case 6: for (let i = 0; i < lim; i++) a.push(R.dv.getInt8(o + i)); break;
    case 3: for (let i = 0; i < lim; i++) a.push(R.u16(o + 2 * i)); break;
    case 8: for (let i = 0; i < lim; i++) a.push(R.i16(o + 2 * i)); break;
    case 4: case 13: for (let i = 0; i < lim; i++) a.push(R.u32(o + 4 * i)); break;
    case 9: for (let i = 0; i < lim; i++) a.push(R.i32(o + 4 * i)); break;
    case 5: for (let i = 0; i < lim; i++) a.push(R.u32(o + 8 * i) / (R.u32(o + 8 * i + 4) || 1)); break;
    case 10: for (let i = 0; i < lim; i++) a.push(R.i32(o + 8 * i) / (R.i32(o + 8 * i + 4) || 1)); break;
    case 11: for (let i = 0; i < lim; i++) a.push(R.f32(o + 4 * i)); break;
    case 12: for (let i = 0; i < lim; i++) a.push(R.f64(o + 8 * i)); break;
  }
  return count === 1 ? a[0] : a;
}
/* Sony SR2 解密（dcraw sony_decrypt）：資料以大端序 32 位元字組與金鑰流 XOR */
function sonyDecrypt(u8, key) {
  const pad = new Uint32Array(128); let k = key >>> 0;
  for (let p = 0; p < 4; p++) { k = (Math.imul(k, 48828125) + 1) >>> 0; pad[p] = k; }
  pad[3] = ((pad[3] << 1) | ((pad[0] ^ pad[2]) >>> 31)) >>> 0;
  for (let p = 4; p < 127; p++) pad[p] = (((pad[p - 4] ^ pad[p - 2]) << 1) | ((pad[p - 3] ^ pad[p - 1]) >>> 31)) >>> 0;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = u8.byteLength >> 2; let p = 127;
  for (let i = 0; i < n; i++) {
    p++; const v = pad[(p - 1) & 127] = (pad[p & 127] ^ pad[(p + 64) & 127]) >>> 0;
    dv.setUint32(i * 4, (dv.getUint32(i * 4, false) ^ v) >>> 0, false);
  }
  return u8;
}
/* 解析檔案：回傳 {make, model, lens, focal, iso, dateOriginal, ifd0, exif, gps, sony:{dist,ca,vig}, orientation} */
function parse(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let base = 0;
  if (u8[0] === 0xFF && u8[1] === 0xD8) { // JPEG：找 APP1 Exif
    let o = 2;
    while (o + 4 < u8.length) {
      if (u8[o] !== 0xFF) break; const m = u8[o + 1], L = (u8[o + 2] << 8) | u8[o + 3];
      if (m === 0xE1 && u8[o + 4] === 0x45 && u8[o + 5] === 0x78 && u8[o + 6] === 0x69 && u8[o + 7] === 0x66) { base = o + 10; break; }
      if (m === 0xDA) break; o += 2 + L;
    }
    if (!base) return { kind: 'jpeg', ifd0: {}, exif: {}, gps: {} };
  }
  const le = u8[base] === 0x49; const R = reader(u8, 0, le);
  if (R.u16(base + 2) !== 42 && R.u16(base + 2) !== 0x4F52 && R.u16(base + 2) !== 0x55) return null;
  const I0 = readIFD(R, base, R.u32(base + 4)), ifd0 = I0.tags;
  const exif = ifd0[0x8769] ? readIFD(R, base, ifd0[0x8769].val).tags : {};
  const gps = ifd0[0x8825] ? readIFD(R, base, ifd0[0x8825].val).tags : {};
  const out = { kind: base ? 'jpeg' : 'tiff', le, ifd0, exif, gps };
  const g = (t, k) => (t[k] ? t[k].val : undefined);
  out.make = g(ifd0, 0x010F) || ''; out.model = g(ifd0, 0x0110) || '';
  out.orientation = g(ifd0, 0x0112) || 1;
  out.dateOriginal = g(exif, 0x9003) || g(ifd0, 0x0132) || '';
  out.offsetTime = g(exif, 0x9011) || '';
  out.lens = g(exif, 0xA434) || ''; out.focal = g(exif, 0x920A); out.iso = g(exif, 0x8827); out.fnum = g(exif, 0x829D); out.exposure = g(exif, 0x829A);
  // Sony 鏡頭校正參數：在 RAW 影像的 SubIFD（0x014A）裡：0x7032 暗角、0x7035 色差、0x7037 變形
  try {
    if (/sony/i.test(out.make) && ifd0[0x014A]) {
      const subs = [].concat(ifd0[0x014A].val);
      for (const so of subs) {
        const T = readIFD(R, base, so).tags, arr = t => (T[t] ? [].concat(T[t].val) : null);
        const d = arr(0x7037), c = arr(0x7035), v = arr(0x7032);
        if (d && c && v) { const toS = a => a.map(x => (x > 32767 ? x - 65536 : x)); const D = toS(d), C = toS(c), V = toS(v), nc = D[0];
          if (nc <= 16 && C[0] === 2 * nc && V[0] === nc) { out.sony = { nc, dist: D.slice(1, nc + 1), ca_r: C.slice(1, nc + 1), ca_b: C.slice(nc + 1, 2 * nc + 1), vig: V.slice(1, nc + 1) }; break; } }
      }
    }
  } catch (e) { out.sonyErr = String(e); }
  // GPS
  if (gps[2] && gps[4]) {
    const dms = a => a[0] + a[1] / 60 + a[2] / 3600;
    out.lat = dms(gps[2].val) * (g(gps, 1) === 'S' ? -1 : 1); out.lon = dms(gps[4].val) * (g(gps, 3) === 'W' ? -1 : 1);
  }
  return out;
}
/* 找出 RAW 內嵌的 JPEG 預覽（ARW IFD0 0x201、DNG SubIFD 預覽…），回傳 [{off,len}]（由大到小） */
function previews(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf); if (u8[0] === 0xFF && u8[1] === 0xD8) return [];
  const le = u8[0] === 0x49, R = reader(u8, 0, le), out = [];
  const visit = (off, depth) => {
    if (!off || depth > 3) return; const T = readIFD(R, 0, off).tags;
    const g = t => T[t] ? T[t].val : undefined;
    if (g(0x201) && g(0x202)) out.push({ off: g(0x201), len: g(0x202) });
    const comp = g(0x103); if ((comp === 7 || comp === 6) && g(0x111) != null && g(0x117) != null && g(0xFE) === 1) { const o = [].concat(g(0x111)), l = [].concat(g(0x117)); if (o.length === 1) out.push({ off: o[0], len: l[0] }); }
    if (T[0x14A]) [].concat(g(0x14A)).forEach(o => visit(o, depth + 1));
  };
  try { let off = R.u32(4), n = 0; while (off && n++ < 4) { visit(off, 0); off = readIFD(R, 0, off).next; } } catch (e) { }
  return out.filter(p => p.len > 2000).sort((a, b) => b.len - a.len);
}
/* EXIF 日期字串 → 毫秒（當地時間，含 OffsetTime 時用它） */
function exifDateMs(s, off) {
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s || ''); if (!m) return 0;
  if (off && /^[+-]\d\d:\d\d$/.test(off)) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`);
  return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

/* ---------------- 寫入 ---------------- */
function W() { // 大端序寫入器
  let a = new Uint8Array(1 << 16), n = 0;
  const grow = k => { if (n + k <= a.length) return; let b = new Uint8Array(Math.max(a.length * 2, n + k)); b.set(a); a = b; };
  return { get n() { return n; }, u8(v) { grow(1); a[n++] = v & 255; }, u16(v) { grow(2); a[n++] = (v >> 8) & 255; a[n++] = v & 255; },
    u32(v) { grow(4); a[n++] = (v >>> 24) & 255; a[n++] = (v >>> 16) & 255; a[n++] = (v >>> 8) & 255; a[n++] = v & 255; },
    bytes(b) { grow(b.length); a.set(b, n); n += b.length; }, at(o, v) { a[o] = (v >>> 24) & 255; a[o + 1] = (v >>> 16) & 255; a[o + 2] = (v >>> 8) & 255; a[o + 3] = v & 255; },
    out() { return a.slice(0, n); } };
}
/* 把原始位元組轉成大端序（依型別翻轉） */
function toBE(raw, type, le) {
  if (!le) return raw; const s = TYPES[type] || 1; if (s === 1) return raw;
  const o = new Uint8Array(raw.length), unit = (type === 5 || type === 10) ? 4 : s;
  for (let i = 0; i < raw.length; i += unit) for (let j = 0; j < unit; j++) o[i + j] = raw[i + unit - 1 - j];
  return o;
}
const ent = (tag, type, count, data) => ({ tag, type, count, data });
const ascii = (tag, s) => { const b = new TextEncoder().encode(String(s) + '\0'); return ent(tag, 2, b.length, b); };
const short = (tag, v) => { const a = [].concat(v), b = new Uint8Array(a.length * 2); a.forEach((x, i) => { b[2 * i] = (x >> 8) & 255; b[2 * i + 1] = x & 255; }); return ent(tag, 3, a.length, b); };
const long = (tag, v) => { const a = [].concat(v), b = new Uint8Array(a.length * 4); a.forEach((x, i) => { b[4 * i] = (x >>> 24) & 255; b[4 * i + 1] = (x >>> 16) & 255; b[4 * i + 2] = (x >>> 8) & 255; b[4 * i + 3] = x & 255; }); return ent(tag, 4, a.length, b); };
const rational = (tag, v) => { const a = [].concat(v), b = new Uint8Array(a.length * 8); a.forEach((x, i) => { let d = 1; while (Math.abs(x * d - Math.round(x * d)) > 1e-7 && d < 1e7) d *= 10; const nn = Math.round(x * d); const dv = new DataView(b.buffer); dv.setUint32(8 * i, nn >>> 0); dv.setUint32(8 * i + 4, d >>> 0); }); return ent(tag, 5, a.length, b); };
const bytes = (tag, arr, type) => ent(tag, type || 1, arr.length, Uint8Array.from(arr));
function writeIFD(w, entries, tiffStart, nextPtrHook) {
  entries.sort((a, b) => a.tag - b.tag);
  const start = w.n; w.u16(entries.length); const fix = [];
  for (const e of entries) { w.u16(e.tag); w.u16(e.type); w.u32(e.count); if (e.data.length <= 4) { const b = new Uint8Array(4); b.set(e.data); w.bytes(b); } else { fix.push([w.n, e]); w.u32(0); } }
  const nextAt = w.n; w.u32(0);
  for (const [pos, e] of fix) { if (w.n & 1) w.u8(0); w.at(pos, w.n - tiffStart); w.bytes(e.data); }
  return { start, nextAt };
}
/* 由來源中繼資料＋選項組出 EXIF 的三個 IFD。opt：{w,h,software,gps:{lat,lon,alt},keepMaker,thumb} */
const SKIP_EXIF = new Set([0x927C /*MakerNote*/, 0xA005 /*Interop*/, 0xA002, 0xA003, 0x9286 /* UserComment 保留? */]);
function buildEntries(meta, opt) {
  const le = meta && meta.le, i0 = (meta && meta.ifd0) || {}, ex = (meta && meta.exif) || {};
  const keep = (tags, tag) => tags[tag] ? ent(tag, tags[tag].type, tags[tag].count, toBE(tags[tag].raw, tags[tag].type, le)) : null;
  const d0 = [0x010F, 0x0110, 0x013B, 0x8298].map(t => keep(i0, t)).filter(Boolean);
  const dt = (meta && meta.dateOriginal) || opt.date || '';
  d0.push(short(0x0112, 1), rational(0x011A, 300), rational(0x011B, 300), short(0x0128, 2), ascii(0x0131, opt.software || 'AI修圖軟體'));
  if (dt) d0.push(ascii(0x0132, dt));
  const de = [];
  for (const k in ex) { const t = +k; if (SKIP_EXIF.has(t)) continue; if (t === 0x927C) continue; const e = keep(ex, t); if (e) de.push(e); }
  if (opt.keepMaker && ex[0x927C] && ex[0x927C].raw.length < 40000) de.push(keep(ex, 0x927C));
  // 畫素尺寸、色彩空間
  for (const t of [0xA002, 0xA003, 0xA001]) { const i = de.findIndex(e => e.tag === t); if (i >= 0) de.splice(i, 1); }
  de.push(long(0xA002, opt.w), long(0xA003, opt.h), short(0xA001, opt.colorSpace || 1));
  if (!de.some(e => e.tag === 0x9000)) de.push(bytes(0x9000, [48, 50, 51, 50], 7));
  const dg = [];
  const g = opt.gps || (meta && meta.lat != null ? { lat: meta.lat, lon: meta.lon } : null);
  if (g && isFinite(g.lat) && isFinite(g.lon)) {
    const dms = v => { v = Math.abs(v); const d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60 * 10000) / 10000; return [d, m, s]; };
    dg.push(bytes(0x0000, [2, 3, 0, 0]), ascii(0x0001, g.lat >= 0 ? 'N' : 'S'), rational(0x0002, dms(g.lat)), ascii(0x0003, g.lon >= 0 ? 'E' : 'W'), rational(0x0004, dms(g.lon)));
    if (g.alt != null && isFinite(g.alt)) dg.push(bytes(0x0005, [g.alt < 0 ? 1 : 0]), rational(0x0006, Math.abs(Math.round(g.alt * 10) / 10)));
    dg.push(ascii(0x0012, 'WGS-84'));
    if (g.name) { const s = String(g.name).slice(0, 120), b = new Uint8Array(8 + s.length * 2); b.set([85, 78, 73, 67, 79, 68, 69, 0]); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[8 + 2 * i] = c >> 8; b[9 + 2 * i] = c & 255; } dg.push(ent(0x001C, 7, b.length, b)); }
  } else if (meta && meta.gps) { for (const k in meta.gps) { const e = keep(meta.gps, +k); if (e) dg.push(e); } }
  return { d0, de, dg };
}
/* JPEG 用的 APP1 區段（TIFF 起點在 "Exif\0\0" 之後） */
function app1(meta, opt) {
  const { d0, de, dg } = buildEntries(meta, opt);
  const w = W(); w.bytes([0x45, 0x78, 0x69, 0x66, 0, 0]); const T = w.n;
  w.bytes([0x4D, 0x4D, 0, 42]); w.u32(8);
  const pE = long(0x8769, 0), pG = dg.length ? long(0x8825, 0) : null;
  d0.push(pE); if (pG) d0.push(pG);
  writeIFD(w, d0, T);
  const findPtr = tag => { const b = w.out(); const n = (b[T + 8] << 8) | b[T + 9]; for (let i = 0; i < n; i++) { const e = T + 10 + i * 12; if (((b[e] << 8) | b[e + 1]) === tag) return e + 8; } return -1; };
  const posE = findPtr(0x8769); if (w.n & 1) w.u8(0); w.at(posE, w.n - T); writeIFD(w, de, T);
  if (pG) { const posG = findPtr(0x8825); if (w.n & 1) w.u8(0); w.at(posG, w.n - T); writeIFD(w, dg, T); }
  const body = w.out(); if (body.length + 2 > 65535) { if (opt.keepMaker) return app1(meta, Object.assign({}, opt, { keepMaker: false })); }
  const seg = new Uint8Array(body.length + 4); seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = ((body.length + 2) >> 8) & 255; seg[3] = (body.length + 2) & 255; seg.set(body, 4);
  return seg;
}
/* 把 EXIF 放進 JPEG（移除原本的 APP1） */
function jpegWithExif(jpg, meta, opt) {
  const u = new Uint8Array(jpg), parts = [u.slice(0, 2)]; let o = 2;
  const seg = app1(meta, opt);
  // 保留 APP0(JFIF) 之外的段落，去掉舊 APP1
  while (o + 4 < u.length && u[o] === 0xFF && u[o + 1] >= 0xE0 && u[o + 1] <= 0xEF) { const L = (u[o + 2] << 8) | u[o + 3]; if (u[o + 1] !== 0xE1) parts.push(u.slice(o, o + 2 + L)); o += 2 + L; }
  parts.splice(1, 0, seg); parts.push(u.slice(o));
  const tot = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(tot); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}
/* 16-bit TIFF（RGB，未壓縮或 Deflate），內含 EXIF 與 GPS */
async function tiff16(rgb16, w, h, meta, opt) {
  let data = new Uint8Array(rgb16.buffer, rgb16.byteOffset, rgb16.byteLength), comp = 1;
  // 轉大端序
  const be = new Uint8Array(data.length); for (let i = 0; i < data.length; i += 2) { be[i] = data[i + 1]; be[i + 1] = data[i]; } data = be;
  if (opt.deflate && typeof CompressionStream !== 'undefined') {
    // 水平差分（Predictor=2）讓壓縮率更好
    const dv = new DataView(data.buffer); const row = w * 3;
    for (let y = 0; y < h; y++) for (let x = w - 1; x > 0; x--) for (let c = 0; c < 3; c++) { const i = ((y * w + x) * 3 + c) * 2, j = ((y * w + x - 1) * 3 + c) * 2; dv.setUint16(i, (dv.getUint16(i) - dv.getUint16(j)) & 0xFFFF); }
    const cs = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
    data = new Uint8Array(await new Response(cs).arrayBuffer()); comp = 8;
  }
  const { d0, de, dg } = buildEntries(meta, Object.assign({}, opt, { w, h }));
  d0.push(long(0x0100, w), long(0x0101, h), short(0x0102, [16, 16, 16]), short(0x0103, comp), short(0x0106, 2), short(0x0115, 3), long(0x0116, h), short(0x011C, 1), long(0x0111, 0), long(0x0117, data.length));
  if (comp === 8) d0.push(short(0x013D, 2));
  const w_ = W(); w_.bytes([0x4D, 0x4D, 0, 42]); w_.u32(8);
  d0.push(long(0x8769, 0)); if (dg.length) d0.push(long(0x8825, 0));
  writeIFD(w_, d0, 0);
  const b0 = w_.out(), n0 = (b0[8] << 8) | b0[9], ptr = tag => { for (let i = 0; i < n0; i++) { const e = 10 + i * 12; if (((b0[e] << 8) | b0[e + 1]) === tag) return e + 8; } return -1; };
  if (w_.n & 1) w_.u8(0); w_.at(ptr(0x8769), w_.n); writeIFD(w_, de, 0);
  if (dg.length) { if (w_.n & 1) w_.u8(0); w_.at(ptr(0x8825), w_.n); writeIFD(w_, dg, 0); }
  if (w_.n & 1) w_.u8(0); w_.at(ptr(0x0111), w_.n);
  const head = w_.out(), out = new Uint8Array(head.length + data.length); out.set(head); out.set(data, head.length);
  return out;
}

const API = { previews, parse, sonyDecrypt, exifDateMs, app1, jpegWithExif, tiff16, buildEntries };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.EXIF = API;
})(typeof self !== 'undefined' ? self : globalThis);
