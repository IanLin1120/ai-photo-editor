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
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx >= 251) clip++; sat += mx ? (mx - mn) / mx : 0;
    }
    const P = (hh, tot, p) => { let c = 0; const t = tot * p; for (let i = 0; i < 1024; i++) { c += hh[i]; if (c >= t) return i / 1023; } return 1; };
    const q = (p) => P(hist, n, p);
    return { p005: q(0.005), p02: q(0.02), p05: q(0.05), p10: q(0.10), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99), p995: q(0.995), c50: P(histC, nc, 0.5), clip: clip / n, sat: sat / n, lav: l2s(Math.max(0, Math.exp(lg / n) - 0.004)) };
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
    for (let k = 0; k < 4; k++) {
      const over = Math.max(0, s.p99 - hiT) * 300 + Math.max(0, s.clip - 0.003) * 3500; if (over < 2 || e.highlights <= -100) break;
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
    if (s.clip < 0.004 && s.p995 < wT - 0.02) e.whites = Math.round(clamp((wT - s.p995) * 110, 0, 35));
    else if (s.clip > 0.008) e.whites = Math.round(clamp(-(s.clip - 0.004) * 2500, -40, 0));
    const hazy = s.p02 > 0.12 && !night, bT = night ? 0.012 : 0.022;
    e.blacks = Math.round(clamp((bT - s.p005) * 260, hazy ? -22 : -40, 12));
    R();
    // 對比：拉陰影壓亮部後若太平，補一點中間調對比（不影響已救回的兩端）
    const spr = s.p75 - s.p25; if (!highKey && spr < 0.22) e.contrast = clamp(Math.round((0.22 - spr) * 120), 0, 18);
    const out = {}; for (const k of this.TONE) out[k] = e[k];
    out._info = { scene: highKey ? '高調' : night ? '夜景' : hdr ? '大光比' : '一般', it, before: s0, after: s };
    return out;
  },
  /* 色彩：用接近中性灰的像素估計色偏（暖色夕陽、晨光不算色偏） */
  wb(ses, edit) {
    const e = normEdit(clone(edit)); const cv = this.render(ses, e), W = cv.width, H = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    let r = 0, g = 0, b = 0, n = 0, warmHi = 0, hiN = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = s2l(d[i] / 255), G = s2l(d[i + 1] / 255), B = s2l(d[i + 2] / 255), mx = Math.max(R, G, B), mn = Math.min(R, G, B), Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      if (Y > 0.35) { hiN++; if (R > B * 1.35) warmHi++; }
      if (mx > 0.95 || Y < 0.03 || (mx - mn) / mx > 0.28) continue;
      r += R; g += G; b += B; n++;
    }
    const N = d.length / 4; if (n < N * 0.03) return { temp: edit.temp, tint: edit.tint, note: '畫面中可判斷的中性色太少，保留原本白平衡' };
    r /= n; g /= n; b /= n;
    let t = Math.log(b / r) / 0.72 * 100 * 0.85, m = Math.log(g / Math.sqrt(r * b)) / 0.24 * 100 * 0.8;
    const golden = hiN > N * 0.05 && warmHi > hiN * 0.5;     // 大面積暖色亮部：夕陽、晨光、燈光氛圍 → 不往冷色拉
    if (golden && t < 0) t *= 0.15;
    t *= 0.6; m *= 0.6;                                    // 只修正 60%，保留現場氣氛
    if (Math.abs(t) < 4) t = 0; if (Math.abs(m) < 3) m = 0;
    return { temp: clamp(Math.round(edit.temp + t), -100, 100), tint: clamp(Math.round(edit.tint + m), -100, 100), note: golden ? '偵測到暖色光線，保留氛圍' : '' };
  }
};
