/* ================= RAW 解碼（LibRaw WebAssembly） =================
   支援 Sony ARW、Canon CR2/CR3、Nikon NEF、Fujifilm RAF、Olympus ORF、Panasonic RW2、Pentax PEF、DNG 等。
   以全解析度去馬賽克，套用相機白平衡與色彩矩陣，並依 RAW 內的方向自動轉正。 */
const RAW_EXT = ['arw', 'srf', 'sr2', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'raf', 'orf', 'rw2', 'pef', 'dng', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'mrw', 'kdc', 'dcr', 'mos', 'rwl'];
function isRawName(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return !!m && RAW_EXT.includes(m[1].toLowerCase()); }
const RawDec = {
  worker: null, pending: new Map(), id: 0, wurl: '', wasm: '', chain: Promise.resolve(),
  start() {
    if (this.worker) return;
    if (!this.wurl) { this.wurl = URL.createObjectURL(new Blob([LIBRAW_WORKER], { type: 'text/javascript' })); this.wasm = URL.createObjectURL(new Blob([b64ToBytes(WASM_LIBRAW)], { type: 'application/wasm' })); }
    this.worker = new Worker(this.wurl);
    this.worker.postMessage({ wasmUrl: this.wasm });
    this.worker.onmessage = ({ data }) => { const p = this.pending.get(data && data.id); if (!p) return; this.pending.delete(data.id); data.error ? p.rej(new Error(data.error)) : p.res(data.out); };
    this.worker.onerror = (e) => { for (const p of this.pending.values()) p.rej(new Error('RAW 解碼器錯誤：' + (e.message || ''))); this.pending.clear(); this.worker = null; };
  },
  call(fn, ...args) {
    this.start();
    return new Promise((res, rej) => { const id = ++this.id; this.pending.set(id, { res, rej }); const tr = args.filter((a) => a && a.buffer instanceof ArrayBuffer).map((a) => a.buffer); this.worker.postMessage({ id, fn, args }, tr); });
  },
  /* half=true：不做去馬賽克、尺寸減半（快 3–5 倍），用於匯入時的預覽 */
  decode(bytes, half) {
    const job = async () => {
      // 看門狗：解碼器若因記憶體不足等原因沒有回應，最多等 120 秒就重置，不會讓畫面一直卡住
      let wd; const dog = new Promise((_, rej) => { wd = setTimeout(() => { this.dispose(); for (const p of this.pending.values()) p.rej(new Error('RAW 解碼逾時')); this.pending.clear(); rej(new Error('RAW 解碼逾時（可能記憶體不足）')); }, 120000); });
      try { return await Promise.race([dog, run()]); } finally { clearTimeout(wd); }
    };
    const run = async () => {
      try {
        await this.call('open', bytes, { useCameraWb: true, outputColor: 1, outputBps: 16, noAutoBright: true, userQual: CFG.rawQ === 'fast' ? 2 : 3, highlight: 2, userFlip: -1, halfSize: !!half });
        const meta = await this.call('metadata', true);
        const img = await this.call('imageData');
        if (!img || !img.data) throw new Error('無法解碼此 RAW 檔');
        return { meta, img };
      } finally {
        // 連續解碼時沿用同一個解碼器（省去重新載入 WebAssembly），每 4 張或閒置 4 秒後回收記憶體
        this.uses = (this.uses || 0) + 1; clearTimeout(this.idleT);
        if (this.uses >= 4) this.dispose(); else this.idleT = setTimeout(() => this.dispose(), 4000);
      }
    };
    const p = this.chain.then(job, job); this.chain = p.catch(() => {}); return p;
  },
  dispose() { clearTimeout(this.idleT); this.uses = 0; if (this.worker) { this.worker.terminate(); this.worker = null; } }
};
/* ---------- RAW → 畫面（v1.12 起，與 Lightroom 相同的處理方式） ----------
   舊版用 LibRaw「自動亮度」直接輸出 8-bit：會強制裁掉最亮 1% 的高光（各色版裁切程度不同 → 壓暗高光時偏色），
   而且亮度每張不固定。現在改為：16-bit、不自動亮度 → 轉線性 → 依相機內嵌 JPEG 對齊中間調曝光（每張固定一個倍率，
   預覽與全解析度一致）→ 以亮度為準的柔和高光肩部（保留高光層次、不改變色相）→ 超出色域時保持亮度降低彩度。 */
const RAW_LIN = (() => { const t = new Float32Array(65536); for (let i = 0; i < 65536; i++) { const v = i / 65535; t[i] = v < 0.081 ? v / 4.5 : Math.pow((v + 0.099) / 1.099, 1 / 0.45); } return t; })();
const RAW_DEF_K = 9;   // 沒有內嵌預覽可對齊時的預設曝光倍率（Sony／Ricoh 實測中位數）
const oetfN = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055), eotfN = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
/* 基礎色調曲線（sRGB 編碼值，輸入可大於 1 = 高光餘裕）：由 Sony A6700／GR III 的 RAW 與機內 JPEG 實測擬合，
   暗部略壓（通透不灰）、中間調不變、0.55 以上柔和肩部一路收到 1（高光不硬切、壓暗高光時有層次且不偏色） */
const RAW_CURVE = (() => {
  const P = [[0, 0], [0.05, 0.032], [0.10, 0.078], [0.18, 0.158], [0.30, 0.292], [0.42, 0.425], [0.52, 0.522], [0.64, 0.623], [0.76, 0.715], [0.90, 0.80], [1.05, 0.86], [1.25, 0.915], [1.5, 0.958], [1.9, 0.988], [2.5, 1.0], [3.6, 1.0]];
  const n = P.length, xs = P.map((p) => p[0]), ys = P.map((p) => p[1]), d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2]; for (let i = 1; i < n - 1; i++) { const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0; m[i] = d[i - 1] * d[i] <= 0 ? 0 : (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  const N = 4096, XM = 3.6, T = new Float32Array(N + 1);
  for (let j = 0; j <= N; j++) { const x = j / N * XM; let i = 0; while (i < n - 2 && x > xs[i + 1]) i++; const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t;
    T[j] = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1]; }
  for (let j = 1; j <= N; j++) T[j] = Math.max(T[j], T[j - 1]);
  return { T, N, XM };
})();
function rawShoulder(x) { const C = RAW_CURVE; if (x >= C.XM) return 1; const f = x / C.XM * C.N, i = f | 0; return C.T[i] + (C.T[Math.min(i + 1, C.N)] - C.T[i]) * (f - i); }
function rawShoulderInv(y) { const C = RAW_CURVE; if (y >= C.T[C.N] - 1e-4) return 2.5; let lo = 0, hi = C.N; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (C.T[mid] < y) lo = mid; else hi = mid; } const a = C.T[lo], b = C.T[hi]; return (lo + (b > a ? (y - a) / (b - a) : 0)) / C.N * C.XM; }
/* 依內嵌 JPEG（相機的機內處理）求曝光倍率：比對 30/50/70 百分位亮度 */
function rawLumPct(img, ps) {
  const src = img.data, ch = img.colors || 3, W = img.width, H = img.height, a = [], st = Math.max(1, Math.round(Math.sqrt(W * H * 0.36 / 120000)));
  for (let y = Math.round(H * 0.2); y < H * 0.8; y += st) for (let x = Math.round(W * 0.2); x < W * 0.8; x += st) { const j = (y * W + x) * ch; a.push(0.2126 * RAW_LIN[src[j]] + 0.7152 * RAW_LIN[src[j + 1]] + 0.0722 * RAW_LIN[src[j + 2]]); }
  a.sort((x, y) => x - y); return ps.map((p) => a[Math.min(a.length - 1, Math.floor(p * a.length))]);
}
function canvasLumPct(cv, ps) {
  const s = Math.min(1, 640 / Math.max(cv.width, cv.height)), c = mkCanvas(cv.width * s, cv.height * s), x = c.getContext('2d'); x.drawImage(cv, 0, 0, c.width, c.height);
  const d = x.getImageData(Math.round(c.width * 0.2), Math.round(c.height * 0.2), Math.round(c.width * 0.6), Math.round(c.height * 0.6)).data, a = [];
  for (let i = 0; i < d.length; i += 4) a.push(0.2126 * eotfN(d[i] / 255) + 0.7152 * eotfN(d[i + 1] / 255) + 0.0722 * eotfN(d[i + 2] / 255));
  a.sort((x, y) => x - y); return ps.map((p) => a[Math.min(a.length - 1, Math.floor(p * a.length))]);
}
function rawExposureK(img, refCanvas) {
  if (!refCanvas) return RAW_DEF_K;
  try {
    const ps = [0.3, 0.5, 0.7], ours = rawLumPct(img, ps), ref = canvasLumPct(refCanvas, ps), w = [1, 2, 1]; let lk = 0, ws = 0;
    for (let i = 0; i < 3; i++) { if (ours[i] < 1e-5 || ref[i] < 1e-4) continue; const tgt = Math.pow(Math.max(0, (Math.min(rawShoulderInv(oetfN(ref[i])), 2.4) + 0.055) / 1.055), 2.4); lk += w[i] * Math.log(tgt / ours[i]); ws += w[i]; }
    return ws ? clamp(Math.exp(lk / ws), 0.4, 16) : RAW_DEF_K;
  } catch (e) { console.warn('rawExposureK', e); return RAW_DEF_K; }
}
function rawCanvas(img, k) {
  k = k || RAW_DEF_K;
  const W = img.width, H = img.height, n = W * H, ch = img.colors || 3, src = img.data, is16 = src.BYTES_PER_ELEMENT === 2;
  const LIN = is16 ? RAW_LIN : (() => { const t = new Float32Array(256); for (let i = 0; i < 256; i++) t[i] = eotfN(i / 255); return t; })();
  // 線性值 → 色調曲線後的線性值（平方根索引，暗部精度足夠）
  const VMAX = k * 1.02, NT = 16384, TT = new Float32Array(NT + 2);
  for (let i = 0; i <= NT + 1; i++) { const q = i / NT, v = q * q * VMAX; TT[i] = eotfN(Math.min(1, rawShoulder(oetfN(v)))); }
  const tc = (v) => { if (v <= 0) return 0; let f = Math.sqrt(v / VMAX) * NT; if (f >= NT) return TT[NT]; const fi = f | 0; return TT[fi] + (TT[fi + 1] - TT[fi]) * (f - fi); };
  const NO = 16384, OE = new Uint8ClampedArray(NO + 1); for (let i = 0; i <= NO; i++) OE[i] = Math.round(oetfN(i / NO) * 255);
  const rgba = new Uint8ClampedArray(n * 4), o8 = (v) => OE[v <= 0 ? 0 : v >= 1 ? NO : (v * NO + 0.5) | 0];
  for (let i = 0, j = 0, q = 0; i < n; i++, j += ch, q += 4) {
    const r = LIN[src[j]] * k, g = LIN[src[j + 1]] * k, b = LIN[src[j + 2]] * k;
    let R, G, B;
    if (r >= g) {
      if (g >= b) { R = tc(r); B = tc(b); G = r > b ? B + (R - B) * (g - b) / (r - b) : R; }         // r ≥ g ≥ b
      else if (r >= b) { R = tc(r); G = tc(g); B = r > g ? G + (R - G) * (b - g) / (r - g) : R; }    // r ≥ b > g
      else { B = tc(b); G = tc(g); R = b > g ? G + (B - G) * (r - g) / (b - g) : B; }                 // b > r ≥ g
    } else {
      if (r >= b) { G = tc(g); B = tc(b); R = g > b ? B + (G - B) * (r - b) / (g - b) : G; }         // g > r ≥ b
      else if (g >= b) { G = tc(g); R = tc(r); B = g > r ? R + (G - R) * (b - r) / (g - r) : G; }    // g ≥ b > r
      else { B = tc(b); R = tc(r); G = b > r ? R + (B - R) * (g - r) / (b - r) : B; }                 // b > g > r
    }
    rgba[q] = o8(R); rgba[q + 1] = o8(G); rgba[q + 2] = o8(B); rgba[q + 3] = 255;
  }
  const cv = mkCanvas(W, H); cv.getContext('2d').putImageData(new ImageData(rgba, W, H), 0, 0); return cv;
}
/* 由 RAW 中繼資料重建 EXIF（相機、鏡頭、光圈、快門、ISO、時間、GPS） */
function rawExif(meta, name, W, H) {
  const L = meta.lens || {};
  const ex = { make: meta.camera_make, model: meta.camera_model, iso: meta.iso_speed, exposure: meta.shutter, fnumber: meta.aperture, focal: meta.focal_len,
    date: meta.timestamp instanceof Date && !isNaN(meta.timestamp) ? meta.timestamp : (meta.timestamp > 0 ? new Date(meta.timestamp * 1000) : null), lens: (L.Lens || (L.makernotes && L.makernotes.Lens) || '').trim(), lensMake: (L.LensMake || '').trim(),
    focal35: L.FocalLengthIn35mmFormat || 0, software: 'AI修圖軟體（RAW：' + (name || '') + '）', w: W, h: H, artist: meta.artist };
  let exif = Meta.buildExif(ex);
  const g = meta.gps_data;
  if (g && g.gpsparsed && g.latitude && (g.latitude[0] || g.latitude[1])) {
    const dd = (a, r, neg) => (a[0] + a[1] / 60 + a[2] / 3600) * (r === neg ? -1 : 1);
    exif = Meta.withGps(exif, { lat: dd(g.latitude, g.latref, 'S'), lon: dd(g.longitude, g.longref, 'W'), alt: g.altitude ? (g.altref ? -g.altitude : g.altitude) : null });
  }
  return { exif, lens: ex.lens };
}
/* 匯入用：快速半尺寸解碼 → 預覽畫布 + 全尺寸大小 + EXIF（全解析度等需要時才解碼） */
async function rawPreview(blob, name, onStage) {
  onStage && onStage('讀取 RAW…');
  const head = new Uint8Array(await blob.slice(0, 16 << 20).arrayBuffer());
  let ref = null; try { const e = await rawEmbeddedPreview(blob, head); if (e) ref = e.canvas; } catch (e) {}
  const { meta, img } = await RawDec.decode(new Uint8Array(await blob.arrayBuffer()), true);
  const k = rawExposureK(img, ref); if (ref) ref.width = ref.height = 1;
  const cv = rawCanvas(img, k); const W = meta.width || img.width * 2, H = meta.height || img.height * 2;
  const built = rawExif(meta, name, W, H);
  // 優先沿用相機寫在 RAW 裡的原始 EXIF（拍攝時間、曝光補償…完整保留）
  const L = meta.lens || {};
  let exif = Meta.fromRawTiff(head, { w: W, h: H, lens: built.lens || '', lensMake: (L.LensMake || '').trim() });
  if (exif) { const g = meta.gps_data; const sm = Meta.summary(exif) || {}; if (!sm.lat && g && g.gpsparsed && built.exif.length > 0) { const gs = Meta.summary(built.exif) || {}; if (gs.lat) exif = Meta.withGps(exif, { lat: gs.lat, lon: gs.lon, alt: gs.alt }); } }
  else exif = built.exif;
  return { canvas: cv, W, H, exif, lens: built.lens, k };
}
/* ================= RAW 內嵌預覽（與 Lightroom 相同的快速匯入方式） =================
   相機在 RAW 檔裡都會存一張機內 JPEG 預覽；匯入時直接取出來當縮圖／暫時預覽（幾十毫秒），
   真正的 RAW 解碼在背景慢慢做，或打開編輯時才做。支援 TIFF 系（ARW/NEF/CR2/DNG/ORF/RW2/PEF/SRW…）與 RAF。 */
function rawEmbeddedInfo(u, total) {
  const n = u.length; if (n < 16) return null; total = total || n;
  const out = { cands: [], ori: 1, rawW: 0, rawH: 0 };
  const add = (off, len) => { if (off > 0 && len > 1000 && (off + 2 < n ? u[off] === 0xff && u[off + 1] === 0xd8 : off + len <= total)) out.cands.push({ off, len }); };   // 預覽可能在讀入的檔頭之後（例如 DNG），先收下、之後再檢查
  // Fujifilm RAF：檔頭 84 位元組處記錄 JPEG 位置
  if (String.fromCharCode(...u.subarray(0, 8)) === 'FUJIFILM') {
    const be = (o) => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0; add(be(84), be(88));
    return out.cands.length ? out : null;
  }
  const le = u[0] === 0x49 && u[1] === 0x49, bigE = u[0] === 0x4d && u[1] === 0x4d; if (!le && !bigE) return null;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const seen = new Set(), todo = [u32(4)]; let guard = 0;
  while (todo.length && guard++ < 64) {
    const ifd = todo.shift(); if (!ifd || ifd + 2 > n || seen.has(ifd)) continue; seen.add(ifd);
    const cnt = u16(ifd); if (cnt > 512 || ifd + 2 + cnt * 12 > n) continue;
    const tags = {};
    for (let i = 0; i < cnt; i++) {
      const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), c = u32(e + 4); const sz = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4][type] || 1;
      const vo = c * sz <= 4 ? e + 8 : u32(e + 8);
      const rd = (k) => (vo + k * sz + sz > n ? 0 : sz === 2 ? u16(vo + k * sz) : sz === 4 ? u32(vo + k * sz) : u[vo + k]);
      if (tag === 0x002e && type === 7) { add(vo, c); continue; }                 // Panasonic RW2 JpgFromRaw
      if (tag === 0x014a || tag === 0x8769) { for (let k = 0; k < Math.min(c, 8); k++) todo.push(rd(k)); continue; }   // SubIFD／EXIF
      tags[tag] = c === 1 ? rd(0) : (c <= 4 ? Array.from({ length: c }, (_, k) => rd(k)) : rd(0));
    }
    if (tags[0x0201] && tags[0x0202]) add(tags[0x0201], tags[0x0202]);
    if ((tags[0x0103] === 6 || tags[0x0103] === 7) && typeof tags[0x0111] === 'number' && typeof tags[0x0117] === 'number') add(tags[0x0111], tags[0x0117]);
    if (seen.size === 1 && tags[0x0112]) out.ori = tags[0x0112];
    const w = tags[0x0100], h = tags[0x0101]; if (typeof w === 'number' && typeof h === 'number' && w * h > out.rawW * out.rawH) { out.rawW = w; out.rawH = h; }
    const next = u32(ifd + 2 + cnt * 12); if (next && next < n) todo.push(next);
  }
  // 只保留一般 JPEG（SOF0/1/2）。RAW 本體常是「無損 JPEG」（SOF3，ARW／DNG 都有），瀏覽器無法解碼，誤選會卡住很久
  out.cands = out.cands.map((c) => Object.assign(c, c.off + 64 < n ? sofInfo(u, c.off, c.len) : { sof: -1, w: 0, h: 0 })).filter((c) => c.sof === -1 || (c.sof >= 0xc0 && c.sof <= 0xc2 && c.w > 0));
  if (!out.cands.length) return null; out.cands.sort((a, b) => b.w * b.h - a.w * a.h || b.len - a.len); return out;
}
function sofInfo(u, off, len) {
  const end = Math.min(u.length, off + len, off + (2 << 20)); let o = off + 2;
  while (o + 9 < end) {
    if (u[o] !== 0xff) { o++; continue; } const m = u[o + 1]; if (m === 0xff) { o++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    const L = (u[o + 2] << 8) | u[o + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { sof: m, h: (u[o + 5] << 8) | u[o + 6], w: (u[o + 7] << 8) | u[o + 8] };
    if (m === 0xda) break; o += 2 + L;
  }
  return { sof: 0, w: 0, h: 0 };
}
/* 取出最大的內嵌 JPEG 並依 RAW 方向轉正；太小（< 1200px）則回傳 null，改走完整解碼 */
async function rawEmbeddedPreview(blob, head) {
  const info = rawEmbeddedInfo(head || new Uint8Array(await blob.slice(0, 16 << 20).arrayBuffer()), blob.size); if (!info) return null;
  for (const c of info.cands) if (c.sof === -1) { const u2 = new Uint8Array(await blob.slice(c.off, c.off + Math.min(c.len, 1 << 20)).arrayBuffer()); if (u2[0] === 0xff && u2[1] === 0xd8) Object.assign(c, sofInfo(u2, 0, u2.length)); else c.sof = 0; }
  info.cands = info.cands.filter((c) => c.sof >= 0xc0 && c.sof <= 0xc2 && c.w > 0).sort((a, b) => b.w * b.h - a.w * a.h); if (!info.cands.length) return null;
  for (const c of info.cands.slice(0, 3)) {
    try {
      const jb = blob.slice(c.off, c.off + c.len, 'image/jpeg');
      const bm = await createImageBitmap(jb, { imageOrientation: 'none' });
      if (Math.max(bm.width, bm.height) < 1200) { bm.close(); continue; }
      const ori = info.ori | 0; let cv = bm;
      if (ori > 1 && ori <= 8) {
        const w = bm.width, hh = bm.height, swap = ori >= 5; cv = mkCanvas(swap ? hh : w, swap ? w : hh); const x = cv.getContext('2d');
        x.setTransform(...{ 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, hh], 4: [1, 0, 0, -1, 0, hh], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, hh, 0], 7: [0, -1, -1, 0, hh, w], 8: [0, -1, 1, 0, 0, w] }[ori]); x.drawImage(bm, 0, 0); bm.close();
      }
      // 暫定全尺寸：以 RAW 感光元件長邊 × 預覽比例估算（背景解碼後會更新為精確值）
      const L = Math.max(cv.width, cv.height), ar = cv.width / cv.height;
      const W = ar >= 1 ? L : Math.round(L * ar), H = ar >= 1 ? Math.round(L / ar) : L;
      return { canvas: cv, W, H, ori };
    } catch (e) { console.warn('embedded preview', e); }
  }
  return null;
}
/* 全解析度去馬賽克（AHD），直接回傳畫布，不經過 JPEG 壓縮 */
async function rawFull(blob, k) {
  const { img } = await RawDec.decode(new Uint8Array(await blob.arrayBuffer()), false);
  if (!k) { let ref = null; try { const e = await rawEmbeddedPreview(blob); if (e) ref = e.canvas; } catch (e) {} k = rawExposureK(img, ref); }
  await yieldNow(); return rawCanvas(img, k);
}

/* ================= 鏡頭描述檔（Lensfun 開放資料庫） =================
   依 EXIF 的相機與鏡頭型號自動找出變形、暈影、色差（TCA）校正參數。 */
const LensDB = {
  d: null,
  async load() {
    if (this.d) return this.d;
    const st = new Blob([b64ToBytes(LENSDB_B64)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    this.d = JSON.parse(await new Response(st).text());
    this.d.l.forEach((l, i) => (l.idx = i));
    return this.d;
  },
  tok(s) {
    s = String(s || '').toLowerCase().replace(/f\/\s*(?=\d)/g, 'f').replace(/(\d)\s*mm/g, '$1mm').replace(/[()\[\],]/g, ' ');
    return s.split(/\s+/).filter(Boolean);
  },
  focalTok(s) { const m = String(s || '').toLowerCase().match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*mm/); return m ? m[1] + (m[2] ? '-' + m[2] : '') : null; },
  apTok(s) { const m = String(s || '').toLowerCase().match(/f\s*\/?\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/); return m ? m[1] + (m[2] ? '-' + m[2] : '') : null; },
  camera(make, model) {
    if (!this.d) return null; const mk = String(make || '').toLowerCase(), md = String(model || '').toLowerCase().replace(/\s+/g, '');
    let best = null;
    for (const c of this.d.c) {
      if (!mk.includes(c[0].toLowerCase().split(' ')[0])) continue;
      const cm = c[1].toLowerCase().replace(/\s+/g, '');
      if (cm === md) return { maker: c[0], model: c[1], mount: c[2], crop: c[3] };
      if (!best && (md.endsWith(cm) || cm.endsWith(md))) best = { maker: c[0], model: c[1], mount: c[2], crop: c[3] };
    }
    return best;
  },
  /* 依鏡頭名稱模糊比對 */
  findLens(lensName, lensMake, cam) {
    if (!this.d || !lensName || /^-+$/.test(lensName)) return null;
    const ft = this.focalTok(lensName), at = this.apTok(lensName), toks = this.tok(lensName); let best = null, bs = 0;
    for (const l of this.d.l) {
      const lf = this.focalTok(l[1]); if (ft && lf && lf !== ft) continue;
      let sc = 0; const lt = this.tok(l[1]);
      for (const t of toks) if (lt.includes(t)) sc += /\d/.test(t) ? 3 : 1;
      if (ft && lf === ft) sc += 4; if (at && this.apTok(l[1]) === at) sc += 3;
      if (lensMake && l[0].toLowerCase().includes(String(lensMake).toLowerCase().split(' ')[0])) sc += 2;
      if (cam && cam.mount && l[2].includes(cam.mount)) sc += 3;
      if (sc > bs) { bs = sc; best = l; }
    }
    return bs >= 8 ? best : null;
  },
  name(l) { return l ? `${l[0]} ${l[1]}` : ''; },
  /* 在指定焦距／光圈計算校正係數 */
  params(l, focal, aperture) {
    if (!l) return null; focal = focal || (l[6][0] && l[6][0][0]) || 50; aperture = aperture || 8;
    const interp = (arr) => {
      if (!arr.length) return null; const s = arr.slice().sort((a, b) => a[0] - b[0]);
      if (focal <= s[0][0]) return s[0]; if (focal >= s[s.length - 1][0]) return s[s.length - 1];
      for (let i = 0; i < s.length - 1; i++) if (focal >= s[i][0] && focal <= s[i + 1][0]) {
        const a = s[i], b = s[i + 1]; if (a[1] !== b[1]) return Math.abs(focal - a[0]) < Math.abs(focal - b[0]) ? a : b;
        const t = (focal - a[0]) / (b[0] - a[0] || 1); return a.map((v, k) => (typeof v === 'number' && k > 1 ? v + (b[k] - v) * t : v));
      }
      return s[0];
    };
    const d = interp(l[6]), t = interp(l[7]);
    let v = null;
    if (l[8].length) {
      const far = Math.max(...l[8].map((x) => x[2])); const set = l[8].filter((x) => x[2] === far);
      const fs = [...new Set(set.map((x) => x[0]))].sort((a, b) => a - b);
      const nearF = (f) => { const at = set.filter((x) => x[0] === f).sort((a, b) => a[1] - b[1]); if (aperture <= at[0][1]) return at[0].slice(3); if (aperture >= at[at.length - 1][1]) return at[at.length - 1].slice(3);
        for (let i = 0; i < at.length - 1; i++) if (aperture >= at[i][1] && aperture <= at[i + 1][1]) { const u = (1 / aperture - 1 / at[i][1]) / (1 / at[i + 1][1] - 1 / at[i][1]); return [3, 4, 5].map((k) => at[i][k] + (at[i + 1][k] - at[i][k]) * u); } return at[0].slice(3); };
      let f0 = fs[0], f1 = fs[0]; for (let i = 0; i < fs.length; i++) { if (fs[i] <= focal) f0 = fs[i]; if (fs[i] >= focal) { f1 = fs[i]; break; } f1 = fs[i]; }
      const a = nearF(f0), b = nearF(f1); const u = f1 === f0 ? 0 : (focal - f0) / (f1 - f0); v = a.map((x, i) => x + (b[i] - x) * u);
    }
    return { crop: l[3], aspect: l[4] || 1.5, fisheye: l[5] === 'f', dist: d, tca: t, vig: v };
  }
};

/* 依相片 EXIF 找出（或依指定 key）鏡頭描述檔，計算該焦距／光圈的係數 */
async function lensProfileFor(rec, key) {
  await LensDB.load(); const ex = rec.exif || {};
  const cam = LensDB.camera(ex.make, ex.model);
  let l = null;
  if (key) l = LensDB.d.l.find((x) => x[0] + '|' + x[1] === key) || null;
  if (!l) l = LensDB.findLens(ex.lens, ex.lensMake, cam);
  if (!l) return { cam, lens: null };
  const p = LensDB.params(l, ex.focal, ex.fnumber);
  const camCrop = cam ? cam.crop : (ex.focal35 && ex.focal ? ex.focal35 / ex.focal : l[3]);
  return { cam, lens: l, key: l[0] + '|' + l[1], name: LensDB.name(l), p, camCrop };
}
/* 開啟或匯出前：重新計算已啟用描述檔的係數（以本張相片的焦距為準） */
async function refreshLens(rec, edit) {
  const pr = edit.optics && edit.optics.prof; if (!pr || !pr.on) return edit;
  try { const r = await lensProfileFor(rec, pr.key); if (r.lens) Object.assign(pr, { key: r.key, name: r.name, p: r.p, camCrop: r.camCrop }); else pr.p = null; } catch (e) { console.warn('lens', e); }
  return edit;
}
