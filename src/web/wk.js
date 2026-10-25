/* ================= 修圖背景執行緒（Web Worker） =================
   持有目前照片的影像資料；預覽渲染、AI 自動、全解析度輸出都在這裡做，介面不會卡住 */
'use strict';
const E = self.ENG, X = self.EXIF;
// JPEG／PNG 等已編碼照片用的「恆等」描述檔（不再套相機曲線）
if (!PROFILES.JPEG) { const xs = [], ys = []; for (let i = 0; i < 59; i++) { const x = -13 + i * 0.25; xs.push(x); ys.push(Math.pow(2, x)); } PROFILES.JPEG = { xs, ys, hsm: Array.from({ length: 36 }, () => Array.from({ length: 8 }, () => [0, 1, 1])) }; }
const PROF = {}; const prof = k => PROF[k] || (PROF[k] = E.makeProfile(PROFILES[k] || PROFILES['*']));
const S = { key: null };
const SRGB2PP = (() => { // 線性 sRGB → 線性 ProPhoto（JPEG 輸入用）
  const inv = m => { const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2], A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, D = a * A + b * B + c * C;
    return [[A / D, -(b * i - c * h) / D, (b * f - c * e) / D], [B / D, (a * i - c * g) / D, -(a * f - c * d) / D], [C / D, -(a * h - b * g) / D, (a * e - b * d) / D]]; };
  return inv(E.PP2S);
})();

/* ---------- 共用 ---------- */
function lensFor(meta, key, L) {
  if (!L || L.on === false) return null;
  let base = null;
  if (meta && meta.sony) base = E.sonyLens(meta.sony);
  else if (LENSDB[key]) base = E.dbLens(LENSDB[key]);
  if (!base) return null;
  return E.lensSpec(base, { dist: L.dist == null ? 1 : L.dist, ca: L.ca === false ? 0 : (L.caAmt == null ? 1 : L.caAmt), vig: L.vig == null ? 1 : L.vig });
}
function rgbaFrom(o, alpha) { // 編碼浮點 → RGBA 8-bit
  const n = o.w * o.h, d = new Uint8ClampedArray(n * 4);
  for (let i = 0, j = 0; i < n; i++, j += 4) { d[j] = o.R[i] * 255 + .5; d[j + 1] = o.G[i] * 255 + .5; d[j + 2] = o.B[i] * 255 + .5; d[j + 3] = 255; }
  return d;
}
function hist(o) {
  const H = new Uint32Array(64 * 4), n = o.w * o.h, st = Math.max(1, (n / 120000) | 0);
  for (let i = 0; i < n; i += st) { const r = o.R[i], g = o.G[i], b = o.B[i]; H[Math.min(63, r * 64 | 0)]++; H[64 + Math.min(63, g * 64 | 0)]++; H[128 + Math.min(63, b * 64 | 0)]++; H[192 + Math.min(63, (0.2126 * r + 0.7152 * g + 0.0722 * b) * 64 | 0)]++; }
  return Array.from(H);
}
function keyOf(P, keys) { const o = {}; for (const k of keys) o[k] = P[k]; return JSON.stringify(o); }
async function rgbFromBytes(bytes) { // 已編碼照片 → 線性 ProPhoto 浮點
  const bmp = await createImageBitmap(new Blob([bytes]));
  const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data, w = bmp.width, h = bmp.height, o = E.img(w, h), M = SRGB2PP;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const r = E.eotf(d[j] / 255), g = E.eotf(d[j + 1] / 255), b = E.eotf(d[j + 2] / 255);
    o.R[i] = M[0][0] * r + M[0][1] * g + M[0][2] * b; o.G[i] = M[1][0] * r + M[1][1] * g + M[1][2] * b; o.B[i] = M[2][0] * r + M[2][1] * g + M[2][2] * b;
  }
  bmp.close(); return o;
}

/* ---------- 指令 ---------- */
const H = {
  /* 載入照片（半尺寸 RAW 解碼結果或已編碼照片）→ 預覽影像 */
  async load(a) {
    S.key = a.key; S.meta = a.meta || {}; S.flip = a.flip || 0; S.kind = a.kind; S.lensP = null; S.cache = {}; S.low = null; S.fast = null;
    if (a.kind === 'raw') {
      S.src = { u16: a.u16, w: a.w, h: a.h, scale: 1, lut: E.BT709_LIN };
      const f = Math.max(1, Math.round(Math.max(a.w, a.h) / 1600));
      S.base = E.fromInterleaved16(a.u16, a.w, a.h, 1, f, E.BT709_LIN);
    } else {
      const im = await rgbFromBytes(a.bytes); S.src = null; S.flip = 0;
      S.base = E.resizeImg(im, 1600);
    }
    return this.relens(a.lens);
  },
  /* 鏡頭校正設定改變時重建預覽 */
  relens(L) {
    S.lensP = JSON.stringify(L || {}); const spec = S.kind === 'raw' ? lensFor(S.meta, S.key, L) : null; S.spec = spec;
    const b = S.base; let x = spec ? E.lensRemap(b, spec, b.w, b.h) : b;
    x = E.rotate(x, S.flip); S.low = x; S.fast = E.resizeImg(x, 900); S.cache = {};
    return { w: x.w, h: x.h, lens: spec ? (S.meta && S.meta.sony ? 'sony' : 'db') : '' };
  },
  render(a) {
    const P = Object.assign({}, E.DEFAULTS, a.P), im = a.fast ? S.fast : S.low, tag = a.fast ? 'f' : 'l', pf = prof(S.key);
    if (a.lens && JSON.stringify(a.lens) !== S.lensP) this.relens(a.lens);
    const gk = tag + keyOf(P, ['exposure', 'temp', 'tint', 'dehaze']);
    if (!S.cache.G || S.cache.gk !== gk) { S.cache.G = E.analyse(im, P); S.cache.gk = gk; S.cache.tk = null; }
    const tk = tag + keyOf(P, E.TONE_KEYS);
    if (S.cache.tk !== tk) { S.cache.T = E.toneStage(im, pf, P, S.cache.G); S.cache.tk = tk; }
    const o = E.colorStage(S.cache.T, P);
    const px = rgbaFrom(o);
    return { w: o.w, h: o.h, px, hist: a.hist ? hist(o) : null, _t: [px.buffer] };
  },
  /* 原圖（只套相機描述檔，給「按住看原始」用） */
  original(a) {
    const P = Object.assign({}, E.DEFAULTS, { sharpen: 0, cnr: 0 }), im = S.fast;
    const o = E.render(im, prof(S.key), P), px = rgbaFrom(o); return { w: o.w, h: o.h, px, _t: [px.buffer] };
  },
  auto(a) {
    const t = a.tmpl ? TEMPLATES[a.tmpl] : null;
    const P = E.aiAuto(S.low, prof(S.key), t, { proxy: 560, iters: 12, onStep: (i, n) => postMessage({ prog: i / n }) });
    return { P };
  },
  async thumb(a) {
    const im = E.resizeImg(S.low, a.size || 480), o = E.render(im, prof(S.key), Object.assign({}, a.P, { sharpen: 0.2 }));
    const cv = new OffscreenCanvas(o.w, o.h); cv.getContext('2d').putImageData(new ImageData(rgbaFrom(o), o.w, o.h), 0, 0);
    const b = new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.82 })).arrayBuffer());
    return { jpg: b, w: o.w, h: o.h, _t: [b.buffer] };
  },
  /* 全解析度輸出：分條渲染 → JPEG／PNG／16-bit TIFF（含 EXIF、GPS） */
  async export(a) {
    const P = Object.assign({}, E.DEFAULTS, a.P), opt = a.opt, key = a.key, pf = prof(key);
    let src, W, Hh, flip = a.flip || 0, spec = null;
    if (a.kind === 'raw') { src = { u16: a.u16, w: a.w, h: a.h, scale: 1, lut: E.BT709_LIN }; W = a.w; Hh = a.h; spec = lensFor(a.meta, key, a.lens); }
    else { const im = await rgbFromBytes(a.bytes); src = im; W = im.w; Hh = im.h; flip = 0; }
    // 全域分析（低解析度）
    const f = Math.max(1, Math.round(Math.max(W, Hh) / 1600));
    let low = src.u16 ? E.fromInterleaved16(src.u16, W, Hh, 1, f, src.lut) : E.resizeImg(src, Math.round(W / f));
    if (spec) low = E.lensRemap(low, spec, low.w, low.h);
    const G = E.analyse(low, P);
    const rot = flip === 5 || flip === 6, OW = rot ? Hh : W, OH = rot ? W : Hh;
    const want = opt.fmt === 'tiff' ? 'u16' : 'rgba';
    const out = want === 'u16' ? new Uint16Array(OW * OH * 3) : null;
    const cv = want === 'rgba' ? new OffscreenCanvas(OW, OH) : null, cx = cv ? cv.getContext('2d') : null;
    const r = Math.max(4, Math.min(W, Hh) * 0.04 | 0), m = Math.max(48, Math.ceil((r / 8) * 3 + 24)), step = 320;
    const strips = []; for (let y = 0; y < Hh; y += step) strips.push([y, Math.min(Hh, y + step)]);
    const mid = strips.splice(strips.length >> 1, 1)[0]; strips.unshift(mid); // 先做中間那條，決定雜訊基準
    let done = 0;
    for (const [y0, y1] of strips) {
      if (S.cancel) { S.cancel = false; throw new Error('已取消'); }
      const ya = Math.max(0, y0 - m), yb = Math.min(Hh, y1 + m);
      const blk = src.u16 || spec ? E.lensRemap(src, spec, W, Hh, [ya, yb]) : sliceRows(src, ya, yb);
      const t = E.toneStage(blk, pf, P, G, [ya, yb, Hh, W]), c = E.colorStage(t, P, [ya, yb, Hh, W]);
      const off = y0 - ya, rows = y1 - y0;
      if (out) writeU16(out, c, off, rows, y0, W, Hh, OW, flip);
      else { const im = stripRGBA(c, off, rows, W, flip), px = flip === 6 ? Hh - y1 : flip === 5 ? y0 : 0, py = flip === 3 ? Hh - y1 : (flip === 5 || flip === 6) ? 0 : y0; cx.putImageData(im, px, py); }
      done += rows; postMessage({ prog: done / Hh * 0.9 });
    }
    const exifOpt = { software: opt.software, gps: opt.gps, keepMaker: opt.maker, w: OW, h: OH };
    const meta = opt.exif === false ? null : a.meta;
    let bytes, mime, ext;
    if (out) {
      bytes = await X.tiff16(out, OW, OH, meta || {}, Object.assign({ deflate: true }, exifOpt)); mime = 'image/tiff'; ext = 'tif';
    } else {
      let c2 = cv, w2 = OW, h2 = OH;
      if (opt.long && Math.max(OW, OH) > opt.long) { const k = opt.long / Math.max(OW, OH); w2 = Math.round(OW * k); h2 = Math.round(OH * k); c2 = downscale(cv, OW, OH, w2, h2); }
      exifOpt.w = w2; exifOpt.h = h2;
      if (opt.fmt === 'png') { const b = new Uint8Array(await (await c2.convertToBlob({ type: 'image/png' })).arrayBuffer()); bytes = pngWithExif(b, meta, exifOpt); mime = 'image/png'; ext = 'png'; }
      else { const b = new Uint8Array(await (await c2.convertToBlob({ type: 'image/jpeg', quality: (opt.q || 95) / 100 })).arrayBuffer()); bytes = meta || exifOpt.gps ? X.jpegWithExif(b, meta || {}, exifOpt) : b; mime = 'image/jpeg'; ext = 'jpg'; }
      exifOpt.outW = w2; exifOpt.outH = h2;
    }
    postMessage({ prog: 1 });
    return { bytes, mime, ext, w: exifOpt.outW || OW, h: exifOpt.outH || OH, _t: [bytes.buffer] };
  },
  cancel() { S.cancel = true; return {}; }
};
function sliceRows(im, ya, yb) { const w = im.w, o = E.img(w, yb - ya); o.R.set(im.R.subarray(ya * w, yb * w)); o.G.set(im.G.subarray(ya * w, yb * w)); o.B.set(im.B.subarray(ya * w, yb * w)); return o; }
function stripRGBA(c, off, rows, W, flip) {
  const rot = flip === 5 || flip === 6, iw = rot ? rows : W, ih = rot ? W : rows, d = new Uint8ClampedArray(iw * ih * 4);
  for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) {
    const i = (y + off) * W + x; let ox, oy;
    if (flip === 3) { ox = W - 1 - x; oy = rows - 1 - y; } else if (flip === 6) { ox = rows - 1 - y; oy = x; } else if (flip === 5) { ox = y; oy = W - 1 - x; } else { ox = x; oy = y; }
    const j = (oy * iw + ox) * 4; d[j] = c.R[i] * 255 + .5; d[j + 1] = c.G[i] * 255 + .5; d[j + 2] = c.B[i] * 255 + .5; d[j + 3] = 255;
  }
  return new ImageData(d, iw, ih);
}
function writeU16(out, c, off, rows, y0, W, Hh, OW, flip) {
  for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) {
    const i = (y + off) * W + x, Y = y0 + y; let ox, oy;
    if (flip === 3) { ox = W - 1 - x; oy = Hh - 1 - Y; } else if (flip === 6) { ox = Hh - 1 - Y; oy = x; } else if (flip === 5) { ox = Y; oy = W - 1 - x; } else { ox = x; oy = Y; }
    const j = (oy * OW + ox) * 3; out[j] = c.R[i] * 65535 + .5; out[j + 1] = c.G[i] * 65535 + .5; out[j + 2] = c.B[i] * 65535 + .5;
  }
}
function downscale(cv, w, h, w2, h2) { // 逐級減半再縮，品質接近面積平均
  let c = cv, cw = w, ch = h;
  while (cw / 2 >= w2 && ch / 2 >= h2) { const n = new OffscreenCanvas(cw >> 1, ch >> 1), x = n.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, cw >> 1, ch >> 1); c = n; cw >>= 1; ch >>= 1; }
  const n = new OffscreenCanvas(w2, h2), x = n.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w2, h2); return n;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function pngWithExif(png, meta, opt) { // PNG 的 eXIf 區塊（放在 IHDR 之後）
  if (!meta && !opt.gps) return png;
  const app = X.app1(meta || {}, opt), tiff = app.subarray(10);
  const chunk = new Uint8Array(12 + tiff.length), dv = new DataView(chunk.buffer);
  dv.setUint32(0, tiff.length); chunk.set([101, 88, 73, 102], 4); chunk.set(tiff, 8); dv.setUint32(8 + tiff.length, crc32(chunk.subarray(4, 8 + tiff.length)));
  const ih = 8 + 25, out = new Uint8Array(png.length + chunk.length); out.set(png.subarray(0, ih)); out.set(chunk, ih); out.set(png.subarray(ih), ih + chunk.length); return out;
}

self.onmessage = async e => {
  const { id, cmd, a } = e.data;
  try { const r = await H[cmd](a || {}); const t = r && r._t; if (r) delete r._t; postMessage({ id, ok: true, r }, t || []); }
  catch (err) { postMessage({ id, ok: false, err: String(err && err.message || err) }); }
};
