/* ================= 修圖引擎（手機 WebView 與雲端 Node.js 共用同一份） =================
   輸入：LibRaw 解出的線性 ProPhoto RGB（已套相機白平衡）
   流程：鏡頭校正 → 曝光／白平衡 → 去朦朧 → 局部色調（亮部、陰影、對比、清晰度、紋理，導向濾波分層）
        → 相機描述檔（DNG 結構：色調曲線＋HueSatMap）→ 白色／黑色色階 → 點曲線
        → Lab：降彩噪、鮮豔度／飽和度、相機模板 HSL、HSL 手動、氛圍感（色彩分級）、去紫邊綠邊 → 銳利化
   設計：大半徑運算在低解析度做（快速導向濾波），全解析度輸出分條處理，手機記憶體也吃得下。 */
(function (G) {
'use strict';
const LUM = [0.2880402, 0.7118741, 0.0000857];
const PP2XYZ = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.8252100]];
const XYZ50_SRGB = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.0334540], [0.0719453, -0.2289914, 1.4052427]];
const mm = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const PP2S = mm(XYZ50_SRGB, PP2XYZ);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const DEFAULTS = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0, temp: 0, tint: 0,
  sharpen: 0.4, nr: 0, cnr: 0.5,
  hsl: null,                 // 8x3 [hueDeg, satScale, lumShift] 使用者 HSL（紅橙黃綠青藍紫洋紅）
  look: null, lookAmt: 1,    // 相機模板 HSL（自動帶入）
  grade: null, gradeAmt: 0,  // 氛圍感（色彩分級＋亮度曲線）
  curve: null,               // 點曲線 [[x,y],...] 0..255
  defringeP: 0, defringeG: 0 // 去紫邊／綠邊 0..1
};

/* ---------------- sRGB 轉換（查表） ---------------- */
const OE_N = 8192, OE = new Float32Array(OE_N + 1);
for (let i = 0; i <= OE_N; i++) { const s = i / OE_N, x = s * s; OE[i] = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }
function oetf(x) { if (x <= 0) return 0; if (x >= 1) return 1; const f = Math.sqrt(x) * OE_N, i = f | 0; return OE[i] + (OE[i + 1] - OE[i]) * (f - i); }
const EO_N = 4096, EO = new Float32Array(EO_N + 1);
for (let i = 0; i <= EO_N; i++) { const v = i / EO_N; EO[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function eotf(v) { if (v <= 0) return 0; if (v >= 1) return 1; const f = v * EO_N, i = f | 0; return EO[i] + (EO[i + 1] - EO[i]) * (f - i); }

/* ---------------- Lab（D65，與 OpenCV 一致） ---------------- */
const XN = 0.950456, ZN = 1.088754;
function rgb2lab(r, g, b, o) { // r,g,b 為 sRGB 編碼值 0..1
  r = eotf(r); g = eotf(g); b = eotf(b);
  const X = (0.412453 * r + 0.357580 * g + 0.180423 * b) / XN, Y = 0.212671 * r + 0.715160 * g + 0.072169 * b, Z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / ZN;
  const fx = X > 0.008856 ? Math.cbrt(X) : 7.787 * X + 0.137931, fy = Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 0.137931, fz = Z > 0.008856 ? Math.cbrt(Z) : 7.787 * Z + 0.137931;
  o[0] = Y > 0.008856 ? 116 * fy - 16 : 903.3 * Y; o[1] = 500 * (fx - fy); o[2] = 200 * (fy - fz);
}
function lab2lin(L, a, b, o) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const x3 = fx * fx * fx, z3 = fz * fz * fz;
  const Y = L > 7.9996 ? fy * fy * fy : L / 903.3, X = (x3 > 0.008856 ? x3 : (fx - 0.137931) / 7.787) * XN, Z = (z3 > 0.008856 ? z3 : (fz - 0.137931) / 7.787) * ZN;
  o[0] = 3.240479 * X - 1.537150 * Y - 0.498535 * Z;
  o[1] = -0.969256 * X + 1.875992 * Y + 0.041556 * Z;
  o[2] = 0.055648 * X - 0.204043 * Y + 1.057311 * Z;
}
function lab2rgb(L, a, b, o) { lab2lin(L, a, b, o); o[0] = oetf(o[0]); o[1] = oetf(o[1]); o[2] = oetf(o[2]); }

/* ---------------- 濾波基本功 ---------------- */
function boxBlur(src, w, h, r, out) {
  out = out || new Float32Array(w * h); if (r < 1) { out.set(src); return out; }
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { // 水平
    const o = y * w; let s = 0, n = 0;
    for (let x = 0; x < Math.min(r, w); x++) { s += src[o + x]; n++; }
    for (let x = 0; x < w; x++) {
      if (x + r < w) { s += src[o + x + r]; n++; }
      if (x - r - 1 >= 0) { s -= src[o + x - r - 1]; n--; }
      tmp[o + x] = s / n;
    }
  }
  const col = new Float64Array(w), cnt = new Int32Array(1);
  // 垂直（逐列累加，cache 友善）
  const acc = new Float64Array(w); let n = 0;
  for (let y = 0; y < Math.min(r, h); y++) { const o = y * w; for (let x = 0; x < w; x++) acc[x] += tmp[o + x]; n++; }
  for (let y = 0; y < h; y++) {
    if (y + r < h) { const o = (y + r) * w; for (let x = 0; x < w; x++) acc[x] += tmp[o + x]; n++; }
    if (y - r - 1 >= 0) { const o = (y - r - 1) * w; for (let x = 0; x < w; x++) acc[x] -= tmp[o + x]; n--; }
    const o = y * w, inv = 1 / n; for (let x = 0; x < w; x++) out[o + x] = acc[x] * inv;
  }
  return out;
}
function gaussBlur(src, w, h, sigma, out) { // 三次方框近似高斯
  const r = Math.max(1, Math.round(Math.sqrt(12 * sigma * sigma / 3 + 1) - 1) / 2 | 0) || 1;
  const a = boxBlur(src, w, h, r), b = boxBlur(a, w, h, r); return boxBlur(b, w, h, r, out);
}
function guidedSelf(I, w, h, r, eps) {
  const n = w * h, mI = boxBlur(I, w, h, r), II = new Float32Array(n);
  for (let i = 0; i < n; i++) II[i] = I[i] * I[i];
  const mII = boxBlur(II, w, h, r), a = II, b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], A = v / (v + eps); a[i] = A; b[i] = mI[i] - A * mI[i]; }
  const ma = boxBlur(a, w, h, r, mII), mb = boxBlur(b, w, h, r, mI), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}
function guided(I, p, w, h, r, eps) {
  const n = w * h, mI = boxBlur(I, w, h, r), mp = boxBlur(p, w, h, r), t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = I[i] * p[i];
  const mIp = boxBlur(t, w, h, r);
  for (let i = 0; i < n; i++) t[i] = I[i] * I[i];
  const mII = boxBlur(t, w, h, r);
  for (let i = 0; i < n; i++) { const A = (mIp[i] - mI[i] * mp[i]) / (mII[i] - mI[i] * mI[i] + eps); t[i] = A; mp[i] = mp[i] - A * mI[i]; }
  const ma = boxBlur(t, w, h, r, mII), mb = boxBlur(mp, w, h, r, mIp), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}
/* 快速導向濾波：係數在縮小圖上算再放大（He 2015），大半徑也很快 */
function downArea(src, w, h, s) {
  const w2 = Math.max(1, Math.floor(w / s)), h2 = Math.max(1, Math.floor(h / s)), o = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    let acc = 0; for (let j = 0; j < s; j++) { const r = (y * s + j) * w + x * s; for (let i = 0; i < s; i++) acc += src[r + i]; }
    o[y * w2 + x] = acc / (s * s);
  }
  return { d: o, w: w2, h: h2 };
}
function upBilinear(src, w2, h2, w, h, out) {
  out = out || new Float32Array(w * h); const sx = w2 / w, sy = h2 / h;
  for (let y = 0; y < h; y++) {
    let fy = (y + 0.5) * sy - 0.5; if (fy < 0) fy = 0; let y0 = fy | 0; if (y0 >= h2 - 1) { y0 = h2 - 1; } const y1 = Math.min(y0 + 1, h2 - 1), ay = fy - y0;
    for (let x = 0; x < w; x++) {
      let fx = (x + 0.5) * sx - 0.5; if (fx < 0) fx = 0; let x0 = fx | 0; if (x0 >= w2 - 1) x0 = w2 - 1; const x1 = Math.min(x0 + 1, w2 - 1), ax = fx - x0;
      const a = src[y0 * w2 + x0], b = src[y0 * w2 + x1], c = src[y1 * w2 + x0], d = src[y1 * w2 + x1];
      out[y * w + x] = (a + (b - a) * ax) * (1 - ay) + (c + (d - c) * ax) * ay;
    }
  }
  return out;
}
function fastGuidedCoef(I, w, h, r, eps, s) { // 回傳低解析度 a,b（呼叫端放大後套用）
  s = Math.max(1, s | 0);
  const D = s > 1 ? downArea(I, w, h, s) : { d: I, w, h };
  const rr = Math.max(1, Math.round(r / s)), n = D.w * D.h, Id = D.d;
  const mI = boxBlur(Id, D.w, D.h, rr), II = new Float32Array(n);
  for (let i = 0; i < n; i++) II[i] = Id[i] * Id[i];
  const mII = boxBlur(II, D.w, D.h, rr), a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], A = v / (v + eps); a[i] = A; b[i] = mI[i] - A * mI[i]; }
  return { a: boxBlur(a, D.w, D.h, rr), b: boxBlur(b, D.w, D.h, rr), w: D.w, h: D.h };
}
function minFilter1D(src, dst, n, stride, off, k) { // 滑動最小值（單調佇列）
  const q = new Int32Array(n); let hd = 0, tl = 0; const r = k >> 1;
  for (let i = 0; i < n + r; i++) {
    if (i < n) { const v = src[off + i * stride]; while (tl > hd && src[off + q[tl - 1] * stride] >= v) tl--; q[tl++] = i; }
    const c = i - r; if (c >= 0) { while (q[hd] < c - r) hd++; dst[off + c * stride] = src[off + q[hd] * stride]; }
  }
}
function erode(src, w, h, k) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) minFilter1D(src, t, w, 1, y * w, k);
  for (let x = 0; x < w; x++) minFilter1D(t, o, h, w, x, k);
  return o;
}
function percentiles(arr, qs, step) {
  step = step || Math.max(1, Math.floor(arr.length / 200000));
  const s = new Float32Array(Math.ceil(arr.length / step)); let j = 0;
  for (let i = 0; i < arr.length; i += step) s[j++] = arr[i];
  const v = s.subarray(0, j).sort();
  return qs.map(q => v[Math.min(j - 1, Math.max(0, Math.round(q / 100 * (j - 1))))]);
}

/* ---------------- 影像容器 ---------------- */
function img(w, h) { const n = w * h; return { w, h, R: new Float32Array(n), G: new Float32Array(n), B: new Float32Array(n) }; }
/* LibRaw 預設輸出 BT.709 曲線（gamm 參數在 wasm 版無效），用查表轉回線性 */
const BT709_LIN = (() => { const t = new Float32Array(65536); for (let i = 0; i < 65536; i++) { const s = i / 65535; t[i] = s < 0.081 ? s / 4.5 : Math.pow((s + 0.099) / 1.099, 1 / 0.45); } return t; })();
function fromInterleaved16(u16, w, h, scale, f, lut) { // f：整數縮小倍率（面積平均）；lut：16-bit → 線性
  f = Math.max(1, f | 0); const w2 = Math.floor(w / f), h2 = Math.floor(h / f), o = img(w2, h2), k = scale / (f * f);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    let r = 0, g = 0, b = 0;
    if (lut) for (let j = 0; j < f; j++) { let p = ((y * f + j) * w + x * f) * 3; for (let i = 0; i < f; i++, p += 3) { r += lut[u16[p]]; g += lut[u16[p + 1]]; b += lut[u16[p + 2]]; } }
    else for (let j = 0; j < f; j++) { let p = ((y * f + j) * w + x * f) * 3; for (let i = 0; i < f; i++, p += 3) { r += u16[p]; g += u16[p + 1]; b += u16[p + 2]; } }
    const q = y * w2 + x; o.R[q] = r * k; o.G[q] = g * k; o.B[q] = b * k;
  }
  return o;
}
function resizeImg(im, W) { // 面積縮圖到寬 W（整數倍率＋雙線性）
  if (im.w <= W) return im; const f = Math.max(1, Math.floor(im.w / W));
  let a = f > 1 ? { w: Math.floor(im.w / f), h: Math.floor(im.h / f), R: downArea(im.R, im.w, im.h, f).d, G: downArea(im.G, im.w, im.h, f).d, B: downArea(im.B, im.w, im.h, f).d } : im;
  if (a.w === W) return a; const H = Math.round(a.h * W / a.w), o = img(W, H);
  upBilinear(a.R, a.w, a.h, W, H, o.R); upBilinear(a.G, a.w, a.h, W, H, o.G); upBilinear(a.B, a.w, a.h, W, H, o.B); return o;
}
function rotate(im, flip) { // LibRaw flip：3=180，5=逆時針90，6=順時針90
  if (!flip || flip === 0) return im;
  const { w, h } = im, o = flip === 3 ? img(w, h) : img(h, w);
  for (const c of ['R', 'G', 'B']) {
    const s = im[c], d = o[c];
    if (flip === 3) { for (let i = 0, n = w * h; i < n; i++) d[n - 1 - i] = s[i]; }
    else if (flip === 6) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[x * h + (h - 1 - y)] = s[y * w + x]; }
    else if (flip === 5) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(w - 1 - x) * h + y] = s[y * w + x]; }
  }
  return o;
}

/* ---------------- 鏡頭校正（暗角、變形、橫向色差） ---------------- */
function interp(knots, vals, r) {
  const n = knots.length; if (r <= knots[0]) return vals[0]; if (r >= knots[n - 1]) return vals[n - 1];
  let i = 1; while (knots[i] < r) i++;
  const t = (r - knots[i - 1]) / (knots[i] - knots[i - 1]); return vals[i - 1] + (vals[i] - vals[i - 1]) * t;
}
/* spec：{knots, cor:[R[],G[],B[]], vigKnots, vig[] (除數)}；k：{dist, ca, vig} 強度 0..2 */
function lensSpec(base, k) {
  if (!base) return null; k = Object.assign({ dist: 1, ca: 1, vig: 1 }, k || {});
  const n = base.knots.length, cor = [[], [], []];
  for (let i = 0; i < n; i++) {
    const d = 1 + (base.dist[i] - 1) * k.dist;
    cor[0][i] = d * (1 + ((base.caR ? base.caR[i] : 1) - 1) * k.ca);
    cor[1][i] = d;
    cor[2][i] = d * (1 + ((base.caB ? base.caB[i] : 1) - 1) * k.ca);
  }
  let vig = null;
  if (base.vig) vig = base.vig.map(v => Math.pow(v, k.vig));
  return { knots: base.knots, cor, vigKnots: base.vigKnots || base.knots, vig };
}
function sonyLens(p) { // darktable embedded metadata v2 的公式
  const nc = p.nc, knots = [], dist = [], caR = [], caB = [], vig = [];
  for (let i = 0; i < nc; i++) {
    knots.push((i + 0.5) / (nc - 1));
    dist.push(p.dist[i] * Math.pow(2, -14) + 1);
    caR.push(p.ca_r[i] * Math.pow(2, -21) + 1); caB.push(p.ca_b[i] * Math.pow(2, -21) + 1);
    vig.push(Math.pow(2, 0.5 - Math.pow(2, p.vig[i] * Math.pow(2, -13) - 1)));
  }
  return { knots, dist, caR, caB, vig, src: 'Sony 機身內嵌鏡頭校正資料' };
}
function dbLens(e) { // 由相機 JPG 反推的鏡頭資料（例如 GR III）
  return { knots: e.knots, dist: e.dist, caR: null, caB: null, vigKnots: e.vigKnots, vig: e.vigEV.map(ev => Math.pow(2, -ev)), src: '依相機直出 JPG 反推的鏡頭資料' };
}
function lensAutoScale(spec, w, h) {
  if (!spec) return 1; const w2 = w / 2, h2 = h / 2, rn = 1 / Math.hypot(w2, h2); let need = 0;
  for (let i = 0; i <= 400; i++) {
    const t = i / 400, pts = [[-w2 + 2 * w2 * t, -h2], [w2, -h2 + 2 * h2 * t], [-w2 + 2 * w2 * t, h2], [-w2, -h2 + 2 * h2 * t]];
    for (const [bx, by] of pts) { const r = rn * Math.hypot(bx, by); for (let c = 0; c < 3; c++) { const d = interp(spec.knots, spec.cor[c], r); need = Math.max(need, Math.abs(d * bx) / w2, Math.abs(d * by) / h2); } }
  }
  return need > 1 ? 1 / need : 1;
}
/* 從來源取樣出校正後的影像（輸出尺寸 W×H 與來源同一個畫框；來源可為 16-bit 交錯或 Float32 平面） */
function lensRemap(src, spec, W, H, rows) {
  const sw = src.w, sh = src.h, w2 = W / 2, h2 = H / 2, rn = 1 / Math.hypot(w2, h2), inv = spec ? lensAutoScale(spec, W, H) : 1;
  const sx = sw / W, sy = sh / H, y0 = rows ? rows[0] : 0, y1 = rows ? rows[1] : H, o = img(W, y1 - y0);
  const LUT = src.lut, get = src.u16 ? (LUT ? ((c, x, y) => LUT[src.u16[(y * sw + x) * 3 + c]] * src.scale) : ((c, x, y) => src.u16[(y * sw + x) * 3 + c] * src.scale)) : null;
  const P = src.u16 ? null : [src.R, src.G, src.B];
  const sample = (c, fx, fy) => {
    if (fx < 0) fx = 0; if (fy < 0) fy = 0; if (fx > sw - 1) fx = sw - 1; if (fy > sh - 1) fy = sh - 1;
    const x0 = fx | 0, y0_ = fy | 0, x1 = x0 < sw - 1 ? x0 + 1 : x0, y1_ = y0_ < sh - 1 ? y0_ + 1 : y0_, ax = fx - x0, ay = fy - y0_;
    let a, b, cc, d;
    if (P) { const p = P[c]; a = p[y0_ * sw + x0]; b = p[y0_ * sw + x1]; cc = p[y1_ * sw + x0]; d = p[y1_ * sw + x1]; }
    else { a = get(c, x0, y0_); b = get(c, x1, y0_); cc = get(c, x0, y1_); d = get(c, x1, y1_); }
    return (a + (b - a) * ax) * (1 - ay) + (cc + (d - cc) * ax) * ay;
  };
  const ch = [o.R, o.G, o.B];
  for (let y = y0; y < y1; y++) {
    const cy = (y + 0.5 - h2) * inv, oy = (y - y0) * W;
    for (let x = 0; x < W; x++) {
      const cx = (x + 0.5 - w2) * inv, r = rn * Math.hypot(cx, cy);
      let vigDiv = 1;
      for (let c = 0; c < 3; c++) {
        const d = spec ? interp(spec.knots, spec.cor[c], r) : 1;
        if (c === 1 && spec && spec.vig) vigDiv = Math.max(1e-4, interp(spec.vigKnots, spec.vig, d * r));
        ch[c][oy + x] = sample(c, (d * cx + w2) * sx - 0.5, (d * cy + h2) * sy - 0.5);
      }
      if (vigDiv !== 1) { const k = 1 / vigDiv; o.R[oy + x] *= k; o.G[oy + x] *= k; o.B[oy + x] *= k; }
    }
  }
  return o;
}

/* ---------------- 相機描述檔（DNG 結構） ---------------- */
function makeProfile(p) {
  const xs = p.xs, ys = Float32Array.from(p.ys), x0 = xs[0], dx = xs[1] - xs[0], n = xs.length;
  const H = Float32Array.from(p.hsm.flat(2)); // [36][8][3]
  return {
    curve(L) { const lx = Math.log2(L > 1e-7 ? L : 1e-7), f = (lx - x0) / dx; if (f <= 0) return ys[0]; if (f >= n - 1) return ys[n - 1]; const i = f | 0; return ys[i] + (ys[i + 1] - ys[i]) * (f - i); },
    hsm: H
  };
}
/* x（線性 ProPhoto）→ o（線性 sRGB） */
function applyProfile(prof, r, g, b, o) {
  if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
  let L = r * LUM[0] + g * LUM[1] + b * LUM[2]; if (L < 1e-7) L = 1e-7;
  const k = prof.curve(L) / L; r *= k; g *= k; b *= k;
  // HSV（線性 ProPhoto）
  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b), d = mx - mn;
  if (d > 1e-9 && mx > 1e-9) {
    let h; if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360; const s = d / mx;
    const fh = h / 10, h0 = (fh | 0) % 36, h1 = (h0 + 1) % 36, ah = fh - (fh | 0);
    const fs = Math.min(s, 1) * 7; let s0 = fs | 0; if (s0 > 6) s0 = 6; const as = fs - s0;
    const T = prof.hsm, i00 = (h0 * 8 + s0) * 3, i10 = (h1 * 8 + s0) * 3, i01 = i00 + 3, i11 = i10 + 3;
    const w00 = (1 - ah) * (1 - as), w10 = ah * (1 - as), w01 = (1 - ah) * as, w11 = ah * as;
    const dh = T[i00] * w00 + T[i10] * w10 + T[i01] * w01 + T[i11] * w11;
    const ss = T[i00 + 1] * w00 + T[i10 + 1] * w10 + T[i01 + 1] * w01 + T[i11 + 1] * w11;
    const vs = T[i00 + 2] * w00 + T[i10 + 2] * w10 + T[i01 + 2] * w01 + T[i11 + 2] * w11;
    let h2 = (h + dh) % 360; if (h2 < 0) h2 += 360; let s2 = s * ss; if (s2 > 1) s2 = 1; const v = mx * vs;
    const hh = h2 / 60, ii = hh | 0, f = hh - ii, p_ = v * (1 - s2), q = v * (1 - s2 * f), t = v * (1 - s2 * (1 - f));
    switch (ii % 6) { case 0: r = v; g = t; b = p_; break; case 1: r = q; g = v; b = p_; break; case 2: r = p_; g = v; b = t; break; case 3: r = p_; g = q; b = v; break; case 4: r = t; g = p_; b = v; break; default: r = v; g = p_; b = q; }
  }
  let L2 = r * LUM[0] + g * LUM[1] + b * LUM[2]; if (L2 < 1e-7) L2 = 1e-7;
  let kk = (L2 - 0.80) / 0.25; kk = kk < 0 ? 0 : kk > 1 ? 1 : kk; kk *= kk;
  r = r * (1 - kk) + L2 * kk; g = g * (1 - kk) + L2 * kk; b = b * (1 - kk) + L2 * kk;
  o[0] = PP2S[0][0] * r + PP2S[0][1] * g + PP2S[0][2] * b;
  o[1] = PP2S[1][0] * r + PP2S[1][1] * g + PP2S[1][2] * b;
  o[2] = PP2S[2][0] * r + PP2S[2][1] * g + PP2S[2][2] * b;
}

/* ---------------- 點曲線（單調三次，與 Lightroom 點曲線同類） ---------------- */
function curveLUT(pts) {
  if (!pts || pts.length < 2) return null;
  const P = pts.map(p => [p[0] / 255, p[1] / 255]).sort((a, b) => a[0] - b[0]), n = P.length;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; dy[i] = (P[i + 1][1] - P[i][1]) / (dx[i] || 1e-6); }
  m[0] = dy[0]; m[n - 1] = dy[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (dy[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / dy[i], b = m[i + 1] / dy[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dy[i]; m[i + 1] = t * b * dy[i]; } }
  const L = new Float32Array(1025);
  for (let k = 0; k <= 1024; k++) {
    const x = k / 1024; let i = 0; while (i < n - 2 && x > P[i + 1][0]) i++;
    if (x <= P[0][0]) { L[k] = P[0][1]; continue; } if (x >= P[n - 1][0]) { L[k] = P[n - 1][1]; continue; }
    const hh = dx[i], t = (x - P[i][0]) / hh, t2 = t * t, t3 = t2 * t;
    L[k] = clamp((2 * t3 - 3 * t2 + 1) * P[i][1] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * P[i + 1][1] + (t3 - t2) * hh * m[i + 1], 0, 1);
  }
  return L;
}

/* ---------------- HSL／色彩分級 ---------------- */
const BANDS = [20, 50, 85, 135, 190, 245, 290, 330];
function bandW(h, w) { let s = 0; for (let i = 0; i < 8; i++) { let d = Math.abs(((h - BANDS[i]) % 360 + 540) % 360 - 180); const v = d < 40 ? 1 - d / 40 : 0; w[i] = v; s += v; } if (s > 0) for (let i = 0; i < 8; i++) w[i] /= s; }

/* ================= 主流程 ================= */
/* 全域分析（在低解析度影像上做一次）：去朦朧大氣光與穿透率、基底層係數、雜訊量 */
function analyse(low, P) {
  const { w, h } = low, n = w * h, x = scaleExp(low, P);
  const res = { w, h };
  // 去朦朧
  if (P.dehaze > 0) {
    const k = Math.max(3, (Math.min(w, h) * 0.02 | 0) | 1), mn = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = x.R[i], b = x.G[i], c = x.B[i]; mn[i] = a < b ? (a < c ? a : c) : (b < c ? b : c); }
    const dc = erode(mn, w, h, k), idx = Array.from(dc.keys()).sort((i, j) => dc[j] - dc[i]).slice(0, Math.max(10, n / 1000 | 0));
    let A = 0; for (const i of idx) A += x.R[i] * LUM[0] + x.G[i] * LUM[1] + x.B[i] * LUM[2]; A /= idx.length;
    for (let i = 0; i < n; i++) mn[i] /= Math.max(A, 1e-6);
    const dcn = erode(mn, w, h, k), t = new Float32Array(n), g = new Float32Array(n); let gm = 1e-6;
    for (let i = 0; i < n; i++) { g[i] = x.R[i] * LUM[0] + x.G[i] * LUM[1] + x.B[i] * LUM[2]; if (g[i] > gm) gm = g[i]; t[i] = 1 - 0.95 * Math.min(P.dehaze, 1) * dcn[i]; }
    for (let i = 0; i < n; i++) g[i] /= gm;
    const tg = guided(g, t, w, h, k * 2, 1e-3);
    for (let i = 0; i < n; i++) { let near = (g[i] * gm / Math.max(A, 1e-6) - 0.75) / 0.25; near = near < 0 ? 0 : near > 1 ? 1 : near; tg[i] = clamp(tg[i] + (1 - tg[i]) * near, 0.3, 1); }
    res.A = A; res.t = tg; applyDehaze(x, res, null);
  }
  const lg = new Float32Array(n);
  for (let i = 0; i < n; i++) { let L = x.R[i] * LUM[0] + x.G[i] * LUM[1] + x.B[i] * LUM[2]; lg[i] = Math.log2(L > 1e-6 ? L : 1e-6); }
  const r = Math.max(4, Math.min(w, h) * 0.04 | 0);
  res.baseCoef = fastGuidedCoef(lg, w, h, r, 0.04, Math.max(1, r / 8 | 0));
  return res;
}
function scaleExp(im, P, rows) { // 曝光＋白平衡微調（線性）
  const k = Math.pow(2, P.exposure), kr = k * Math.pow(2, 0.25 * P.temp), kg = k * Math.pow(2, -0.25 * P.tint), kb = k * Math.pow(2, -0.25 * P.temp);
  const n = im.R.length, o = { w: im.w, h: im.h, R: new Float32Array(n), G: new Float32Array(n), B: new Float32Array(n) };
  for (let i = 0; i < n; i++) { o.R[i] = im.R[i] * kr; o.G[i] = im.G[i] * kg; o.B[i] = im.B[i] * kb; }
  return o;
}
function applyDehaze(x, A, rows) { // rows：[y0, y1, 全高, 全寬] 對應低解析度 t 的放大
  const { w, h } = x, n = w * h; const tA = A.A;
  let t = A.t;
  if (A.w !== w || (rows && (rows[2] !== A.h))) { // 放大 t 到目前尺寸
    const full = rows ? [rows[3], rows[2]] : [w, h], tt = new Float32Array(w * h), sx = A.w / full[0], sy = A.h / full[1];
    for (let y = 0; y < h; y++) {
      const Y = (rows ? rows[0] : 0) + y; let fy = (Y + 0.5) * sy - 0.5; if (fy < 0) fy = 0; let y0 = fy | 0; if (y0 > A.h - 1) y0 = A.h - 1; const y1 = Math.min(y0 + 1, A.h - 1), ay = fy - y0;
      for (let xx = 0; xx < w; xx++) { let fx = (xx + 0.5) * sx - 0.5; if (fx < 0) fx = 0; let x0 = fx | 0; if (x0 > A.w - 1) x0 = A.w - 1; const x1 = Math.min(x0 + 1, A.w - 1), ax = fx - x0;
        const T = A.t; tt[y * w + xx] = (T[y0 * A.w + x0] * (1 - ax) + T[y0 * A.w + x1] * ax) * (1 - ay) + (T[y1 * A.w + x0] * (1 - ax) + T[y1 * A.w + x1] * ax) * ay; }
    }
    t = tt;
  }
  for (let i = 0; i < n; i++) { const ti = t[i]; x.R[i] = Math.max((x.R[i] - tA) / ti + tA, 0); x.G[i] = Math.max((x.G[i] - tA) / ti + tA, 0); x.B[i] = Math.max((x.B[i] - tA) / ti + tA, 0); }
}

/* 渲染分兩段：toneStage（曝光、局部色調、描述檔、色階、曲線）→ colorStage（Lab 色彩、銳利化）。
   只改顏色類滑桿時可重用 toneStage 的結果，拉滑桿比較順。
   im：線性影像（已鏡頭校正）；G：analyse() 結果；rows：分條時 [y0,y1,全高,全寬] */
const TONE_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'temp', 'tint', 'nr', 'curve'];
const TW_LO = -16, TW_HI = 4, TW_N = 2048, TW_D = (TW_HI - TW_LO) / TW_N;
function toneLUT(P) { // 依基底亮度（log2）預先算好：亮部、陰影、對比後的新基底，以及清晰度權重
  const nb = new Float32Array(TW_N + 1), mw = new Float32Array(TW_N + 1);
  for (let i = 0; i <= TW_N; i++) {
    const bs = TW_LO + i * TW_D;
    let hw = (bs + 3.5) / 3.5; hw = hw < 0 ? 0 : hw > 1 ? 1 : hw; hw = Math.pow(hw, 1.6);
    let sw = (-2.5 - bs) / 5; sw = sw < 0 ? 0 : sw > 1 ? 1 : sw; sw = Math.pow(sw, 0.8);
    let v = bs + P.highlights * 2.6 * hw + P.shadows * 1.8 * sw;
    if (P.contrast) v = -2.6 + (v + 2.6) * (1 + 0.35 * P.contrast);
    nb[i] = v; mw[i] = Math.exp(-((bs + 3) * (bs + 3)) / 10);
  }
  return { nb, mw };
}
function toneStage(im, prof, P, G, rows) {
  P = Object.assign({}, DEFAULTS, P);
  const { w, h } = im, n = w * h, full = rows ? [rows[3], rows[2]] : [w, h];
  const x = scaleExp(im, P);
  if (P.dehaze > 0 && G.t) applyDehaze(x, G, rows);
  else if (P.dehaze < 0) { const a = -P.dehaze * 0.5; let m = 0; for (let i = 0; i < n; i++) m += x.G[i]; m /= n; for (let i = 0; i < n; i++) { x.R[i] = x.R[i] * (1 - a) + m * a; x.G[i] = x.G[i] * (1 - a) + m * a; x.B[i] = x.B[i] * (1 - a) + m * a; } }
  if (P.nr > 0) lightDenoise(x, P.nr);
  const lg = new Float32Array(n);
  for (let i = 0; i < n; i++) { const L = x.R[i] * LUM[0] + x.G[i] * LUM[1] + x.B[i] * LUM[2]; lg[i] = Math.log2(L > 1e-6 ? L : 1e-6); }
  const C = G.baseCoef;
  const a = upRows(C.a, C.w, C.h, full[0], full[1], rows ? rows[0] : 0, h), b = upRows(C.b, C.w, C.h, full[0], full[1], rows ? rows[0] : 0, h);
  const r = Math.max(4, Math.min(full[0], full[1]) * 0.04 | 0), rf = Math.max(1, r / 8 | 0);
  const baseF = guidedSelf(lg, w, h, rf, 0.004);
  const E = new Float32Array(n);
  for (let i = 0; i < n; i++) { const f = lg[i] - baseF[i]; E[i] = f * f; }
  const Es = gaussBlur(E, w, h, 2.0 * Math.max(1, full[0] / 3000));
  const Nn = G.noiseE || (G.noiseE = percentiles(Es, [50])[0] + 1e-9);
  const T = toneLUT(P), tex = 1 + P.texture, cla = P.clarity * 5;
  const oR = new Float32Array(n), oG = new Float32Array(n), oB = new Float32Array(n), t3 = [0, 0, 0];
  const bl = -P.blacks * 0.08, wh = 1 - P.whites * 0.08, den = Math.max(wh - bl, 1e-3), cl = curveLUT(P.curve);
  // 色階＋柔和高光肩部＋點曲線 → 一張 4096 格的表
  const LV = new Float32Array(4097);
  for (let j = 0; j <= 4096; j++) { let v = (j / 4096 - bl) / den; v = v < 0 ? 0 : v > 1 ? 1 : v; if (v > 0.92) v = 0.92 + (1 - Math.exp(-(v - 0.92) / 0.08)) * 0.08; if (cl) { const f = v * 1024, q = f | 0; v = q >= 1024 ? cl[1024] : cl[q] + (cl[q + 1] - cl[q]) * (f - q); } LV[j] = v; }
  const lev = v => { const f = (v < 0 ? 0 : v > 1 ? 1 : v) * 4096, q = f | 0; return q >= 4096 ? LV[4096] : LV[q] + (LV[q + 1] - LV[q]) * (f - q); };
  for (let i = 0; i < n; i++) {
    const L0 = lg[i], bs = a[i] * L0 + b[i], bF = baseF[i], fine = L0 - bF, mid = bF - bs;
    let ti = (bs - TW_LO) / TW_D; ti = ti < 0 ? 0 : ti > TW_N - 1 ? TW_N - 1 : ti; const q = ti | 0, fr = ti - q;
    const nb = T.nb[q] + (T.nb[q + 1] - T.nb[q]) * fr, mwv = T.mw[q] + (T.mw[q + 1] - T.mw[q]) * fr;
    const dm = Es[i] / (Es[i] + 2 * Nn), fg = tex * dm + 0.55 * (1 - dm);
    const k = Math.pow(2, nb + mid * (1 + cla * mwv) + fine * fg - L0);
    applyProfile(prof, x.R[i] * k, x.G[i] * k, x.B[i] * k, t3);
    oR[i] = lev(oetf(t3[0])); oG[i] = lev(oetf(t3[1])); oB[i] = lev(oetf(t3[2]));
  }
  return { w, h, R: oR, G: oG, B: oB, full };
}
/* 依色相（每 1°）預先合成：相機模板 HSL＋使用者 HSL、鮮豔度的膚色保護 */
function hueTables(P) {
  const look = P.look, uh = P.hsl, am = P.lookAmt == null ? 1 : P.lookAmt, wb = new Float32Array(8);
  const dh = new Float32Array(361), cs = new Float32Array(361), dl = new Float32Array(361), skin = new Float32Array(361);
  for (let d = 0; d <= 360; d++) {
    bandW(d, wb); let h1 = 0, c1 = 1, l1 = 0;
    if (look) { let a1 = 0, a2 = 0, a3 = 0; for (let j = 0; j < 8; j++) { a1 += wb[j] * look[j][0]; a2 += wb[j] * look[j][1]; a3 += wb[j] * look[j][2]; } h1 += a1 * am; c1 *= 1 + (a2 - 1) * am; l1 += a3 * am; }
    if (uh) { let a1 = 0, a2 = 0, a3 = 0; for (let j = 0; j < 8; j++) { a1 += wb[j] * uh[j][0]; a2 += wb[j] * uh[j][1]; a3 += wb[j] * uh[j][2]; } h1 += a1; c1 *= a2; l1 += a3; }
    dh[d] = h1; cs[d] = c1; dl[d] = l1; skin[d] = Math.exp(-((d - 55) * (d - 55)) / 648);
  }
  return { dh, cs, dl, skin, on: !!(look || uh) };
}
function colorStage(t, P, rows) {
  P = Object.assign({}, DEFAULTS, P);
  const { w, h } = t, n = w * h, full = t.full || [w, h];
  const oR = new Float32Array(n), oG = new Float32Array(n), oB = new Float32Array(n);
  const Lc = new Float32Array(n), Ac = new Float32Array(n), Bc = new Float32Array(n), lab = [0, 0, 0], t3 = [0, 0, 0];
  for (let i = 0; i < n; i++) { rgb2lab(t.R[i], t.G[i], t.B[i], lab); Lc[i] = lab[0]; Ac[i] = lab[1]; Bc[i] = lab[2]; }
  // 平滑色度（亮度引導，邊緣不暈色）：降彩噪用，也作為「色彩調整量」的計算基準，避免把雜訊放大成彩點
  if (P.cnr > 0) { // 去除孤立彩色亮點（暗部感光雜訊/熱像素，常見為藍紫色小點）：比鄰近亮很多且顏色偏離 → 以鄰近平均取代，重複兩輪
    for (let pass = 0; pass < 2; pass++) {
      const Lm = boxBlur(Lc, w, h, 2), Am = boxBlur(Ac, w, h, 2), Bm = boxBlur(Bc, w, h, 2);
      for (let i = 0; i < n; i++) {
        const dL = Lc[i] - Lm[i], da = Ac[i] - Am[i], db = Bc[i] - Bm[i];
        if (dL > 5 + 0.4 * Lm[i] && db < -6 && da * da + db * db > 100 && Lm[i] < 40) { Lc[i] = Lm[i]; Ac[i] = Am[i]; Bc[i] = Bm[i]; }
      }
    }
  }
  const rr = Math.max(2, Math.round(3 * Math.max(1, full[0] / 2000))), g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = Lc[i] / 100;
  const As = guided(g, Ac, w, h, rr, 2e-4), Bs = guided(g, Bc, w, h, rr, 2e-4);
  if (P.cnr > 0) { const m = P.cnr;
    // 暗部再用大半徑平滑一次（小簇彩噪在小半徑下會殘留成一團藍/紫斑）
    const A2 = guided(g, As, w, h, rr * 4, 1e-3), B2 = guided(g, Bs, w, h, rr * 4, 1e-3);
    for (let i = 0; i < n; i++) {
      const Ld = Lc[i], d2 = (Ld >= 30 ? 0 : Ld <= 10 ? 1 : (30 - Ld) / 20) * m;
      if (d2 > 0) { As[i] += (A2[i] - As[i]) * d2; Bs[i] += (B2[i] - Bs[i]) * d2;
        const cap = 4 + 1.2 * Ld, c = Math.sqrt(As[i] * As[i] + Bs[i] * Bs[i]); if (c > cap) { const f = 1 - (1 - cap / c) * d2; As[i] *= f; Bs[i] *= f; } }
    }
    for (let i = 0; i < n; i++) {
      // 暗部雜訊多、彩點最明顯：越暗越貼近平滑色度；殘餘偏差再限幅，消除孤立藍點
      const L = Lc[i], dk = L >= 24 ? 0 : L <= 8 ? 1 : (24 - L) / 16, k = m + (1 - m) * dk;
      let da = (Ac[i] - As[i]) * (1 - k), db = (Bc[i] - Bs[i]) * (1 - k);
      const lim = 2 + 0.12 * L, d = Math.sqrt(da * da + db * db); if (d > lim) { da *= lim / d; db *= lim / d; }
      Ac[i] = As[i] + da; Bc[i] = Bs[i] + db;
    } }
  if (P.defringeP > 0 || P.defringeG > 0) defringe(Lc, Ac, Bc, w, h, P.defringeP, P.defringeG);
  const HT = hueTables(P), gr = P.grade, ga = P.gradeAmt || 0, vib = P.vibrance, sat = P.saturation;
  let GL = null, GA = null, GB = null;
  if (gr && ga) { // 氛圍感：亮度曲線與各亮度的色調偏移，預先做成表
    GL = new Float32Array(1001); GA = new Float32Array(1001); GB = new Float32Array(1001); const step = gr.Lc[1] - gr.Lc[0];
    for (let j = 0; j <= 1000; j++) { const L = j / 10, L2 = L + (interp(gr.Lx, gr.Ly, L) - L) * ga; GL[j] = L2; let s = 0, oa = 0, ob = 0;
      for (let q = 0; q < gr.Lc.length; q++) { const wv = Math.max(0, 1 - Math.abs(L2 - gr.Lc[q]) / step); s += wv; oa += wv * gr.ab[q][0]; ob += wv * gr.ab[q][1]; }
      GA[j] = s > 0 ? oa / s * ga : 0; GB[j] = s > 0 ? ob / s * ga : 0; }
  }
  // 銳利化只作用在亮度
  let Lsh = null; if (P.sharpen > 0) { const s = 0.9 * Math.max(1, full[0] / 3000); Lsh = gaussBlur(Lc, w, h, s); }
  const colorOn = vib || sat || HT.on;
  for (let i = 0; i < n; i++) {
    let L = Lc[i], A = Ac[i], B = Bc[i];
    if (colorOn) {
      // 在平滑色度上算出「改變量」，再加回原像素
      const a0 = As[i], b0 = Bs[i]; let Cc = Math.sqrt(a0 * a0 + b0 * b0);
      let hue = Math.atan2(b0, a0) * 57.29578; if (hue < 0) hue += 360; const hd = hue | 0, hf = hue - hd;
      let kk = 1;
      if (vib || sat) {
        const sk = (HT.skin[hd] + (HT.skin[hd + 1] - HT.skin[hd]) * hf) * (Cc < 45 ? 1 - Cc / 45 : 0);
        const guard = (Cc <= 3 ? 0 : Cc >= 13 ? 1 : (Cc - 3) / 10) * (L >= 96 ? 0 : L <= 84 ? 1 : (96 - L) / 12);
        kk = 1 + (sat + vib * (Cc < 70 ? 1 - Cc / 70 : 0) * (1 - 0.7 * sk)) * guard;
      }
      let a1 = a0 * kk, b1 = b0 * kk, dl = 0;
      if (HT.on) {
        const gg = (Cc >= 8 ? 1 : Cc / 8) * (L >= 12 ? 1 : L / 12), dh = (HT.dh[hd] + (HT.dh[hd + 1] - HT.dh[hd]) * hf) * gg, cs = 1 + ((HT.cs[hd] + (HT.cs[hd + 1] - HT.cs[hd]) * hf) - 1) * gg;
        dl = (HT.dl[hd] + (HT.dl[hd + 1] - HT.dl[hd]) * hf) * gg * (L >= 95 ? 0 : L <= 80 ? 1 : (95 - L) / 15);
        const C2 = Cc * kk * cs, h2 = (hue + dh) * 0.0174533; a1 = C2 * Math.cos(h2); b1 = C2 * Math.sin(h2);
      }
      // 原像素的彩度相對於平滑值的比例也一起縮放（保留細節，但不額外放大雜訊）
      const ratio = Cc > 1e-3 ? Math.min(Math.sqrt(a1 * a1 + b1 * b1) / Cc, 1.25) : 1;
      A = a1 + (A - a0) * Math.min(ratio, 1); B = b1 + (B - b0) * Math.min(ratio, 1); L = L + dl;
    }
    if (Lsh) L = L + P.sharpen * (Lc[i] - Lsh[i]);
    L = L < 0 ? 0 : L > 100 ? 100 : L;
    if (GL) { const f = L * 10, q = f | 0, fr = f - q, q1 = q < 1000 ? q + 1 : 1000; A += GA[q] + (GA[q1] - GA[q]) * fr; B += GB[q] + (GB[q1] - GB[q]) * fr; L = GL[q] + (GL[q1] - GL[q]) * fr; }
    lab2lin(L, A, B, t3);
    if (t3[0] < 0 || t3[1] < 0 || t3[2] < 0) { // 超出 sRGB 色域（暗部雜訊最常見，會變成純藍點）：保持亮度、降低彩度拉回色域內
      let lo = 0, hi = 1; for (let it = 0; it < 7; it++) { const s = (lo + hi) / 2; lab2lin(L, A * s, B * s, t3); if (t3[0] < 0 || t3[1] < 0 || t3[2] < 0) hi = s; else lo = s; }
      A *= lo; B *= lo;
    }
    lab2rgb(L, A, B, t3);
    oR[i] = t3[0]; oG[i] = t3[1]; oB[i] = t3[2];
  }
  return { w, h, R: oR, G: oG, B: oB };
}
function renderBlock(im, prof, P, G, rows) { return colorStage(toneStage(im, prof, P, G, rows), P, rows); }
function upRows(src, w2, h2, W, H, y0, hh) { // 只放大需要的那幾列
  const out = new Float32Array(W * hh), sx = w2 / W, sy = h2 / H;
  for (let y = 0; y < hh; y++) {
    let fy = (y0 + y + 0.5) * sy - 0.5; if (fy < 0) fy = 0; let a0 = fy | 0; if (a0 > h2 - 1) a0 = h2 - 1; const a1 = Math.min(a0 + 1, h2 - 1), ay = fy - a0;
    for (let x = 0; x < W; x++) { let fx = (x + 0.5) * sx - 0.5; if (fx < 0) fx = 0; let b0 = fx | 0; if (b0 > w2 - 1) b0 = w2 - 1; const b1 = Math.min(b0 + 1, w2 - 1), ax = fx - b0;
      out[y * W + x] = (src[a0 * w2 + b0] * (1 - ax) + src[a0 * w2 + b1] * ax) * (1 - ay) + (src[a1 * w2 + b0] * (1 - ax) + src[a1 * w2 + b1] * ax) * ay; }
  }
  return out;
}
function lightDenoise(x, amt) {
  const { w, h } = x, n = w * h, L = new Float32Array(n), Y = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = Math.max(x.R[i] * LUM[0] + x.G[i] * LUM[1] + x.B[i] * LUM[2], 1e-7); Y[i] = Math.sqrt(L[i]); }
  let ym = 1e-6; for (let i = 0; i < n; i++) if (Y[i] > ym) ym = Y[i];
  const g = new Float32Array(n); for (let i = 0; i < n; i++) g[i] = Y[i] / ym;
  const r = Math.max(1, Math.round(Math.min(w, h) * 0.0012)), Yd = guidedSelf(g, w, h, r, 2e-4 * amt * amt);
  const rr = Math.max(2, Math.round(Math.min(w, h) * 0.004));
  for (const c of ['R', 'G', 'B']) {
    const ratio = new Float32Array(n); for (let i = 0; i < n; i++) ratio[i] = x[c][i] / L[i];
    const rs = guided(Yd, ratio, w, h, rr, 1e-4);
    for (let i = 0; i < n; i++) { const yy = Yd[i] * ym, nl = yy * yy, v = Math.max(rs[i] * nl, 0); x[c][i] = x[c][i] * (1 - amt) + v * amt; }
  }
}
function defringe(L, A, B, w, h, kp, kg) { // 高對比邊緣旁的紫／綠色鑲邊 → 降彩度
  const n = w * h, edge = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w]; edge[i] = Math.hypot(gx, gy) > 15 ? 1 : 0; }
  const e = boxBlur(edge, w, h, 3), As = boxBlur(A, w, h, 3), Bs = boxBlur(B, w, h, 3);
  for (let i = 0; i < n; i++) {
    if (e[i] <= 0) continue; const Cc = Math.hypot(A[i], B[i]); if (Cc < 6) continue;
    let hue = Math.atan2(B[i], A[i]) * 57.29578; if (hue < 0) hue += 360;
    const dp = ((hue - 305) % 360 + 540) % 360 - 180, dg = ((hue - 150) % 360 + 540) % 360 - 180;
    const wgt = Math.min(1, e[i] * 3) * Math.max(kp * Math.exp(-dp * dp / 1800), kg * 0.8 * Math.exp(-dg * dg / 968)) * clamp((Cc - 6) / 14, 0, 1);
    A[i] = A[i] * (1 - wgt) + As[i] * 0.3 * wgt; B[i] = B[i] * (1 - wgt) + Bs[i] * 0.3 * wgt;
  }
}

/* ---------------- 量測（給 AI 自動用） ---------------- */
function measure(o) {
  const { w, h } = o, n = w * h, L = new Float32Array(n), Cc = new Float32Array(n), lab = [0, 0, 0]; let csum = 0, clip = 0;
  for (let i = 0; i < n; i++) { rgb2lab(o.R[i], o.G[i], o.B[i], lab); L[i] = lab[0]; const c = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]); Cc[i] = c; csum += c; if (lab[0] > 96.5) clip++; }
  const [p1, p50, p95, p99] = percentiles(L, [1, 50, 95, 99.5], 1);
  const s = Math.max(1, w / 1200), g20 = gaussBlur(L, w, h, 20 * s), g2 = gaussBlur(L, w, h, 2 * s);
  let m1 = 0, m2 = 0, f1 = 0, f2 = 0; for (let i = 0; i < n; i++) { const a = L[i] - g20[i], b = L[i] - g2[i]; m1 += a; m2 += a * a; f1 += b; f2 += b * b; }
  return { p1, p50, p95, p99, C: csum / n, clip: clip / n * 100, midc: Math.sqrt(Math.max(m2 / n - (m1 / n) ** 2, 1e-9)), fine: Math.sqrt(Math.max(f2 / n - (f1 / n) ** 2, 1e-9)), L, Cc };
}
function render(im, prof, P) { const G = analyse(im, Object.assign({}, DEFAULTS, P)); return renderBlock(im, prof, P, G); }
function hazeScore(o) {
  const { w, h } = o, n = w * h, k = Math.max(3, (Math.min(w, h) * 0.02 | 0) | 1), mn = new Float32Array(n), Lm = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = o.R[i], b = o.G[i], c = o.B[i]; mn[i] = Math.min(a, b, c); Lm[i] = (a + b + c) / 3; }
  const dc = erode(mn, w, h, k), [p40] = percentiles(Lm, [40], 1), sel = [];
  for (let i = 0; i < n; i++) if (Lm[i] > p40 && Lm[i] < 0.97) sel.push(dc[i]);
  if (!sel.length) return 0; sel.sort((a, b) => a - b); return sel[sel.length >> 1];
}
function estimateNoise(im) {
  const { w, h } = im, n = w * h, Y = new Float32Array(n);
  for (let i = 0; i < n; i++) Y[i] = Math.sqrt(Math.max(im.R[i] * LUM[0] + im.G[i] * LUM[1] + im.B[i] * LUM[2], 0));
  const sd = [];
  for (let by = 1; by + 16 < h; by += 16) for (let bx = 1; bx + 16 < w; bx += 16) {
    let s = 0, s2 = 0, m = 0;
    for (let y = by; y < by + 16; y++) for (let x = bx; x < bx + 16; x++) { const i = y * w + x; const l = (4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - w] - Y[i + w]) / Math.sqrt(20); s2 += l * l; m += Y[i]; }
    if (m / 256 > 0.05) sd.push(Math.sqrt(s2 / 256));
  }
  if (!sd.length) return 0.005; sd.sort((a, b) => a - b); return sd[Math.floor(sd.length * 0.1)];
}

/* AI 自動：閉迴路調整滑桿，直到量測值符合目標（目標來自相機模板＝你的修圖風格） */
function aiAuto(im, prof, tmpl, opt) {
  opt = opt || {}; const W = opt.proxy || 640, small = resizeImg(im, W), iters = opt.iters || 12;
  const post = tmpl && tmpl.hsl ? { look: tmpl.hsl, lookAmt: 1 } : {};
  const enc0 = render(small, prof, { sharpen: 0, cnr: 0 }), m0 = measure(enc0);
  const P = Object.assign({}, DEFAULTS, { sharpen: 0, cnr: 0 });
  // 白平衡：只有中性色明顯偏色才微調（避免製造色偏）
  { const lab = [0, 0, 0], as = [], bs = []; for (let i = 0; i < enc0.R.length; i++) { rgb2lab(enc0.R[i], enc0.G[i], enc0.B[i], lab); if (Math.hypot(lab[1], lab[2]) < 12 && lab[0] > 35 && lab[0] < 92) { as.push(lab[1]); bs.push(lab[2]); } }
    if (as.length > 0.02 * enc0.R.length) { as.sort((a, b) => a - b); bs.sort((a, b) => a - b); const a = as[as.length >> 1], b = bs[bs.length >> 1];
      P.temp = clamp(-Math.sign(b) * Math.max(Math.abs(b) - 6, 0) / 25, -0.15, 0.15); P.tint = clamp(Math.sign(a) * Math.max(Math.abs(a) - 6, 0) / 25, -0.15, 0.15); } }
  const hz = hazeScore(enc0); P.dehaze = clamp((hz - 0.30) * 2.2, 0, 0.7);
  const nz = opt.noise != null ? opt.noise : estimateNoise(im); P.nr = 0; P._noise = nz;
  const ref = measure(render(small, prof, { sharpen: 0, cnr: 0, dehaze: P.dehaze }));
  const T = {}; T.p1 = 2.5; T.p95 = Math.min(ref.p95, 87); T.p99 = Math.min(Math.max(ref.p99, 92), 95.5);
  T.p50 = clamp(ref.p50 + (48 - ref.p50) * 0.85, 38, 58); T.C = ref.C * interp([12, 40], [1.6, 1.2], ref.C); T.midc = ref.midc * 1.25; T.fine = ref.fine * 1.25;
  if (tmpl) { T.p1 = tmpl.p1; T.p95 = Math.min(ref.p95, tmpl.p95); T.p50 = clamp(ref.p50 + (tmpl.p50 - ref.p50) * 0.85, 36, 60); T.midc = ref.midc * tmpl.midc; T.fine = ref.fine * tmpl.fine; T.C = null; }
  for (let it = 0; it < iters; it++) {
    const m = measure(render(small, prof, Object.assign({}, P, post)));
    P.exposure = clamp(P.exposure + (T.p50 - m.p50) / 45, -2, 2);
    P.highlights = clamp(P.highlights - (m.p95 - T.p95) / 25 - Math.max(m.clip - 0.4, 0) / 8, -1, 0.2);
    P.whites = clamp(P.whites + (T.p99 - m.p99) / 20, -0.5, 0.6);
    P.blacks = clamp(P.blacks - (m.p1 - T.p1) / 15, -1.2, 0.6);
    P.shadows = clamp(P.shadows + (T.p50 - m.p50) / 60, 0, 0.6);
    if (T.C != null) P.vibrance = clamp(P.vibrance + (T.C / m.C - 1) * 1.5, 0, 1);
    P.clarity = clamp(P.clarity + (T.midc / m.midc - 1), -0.3, 1);
    P.texture = clamp(P.texture + (T.fine / m.fine - 1) * 2, -0.3, 0.9);
    if (opt.onStep) opt.onStep(it + 1, iters);
  }
  P.sharpen = 0.4; P.cnr = 0.5; P.nr = clamp((nz - 0.004) / 0.01, 0, 0.6);
  if (tmpl && tmpl.hsl) { P.look = tmpl.hsl; P.lookAmt = 1; }
  P._haze = hz; return P;
}

const API = { BT709_LIN, DEFAULTS, LUM, PP2S, oetf, eotf, rgb2lab, lab2rgb, boxBlur, gaussBlur, guided, guidedSelf, img, fromInterleaved16, resizeImg, rotate,
  lensSpec, sonyLens, dbLens, lensAutoScale, lensRemap, makeProfile, applyProfile, analyse, toneStage, colorStage, renderBlock, render, TONE_KEYS, measure, aiAuto, estimateNoise, hazeScore, curveLUT, percentiles, BANDS };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else G.ENG = API;
})(typeof self !== 'undefined' ? self : globalThis);
