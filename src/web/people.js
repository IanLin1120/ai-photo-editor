/* ================= v1.17：在手機上偵測人物（YOLO11 實例分割，ONNX Runtime Web） =================
   第一次使用時從 GitHub Pages 下載模型（約 21 MB）與推論引擎（約 11 MB），存在手機裡，之後完全離線、數秒完成。
   回傳每個人：box（正規化 x0,y0,x1,y1）、polys（沿輪廓的多邊形，正規化座標）、score */
const People = {
  VER: 'y11s-1',
  FILES: { wasm: 'models/ort-wasm-simd-threaded.wasm', model: 'models/yolo11s-seg-w16.onnx' },
  url(f) { return (window.PEOPLE_BASE || GH.pages) + f; },
  async bin(key, url, onp) {
    const k = `bin:${this.VER}:${key}`; const c = await DB.get('ai', k).catch(() => null); if (c) return c instanceof Blob ? new Uint8Array(await c.arrayBuffer()) : c;
    const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('下載失敗 HTTP ' + r.status);
    const tot = +r.headers.get('content-length') || 0, rd = r.body.getReader(), parts = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onp && onp(n, tot); }
    const b = new Uint8Array(n); let o = 0; for (const p of parts) { b.set(p, o); o += p.length; }
    await DB.put('ai', new Blob([b]), k).catch((e) => console.warn('cache', e));
    return b;
  },
  async ready() { for (const k of Object.keys(this.FILES)) if (!(await DB.get('ai', `bin:${this.VER}:${k}`).catch(() => null))) return false; return true; },
  async session(onp) {
    if (this.ses) return this.ses;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const prog = { wasm: [0, 11.2e6], model: [0, 20.9e6] }; const tell = () => { const a = prog.wasm[0] + prog.model[0], b = prog.wasm[1] + prog.model[1]; onp && onp(`下載 AI 人物偵測模型 ${(a / 1048576).toFixed(1)} / ${(b / 1048576).toFixed(0)} MB（只需一次）`, a / b); };
      const [w, m] = await Promise.all(['wasm', 'model'].map((k) => this.bin(k, this.url(this.FILES[k]), (n, t) => { prog[k] = [n, t || prog[k][1]]; tell(); })));
      onp && onp('啟動 AI 人物偵測…', 1);
      const ort = window.ort; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
      ort.env.wasm.wasmBinary = w.buffer.byteLength === w.length ? w.buffer : w.slice().buffer;
      ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([ORT_MJS], { type: 'text/javascript' })) };
      const s = await ort.InferenceSession.create(m, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      this.ses = s; return s;
    })();
    try { return await this.loading; } finally { this.loading = null; }
  },
  /* img：已轉正的影像（ImageBitmap／canvas），long：推論長邊 */
  async detect(img, onp, long = 960) {
    const s = await this.session(onp); onp && onp('AI 偵測人物中…', 1);
    const W = img.width, H = img.height, sc = long / Math.max(W, H);
    const rw = Math.max(32, Math.round(W * sc / 32) * 32), rh = Math.max(32, Math.round(H * sc / 32) * 32);
    const c = mkCanvas(rw, rh), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, rw, rh);
    const d = x.getImageData(0, 0, rw, rh).data, N = rw * rh, inp = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) { inp[i] = d[i * 4] / 255; inp[N + i] = d[i * 4 + 1] / 255; inp[2 * N + i] = d[i * 4 + 2] / 255; }
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const out = await s.run({ [s.inputNames[0]]: new window.ort.Tensor('float32', inp, [1, 3, rh, rw]) });
    const o0 = out[s.outputNames[0]], o1 = out[s.outputNames[1]]; this.lastMs = performance.now() - t0;
    const P = o0.data, A = o0.dims[2], C = o0.dims[1], nm = C - 84, pr = o1.data, ph = o1.dims[2], pw = o1.dims[3];
    // 人（COCO 類別 0）
    let cand = [];
    for (let i = 0; i < A; i++) { const sc0 = P[4 * A + i]; if (sc0 < 0.25) continue; const cx = P[i], cy = P[A + i], bw = P[2 * A + i], bh = P[3 * A + i]; cand.push({ i, s: sc0, b: [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2] }); }
    cand.sort((a, b) => b.s - a.s);
    const iou = (a, b) => { const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])), I = ix * iy; return I / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - I + 1e-9); };
    const keep = []; for (const q of cand) { if (keep.every((k) => iou(k.b, q.b) < 0.5)) keep.push(q); if (keep.length >= 60) break; }
    const res = [];
    for (const q of keep) {
      const co = new Float32Array(nm); for (let k = 0; k < nm; k++) co[k] = P[(84 + k) * A + q.i];
      // 遮罩：在框內以 2 倍 proto 解析度雙線性內插 logits → 二值 → 描輪廓
      const f = pw / rw, S = 2;
      const bx0 = Math.max(0, Math.floor(q.b[0] * f) - 1), by0 = Math.max(0, Math.floor(q.b[1] * f) - 1), bx1 = Math.min(pw - 1, Math.ceil(q.b[2] * f) + 1), by1 = Math.min(ph - 1, Math.ceil(q.b[3] * f) + 1);
      const gw = bx1 - bx0 + 1, gh = by1 - by0 + 1; if (gw < 2 || gh < 2) continue;
      const lg = new Float32Array(gw * gh);
      for (let yy = 0; yy < gh; yy++) for (let xx = 0; xx < gw; xx++) { let v = 0; const o = (by0 + yy) * pw + bx0 + xx; for (let k = 0; k < nm; k++) v += co[k] * pr[k * ph * pw + o]; lg[yy * gw + xx] = v; }
      const mw = gw * S, mh = gh * S, M = new Uint8Array((mw + 2) * (mh + 2));
      const X0 = q.b[0] * f, Y0 = q.b[1] * f, X1 = q.b[2] * f, Y1 = q.b[3] * f;
      let area = 0;
      for (let yy = 0; yy < mh; yy++) for (let xx = 0; xx < mw; xx++) {
        const gx = (xx + 0.5) / S - 0.5, gy = (yy + 0.5) / S - 0.5, px = bx0 + gx + 0.5, py = by0 + gy + 0.5;
        if (px < X0 || px > X1 || py < Y0 || py > Y1) continue;
        const ix = Math.max(0, Math.min(gw - 2, Math.floor(gx))), iy = Math.max(0, Math.min(gh - 2, Math.floor(gy))), tx = Math.max(0, Math.min(1, gx - ix)), ty = Math.max(0, Math.min(1, gy - iy));
        const v = (lg[iy * gw + ix] * (1 - tx) + lg[iy * gw + ix + 1] * tx) * (1 - ty) + (lg[(iy + 1) * gw + ix] * (1 - tx) + lg[(iy + 1) * gw + ix + 1] * tx) * ty;
        if (v > 0) { M[(yy + 1) * (mw + 2) + xx + 1] = 1; area++; }
      }
      if (area < 6) continue;
      const toN = (p) => [(bx0 + (p[0] - 1) / S) / pw, (by0 + (p[1] - 1) / S) / ph];
      const polys = this.contours(M, mw + 2, mh + 2, area).map((pl) => this.simplify(pl, 0.7).map(toN)).filter((pl) => pl.length >= 3);
      if (!polys.length) continue;
      res.push({ box: [q.b[0] / rw, q.b[1] / rh, q.b[2] / rw, q.b[3] / rh].map((v) => Math.max(0, Math.min(1, v))), polys, score: Math.round(q.s * 1000) / 1000 });
    }
    const ar = (p) => (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]);
    res.sort((a, b) => ar(b) - ar(a));
    return res;
  },
  /* 外輪廓（Moore 鄰域追蹤）：每個連通區塊一條；太小的碎塊略過 */
  contours(M, w, h, area) {
    const seen = new Uint8Array(w * h), out = [];
    const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if (!M[i] || M[i - 1] || seen[i]) continue;
      // 區塊大小（填色）
      const st = [i], comp = []; seen[i] = 1;
      while (st.length) { const j = st.pop(); comp.push(j); for (const n of [j - 1, j + 1, j - w, j + w]) if (M[n] && !seen[n]) { seen[n] = 1; st.push(n); } }
      if (comp.length < Math.max(4, area * 0.04)) continue;
      // 追蹤外框：從最左上角的點開始
      const pts = []; let cx = x, cy = y, dir = 6; const sx = x, sy = y; let guard = 0;
      do {
        pts.push([cx, cy]); let found = false;
        for (let k = 0; k < 8; k++) { const d = (dir + 6 + k) % 8, nx = cx + DX[d], ny = cy + DY[d]; if (M[ny * w + nx]) { cx = nx; cy = ny; dir = d; found = true; break; } }
        if (!found) break;
      } while ((cx !== sx || cy !== sy) && ++guard < 40000);
      if (pts.length >= 3) out.push(pts);
    }
    return out;
  },
  simplify(pts, eps) {   // Ramer–Douglas–Peucker
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let md = 0, mi = -1; const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L; if (d > md) { md = d; mi = i; } }
      if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
};
