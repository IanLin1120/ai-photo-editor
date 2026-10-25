/* 雲端渲染：用手機同一份修圖引擎（src/web/engine.js）把降噪後的線性影像全解析度輸出
   node render.js job.json lin.f32 orig.bin out.bin */
const fs = require('fs'), path = require('path');
const W = path.join(__dirname, '..', 'src', 'web');
const E = require(path.join(W, 'engine.js')), X = require(path.join(W, 'exif.js')), D = require(path.join(W, 'profiles.js'));
const jpeg = require('jpeg-js'), { PNG } = require('pngjs');
const [job, linF, origF, outF] = process.argv.slice(2);
const J = JSON.parse(fs.readFileSync(job, 'utf8')), spec = J.spec, P = Object.assign({}, E.DEFAULTS, spec.P), opt = spec.opt;
const zlib = require('zlib');
function pngExif(png, meta, eo) { // PNG eXIf 區塊（IHDR 後面）
  const tiff = Buffer.from(X.app1(meta || {}, eo).subarray(10)), len = Buffer.alloc(4); len.writeUInt32BE(tiff.length);
  const body = Buffer.concat([Buffer.from('eXIf'), tiff]), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
  return Buffer.concat([png.subarray(0, 33), len, body, crc, png.subarray(33)]);
}
function crc32(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; } return (~c) >>> 0; }
const status = m => { try { fs.writeFileSync(path.join(path.dirname(outF), 'render.status'), m); } catch (e) { } };
(async () => {
  const orig = fs.readFileSync(origF), meta = X.parse(orig) || {};
  const buf = fs.readFileSync(linF), f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), Wd = J.w, Hd = J.h;
  const src = E.img(Wd, Hd); for (let i = 0, n = Wd * Hd; i < n; i++) { src.R[i] = f[i * 3]; src.G[i] = f[i * 3 + 1]; src.B[i] = f[i * 3 + 2]; }
  if (!D.PROFILES.JPEG) { const xs = [], ys = []; for (let i = 0; i < 59; i++) { const x = -13 + i * 0.25; xs.push(x); ys.push(Math.pow(2, x)); } D.PROFILES.JPEG = { xs, ys, hsm: Array.from({ length: 36 }, () => Array.from({ length: 8 }, () => [0, 1, 1])) }; }
  const pf = E.makeProfile(D.PROFILES[spec.key] || D.PROFILES['*']);
  let lens = null; const L = spec.lens || {};
  if (spec.raw && L.on !== false) { const base = meta.sony ? E.sonyLens(meta.sony) : D.LENSDB[spec.key] ? E.dbLens(D.LENSDB[spec.key]) : null; if (base) lens = E.lensSpec(base, { dist: L.dist == null ? 1 : L.dist, ca: L.ca === false ? 0 : 1, vig: L.vig == null ? 1 : L.vig }); }
  const flip = spec.raw ? (J.flip || 0) : 0;
  const fct = Math.max(1, Math.round(Math.max(Wd, Hd) / 1600)); let low = E.resizeImg(src, Math.round(Wd / fct)); if (lens) low = E.lensRemap(low, lens, low.w, low.h);
  const G = E.analyse(low, P);
  const rot = flip === 5 || flip === 6, OW = rot ? Hd : Wd, OH = rot ? Wd : Hd;
  const u16 = opt.fmt === 'tiff', out = u16 ? new Uint16Array(OW * OH * 3) : Buffer.alloc(OW * OH * 4);
  const r = Math.max(4, Math.min(Wd, Hd) * 0.04 | 0), m = Math.max(48, Math.ceil((r / 8) * 3 + 24)), step = 320, strips = [];
  for (let y = 0; y < Hd; y += step) strips.push([y, Math.min(Hd, y + step)]); strips.unshift(strips.splice(strips.length >> 1, 1)[0]);
  let done = 0;
  for (const [y0, y1] of strips) {
    const ya = Math.max(0, y0 - m), yb = Math.min(Hd, y1 + m);
    const blk = E.lensRemap(src, lens, Wd, Hd, [ya, yb]);
    const c = E.colorStage(E.toneStage(blk, pf, P, G, [ya, yb, Hd, Wd]), P, [ya, yb, Hd, Wd]);
    for (let y = y0; y < y1; y++) for (let x = 0; x < Wd; x++) {
      const i = (y - ya) * Wd + x; let ox, oy;
      if (flip === 3) { ox = Wd - 1 - x; oy = Hd - 1 - y; } else if (flip === 6) { ox = Hd - 1 - y; oy = x; } else if (flip === 5) { ox = y; oy = Wd - 1 - x; } else { ox = x; oy = y; }
      if (u16) { const j = (oy * OW + ox) * 3; out[j] = c.R[i] * 65535 + .5; out[j + 1] = c.G[i] * 65535 + .5; out[j + 2] = c.B[i] * 65535 + .5; }
      else { const j = (oy * OW + ox) * 4; out[j] = c.R[i] * 255 + .5; out[j + 1] = c.G[i] * 255 + .5; out[j + 2] = c.B[i] * 255 + .5; out[j + 3] = 255; }
    }
    done += y1 - y0; status(JSON.stringify({ msg: `渲染 ${Math.round(done / Hd * 100)}%`, pct: 0.75 + 0.2 * done / Hd }));
  }
  let w2 = OW, h2 = OH, rgba = out;
  if (!u16 && opt.long && Math.max(OW, OH) > opt.long) { // 面積平均縮圖
    const k = opt.long / Math.max(OW, OH); w2 = Math.round(OW * k); h2 = Math.round(OH * k); rgba = Buffer.alloc(w2 * h2 * 4);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      const xa = Math.floor(x / k), xb = Math.max(xa + 1, Math.floor((x + 1) / k)), ya = Math.floor(y / k), yb = Math.max(ya + 1, Math.floor((y + 1) / k)); let s0 = 0, s1 = 0, s2 = 0, n = 0;
      for (let yy = ya; yy < Math.min(yb, OH); yy++) for (let xx = xa; xx < Math.min(xb, OW); xx++) { const j = (yy * OW + xx) * 4; s0 += out[j]; s1 += out[j + 1]; s2 += out[j + 2]; n++; }
      const j = (y * w2 + x) * 4; rgba[j] = s0 / n; rgba[j + 1] = s1 / n; rgba[j + 2] = s2 / n; rgba[j + 3] = 255;
    }
  }
  const eo = { software: opt.software, gps: opt.gps, keepMaker: false, w: w2, h: h2 }, mt = opt.exif === false ? {} : meta;
  let bytes;
  if (u16) bytes = await X.tiff16(out, OW, OH, mt, Object.assign({ deflate: true }, eo));
  else if (opt.fmt === 'png') { const png = new PNG({ width: w2, height: h2 }); rgba.copy(png.data); bytes = pngExif(PNG.sync.write(png), mt, eo); }
  else bytes = X.jpegWithExif(jpeg.encode({ data: rgba, width: w2, height: h2 }, opt.q || 95).data, mt, eo);
  fs.writeFileSync(outF, Buffer.from(bytes)); status(JSON.stringify({ msg: '完成', pct: 0.97 }));
  console.log('rendered', w2, h2, bytes.length);
})().catch(e => { console.error(e); process.exit(1); });
