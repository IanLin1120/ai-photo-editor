/* ================= AI 降噪引擎 =================
   Intel Open Image Denoise (OIDN 2.3) U-Net，權重為 TZA 格式（Apache-2.0）。
   以 TensorFlow.js（WebGL 後端，失敗時退回 CPU）在裝置上推論，分塊處理任意解析度。 */
(function (root) {
  'use strict';
  function half2float(h) {
    const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : (s ? -Infinity : Infinity);
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  function parseTZA(buffer) {
    const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
    let o = 0;
    const r = (n) => { let v; if (n === 1) v = dv.getUint8(o); else if (n === 2) v = dv.getUint16(o, true); else if (n === 4) v = dv.getUint32(o, true); else v = Number(dv.getBigUint64(o, true)); o += n; return v; };
    if (r(2) !== 0x41d7) throw new Error('權重檔格式錯誤');
    const maj = r(1); r(1);
    if (maj !== 2) throw new Error('不支援的權重版本');
    o = r(8);
    const n = r(4), map = new Map(), td = new TextDecoder();
    for (let i = 0; i < n; i++) {
      const nl = r(2); const name = td.decode(u8.subarray(o, o + nl)); o += nl;
      const nd = r(1); const dims = []; for (let j = 0; j < nd; j++) dims.push(r(4));
      const layout = td.decode(u8.subarray(o, o + nd)); o += nd;
      const dt = String.fromCharCode(r(1)); const off = r(8);
      const cnt = dims.reduce((a, b) => a * b, 1);
      const out = new Float32Array(cnt);
      if (dt === 'h') { const hv = new DataView(buffer, off, cnt * 2); for (let k = 0; k < cnt; k++) out[k] = half2float(hv.getUint16(k * 2, true)); }
      else { const fv = new DataView(buffer, off, cnt * 4); for (let k = 0; k < cnt; k++) out[k] = fv.getFloat32(k * 4, true); }
      map.set(name, { dims, layout, data: out });
    }
    return map;
  }
  const SMALL = [['enc_conv0', 'c', 'in'], ['enc_conv1', 'c'], ['pool1', 'p'], ['enc_conv2', 'c'], ['pool2', 'p'], ['enc_conv3', 'c'], ['pool3', 'p'], ['enc_conv4', 'c'], ['pool4', 'p'], ['enc_conv5a', 'c'], ['enc_conv5b', 'c'], ['up4', 'u'], ['concat4', 'cat', 'pool3'], ['dec_conv4a', 'c'], ['dec_conv4b', 'c'], ['up3', 'u'], ['concat3', 'cat', 'pool2'], ['dec_conv3a', 'c'], ['dec_conv3b', 'c'], ['up2', 'u'], ['concat2', 'cat', 'pool1'], ['dec_conv2a', 'c'], ['dec_conv2b', 'c'], ['up1', 'u'], ['concat1', 'cat', 'in'], ['dec_conv1a', 'c'], ['dec_conv1b', 'c'], ['dec_conv0', 'o']];
  const LARGE = [['enc_conv1a', 'c', 'in'], ['enc_conv1b', 'c'], ['pool1', 'p'], ['enc_conv2a', 'c'], ['enc_conv2b', 'c'], ['pool2', 'p'], ['enc_conv3a', 'c'], ['enc_conv3b', 'c'], ['pool3', 'p'], ['enc_conv4a', 'c'], ['enc_conv4b', 'c'], ['pool4', 'p'], ['enc_conv5a', 'c'], ['enc_conv5b', 'c'], ['up4', 'u'], ['concat4', 'cat', 'pool3'], ['dec_conv4a', 'c'], ['dec_conv4b', 'c'], ['up3', 'u'], ['concat3', 'cat', 'pool2'], ['dec_conv3a', 'c'], ['dec_conv3b', 'c'], ['up2', 'u'], ['concat2', 'cat', 'pool1'], ['dec_conv2a', 'c'], ['dec_conv2b', 'c'], ['up1', 'u'], ['concat1', 'cat', 'in'], ['dec_conv1a', 'c'], ['dec_conv1b', 'c'], ['dec_conv1c', 'o']];

  class UNet {
    constructor(tf, tza) {
      this.tf = tf;
      this.graph = tza.has('enc_conv0.weight') ? SMALL : LARGE;
      this.w = {};
      for (const [name, op] of this.graph) {
        if (op !== 'c' && op !== 'o') continue;
        const W = tza.get(name + '.weight'), B = tza.get(name + '.bias');
        const [O, I, H, Wd] = W.dims;
        // OIHW -> HWIO
        const hwio = new Float32Array(O * I * H * Wd);
        for (let oo = 0; oo < O; oo++) for (let ii = 0; ii < I; ii++) for (let y = 0; y < H; y++) for (let x = 0; x < Wd; x++)
          hwio[((y * Wd + x) * I + ii) * O + oo] = W.data[((oo * I + ii) * H + y) * Wd + x];
        this.w[name] = { k: tf.tensor4d(hwio, [H, Wd, I, O]), b: tf.tensor1d(B.data.slice(0, O)) };
      }
      this.inC = tza.get(this.graph[0][0] + '.weight').dims[1];
    }
    forward(x) {
      const tf = this.tf;
      return tf.tidy(() => {
        const v = { in: x }; let cur = x;
        for (const [name, op, arg] of this.graph) {
          if (op === 'c' || op === 'o') {
            const src = arg ? v[arg] : cur; const w = this.w[name];
            cur = tf.add(tf.conv2d(src, w.k, 1, 'same'), w.b);
            if (op === 'c') cur = tf.relu(cur);
          } else if (op === 'p') cur = tf.maxPool(cur, 2, 2, 'same');
          else if (op === 'u') { const s = cur.shape; cur = tf.image.resizeNearestNeighbor(cur, [s[1] * 2, s[2] * 2]); }
          else if (op === 'cat') cur = tf.concat([cur, v[arg]], 3);
          v[name] = cur;
        }
        return tf.clipByValue(cur, 0, 1);
      });
    }
    /* 分塊降噪（可處理超大影像，不需整張載入）：
       read(x,y,w,h) 回傳該範圍 RGBA（範圍已裁在影像內），write(x,y,w,h,rgba) 寫回結果。 */
    async runTiles(o) {
      const tf = this.tf, W = o.W, H = o.H;
      const tile = o.tile || 384, pad = o.pad || 48;
      const tilesX = Math.ceil(W / tile), tilesY = Math.ceil(H / tile), total = tilesX * tilesY;
      let done = 0;
      for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
        if (o.signal && o.signal.aborted) throw new Error('aborted');
        const x0 = tx * tile, y0 = ty * tile;
        const cw = Math.min(tile, W - x0), ch = Math.min(tile, H - y0);
        const rx0 = Math.max(0, x0 - pad), ry0 = Math.max(0, y0 - pad), rx1 = Math.min(W, x0 + cw + pad), ry1 = Math.min(H, y0 + ch + pad);
        const rw = rx1 - rx0, rh = ry1 - ry0;
        const src = await o.read(rx0, ry0, rw, rh);
        // 網路輸入需為 16 的倍數，不足處鏡射補齊
        // 固定輸入尺寸：所有分塊同形狀，GPU 著色器只需編譯一次（大幅加速）
        const iw = Math.ceil((Math.min(tile, W) + pad * 2) / 16) * 16, ih = Math.ceil((Math.min(tile, H) + pad * 2) / 16) * 16;
        const refl = (v, n) => { if (n <= 1) return 0; const p2 = 2 * n - 2; v = v % p2; return v < n ? v : p2 - v; };
        const inp = new Float32Array(iw * ih * this.inC);
        for (let y = 0; y < ih; y++) {
          const sy = refl(y, rh);
          for (let x = 0; x < iw; x++) {
            const sx = refl(x, rw);
            const si = (sy * rw + sx) * 4, di = (y * iw + x) * this.inC;
            inp[di] = src[si] / 255; inp[di + 1] = src[si + 1] / 255; inp[di + 2] = src[si + 2] / 255;
          }
        }
        const xt = tf.tensor4d(inp, [1, ih, iw, this.inC]);
        const yt = this.forward(xt); xt.dispose();
        const res = await yt.data(); yt.dispose();
        const den = new Float32Array(rw * rh * 3), org = new Float32Array(rw * rh * 3);
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
          const a = (y * iw + x) * 3, b = (y * rw + x) * 3, s = (y * rw + x) * 4;
          den[b] = res[a]; den[b + 1] = res[a + 1]; den[b + 2] = res[a + 2];
          org[b] = src[s] / 255; org[b + 1] = src[s + 1] / 255; org[b + 2] = src[s + 2] / 255;
        }
        // 低頻還原：保留原圖的大範圍色調，避免神經網路造成整體偏色或亮度漂移
        const r = Math.max(3, Math.round(Math.min(rw, rh) / 40));
        const bo = blur3(org, rw, rh, r), bd = blur3(den, rw, rh, r);
        const out = new Uint8ClampedArray(cw * ch * 4);
        const ox = x0 - rx0, oy = y0 - ry0;
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          const b = ((y + oy) * rw + (x + ox)) * 3, d = (y * cw + x) * 4;
          out[d] = (den[b] + bo[b] - bd[b]) * 255 + .5; out[d + 1] = (den[b + 1] + bo[b + 1] - bd[b + 1]) * 255 + .5; out[d + 2] = (den[b + 2] + bo[b + 2] - bd[b + 2]) * 255 + .5;
          out[d + 3] = src[((y + oy) * rw + (x + ox)) * 4 + 3];
        }
        await o.write(x0, y0, cw, ch, out);
        done++; if (o.progress) o.progress(done / total);
        await new Promise((r2) => setTimeout(r2, o.pause || 0));
      }
    }
    /* 對整張 RGBA 陣列降噪（測試與小圖用） */
    async run(rgba, W, H, opts = {}) {
      const out = new Uint8ClampedArray(rgba.length);
      await this.runTiles({ W, H, tile: opts.tile, pad: opts.pad, progress: opts.progress, signal: opts.signal,
        read: (x, y, w, h) => { const r = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < h; j++) r.set(rgba.subarray(((y + j) * W + x) * 4, ((y + j) * W + x + w) * 4), j * w * 4); return r; },
        write: (x, y, w, h, d) => { for (let j = 0; j < h; j++) out.set(d.subarray(j * w * 4, (j + 1) * w * 4), ((y + j) * W + x) * 4); } });
      return out;
    }
  }
  /* 3 通道箱型模糊兩次（近似高斯） */
  function blur3(a, w, h, r) {
    let src = a, tmp = new Float32Array(a.length), dst = new Float32Array(a.length);
    for (let it = 0; it < 2; it++) {
      for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
        let s = 0; const row = y * w;
        for (let x = -r; x <= r; x++) s += src[(row + Math.min(w - 1, Math.max(0, x))) * 3 + c];
        for (let x = 0; x < w; x++) { tmp[(row + x) * 3 + c] = s / (2 * r + 1); s += src[(row + Math.min(w - 1, x + r + 1)) * 3 + c] - src[(row + Math.max(0, x - r)) * 3 + c]; }
      }
      for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let y = -r; y <= r; y++) s += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c];
        for (let y = 0; y < h; y++) { dst[(y * w + x) * 3 + c] = s / (2 * r + 1); s += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c] - tmp[(Math.max(0, y - r) * w + x) * 3 + c]; }
      }
      src = dst; dst = it === 0 ? new Float32Array(a.length) : dst;
    }
    return src;
  }
  root.AIDenoise = { parseTZA, UNet };
})(typeof window !== 'undefined' ? window : globalThis);
