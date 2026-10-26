/* ================= v1.17：在手機上偵測人物（YOLO11 實例分割，ONNX Runtime Web） =================
   第一次使用時從 GitHub Pages 下載模型（約 21 MB）與推論引擎（約 11 MB），存在手機裡，之後完全離線、數秒完成。
   回傳每個人：box（正規化 x0,y0,x1,y1）、polys（沿輪廓的多邊形，正規化座標）、score */
const People = {
  VER: 'y11s-1',
  FILES: { wasm: 'models/ort-wasm-simd-threaded.wasm', model: 'models/yolo11s-seg-w16.onnx', samE: 'models/mobilesam-enc-w16.onnx', samD: 'models/mobilesam-dec-w16.onnx' },
  SIZE: { wasm: 11.2e6, model: 20.9e6, samE: 16.6e6, samD: 8.4e6 },
  // COCO 類別（中文），圈選物件時顯示
  NAMES: '人,腳踏車,汽車,機車,飛機,公車,火車,卡車,船,紅綠燈,消防栓,停車標誌,停車計時器,長椅,鳥,貓,狗,馬,羊,牛,大象,熊,斑馬,長頸鹿,背包,雨傘,手提包,領帶,行李箱,飛盤,滑雪板,滑雪板,球,風箏,球棒,手套,滑板,衝浪板,球拍,瓶子,酒杯,杯子,叉子,刀子,湯匙,碗,香蕉,蘋果,三明治,柳橙,花椰菜,紅蘿蔔,熱狗,披薩,甜甜圈,蛋糕,椅子,沙發,盆栽,床,餐桌,馬桶,電視,筆電,滑鼠,遙控器,鍵盤,手機,微波爐,烤箱,烤麵包機,水槽,冰箱,書,時鐘,花瓶,剪刀,泰迪熊,吹風機,牙刷'.split(','),
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
      const ks = Object.keys(this.FILES), prog = {}; ks.forEach((k) => (prog[k] = [0, this.SIZE[k]]));
      const tell = () => { let a = 0, b = 0; ks.forEach((k) => { a += prog[k][0]; b += prog[k][1]; }); onp && onp(`下載 AI 偵測模型 ${(a / 1048576).toFixed(1)} / ${(b / 1048576).toFixed(0)} MB（只需一次）`, a / b); };
      const B = {}; await Promise.all(ks.map(async (k) => { B[k] = await this.bin(k, this.url(this.FILES[k]), (n, t) => { prog[k] = [n, t || prog[k][1]]; tell(); }); prog[k][0] = prog[k][1]; }));
      onp && onp('啟動 AI 偵測…', 1);
      const ort = window.ort; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
      const w = B.wasm; ort.env.wasm.wasmBinary = w.buffer.byteLength === w.length ? w.buffer : w.slice().buffer;
      ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([ORT_MJS], { type: 'text/javascript' })) };
      const o = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      const s = await ort.InferenceSession.create(B.model, o);
      this.samE = await ort.InferenceSession.create(B.samE, o); this.samD = await ort.InferenceSession.create(B.samD, o);
      this.ses = s; return s;
    })();
    try { return await this.loading; } finally { this.loading = null; }
  },
  /* img：已轉正的影像（ImageBitmap／canvas），long：推論長邊 */
  async detect(img, onp, opt = {}) {
    const long = opt.long || 960;
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
    this.detImg = img;
    const P = o0.data, A = o0.dims[2], C = o0.dims[1], nm = C - 84, pr = o1.data, ph = o1.dims[2], pw = o1.dims[3];
    // 全部 80 類：人（類別 0）門檻 0.25，其他物件 0.3（圈選消除用）
    let cand = [];
    for (let i = 0; i < A; i++) {
      let best = 0, bc = 0; for (let c = 0; c < 80; c++) { const v = P[(4 + c) * A + i]; if (v > best) { best = v; bc = c; } }
      if (best < (bc === 0 ? 0.25 : 0.3)) continue; const cx = P[i], cy = P[A + i], bw = P[2 * A + i], bh = P[3 * A + i]; cand.push({ i, s: best, c: bc, b: [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2] });
    }
    cand.sort((a, b) => b.s - a.s);
    const iou = this.iou;
    const keep = []; for (const q of cand) { if (keep.every((k) => k.c !== q.c || iou(k.b, q.b) < 0.5)) keep.push(q); if (keep.length >= 120) break; }
    this.dets = keep.filter((q) => q.c !== 0).map((q) => ({ cls: q.c, name: this.NAMES[q.c] || '物件', score: q.s, box: [q.b[0] / rw, q.b[1] / rh, q.b[2] / rw, q.b[3] / rh].map((v) => Math.max(0, Math.min(1, v))) }));
    const res = [];
    for (const q of keep) {
      if (q.c !== 0) continue;
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
      res.push({ box: [q.b[0] / rw, q.b[1] / rh, q.b[2] / rw, q.b[3] / rh].map((v) => Math.max(0, Math.min(1, v))), polys, score: Math.round(q.s * 1000) / 1000, kind: 'person', area: area / (S * S * pw * ph) });
    }
    const ar = (p) => (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]);
    res.sort((a, b) => ar(b) - ar(a));
    // v1.17.1：用 SAM（Segment Anything）以每個人的外框重新描輪廓 → 背包、手提包、雨傘這些隨身物品也一起框進來
    await this.encode(img, onp);
    if (opt.refine === false) return res;
    for (let k = 0; k < res.length; k++) {
      onp && onp(`精修輪廓（含背包、隨身物品）${k + 1} / ${res.length}`, 1);
      const p = res[k], b = p.box, pad = 0.04; const bb = [b[0] - (b[2] - b[0]) * pad, b[1] - (b[3] - b[1]) * pad * 0.5, b[2] + (b[2] - b[0]) * pad, b[3] + (b[3] - b[1]) * pad * 0.3];
      const m = await this.segment(bb).catch((e) => { console.warn('sam', e); return null; });
      if (m && m.score > 0.75 && m.area > p.area * 0.6 && m.area < p.area * 2.4) { p.polys = m.polys; p.sam = 1; }
    }
    return res;
  },
  iou(a, b) { const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])), I = ix * iy; return I / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - I + 1e-9); },
  /* ---------- SAM（MobileSAM）：影像只編碼一次（約數秒），之後每個框／圈選只要零點幾秒 ---------- */
  async encode(img, onp) {
    if (this.embImg === img && this.emb) return;
    await this.session(onp); onp && onp('AI 分析畫面中的物件…', 1);
    const W = img.width, H = img.height, s = 1024 / Math.max(W, H), rw = Math.round(W * s), rh = Math.round(H * s);
    const c = mkCanvas(1024, 1024), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, rw, rh);
    const d = x.getImageData(0, 0, 1024, 1024).data, N = 1024 * 1024, inp = new Float32Array(3 * N), mean = [123.675, 116.28, 103.53], sd = [58.395, 57.12, 57.375];
    for (let i = 0; i < N; i++) { const yy = (i / 1024) | 0, xx = i % 1024; if (xx >= rw || yy >= rh) continue; for (let ch = 0; ch < 3; ch++) inp[ch * N + i] = (d[i * 4 + ch] - mean[ch]) / sd[ch]; }
    await new Promise((r) => setTimeout(r, 20));
    const o = await this.samE.run({ [this.samE.inputNames[0]]: new window.ort.Tensor('float32', inp, [1, 3, 1024, 1024]) });
    this.emb = o[this.samE.outputNames[0]]; this.embImg = img; this.embWH = [rw, rh, s];
  },
  /* 以外框（正規化座標）＋選用的正／負點取得物件輪廓；clip：只保留在這個多邊形（圈選範圍）裡的部分 */
  async segment(box, pts = [], clip = null) {
    const [rw, rh] = this.embWH, X = (v) => v * rw, Y = (v) => v * rh, ort = window.ort;
    const co = [X(box[0]), Y(box[1]), X(box[2]), Y(box[3])], lab = [2, 3];
    for (const q of pts) { co.push(X(q[0]), Y(q[1])); lab.push(q[2] ? 1 : 0); }
    co.push(0, 0); lab.push(-1);
    const n = lab.length, D = this.samD, f = {
      image_embeddings: this.emb, point_coords: new ort.Tensor('float32', new Float32Array(co), [1, n, 2]), point_labels: new ort.Tensor('float32', new Float32Array(lab), [1, n]),
      mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]), has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]), orig_im_size: new ort.Tensor('float32', new Float32Array([rh, rw]), [2]) };
    const o = await D.run(f), m = o[D.outputNames[0]].data, score = o[D.outputNames[1]].data[0];
    let cl = null; if (clip) { const c = mkCanvas(rw, rh), x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = x.strokeStyle = '#fff'; x.lineJoin = 'round'; x.lineWidth = Math.max(rw, rh) * 0.02; x.beginPath(); clip.forEach((q, k) => (k ? x.lineTo(X(q[0]), Y(q[1])) : x.moveTo(X(q[0]), Y(q[1])))); x.closePath(); x.fill(); x.stroke(); cl = x.getImageData(0, 0, rw, rh).data; }
    let x0 = rw, y0 = rh, x1 = -1, y1 = -1, area = 0;
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const i = y * rw + x; if (m[i] > 0 && (!cl || cl[i * 4] > 127)) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (!area) return null;
    const gw = x1 - x0 + 3, gh = y1 - y0 + 3, M = new Uint8Array(gw * gh);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * rw + x; if (m[i] > 0 && (!cl || cl[i * 4] > 127)) M[(y - y0 + 1) * gw + x - x0 + 1] = 1; }
    const polys = this.contours(M, gw, gh, area).map((pl) => this.simplify(pl, 0.9).map((q) => [(x0 + q[0] - 1) / rw, (y0 + q[1] - 1) / rh])).filter((pl) => pl.length >= 3);
    if (!polys.length) return null;
    return { polys, score, area: area / (rw * rh), box: [x0 / rw, y0 / rh, (x1 + 1) / rw, (y1 + 1) / rh] };
  },
  /* 圈選：範圍內 AI 認得的物件（人、背包、車、椅子…）各自描出輪廓；沒有認得的物件就把圈選範圍內最明顯的東西描出來 */
  async lasso(img, poly, existing, onp) {
    if (this.detImg !== img) await this.detect(img, onp, { refine: false });
    await this.encode(img, onp);
    const inside = (pt) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1] + 1e-12) + a[0]) c = !c; } return c; };
    const lb = [Math.min(...poly.map((q) => q[0])), Math.min(...poly.map((q) => q[1])), Math.max(...poly.map((q) => q[0])), Math.max(...poly.map((q) => q[1]))];
    const inLasso = (b) => { const ix = Math.max(0, Math.min(b[2], lb[2]) - Math.max(b[0], lb[0])), iy = Math.max(0, Math.min(b[3], lb[3]) - Math.max(b[1], lb[1])); return inside([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]) && ix * iy > 0.55 * (b[2] - b[0]) * (b[3] - b[1]); };
    const hitOld = existing.map((p, i) => (inLasso(p.box) ? i : -1)).filter((i) => i >= 0);
    const add = [];
    for (const d of (this.dets || []).filter((d) => inLasso(d.box))) {
      if (existing.some((p) => this.iou(p.box, d.box) > 0.5) || add.some((p) => this.iou(p.box, d.box) > 0.5)) continue;
      const m = await this.segment(d.box).catch(() => null); if (m && m.score > 0.6) add.push({ box: m.box, polys: m.polys, score: d.score, kind: 'obj', name: d.name });
    }
    if (!add.length && !hitOld.length) {   // 沒有認得的物件：以圈選範圍為框，描出裡面的東西（限制在圈選範圍內）
      const m = await this.segment(lb, [], poly).catch(() => null);
      const la = (lb[2] - lb[0]) * (lb[3] - lb[1]);
      if (m && m.score > 0.5 && m.area > la * 0.05) add.push({ box: m.box, polys: m.polys, score: m.score, kind: 'obj', name: '物件' });
      else add.push({ box: lb, polys: [poly], score: 1, kind: 'obj', name: '圈選範圍' });   // 真的描不出來：直接用你圈的範圍
    }
    return { add, hitOld };
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
