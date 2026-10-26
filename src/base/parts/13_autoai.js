/* ================= AI 自動功能（在手機上即時完成）：拉正、構圖、風格推薦 ================= */
const AutoAI = {
  /* ---------- 線段偵測（方向限制的霍夫轉換） ---------- */
  segments(id) {
    const { width: W, height: H, data: d } = id; const N = W * H; const L = new Float32Array(N);
    for (let i = 0; i < N; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const B = new Float32Array(N); // 3x3 平滑
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; B[i] = (L[i - W - 1] + 2 * L[i - W] + L[i - W + 1] + 2 * L[i - 1] + 4 * L[i] + 2 * L[i + 1] + L[i + W - 1] + 2 * L[i + W] + L[i + W + 1]) / 16; }
    const gx = new Float32Array(N), gy = new Float32Array(N), mag = new Float32Array(N);
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      gx[i] = B[i - W + 1] + 2 * B[i + 1] + B[i + W + 1] - B[i - W - 1] - 2 * B[i - 1] - B[i + W - 1];
      gy[i] = B[i + W - 1] + 2 * B[i + W] + B[i + W + 1] - B[i - W - 1] - 2 * B[i - W] - B[i - W + 1];
      mag[i] = Math.hypot(gx[i], gy[i]);
    }
    const sorted = Array.from(mag.filter((v, i) => i % 7 === 0)).sort((a, b) => a - b); const thr = Math.max(40, sorted[Math.floor(sorted.length * 0.88)] || 40);
    const TB = 360, D = Math.ceil(Math.hypot(W, H)), acc = new Float32Array(TB * (2 * D + 1));
    const cs = new Float32Array(TB), sn = new Float32Array(TB); for (let t = 0; t < TB; t++) { const a = t * Math.PI / TB; cs[t] = Math.cos(a); sn[t] = Math.sin(a); }
    const pts = [];
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x; if (mag[i] < thr) continue;
      // 法線方向 θ（線的法向量）＝ 梯度方向
      let a = Math.atan2(gy[i], gx[i]); if (a < 0) a += Math.PI; const tc = Math.round(a / Math.PI * TB) % TB;
      const lineDeg = ((a * 180 / Math.PI) + 90) % 180; // 線的方向
      const nearV = Math.abs(lineDeg - 90) < 35, nearH = lineDeg < 25 || lineDeg > 155; if (!nearV && !nearH) continue;
      pts.push(i);
      for (let k = -4; k <= 4; k++) { const t = (tc + k + TB) % TB; const r = Math.round(x * cs[t] + y * sn[t]); acc[t * (2 * D + 1) + r + D] += mag[i] / 255; }
    }
    // 找峰值
    const peaks = []; const minV = Math.min(W, H) * 0.08 * 2;
    for (let t = 0; t < TB; t++) for (let r = 0; r < 2 * D + 1; r++) {
      const v = acc[t * (2 * D + 1) + r]; if (v < minV) continue; let ok = true;
      for (let dt = -4; dt <= 4 && ok; dt++) for (let dr = -6; dr <= 6; dr++) { const tt = (t + dt + TB) % TB, rr = r + dr; if (rr < 0 || rr > 2 * D) continue; if (acc[tt * (2 * D + 1) + rr] > v) { ok = false; break; } }
      if (ok) peaks.push([v, t, r - D]);
    }
    peaks.sort((a, b) => b[0] - a[0]);
    const segs = []; const minLen = Math.min(W, H) * 0.07;
    for (const [, t, r] of peaks.slice(0, 90)) {
      const c = cs[t], s = sn[t]; const dir = [-s, c]; const ts = [];
      for (const i of pts) { const x = i % W, y = (i / W) | 0; if (Math.abs(x * c + y * s - r) > 1.2) continue; let a = Math.atan2(gy[i], gx[i]); if (a < 0) a += Math.PI; const da = Math.abs(a - t * Math.PI / TB); if (Math.min(da, Math.PI - da) > 0.15) continue; ts.push(x * dir[0] + y * dir[1]); }
      if (ts.length < minLen * 0.5) continue; ts.sort((a, b) => a - b);
      let st = ts[0], pv = ts[0];
      const flush = (e) => { if (e - st >= minLen) { const p0 = [r * c + st * dir[0], r * s + st * dir[1]], p1 = [r * c + e * dir[0], r * s + e * dir[1]]; segs.push({ a: [p0[0] / W, p0[1] / H], b: [p1[0] / W, p1[1] / H], len: (e - st) / Math.max(W, H) }); } };
      for (let k = 1; k < ts.length; k++) { if (ts[k] - pv > 8) { flush(pv); st = ts[k]; } pv = ts[k]; } flush(pv);
    }
    return segs;
  },
  /* ---------- AI 拉正：讓垂直線真正垂直、水平線真正水平（旋轉＋垂直／水平透視） ---------- */
  upright(ses, edit, mode) {
    const id = imgData(ses.prev, 900); const segs = this.segments(id);
    if (segs.length < 2) return null;
    const SW = ses.SW, SH = ses.SH;
    const ang = (s) => { const dx = (s.b[0] - s.a[0]) * SW, dy = (s.b[1] - s.a[1]) * SH; let a = Math.atan2(dy, dx) * 180 / Math.PI; if (a < 0) a += 180; return a; };
    const V = segs.filter((s) => Math.abs(ang(s) - 90) < 30), Hs = segs.filter((s) => { const a = ang(s); return a < 20 || a > 160; });
    const base = normEdit(clone(edit)); const full = { ...base.crop, x: 0, y: 0, w: 1, h: 1 };
    const cost = (rot, vert, horiz) => {
      const e = clone(base); e.geo.rot = rot; e.geo.vert = vert; e.geo.horiz = horiz; const G = Engine.geometry(e, SW, SH, full);
      const dev = (s, vertical) => { const p = Engine.srcToOut(G, s.a), q = Engine.srcToOut(G, s.b); const dx = (q[0] - p[0]) * G.OW, dy = (q[1] - p[1]) * G.OH; let a = Math.atan2(dy, dx) * 180 / Math.PI; if (a < 0) a += 180; const d = vertical ? a - 90 : (a > 90 ? a - 180 : a); return Math.min(d * d, 36); };
      let c = 0, w = 0; const wv = mode === 'level' ? 1 : 1.4, wh = mode === 'vertical' ? 0.35 : 1;
      for (const s of V) { c += dev(s, true) * s.len * wv; w += s.len * wv; } for (const s of Hs) { c += dev(s, false) * s.len * wh; w += s.len * wh; }
      const reg = mode === 'auto' ? 0.0009 * (vert * vert + horiz * horiz) : 0;
      return (w ? c / w : 0) + reg;
    };
    const r0 = (base.geo.rot || 0); let best = { rot: r0, vert: 0, horiz: 0, c: cost(r0, 0, 0) };
    for (let r = -10; r <= 10; r += 0.25) { const c = cost(r, 0, 0); if (c < best.c) best = { rot: r, vert: 0, horiz: 0, c }; }
    const useV = mode === 'vertical' || mode === 'full' || mode === 'auto', useH = mode === 'full' || mode === 'auto';
    if (useV || useH) {
      for (const step of [12, 6, 3, 1.5, 0.75, 0.3]) {
        let imp = true, guard = 0;
        while (imp && guard++ < 12) {
          imp = false;
          for (const [k, dv] of [['rot', step / 6], ['rot', -step / 6], ...(useV ? [['vert', step], ['vert', -step]] : []), ...(useH ? [['horiz', step], ['horiz', -step]] : [])]) {
            const t = { ...best }; t[k] = clamp(t[k] + dv, k === 'rot' ? -12 : -70, k === 'rot' ? 12 : 70); const c = cost(t.rot, t.vert, t.horiz); if (c < best.c - 1e-6) { best = { ...t, c }; imp = true; }
          }
        }
      }
      if (mode === 'auto' && V.length < 2) { best.vert = 0; best.horiz = 0; }
    }
    return { rot: Math.round(best.rot * 10) / 10, vert: Math.round(best.vert), horiz: Math.round(best.horiz), nV: V.length, nH: Hs.length, before: cost(r0, base.geo.vert || 0, base.geo.horiz || 0), after: best.c };
  },
  /* ---------- 顯著性（主體在哪裡）：色彩獨特性＋局部對比＋邊緣密度 ---------- */
  saliency(px, W, H) {
    const N = W * H; const Lc = new Float32Array(N), A = new Float32Array(N), Bc = new Float32Array(N);
    let mL = 0, mA = 0, mB = 0;
    for (let i = 0; i < N; i++) { const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255; Lc[i] = 0.299 * r + 0.587 * g + 0.114 * b; A[i] = r - g; Bc[i] = (r + g) / 2 - b; mL += Lc[i]; mA += A[i]; mB += Bc[i]; }
    mL /= N; mA /= N; mB /= N;
    const blur = (src, rad) => { const t = new Float32Array(N), o = new Float32Array(N); for (let y = 0; y < H; y++) { let s = 0; for (let x = -rad; x <= rad; x++) s += src[y * W + clamp(x, 0, W - 1)]; for (let x = 0; x < W; x++) { t[y * W + x] = s / (2 * rad + 1); s += src[y * W + clamp(x + rad + 1, 0, W - 1)] - src[y * W + clamp(x - rad, 0, W - 1)]; } }
      for (let x = 0; x < W; x++) { let s = 0; for (let y = -rad; y <= rad; y++) s += t[clamp(y, 0, H - 1) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = s / (2 * rad + 1); s += t[clamp(y + rad + 1, 0, H - 1) * W + x] - t[clamp(y - rad, 0, H - 1) * W + x]; } } return o; };
    const R = Math.max(3, Math.round(Math.max(W, H) * 0.12)); const bL = blur(Lc, R), bA = blur(A, R), bB = blur(Bc, R);
    const S = new Float32Array(N), E = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; E[i] = Math.abs(Lc[i + 1] - Lc[i - 1]) + Math.abs(Lc[i + W] - Lc[i - W]); }
    const bE = blur(E, Math.max(2, Math.round(R / 3)));
    let mx1 = 1e-6, mx2 = 1e-6;
    for (let i = 0; i < N; i++) { const u = Math.hypot(Lc[i] - mL, (A[i] - mA) * 1.6, (Bc[i] - mB) * 1.6) * 0.5 + Math.hypot(Lc[i] - bL[i], (A[i] - bA[i]) * 1.6, (Bc[i] - bB[i]) * 1.6); S[i] = u; if (u > mx1) mx1 = u; if (bE[i] > mx2) mx2 = bE[i]; }
    for (let i = 0; i < N; i++) S[i] = Math.pow(S[i] / mx1 * 0.65 + bE[i] / mx2 * 0.35, 1.6);
    return blur(S, 2);
  },
  /* ---------- AI 自動構圖：依主體位置找出三分法構圖、不切到主體的最佳裁切 ---------- */
  compose(ses, edit) {
    const e = effective(edit); const fullC = { ...e.crop, x: 0, y: 0, w: 1, h: 1 };
    const r = ses.renderPreview(e, { cropOverride: fullC, long: 220, targetName: 'cmp' });
    const W = r.W, H = r.H; const px = Engine.downsample(r.tex, W, H); const S = this.saliency(px, W, H);
    const G = Engine.geometry(e, ses.SW, ses.SH, fullC); const BW = G.BW, BH = G.BH; const imgAR = (W / H);
    // 積分圖
    const I = new Float64Array((W + 1) * (H + 1)); for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) { s += S[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + s; } }
    const sum = (x0, y0, x1, y1) => I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    const total = sum(0, 0, W, H) || 1;
    let cxs = 0, cys = 0, ws = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = S[y * W + x] ** 2; cxs += x * v; cys += y * v; ws += v; }
    const cx = cxs / ws, cy = cys / ws;
    const ars = [['原比例', imgAR], ['1:1', 1], [imgAR >= 1 ? '3:2' : '2:3', imgAR >= 1 ? 1.5 : 2 / 3], [imgAR >= 1 ? '16:9' : '4:5', imgAR >= 1 ? 16 / 9 : 0.8]];
    const out = [];
    for (const [name, ar] of ars) {
      let best = null;
      for (const sc of [1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.55]) {
        let w = W * sc, hh = w / ar; if (hh > H * sc) { hh = H * sc; w = hh * ar; } if (w > W) { w = W; hh = w / ar; } if (hh > H) { hh = H; w = hh * ar; }
        const sx = Math.max(1, (W - w) / 14), sy = Math.max(1, (H - hh) / 14);
        for (let y0 = 0; y0 <= H - hh + 0.01; y0 += sy) for (let x0 = 0; x0 <= W - w + 0.01; x0 += sx) {
          const X0 = Math.round(x0), Y0 = Math.round(y0), X1 = Math.min(W, Math.round(x0 + w)), Y1 = Math.min(H, Math.round(y0 + hh));
          const cov = sum(X0, Y0, X1, Y1) / total;
          const b = 2; const border = (sum(X0, Y0, X1, Math.min(Y1, Y0 + b)) + sum(X0, Math.max(Y0, Y1 - b), X1, Y1) + sum(X0, Y0, Math.min(X1, X0 + b), Y1) + sum(Math.max(X0, X1 - b), Y0, X1, Y1)) / (2 * b * ((X1 - X0) + (Y1 - Y0))) / (total / (W * H));
          const u = (cx - X0) / (X1 - X0), v = (cy - Y0) / (Y1 - Y0); let dth = 9;
          for (const tx of [1 / 3, 2 / 3, 0.5]) for (const ty of [1 / 3, 2 / 3, 0.5]) { const pen = (tx === 0.5 && ty === 0.5) ? 0.06 : (tx === 0.5 || ty === 0.5) ? 0.03 : 0; dth = Math.min(dth, Math.hypot(u - tx, v - ty) + pen); }
          const inside = u > 0.05 && u < 0.95 && v > 0.05 && v < 0.95 ? 0 : 1;
          const score = Math.pow(cov, 1.4) * 1.0 + (1 - Math.min(1, dth / 0.3)) * 0.55 - Math.min(2, border) * 0.25 + sc * 0.3 - inside;
          if (!best || score > best.score) best = { score, x: X0 / W, y: Y0 / H, w: (X1 - X0) / W, h: (Y1 - Y0) / H };
        }
      }
      if (best) out.push({ name, ratio: name === '原比例' ? 'orig' : name, ...best });
    }
    void BW; void BH;
    return out;
  },
  /* ---------- AI 風格推薦 ---------- */
  STYLES: {
    golden: { name: '黃昏暖調', add: { temp: 22, tint: 6, exposure: 0.05, contrast: 12, highlights: -28, shadows: 12, whites: -5, blacks: -6, vibrance: 22, saturation: 4, dehaze: 8, clarity: 6 }, grade: { sh: [215, 14], mid: [32, 8], hi: [38, 30] }, vig: -14 },
    teal: { name: '電影青橙', add: { contrast: 16, highlights: -20, shadows: 8, saturation: -6, vibrance: 12, fade: 6, clarity: 4 }, grade: { sh: [195, 28], hi: [32, 26] }, vig: -10 },
    vivid: { name: '濃郁風景', add: { contrast: 18, clarity: 16, dehaze: 14, vibrance: 30, saturation: 8, highlights: -35, shadows: 20, texture: 8 }, hslSat: [0, 4, 6, 12, 6, 14, 0, 0] },
    airy: { name: '清新通透', add: { exposure: 0.3, contrast: -6, highlights: -22, shadows: 25, whites: 10, blacks: 4, vibrance: 16, temp: -4, clarity: 4, dehaze: 6 } },
    japan: { name: '日系淡雅', add: { exposure: 0.35, contrast: -16, highlights: -25, shadows: 28, saturation: -18, vibrance: 6, temp: -5, tint: 5, fade: 14 }, grade: { hi: [190, 6] } },
    moody: { name: '藍調冷冽', add: { temp: -14, contrast: 14, highlights: -25, shadows: -5, blacks: -10, saturation: -12, vibrance: 8, clarity: 10, dehaze: 10 }, grade: { sh: [215, 18] }, vig: -18 },
    night: { name: '夜景霓虹', add: { temp: -8, contrast: 14, highlights: -40, shadows: 12, vibrance: 28, dehaze: 10, clarity: 8, blacks: -8 }, grade: { sh: [222, 18], hi: [300, 8] } },
    portrait: { name: '柔美人像', add: { exposure: 0.15, contrast: -8, highlights: -20, shadows: 15, clarity: -10, texture: -12, vibrance: 8, temp: 4 }, grade: { hi: [30, 8] } },
    bw: { name: '經典黑白', add: { contrast: 22, clarity: 14, highlights: -20, shadows: 15, blacks: -8 }, mono: true }
  },
  applyStyle(base, key, amt) {
    const st = this.STYLES[key]; const e = normEdit(clone(base)); const f = amt / 100; if (!st || f <= 0) return e;
    for (const k in st.add) { const v = (e[k] || 0) + st.add[k] * f; e[k] = k === 'exposure' ? Math.round(v * 100) / 100 : Math.round(v); }
    if (st.grade) for (const z in st.grade) { const [hue, sat] = st.grade[z]; if (!e.grade[z].s || e.grade[z].s < sat * f) { e.grade[z].h = hue; e.grade[z].s = Math.round(sat * f); } }
    if (st.vig) e.vig.amt = Math.round((e.vig.amt || 0) + st.vig * f);
    if (st.hslSat) e.hsl.sat = e.hsl.sat.map((v, i) => Math.round(v + st.hslSat[i] * f));
    if (st.mono) e.mono = f >= 0.5;
    return e;
  },
  /* 分析場景 → 依「灰平、昏暗、夜景、人像、風景、天空過曝…」排序推薦 */
  analyze(ses, rec) {
    const id = imgData(ses.prev, 256); const d = id.data; const n = d.length / 4; let L = 0, S = 0, warm = 0, green = 0, blue = 0, skin = 0, bright = 0; const hist = new Uint32Array(64);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const y = 0.299 * r + 0.587 * g + 0.114 * b;
      L += y; S += mx ? (mx - mn) / mx : 0; hist[Math.min(63, (y * 64) | 0)]++; if (y > 0.92) bright++;
      if (r > b + 0.06) warm++; if (g > r + 0.03 && g > b) green++; if (b > r + 0.06 && b >= g - 0.02) blue++;
      if (r > 0.35 && r > g && g > b && r - b > 0.12 && r - g < 0.25 && (mx - mn) / mx < 0.6) skin++;
    }
    const pct = (p) => { let c = 0; for (let i = 0; i < 64; i++) { c += hist[i]; if (c >= n * p) return i / 63; } return 1; };
    ses.ensureSky();
    const a = { mean: L / n, sat: S / n, spread: pct(0.95) - pct(0.05), warm: warm / n, green: green / n, blue: blue / n, skin: skin / n, bright: bright / n, sky: ses.skyFrac || 0, iso: (rec.exif || {}).iso || 100 };
    const sc = {}; const why = {};
    const add = (k, v, w) => { sc[k] = (sc[k] || 0) + v; if (w && v > 0.4) why[k] = w; };
    const flat = a.spread < 0.55, dull = a.sat < 0.22, night = a.mean < 0.22, portrait = a.skin > 0.05, land = a.green > 0.15 || a.sky > 0.12;
    add('golden', 1 + (flat ? 1.2 : 0) + (dull ? 0.8 : 0) + (a.sky > 0.1 ? 0.6 : 0) - (night ? 1 : 0) - (a.warm > 0.6 ? 0.6 : 0), flat || dull ? '畫面灰平、色彩淡 → 加入黃昏暖光與對比' : '');
    add('vivid', 0.8 + (land ? 1.3 : 0) + (dull ? 0.6 : 0) - (portrait ? 0.8 : 0), land ? '偵測到綠地／天空 → 讓風景色彩飽滿通透' : '');
    add('teal', 0.9 + (a.warm > 0.35 ? 0.6 : 0) + (flat ? 0.4 : 0) + (portrait ? 0.3 : 0), '電影感青橙對比，主體跳出來');
    add('airy', 0.7 + (a.mean < 0.45 && !night ? 0.6 : 0) + (portrait ? 0.5 : 0) - (night ? 1 : 0), a.mean < 0.45 ? '整體偏暗 → 提亮成明亮清新的感覺' : '');
    add('japan', 0.5 + (portrait ? 0.6 : 0) + (a.mean > 0.45 ? 0.4 : 0) - (night ? 1 : 0), portrait ? '人像適合柔和淡雅色調' : '');
    add('moody', 0.5 + (a.blue > 0.25 ? 0.6 : 0) + (a.mean < 0.35 ? 0.4 : 0), a.blue > 0.25 ? '藍色調多 → 冷冽氛圍' : '');
    add('night', (night ? 2.5 : -1) + (a.bright > 0.01 ? 0.4 : 0), night ? '夜景 → 強化燈光與夜色' : '');
    add('portrait', portrait ? 1.8 : -0.5, portrait ? '偵測到人像膚色 → 柔和膚色、降低紋理' : '');
    add('bw', 0.35 + (dull ? 0.4 : 0) + (a.spread > 0.7 ? 0.3 : 0), dull ? '色彩不突出 → 黑白更有質感' : '');
    const order = Object.keys(sc).sort((x, y) => sc[y] - sc[x]);
    return { a, order, why, skyGold: (a.sky > 0.06 && (flat || a.bright > 0.04)) };
  }
};
