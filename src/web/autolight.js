/* ================= AI 自動光線（v1.13，閉迴路） =================
   舊版只看「原始預覽」的直方圖估一次參數；曝光不準（過曝、太暗、大逆光）時常估錯。
   現在改成像修圖師一樣邊調邊看：每一步都用修圖引擎實際算出小圖，量測結果再修正，最多 10 輪：
   ① 主體亮度（中央加權的中間調）拉到目標 ② 亮部：高光不死白（天空、雲、霧保留層次）
   ③ 陰影：暗部提亮到看得見細節（依 ISO 控制，避免拉出雜訊）④ 白色／黑色：補回完整的明暗範圍
   ⑤ 色彩（光線＋色彩）：只用畫面裡「接近中性」的地方判斷色偏，夕陽、晨光這類刻意的暖色不會被洗掉 */
const AutoLight = {
  TONE: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  stats(cv) {
    const W = cv.width, H = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const hist = new Float64Array(1024), histC = new Float64Array(1024); let n = 0, nc = 0, clip = 0, sat = 0, lg = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2], L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const k = Math.min(1023, (L * 1023) | 0); hist[k]++; n++; lg += Math.log(s2l(L) + 0.004);
      const dx = (x / W - 0.5) / 0.5, dy = (y / H - 0.55) / 0.5, wc = Math.max(0, 1 - (dx * dx + dy * dy) * 0.7); histC[k] += wc; nc += wc;   // 中央加權（主體多半在中間偏下）
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx >= 245) clip++;   // RAW 感光元件飽和處畫成約 249（不是 255），也算過曝 sat += mx ? (mx - mn) / mx : 0;
    }
    const P = (hh, tot, p) => { let c = 0; const t = tot * p; for (let i = 0; i < 1024; i++) { c += hh[i]; if (c >= t) return i / 1023; } return 1; };
    const q = (p) => P(hist, n, p);
    return { p005: q(0.005), p02: q(0.02), p05: q(0.05), p10: q(0.10), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p95: q(0.95), p99: q(0.99), p995: q(0.995), q, c50: P(histC, nc, 0.5), clip: clip / n, sat: sat / n, lav: l2s(Math.max(0, Math.exp(lg / n) - 0.004)) };
  },
  render(ses, e) { return ses.renderThumb(effective(e), 256); },
  /* 回傳調好的六個光線參數（絕對值） */
  solve(ses, edit, o = {}) {
    const iso = o.iso || 100, isoF = iso >= 6400 ? 0.45 : iso >= 3200 ? 0.6 : iso >= 1600 ? 0.78 : iso >= 800 ? 0.9 : 1;
    const e = normEdit(clone(edit)); for (const k of this.TONE) e[k] = o.keep ? e[k] : 0;
    const s0 = this.stats(this.render(ses, e));
    // 場景判斷：霧／雪／高調（整體亮而且層次少）保留明亮；夜景／低調保留暗；其餘把主體拉到中間調
    const spread = s0.p95 - s0.p05, highKey = s0.p50 > 0.58 && spread < 0.45, night = s0.p50 < 0.1 && s0.p99 > 0.6;
    const subj = 0.6 * s0.c50 + 0.4 * s0.p50;
    const tm = highKey ? Math.max(0.6, Math.min(0.72, subj)) : night ? clamp(subj * 1.6, 0.16, 0.3) : 0.45;
    const shT = (night ? 0.05 : 0.10) * (0.6 + 0.4 * isoF), hiT = highKey ? 0.965 : 0.94;
    let s = s0, it = 0; const R = () => { it++; return (s = this.stats(this.render(ses, e))); };
    // 大光比（逆光、強烈明暗）：中間調用對數平均判斷，曝光只小幅移動，主要交給亮部／陰影處理（和 Lightroom 一樣）
    const hdr = s0.p95 - s0.p05 > 0.7 || (s0.p75 - s0.p25 > 0.5);
    const mid = (x) => hdr ? x.lav : 0.5 * x.p50 + 0.5 * x.c50, tmE = hdr ? 0.36 : tm, evLim = hdr ? 0.5 : 3;
    // ① 曝光：只用曝光把中間調（整體＋中央主體）帶到目標；同時限制：最亮處若已大面積死白就不再加亮
    for (let k = 0; k < 4; k++) {
      let dEv = clamp(Math.log2(s2l(tmE) / Math.max(s2l(mid(s)), 1e-4)) * 0.9, -1.2, 1.2);
      if (dEv > 0 && s.clip > 0.12) dEv *= 0.4;
      if (dEv < 0 && s.p10 < shT) dEv = Math.max(dEv, hdr ? 0 : -0.25);   // 暗部已經太暗：不再整體壓暗（亮部交給「亮部」處理）
      if (Math.abs(dEv) < 0.04) break; e.exposure = clamp(Math.round((e.exposure + dEv) * 100) / 100, -evLim, evLim); R();
    }
    const ev0 = e.exposure;
    // ② 亮部：最亮 1% 不超過門檻、死白面積壓到 0.3% 以下（天空、雲、霧找回層次）
    // RAW 裡已經完全過曝（三色都到感光元件上限）的區域沒有資料可救，不拿它來判斷，以免為了它把其他亮部全部壓灰
    const cb = Math.min(0.2, s0.clip), pH = Math.max(0.5, 0.99 - cb);
    for (let k = 0; k < 4; k++) {
      const over = Math.max(0, s.q(pH) - hiT) * 300 + Math.max(0, s.clip - cb - 0.003) * 3500; if (over < 2 || e.highlights <= -100) break;
      e.highlights = Math.round(clamp(e.highlights - over, -100, 0)); R();
    }
    // ③ 陰影：最暗 10% 要看得見細節（依 ISO 節制）
    const s25T = (hdr ? 0.22 : 0.17) * (0.7 + 0.3 * isoF);
    for (let k = 0; k < 5; k++) {
      const add = Math.max((shT - s.p10) * 450, (s25T - s.p25) * 300); if (add < 2 || e.shadows >= 100 * isoF) break;
      e.shadows = Math.round(clamp(e.shadows + add, 0, 100 * isoF)); R();
    }
    // ④ 曝光微調（亮部、陰影調整後中間調若偏離太多），幅度限制在 ±0.3 EV 內，不和陰影互相抵消
    { let dEv = clamp(Math.log2(s2l(tmE) / Math.max(s2l(mid(s)), 1e-4)) * 0.5, -0.3, 0.3); if (hdr || s.p10 < shT * 0.9) dEv = Math.max(dEv, 0); if (Math.abs(dEv) > 0.05) { e.exposure = clamp(Math.round((ev0 + dEv) * 100) / 100, -evLim - 0.3, evLim + 0.3); R(); } }
    // ⑤ 白色／黑色：補足明暗範圍；霧、逆光柔光場景黑色不壓太重
    const wT = highKey ? 0.985 : 0.965;
    if (s.clip < 0.004 + cb && s.q(Math.max(0.5, 0.995 - cb)) < wT - 0.02 && cb < 0.004) e.whites = Math.round(clamp((wT - s.p995) * 110, 0, 35));
    else if (s.clip > cb + 0.008) e.whites = Math.round(clamp(-(s.clip - cb - 0.004) * 2500, -40, 0));
    const hazy = s.p02 > 0.12 && !night, bT = night ? 0.012 : 0.022;
    e.blacks = Math.round(clamp((bT - s.p005) * 260, hazy ? -22 : -40, 12));
    R();
    // 對比：拉陰影壓亮部後若太平，補一點中間調對比（不影響已救回的兩端）
    const spr = s.p75 - s.p25; if (!highKey && spr < 0.22) e.contrast = clamp(Math.round((0.22 - spr) * 120), 0, 18);
    const out = {}; for (const k of this.TONE) out[k] = e[k];
    out._info = { scene: highKey ? '高調' : night ? '夜景' : hdr ? '大光比' : '一般', it, before: s0, after: s };
    return out;
  },
  /* v1.19：大光比／過曝或過暗的照片 → 全域只做溫和的曝光，亮部、暗部交給兩個 AI 分區遮色片各自處理 */
  solveZones(ses, edit, o = {}) {
    const iso = o.iso || 100, isoF = iso >= 6400 ? 0.45 : iso >= 3200 ? 0.6 : iso >= 1600 ? 0.78 : iso >= 800 ? 0.9 : 1;
    const e = normEdit(clone(edit)); for (const k of this.TONE) e[k] = 0; e.masks = (e.masks || []).filter((m) => !m.aiZone);
    let s = this.stats(this.render(ses, e));
    // 全域曝光：以對數平均（整體觀感）為準，小幅移動
    for (let k = 0; k < 3; k++) { let d = clamp(Math.log2(s2l(0.4) / Math.max(s2l(s.lav), 1e-4)) * 0.6, -0.8, 0.8); if (d > 0 && s.clip > 0.08) d *= 0.3; if (Math.abs(d) < 0.05) break; e.exposure = clamp(Math.round((e.exposure + d) * 100) / 100, -1.5, 1.5); s = this.stats(this.render(ses, e)); }
    // 大部分的壓亮／提暗交給「亮部／陰影」（不會有光暈），分區只做細部
    s = this.stats(this.render(ses, e));
    e.shadows = Math.round(clamp((0.2 - s.p25) * 260, 0, 45) * isoF + 10); e.highlights = -Math.round(clamp((s.p95 - 0.85) * 400, 15, 60));
    const z = this.zones(ses, e, { isoF });
    const out = {}; for (const k of this.TONE) out[k] = e[k];
    out._masks = e.masks.filter((m) => m.aiZone); out._extra = { clarity: e.clarity, dehaze: e.dehaze };
    out._info = { scene: '大光比（亮暗分區）', it: 0, before: s, after: z.after, zones: z };
    return out;
  },
  /* 需不需要分區：亮的地方和暗的地方都有一定面積、而且差很多 */
  needZones(ses, edit) {
    const e = normEdit(clone(edit)); for (const k of this.TONE) e[k] = 0; e.masks = [];
    const s = this.stats(this.render(ses, e));
    this.lastNeed = s;
    return (s.p95 - s.p05 > 0.55 && s.p90 > 0.55) || (s.p75 - s.p25 > 0.4) || s.clip > 0.01 || (s.p10 < 0.06 && s.p95 > 0.7);
  },
  /* ================= v1.19：AI 分區光線（大光比：亮部、暗部分開調） =================
     Lightroom 的做法：先用一個「邊緣保留」的平滑亮度把畫面分成「亮區」（天空、雲、窗外）與「暗區」（逆光的人、樹蔭、室內），
     兩區各自用遮色片調曝光／對比／清晰度／彩度，最後再把整張的黑點、白點、清晰度補回來 → 暗部提亮不發灰、亮部壓得下來顏色也正常。
     兩個遮色片都會留在「遮色片」裡，名稱為「AI 亮部區」「AI 暗部區」，可以再手動微調。 */
  baseMap(ses, e) {
    const b = normEdit(clone(e)); for (const k of this.TONE) b[k] = 0; b.masks = []; b.clarity = 0; b.dehaze = 0;
    const cv = this.render(ses, b), W = cv.width, H = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const L = new Float32Array(W * H); for (let i = 0; i < W * H; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    const sg = Math.max(W, H) * 0.009, r = Math.ceil(sg * 3), k = []; let ks = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * sg * sg)); k.push(v); ks += v; }
    const T = new Float32Array(W * H), B = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -r; i <= r; i++) a += L[y * W + Math.min(W - 1, Math.max(0, x + i))] * k[i + r]; T[y * W + x] = a / ks; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -r; i <= r; i++) a += T[Math.min(H - 1, Math.max(0, y + i)) * W + x] * k[i + r]; const lb = a / ks, dd = L[y * W + x] - lb; B[y * W + x] = lb + dd * (1 - Math.exp(-dd * dd / 0.004)); }
    return { B, L, W, H };
  },
  zw(z, p, px) { const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }; const lo = p.lo / 100, hi = p.hi / 100, sm = Math.max(p.sm / 100, 0.002); let w = ss(lo - sm, lo + sm * 0.25, z) * (1 - ss(hi - sm * 0.25, hi + sm, z)); if (px != null) { if (lo > 0.01) w *= ss(lo - 0.3, lo, px); if (hi < 0.99) w *= 1 - ss(hi, hi + 0.3, px); } return w; },
  wstats(cv, w) {   // 加權統計（只看某一區）
    const W = cv.width, H = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data, hist = new Float64Array(256); let n = 0, sat = 0;
    for (let i = 0; i < W * H; i++) { const q = w[i]; if (q < 0.02) continue; const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; hist[Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b))] += q; n += q; const mx = Math.max(r, g, b); sat += q * (mx ? (mx - Math.min(r, g, b)) / mx : 0); }
    const P = (p) => { let c = 0; const t = n * p; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= t) return i / 255; } return 1; };
    return { n, p05: P(0.05), p10: P(0.1), p25: P(0.25), p50: P(0.5), p75: P(0.75), p95: P(0.95), p99: P(0.99), sat: n ? sat / n : 0 };
  },
  zones(ses, e, o = {}) {
    const isoF = o.isoF || 1, M = this.baseMap(ses, e), N = M.B.length;
    // 用 Otsu 找出亮、暗兩群的分界
    const hist = new Float64Array(256); for (const v of M.B) hist[Math.min(255, Math.max(0, Math.round(v * 255)))]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i]; let wB = 0, sB = 0, best = -1, th = 128;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = N - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = t; } }
    const t = Math.min(0.72, Math.max(0.3, th / 255));
    const pH = { lo: Math.round((t + 0.05) * 100), hi: 100, sm: 12 }, pS = { lo: 0, hi: Math.round((t - 0.05) * 100), sm: 12 };
    const wH = new Float32Array(N), wS = new Float32Array(N); let fH = 0, fS = 0;
    for (let i = 0; i < N; i++) { wH[i] = this.zw(M.B[i], pH, M.L[i]); wS[i] = this.zw(M.B[i], pS, M.L[i]); fH += wH[i]; fS += wS[i]; }
    fH /= N; fS /= N;
    const mk = (name, p) => ({ id: uid(), type: 'zone', aiZone: true, name, invert: false, amt: 100, on: true, p, adj: clone(DEF_MASK_ADJ) });
    const mS = fS > 0.04 ? mk('AI 暗部區', pS) : null, mH = fH > 0.04 ? mk('AI 亮部區', pH) : null;
    e.masks = (e.masks || []).filter((m) => !m.aiZone).concat([mS, mH].filter(Boolean));
    const st = () => { const cv = this.render(ses, e); return { all: this.stats(cv), S: mS ? this.wstats(cv, wS) : null, H: mH ? this.wstats(cv, wH) : null }; };
    const ev = (to, from) => Math.log2(s2l(to) / Math.max(s2l(from), 1e-4));
    let s = st();
    for (let k = 0; k < 4; k++) {
      let moved = false;
      if (mS) {   // 暗區：主體拉到看得清楚，但仍比亮區暗（保留光線方向感）
        const tgt = Math.max(0.16, Math.min(0.3, (s.H ? s.H.p50 : 0.8) - 0.22)); let d = Math.max(-0.5, Math.min(0.6, ev(tgt, s.S.p50) * 0.8)); if (d < 0 && s.S.p50 < 0.42) d = 0;   // 暗區只會提亮（除非本來就很亮）
        if (Math.abs(d) > 0.06) { mS.adj.exposure = Math.max(-0.6, Math.min(0.6 + 0.4 * isoF, Math.round((mS.adj.exposure + d) * 100) / 100)); moved = true; }
      }
      if (mH) {   // 亮區：天空、雲找回層次（最亮 5% 不超過 0.93，中間調不要太灰）
        const d = s.H.p95 > 0.93 ? ev(0.93, s.H.p95) : s.H.p50 < 0.5 ? Math.min(0.3, ev(0.55, s.H.p50) * 0.4) : 0;   // 亮區主要是壓暗
        if (Math.abs(d) > 0.06) { mH.adj.exposure = Math.max(-1, Math.min(0.4, Math.round((mH.adj.exposure + d * 0.9) * 100) / 100)); moved = true; }
      }
      if (!moved) break; s = st();
    }
    // 各區的層次與色彩：提亮越多 → 補越多對比、清晰度與彩度（避免發灰）
    if (mS) { const lift = Math.max(0, mS.adj.exposure); Object.assign(mS.adj, { contrast: Math.round(10 + lift * 8), clarity: Math.round(Math.min(25, 12 + lift * 10) * (0.6 + 0.4 * isoF)), saturation: Math.round(Math.min(10, 2 + lift * 6)) }); }
    if (mH) { const pull = Math.max(0, -mH.adj.exposure), flat = s.H.p75 - s.H.p25 < 0.12; Object.assign(mH.adj, { contrast: Math.round(10 + pull * 8 + (flat ? 8 : 0)), dehaze: Math.round(Math.min(30, 6 + pull * 10 + (flat ? 8 : 0))), highlights: -Math.round(Math.min(50, 20 + pull * 15)), saturation: Math.round(Math.min(10, 4 + pull * 4)) }); }
    s = st();
    // 整張：黑點、白點（「通透感」的來源）
    for (let k = 0; k < 3; k++) {
      const db = (0.025 - s.all.p005) * 300, dw = s.all.clip < 0.01 ? (0.965 - s.all.p995) * 120 : -(s.all.clip - 0.006) * 1500;
      let moved = false;
      if (Math.abs(db) > 2) { e.blacks = Math.round(clamp(e.blacks + db, -45, 10)); moved = true; }
      if (Math.abs(dw) > 2) { e.whites = Math.round(clamp(e.whites + dw, -40, 30)); moved = true; }
      if (!moved) break; s = st();
    }
    e.clarity = Math.max(e.clarity || 0, Math.round(10 * (0.6 + 0.4 * isoF)));
    const hazy = s.all.p02 > 0.08 && s.all.p50 > 0.35; if (hazy) e.dehaze = Math.max(e.dehaze || 0, 8);
    s = st();
    return { t, fS, fH, after: s.all };
  },
  /* 色彩：用接近中性灰的像素估計色偏（暖色夕陽、晨光不算色偏） */
  wb(ses, edit) {
    const e = normEdit(clone(edit)); const cv = this.render(ses, e), W = cv.width, H = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    let r = 0, g = 0, b = 0, n = 0, warmHi = 0, hiN = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = s2l(d[i] / 255), G = s2l(d[i + 1] / 255), B = s2l(d[i + 2] / 255), mx = Math.max(R, G, B), mn = Math.min(R, G, B), Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      if (Y > 0.35) { hiN++; if (R > B * 1.35) warmHi++; }
      if (mx > 0.9 || Y < 0.03 || (mx - mn) / mx > 0.16) continue;   // 只用真正接近中性灰的地方（樹葉、草地不算）
      r += R; g += G; b += B; n++;
    }
    const N = d.length / 4; if (n < N * 0.03) return { temp: edit.temp, tint: edit.tint, note: '畫面中可判斷的中性色太少，保留原本白平衡' };
    r /= n; g /= n; b /= n;
    let t = Math.log(b / r) / 0.72 * 100 * 0.85, m = Math.log(g / Math.sqrt(r * b)) / 0.24 * 100 * 0.8;
    const golden = hiN > N * 0.05 && warmHi > hiN * 0.5;     // 大面積暖色亮部：夕陽、晨光、燈光氛圍 → 不往冷色拉
    if (golden && t < 0) t *= 0.15;
    t *= 0.6; m *= 0.4;                                    // 只修正一部分，保留現場氣氛（色調更保守）
    if (Math.abs(t) < 5) t = 0; if (Math.abs(m) < 5) m = 0;
    return { temp: clamp(Math.round(edit.temp + t), -100, 100), tint: clamp(Math.round(edit.tint + m), -100, 100), note: golden ? '偵測到暖色光線，保留氛圍' : '' };
  }
};
