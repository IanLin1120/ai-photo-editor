/* ================= v1.18：生成式 AI 消除（Google Gemini「Nano Banana」，在手機上直接呼叫） =================
   做法：每一塊要消除的範圍裁出一張「留足背景」的局部圖 → 連同「要消除的地方標成紅色」的同一張圖一起送給 Gemini →
   只把消除範圍（羽化過）貼回原圖，並把亮度／色彩對齊周圍，其餘像素完全不動。費用由你的 Gemini API 金鑰計費。 */
const GenErase = {
  RATIOS: [[1, 1], [5, 4], [4, 5], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [21, 9]],
  cfg() { const c = (CFG.gen = CFG.gen || {}); if (c.engine === 'omni') c.engine = 'oc'; const d = { engine: 'oc', key: '', model: 'gemini-nano-banana-2.1', hf: '', size: '2K' }; for (const k in d) if (!(k in c)) c[k] = d[k]; return c; },
  /* 把遮罩（白＝消除，任意解析度，與原圖同比例）分成幾塊：相近的合在一起 */
  regions(mask) {
    const s = Math.min(1, 256 / Math.max(mask.width, mask.height)), w = Math.max(1, Math.round(mask.width * s)), h = Math.max(1, Math.round(mask.height * s));
    const c = mkCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(mask, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, M = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) M[i] = d[i * 4] > 40;
    const seen = new Uint8Array(w * h), boxes = [];
    for (let i = 0; i < w * h; i++) {
      if (!M[i] || seen[i]) continue; const st = [i]; seen[i] = 1; let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
      while (st.length) { const j = st.pop(), y = (j / w) | 0, xx = j % w; n++; x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (const k of [j - 1, j + 1, j - w, j + w]) if (k >= 0 && k < w * h && Math.abs((k % w) - xx) <= 1 && M[k] && !seen[k]) { seen[k] = 1; st.push(k); } }
      boxes.push([x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h]);
    }
    // 合併：外擴 40% 後重疊的合成一塊（補出來的背景才連貫，也比較省錢）
    const grow = (b, f) => { const bw = b[2] - b[0], bh = b[3] - b[1]; return [b[0] - bw * f, b[1] - bh * f, b[2] + bw * f, b[3] + bh * f]; };
    const ov = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    let changed = true;
    while (changed) { changed = false; for (let i = 0; i < boxes.length && !changed; i++) for (let j = i + 1; j < boxes.length; j++) if (ov(grow(boxes[i], 0.4), grow(boxes[j], 0.4))) { const a = boxes[i], b = boxes[j]; boxes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; boxes.splice(j, 1); changed = true; break; } }
    return boxes;
  },
  /* 裁切範圍：物件外再留 70% 的背景，並調整成 Gemini 支援的長寬比 */
  cropFor(b, W, H) {
    let bw = (b[2] - b[0]) * W, bh = (b[3] - b[1]) * H; const cx = (b[0] + b[2]) / 2 * W, cy = (b[1] + b[3]) / 2 * H;
    bw = Math.max(bw * 1.7, Math.min(W, 320)); bh = Math.max(bh * 1.7, Math.min(H, 320));
    let best = null; for (const [rw, rh] of this.RATIOS) { let w = bw, h = bh; if (w / h > rw / rh) h = w * rh / rw; else w = h * rw / rh; if (w > W || h > H) { const k = Math.min(W / w, H / h); w *= k; h *= k; if (w < bw * 0.98 || h < bh * 0.98) continue; } const a = w * h; if (!best || a < best.a) best = { w, h, a, r: `${rw}:${rh}` }; }
    if (!best) {   // 範圍太大、沒有剛好的比例：用整個可用範圍，比例選最接近的（結果會被輕微拉回原比例）
      const w = Math.min(W, bw), h = Math.min(H, bh); let r = null, e = 9; for (const [rw, rh] of this.RATIOS) { const d = Math.abs(Math.log((w / h) / (rw / rh))); if (d < e) { e = d; r = `${rw}:${rh}`; } }
      best = { w, h, r };
    }
    const w = Math.round(best.w), h = Math.round(best.h); const x = Math.round(Math.max(0, Math.min(W - w, cx - w / 2))), y = Math.round(Math.max(0, Math.min(H - h, cy - h / 2)));
    return { x, y, w, h, ratio: best.r };
  },
  b64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); },
  findImage(o) {   // 不管是 generateContent 還是 Interactions 的回應格式，都找出第一張圖
    let hit = null; const walk = (v) => { if (hit || !v || typeof v !== 'object') return; const mt = v.mimeType || v.mime_type; const dt = v.data || v.bytes || v.imageBytes || v.image_bytes; if (typeof dt === 'string' && dt.length > 1000 && (!mt || /^image\//.test(mt))) { hit = { data: dt, mime: mt || 'image/png' }; return; } for (const k in v) walk(v[k]); }; walk(o); return hit;
  },
  async call(prompt, imgs, ratio, size) {
    const c = this.cfg(); if (!c.key) throw new Error('請先在「設定 → AI 消除引擎」填入 Gemini API 金鑰');
    const parts = [{ text: prompt }, ...imgs.map((d) => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))];
    const cfg = { responseModalities: ['IMAGE'], imageConfig: Object.assign({ imageSize: size }, ratio ? { aspectRatio: ratio } : {}) };
    const base = 'https://generativelanguage.googleapis.com/v1beta/';
    let r = await fetch(`${base}models/${encodeURIComponent(c.model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: cfg }) });
    let j = await r.json().catch(() => ({}));
    if (!r.ok && (r.status === 404 || r.status === 400)) {   // 新版模型只走 Interactions API
      const input = [{ type: 'text', text: prompt }, ...imgs.map((d) => ({ type: 'image', mime_type: 'image/jpeg', data: d }))];
      r = await fetch(`${base}interactions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key }, body: JSON.stringify({ model: c.model, input, response_format: Object.assign({ type: 'image', mime_type: 'image/jpeg', image_size: size }, ratio ? { aspect_ratio: ratio } : {}) }) });
      j = await r.json().catch(() => ({}));
    }
    if (!r.ok) { const m = (j.error && (j.error.message || j.error.status)) || ('HTTP ' + r.status); throw new Error(r.status === 429 ? 'Gemini 用量已達上限或尚未開通計費（' + m + '）' : r.status === 403 || r.status === 401 ? 'Gemini API 金鑰無效或沒有權限（' + m + '）' : m); }
    const im = this.findImage(j); if (!im) { const t = JSON.stringify(j).slice(0, 300); throw new Error('Gemini 沒有回傳圖片（可能被安全規則擋下）：' + t); }
    const bin = atob(im.data), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return createImageBitmap(new Blob([u], { type: im.mime }));
  },
  /* full：原始解析度影像；mask：白＝消除（任意解析度、同比例）；回傳新的 JPEG */
  async run(full, mask, onp) {
    const W = full.width, H = full.height, c = this.cfg(), boxes = this.regions(mask); if (!boxes.length) throw new Error('消除範圍是空的');
    const out = mkCanvas(W, H), ox = out.getContext('2d'); ox.drawImage(full, 0, 0);
    const prompt = 'Image 1 is a photograph. Image 2 is the exact same photograph in which the things to remove are painted over in semi-transparent red. ' +
      'Edit Image 1: completely remove everything that is red in Image 2, together with its shadow, reflection and any parts (bags, umbrellas, hands) that belong to it, ' +
      'and fill the area with background that seamlessly continues the surrounding scene — same perspective, lighting, colours, texture, sharpness and film grain. ' +
      'Do not add any new people or objects. Do not change, move, restyle, recolour or crop anything else. Output only the edited Image 1 with exactly the same framing.';
    for (let k = 0; k < boxes.length; k++) {
      onp && onp(`Gemini 生成中 ${k + 1} / ${boxes.length}…`);
      const cr = this.cropFor(boxes[k], W, H), lim = c.size === '1K' ? 1024 : 2048, s = Math.min(1, lim / Math.max(cr.w, cr.h)), sw = Math.round(cr.w * s), sh = Math.round(cr.h * s);
      const a = mkCanvas(sw, sh), ax = a.getContext('2d'); ax.imageSmoothingQuality = 'high'; ax.drawImage(out, cr.x, cr.y, cr.w, cr.h, 0, 0, sw, sh);
      const mk = mkCanvas(sw, sh), mx = mk.getContext('2d'); mx.drawImage(mask, cr.x / W * mask.width, cr.y / H * mask.height, cr.w / W * mask.width, cr.h / H * mask.height, 0, 0, sw, sh);
      const red = mkCanvas(sw, sh), rx = red.getContext('2d'); rx.drawImage(a, 0, 0);
      const tint = mkCanvas(sw, sh), tx = tint.getContext('2d'); tx.fillStyle = '#ff1e1e'; tx.fillRect(0, 0, sw, sh); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mk, 0, 0);
      // 遮罩是黑底白圖：轉成 alpha
      const md = mx.getImageData(0, 0, sw, sh), td = tx.getImageData(0, 0, sw, sh); for (let i = 0; i < sw * sh; i++) td.data[i * 4 + 3] = md.data[i * 4] > 40 ? 170 : 0; tx.putImageData(td, 0, 0);
      rx.drawImage(tint, 0, 0);
      const [i1, i2] = await Promise.all([this.b64(await canvasBlob(a, 'image/jpeg', 0.93)), this.b64(await canvasBlob(red, 'image/jpeg', 0.9))]);
      const res = await this.call(prompt, [i1, i2], cr.ratio, Math.max(sw, sh) > 1100 && c.size !== '1K' ? '2K' : '1K');
      // 生成結果縮放回裁切大小
      const g = mkCanvas(cr.w, cr.h), gx = g.getContext('2d', { willReadFrequently: true }); gx.imageSmoothingQuality = 'high'; gx.drawImage(res, 0, 0, cr.w, cr.h); res.close && res.close();
      // 貼回用的遮罩：外擴＋羽化
      const L = Math.max(cr.w, cr.h), m2 = mkCanvas(cr.w, cr.h), m2x = m2.getContext('2d', { willReadFrequently: true }); m2x.filter = `blur(${Math.max(2, Math.round(L / 260))}px)`;
      const md2 = mkCanvas(cr.w, cr.h), md2x = md2.getContext('2d'); md2x.drawImage(mask, cr.x / W * mask.width, cr.y / H * mask.height, cr.w / W * mask.width, cr.h / H * mask.height, 0, 0, cr.w, cr.h);
      m2x.drawImage(md2, 0, 0); m2x.filter = 'none'; m2x.drawImage(md2, 0, 0);
      // 顏色對齊：比較遮罩外圍一圈（原圖 vs 生成）的平均色
      const oc = mkCanvas(cr.w, cr.h), ocx = oc.getContext('2d', { willReadFrequently: true }); ocx.drawImage(out, cr.x, cr.y, cr.w, cr.h, 0, 0, cr.w, cr.h);
      const O = ocx.getImageData(0, 0, cr.w, cr.h).data, G = gx.getImageData(0, 0, cr.w, cr.h), Gd = G.data, Mm = m2x.getImageData(0, 0, cr.w, cr.h).data;
      const so = [0, 0, 0], sg = [0, 0, 0]; let n = 0;
      for (let i = 0; i < cr.w * cr.h; i += 3) { const m = Mm[i * 4]; if (m > 5 || i % 7) continue; for (let ch = 0; ch < 3; ch++) { so[ch] += O[i * 4 + ch]; sg[ch] += Gd[i * 4 + ch]; } n++; }
      const gain = so.map((v, ch) => (n > 50 && sg[ch] > 0 ? Math.max(0.85, Math.min(1.18, v / sg[ch])) : 1));
      for (let i = 0; i < cr.w * cr.h; i++) { const m = Mm[i * 4] / 255; for (let ch = 0; ch < 3; ch++) Gd[i * 4 + ch] = Math.min(255, Gd[i * 4 + ch] * gain[ch]); Gd[i * 4 + 3] = Math.round(Math.min(1, m * 1.25) * 255); }
      gx.putImageData(G, 0, 0); ox.drawImage(g, cr.x, cr.y);
      for (const cv of [a, mk, red, tint, g, m2, md2, oc]) { cv.width = cv.height = 1; }
    }
    onp && onp('合成中…');
    const blob = await canvasBlob(out, 'image/jpeg', 0.97); out.width = out.height = 1; return { blob, n: boxes.length };
  }
};
