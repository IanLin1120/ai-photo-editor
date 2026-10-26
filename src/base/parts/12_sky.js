/* ================= 天空素材庫（程序產生，無版權問題；也可匯入自己的天空照片） ================= */
const SkyLib = {
  PRESETS: [
    ['cumulus', '白雲藍天'], ['blue', '晴朗藍天'], ['golden', '金色時刻'], ['sunset', '夕陽晚霞'],
    ['dramatic', '戲劇雲層'], ['bluehour', '藍調時刻'], ['overcast', '柔和雲層']
  ],
  P: {
    blue: { top: [0.16, 0.40, 0.80], hor: [0.68, 0.83, 0.96], cover: 0.70, cl: [1, 1, 1], sh: [0.62, 0.70, 0.84], soft: 0.22, seed: 3 },
    cumulus: { top: [0.13, 0.36, 0.78], hor: [0.66, 0.80, 0.95], cover: 0.50, cl: [1, 1, 1], sh: [0.55, 0.62, 0.76], soft: 0.16, seed: 11 },
    golden: { top: [0.30, 0.50, 0.82], mid: [0.82, 0.80, 0.78], hor: [1.0, 0.82, 0.55], cover: 0.56, cl: [1.0, 0.92, 0.78], sh: [0.62, 0.55, 0.58], soft: 0.2, seed: 21, sun: [0.7, 0.98, [1, 0.85, 0.55]] },
    sunset: { top: [0.22, 0.24, 0.48], mid: [0.92, 0.50, 0.38], hor: [1.0, 0.72, 0.38], cover: 0.52, cl: [1.0, 0.66, 0.46], sh: [0.40, 0.26, 0.36], soft: 0.18, seed: 7, sun: [0.62, 1.0, [1, 0.7, 0.35]] },
    dramatic: { top: [0.10, 0.13, 0.20], hor: [0.58, 0.60, 0.64], cover: 0.36, cl: [0.86, 0.87, 0.9], sh: [0.18, 0.2, 0.25], soft: 0.12, seed: 5, contrast: 1.4 },
    bluehour: { top: [0.04, 0.08, 0.24], mid: [0.20, 0.22, 0.45], hor: [0.55, 0.45, 0.62], cover: 0.66, cl: [0.55, 0.52, 0.68], sh: [0.12, 0.12, 0.24], soft: 0.22, seed: 13 },
    overcast: { top: [0.52, 0.60, 0.72], hor: [0.80, 0.84, 0.88], cover: 0.28, cl: [0.95, 0.96, 0.97], sh: [0.62, 0.66, 0.72], soft: 0.35, seed: 17 }
  },
  cache: {}, thumbs: {}, pending: {},
  hash(x, y, s) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; },
  vn(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.hash(xi, yi, s), b = this.hash(xi + 1, yi, s), c = this.hash(xi, yi + 1, s), d = this.hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  },
  fbm(x, y, s, o) { let v = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { v += a * this.vn(x * f, y * f, s + i * 31); n += a; f *= 2.07; a *= 0.5; } return v / n; },
  /* 產生天空影像（上＝天頂，下＝地平線），雲層有透視壓縮與受光陰影 */
  gen(key, W, H) {
    const p = this.P[key] || this.P.cumulus; const c = mkCanvas(W, H); const x2 = c.getContext('2d'); const id = x2.createImageData(W, H); const d = id.data;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const oct = W > 400 ? 6 : 4, con = p.contrast || 1;
    for (let j = 0; j < H; j++) {
      const y = j / (H - 1); const py = 1 / (0.12 + (1 - y) * 0.88);
      const g = p.mid ? (y < 0.6 ? lerp(p.top, p.mid, Math.pow(y / 0.6, 1.3)) : lerp(p.mid, p.hor, (y - 0.6) / 0.4)) : lerp(p.top, p.hor, Math.pow(y, 1.6));
      for (let i = 0; i < W; i++) {
        const x = i / (W - 1); const cx = (x - 0.5) * py * 2.6 + 7.3, cy = py * 3.2;
        const wx = this.fbm(cx * 0.6, cy * 0.6, p.seed + 101, 3) - 0.5, wy = this.fbm(cx * 0.6 + 5.2, cy * 0.6, p.seed + 202, 3) - 0.5;
        const n = this.fbm(cx + wx * 1.2, cy + wy * 1.2, p.seed, oct);
        let den = Math.min(1, Math.max(0, (n - p.cover) / p.soft)); den = Math.pow(den, 1 / con) * (1 - Math.pow(y, 6) * 0.7);
        const n2 = this.fbm(cx + wx * 1.2 + 0.06, cy + wy * 1.2 + 0.09, p.seed, Math.min(oct, 4));
        const lit = Math.min(1, Math.max(0, 0.55 + (n - n2) * 9));
        const cc = lerp(p.sh, p.cl, lit);
        let col = lerp(g, cc, den * 0.95);
        if (p.sun) { const dx = x - p.sun[0], dy = (y - p.sun[1]) * 1.6; const r = Math.sqrt(dx * dx + dy * dy); const gl = Math.exp(-r * r / 0.03) * 0.9 + Math.exp(-r / 0.08) * 0.35; col = lerp(col, p.sun[2], Math.min(1, gl) * (1 - den * 0.5)); }
        const k = (j * W + i) * 4; const dith = (this.hash(i, j, 99) - 0.5) / 255;
        d[k] = Math.min(255, (col[0] + dith) * 255); d[k + 1] = Math.min(255, (col[1] + dith) * 255); d[k + 2] = Math.min(255, (col[2] + dith) * 255); d[k + 3] = 255;
      }
    }
    x2.putImageData(id, 0, 0); return c;
  },
  custom() { return CFG.skyCustom || []; },
  async canvasFor(key, big) {
    if (key.startsWith('c:')) {
      const b = await DB.get('files', 'sky:' + key.slice(2)); if (!b) throw new Error('找不到自訂天空');
      const bm = await createImageBitmap(b); const L = big ? 2048 : 200; const s = Math.min(1, L / bm.width);
      const c = mkCanvas(Math.round(bm.width * s), Math.round(bm.height * s)); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, c.width, c.height); bm.close(); return c;
    }
    return big ? this.gen(key, 960, 480) : this.gen(key, 160, 80);
  },
  texSync(key) { return this.cache[key] || null; },
  load(key) {
    if (this.cache[key]) return Promise.resolve(this.cache[key]);
    if (this.pending[key]) return this.pending[key];
    this.pending[key] = (async () => {
      await sleep(10); const c = await this.canvasFor(key, true);
      // 平均色（用於前景融合／補光色調）
      const s = mkCanvas(16, 8); s.getContext('2d').drawImage(c, 0, 0, 16, 8); const px = s.getContext('2d').getImageData(0, 0, 16, 8).data; let r = 0, g = 0, b = 0;
      const sl = (v) => { v /= 255; return v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      for (let i = 0; i < px.length; i += 4) { r += sl(px[i]); g += sl(px[i + 1]); b += sl(px[i + 2]); }
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b || 1; const avg = [r / Y, g / Y, b / Y].map((v) => Math.min(1.6, Math.max(0.6, v)));
      const t = { tex: Engine.uploadImage(null, c, c.width, c.height), avg, gain: 1 };
      this.cache[key] = t; delete this.pending[key]; return t;
    })().catch((e) => { delete this.pending[key]; throw e; });
    return this.pending[key];
  },
  async thumb(key) { if (this.thumbs[key]) return this.thumbs[key]; const c = await this.canvasFor(key, false); this.thumbs[key] = c.toDataURL('image/jpeg', 0.85); return this.thumbs[key]; },
  async importFile(file) {
    const id = uid(); await DB.put('files', file, 'sky:' + id);
    CFG.skyCustom = [...this.custom(), { id, name: (file.name || '我的天空').replace(/\.[^.]+$/, '') }]; saveCfg(); return 'c:' + id;
  },
  async removeCustom(key) { const id = key.slice(2); await DB.del('files', 'sky:' + id).catch(() => {}); CFG.skyCustom = this.custom().filter((x) => x.id !== id); saveCfg(); delete this.cache[key]; delete this.thumbs[key]; }
};

/* ================= AI 智慧增強（場景分析 → 光線、色彩、局部對比、天空） =================
   依亮度分佈、高光溢出比例、色彩飽和度、ISO（雜訊風險）與天空範圍決定各項參數；
   高 ISO 時會節制陰影提亮，並同時壓低黑色，避免把暗部雜訊與色塊拉出來。 */
function aiEnhance(id, o = {}) {
  const d = id.data; const hist = new Uint32Array(256); let n = 0, sat = 0, clip = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]; const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; hist[y | 0]++; n++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); sat += mx ? (mx - mn) / mx : 0; if (mx >= 250) clip++;
  }
  const pct = (p) => { let c = 0; const t = n * p; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= t) return i / 255; } return 1; };
  const p01 = pct(.01), p05 = pct(.05), p25 = pct(.25), p50 = pct(.5), p95 = pct(.95), p99 = pct(.99);
  const iso = o.iso || 100; const isoF = iso >= 6400 ? 0.35 : iso >= 3200 ? 0.5 : iso >= 1600 ? 0.7 : iso >= 800 ? 0.85 : 1;
  const meanSat = sat / n, clipF = clip / n;
  const ev = clamp(Math.log2(s2l(0.40) / Math.max(s2l(p50), 1e-3)) * 0.45, -1, 0.9 * (0.5 + isoF * 0.5));
  const sh = (v) => l2s(clamp(s2l(v) * Math.pow(2, ev), 0, 4));
  const q01 = sh(p01), q05 = sh(p05), q25 = sh(p25), q95 = sh(p95), q99 = sh(p99);
  const shadows = Math.round(clamp((0.24 - q25) * 140, 0, 38) * isoF);
  const r = {
    exposure: Math.round(ev * 100) / 100,
    highlights: -Math.round(clamp((q99 - 0.82) * 230 + clipF * 350, 0, 85)),
    whites: Math.round(clamp((0.95 - q99) * 70, -30, 18)),
    shadows,
    blacks: shadows > 8 ? -Math.round(shadows * 0.4 + (1 - isoF) * 8) : Math.round(clamp((0.025 - q01) * 220, -18, 8)),
    contrast: Math.round(clamp((0.56 - (q95 - q05)) * 38, -8, 18)),
    clarity: Math.round(8 + 10 * isoF),
    texture: Math.round(6 * isoF),
    dehaze: Math.round(clamp((0.5 - (q95 - q05)) * 30, 0, 14)),
    vibrance: Math.round(clamp((0.38 - meanSat) * 70, 6, 28)),
    saturation: Math.round(clamp((0.3 - meanSat) * 15, 0, 5))
  };
  if (o.wb) { r.temp = Math.round(o.wb.temp * 0.6); r.tint = Math.round(o.wb.tint * 0.6); }
  return r;
}
