/* ================= AI 降噪模組 =================
   在獨立的 Web Worker 中推論（不卡畫面）；裝置不支援時退回主執行緒。 */
const AI_WORKER_MAIN = `
let nets={},W8={},abort={};
const post=(m,t)=>self.postMessage(m,t||[]);
function getNet(model){if(!nets[model])nets[model]=new AIDenoise.UNet(tf,AIDenoise.parseTZA(W8[model].buffer.slice(0)));return nets[model];}
async function selfTest(){const net=getNet('fast');const N=32;const rgba=new Uint8ClampedArray(N*N*4);let seed=7;const rnd=()=>((seed=(seed*16807)%2147483647)/2147483647);
 for(let i=0;i<rgba.length;i+=4){const v=128+(rnd()-.5)*80;rgba[i]=v;rgba[i+1]=v;rgba[i+2]=v;rgba[i+3]=255;}
 const t0=performance.now();const out=await net.run(rgba,N,N,{tile:N,pad:16});let a=0,b=0,bad=0;for(let i=0;i<out.length;i+=4){a+=(rgba[i]-128)**2;b+=(out[i]-128)**2;if(!(out[i]>=0))bad++;}
 const inStd=Math.sqrt(a/(N*N)),outStd=Math.sqrt(b/(N*N));if(bad)return{ok:false,msg:'輸出含無效數值'};if(!(outStd<inStd*0.8))return{ok:false,msg:'推論結果異常（'+inStd.toFixed(1)+'→'+outStd.toFixed(1)+'）'};
 return{ok:true,inStd,outStd,ms:Math.round(performance.now()-t0)};}
self.onmessage=async(e)=>{const m=e.data;try{
 if(m.type==='init'){W8=m.weights;const log=[];if(m.f16){tf.env().set('WEBGL_FORCE_F16_TEXTURES',true);}for(const be of m.order){try{if(!(await tf.setBackend(be)))throw new Error('無法啟用');await tf.ready();nets={};const r=await selfTest();if(!r.ok)throw new Error(r.msg);
   post({type:'ready',backend:be,ms:r.ms,log:log.concat([be+(m.f16&&be==='webgl'?'（半精度）':'')+'（背景執行緒）: OK（'+r.ms+' ms，雜訊 '+r.inStd.toFixed(1)+'→'+r.outStd.toFixed(1)+'）'])});return;}catch(err){log.push(be+': '+(err.message||err));}}
   post({type:'fail',log});}
 else if(m.type==='cancel'){abort[m.id]=true;}
 else if(m.type==='run'){const net=getNet(m.model);const bm=m.bitmap;const W=bm.width,H=bm.height;const ic=new OffscreenCanvas(W,H),ix=ic.getContext('2d',{willReadFrequently:true});ix.drawImage(bm,0,0);bm.close();
   const oc=new OffscreenCanvas(W,H),ox=oc.getContext('2d');const sig={get aborted(){return !!abort[m.id]}};
   await net.runTiles({W,H,tile:m.tile,pad:48,pause:m.pause,signal:sig,progress:f=>post({type:'progress',id:m.id,f}),read:(x,y,w,h)=>ix.getImageData(x,y,w,h).data,write:(x,y,w,h,d)=>ox.putImageData(new ImageData(d,w,h),x,y)});
   const out=oc.transferToImageBitmap();post({type:'done',id:m.id,bitmap:out},[out]);}
}catch(err){post({type:'error',id:m.id,msg:err.message||String(err)});}};`;
const AI = {
  ready: false, nets: {}, backend: '', queue: Promise.resolve(), log: [], err: '', worker: null, jobs: new Map(), jid: 0, mode: '',
  tileOpt(fast) {
    if (fast) return { tile: Math.max(CFG.ai.tile || 256, 384), pause: 0 }; // 匯出：使用者在等，採大分塊、不讓出時間
    const smooth = CFG.ai.smooth !== false; return { tile: smooth ? Math.min(CFG.ai.tile || 256, 256) : (CFG.ai.tile || 256), pause: smooth ? 30 : 0 };
  },
  async init() {
    if (this.ready) return; if (this.initP) return this.initP;
    this.initP = (async () => {
      const pref = CFG.ai.engine || 'auto'; const order = pref === 'cpu' ? ['cpu'] : pref === 'webgl' ? ['webgl'] : ['webgl', 'cpu'];
      this.log = [];
      if (CFG.ai.worker !== false && window.Worker && window.OffscreenCanvas) {
        // 先試半精度（GPU 記憶體頻寬減半，手機上通常明顯較快）；自我測試不過就改全精度
        for (const f16 of (CFG.ai.f16 !== false && order.includes('webgl') ? [true, false] : [false])) {
          try { await this.initWorker(order, f16); if (f16 && this.backend !== 'webgl') throw new Error('半精度無法使用 GPU'); this.mode = 'worker'; this.f16 = f16; this.ready = true; return; }
          catch (e) { console.warn('AI worker', e); this.log.push((f16 ? '半精度：' : '背景執行緒：') + e.message); if (this.worker) { this.worker.terminate(); this.worker = null; } }
        }
      }
      const tf = window.tf; if (!tf) throw new Error('AI 引擎未載入');
      for (const be of order) {
        try {
          this.nets = {}; const ok = await tf.setBackend(be); if (!ok) throw new Error('無法啟用'); await tf.ready();
          const t0 = performance.now(); const r = await this.selfTest(); if (!r.ok) throw new Error(r.msg);
          this.backend = be; this.testMs = Math.round(performance.now() - t0); this.ready = true; this.mode = 'main';
          this.log.push(`${be}: OK（${this.testMs} ms，雜訊 ${r.inStd.toFixed(1)}→${r.outStd.toFixed(1)}）`); return;
        } catch (e) { console.warn('AI backend', be, e); this.log.push(`${be}: ${e.message || e}`); }
      }
      throw new Error('此裝置無法執行 AI 降噪：' + this.log.join('；'));
    })();
    try { await this.initP; } finally { this.initP = null; }
  },
  initWorker(order, f16) {
    return new Promise((res, rej) => {
      const code = ['js-tfcore', 'js-tfcpu', 'js-tfwebgl', 'js-aidn'].map((id) => { const el = document.getElementById(id); if (!el) throw new Error('缺少 ' + id); return el.textContent; }).join('\n;\n') + '\n;\n' + AI_WORKER_MAIN;
      const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); this.worker = w;
      const to = setTimeout(() => rej(new Error('啟動逾時')), 60000);
      w.onerror = (e) => { clearTimeout(to); rej(new Error(e.message || '背景執行緒錯誤')); };
      w.onmessage = ({ data: m }) => {
        if (m.type === 'ready') { clearTimeout(to); this.backend = m.backend; this.testMs = m.ms; this.log.push(...m.log); w.onmessage = (ev) => this.onMsg(ev.data); res(); }
        else if (m.type === 'fail') { clearTimeout(to); this.log.push(...m.log); rej(new Error(m.log.join('；'))); }
      };
      w.postMessage({ type: 'init', order, f16: !!f16, weights: { fast: b64ToBytes(W_OIDN_FAST), hq: b64ToBytes(W_OIDN_HQ) } });
    });
  },
  onMsg(m) {
    const j = this.jobs.get(m.id); if (!j) return;
    if (m.type === 'progress') j.progress && j.progress(m.f);
    else if (m.type === 'done') { this.jobs.delete(m.id); j.res(m.bitmap); }
    else if (m.type === 'error') { this.jobs.delete(m.id); j.rej(new Error(m.msg)); }
  },
  async selfTest() {
    const net = this.build('fast'); const N = 32; const rgba = new Uint8ClampedArray(N * N * 4); let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < rgba.length; i += 4) { const v = 128 + (rnd() - .5) * 80; rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255; }
    const out = await net.run(rgba, N, N, { tile: N, pad: 16 });
    let a = 0, b = 0, bad = 0; for (let i = 0; i < out.length; i += 4) { a += (rgba[i] - 128) ** 2; b += (out[i] - 128) ** 2; if (!(out[i] >= 0)) bad++; }
    const inStd = Math.sqrt(a / (N * N)), outStd = Math.sqrt(b / (N * N));
    if (bad) return { ok: false, msg: '輸出含無效數值' };
    if (!(outStd < inStd * 0.8)) return { ok: false, msg: `推論結果異常（${inStd.toFixed(1)}→${outStd.toFixed(1)}）` };
    return { ok: true, inStd, outStd };
  },
  build(model) {
    if (!this.nets[model]) { const b = b64ToBytes(model === 'hq' ? W_OIDN_HQ : W_OIDN_FAST); this.nets[model] = new AIDenoise.UNet(window.tf, AIDenoise.parseTZA(b.buffer)); }
    return this.nets[model];
  },
  async reset() { this.ready = false; this.nets = {}; this.log = []; if (this.worker) { this.worker.terminate(); this.worker = null; } for (const j of this.jobs.values()) j.rej(new Error('AI 引擎已重新啟動')); this.jobs.clear(); },
  /* 對任意影像來源做降噪，輸出同尺寸 canvas */
  denoise(src, sx, sy, W, H, model, opt = {}) {
    const job = async () => {
      await this.init();
      const { tile, pause } = this.tileOpt(opt.fast);
      if (this.mode === 'worker') {
        const bm = await createImageBitmap(src, sx, sy, W, H);
        const id = ++this.jid;
        const out = await new Promise((res, rej) => {
          this.jobs.set(id, { res, rej, progress: opt.progress });
          if (opt.signal) { const chk = setInterval(() => { if (!this.jobs.has(id)) clearInterval(chk); else if (opt.signal.aborted) { clearInterval(chk); this.worker.postMessage({ type: 'cancel', id }); } }, 300); }
          this.worker.postMessage({ type: 'run', id, model, bitmap: bm, tile, pause }, [bm]);
        });
        const c = mkCanvas(W, H); c.getContext('2d').drawImage(out, 0, 0); out.close(); return c;
      }
      const net = this.build(model);
      const dst = mkCanvas(W, H), dctx = dst.getContext('2d');
      const tmp = mkCanvas(8, 8), tctx = tmp.getContext('2d', { willReadFrequently: true });
      await net.runTiles({ W, H, tile, pad: 48, pause: pause + 10, signal: opt.signal, progress: opt.progress,
        read: (x, y, w, h) => { if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h; } tctx.clearRect(0, 0, w, h); tctx.drawImage(src, sx + x, sy + y, w, h, 0, 0, w, h); return tctx.getImageData(0, 0, w, h).data; },
        write: (x, y, w, h, d) => dctx.putImageData(new ImageData(d, w, h), x, y) });
      return dst;
    };
    const p = this.queue.then(job, job); this.queue = p.catch(() => {}); return p;
  }
};

/* ================= 單張相片的渲染工作階段 ================= */
class Session {
  constructor(rec) { this.rec = rec; this.SW = rec.w; this.SH = rec.h; this.healKey = null; this.brushKeys = {}; this.brushTex = {}; this.guideKey = ''; this.full = null; this.fullDn = {}; this.aiPrev = null; this.regionDn = new Map(); }
  async load() {
    const blob = await DB.get('prev', this.rec.id);
    if (!blob) throw new Error('找不到預覽檔');
    this.prev = await createImageBitmap(blob); this.PW = this.prev.width; this.PH = this.prev.height;
    this.healKey = null; return this;
  }
  dispose() {
    for (const t of [this.srcTex, this.dnTex, this.skyTex, this.regTex, this.regDnTex]) Engine.freeTex(t);
    for (const k in this.brushTex) Engine.freeTex(this.brushTex[k].tex);
    for (const k in (this.lutTex || {})) Engine.freeTex(this.lutTex[k]);
    try { this.prev && this.prev.close(); this.full && this.full.close && this.full.close(); } catch (e) {}
    this.full = null; this.fullDn = {}; this.regionDn.clear();
  }
  /* 預覽來源：套用修復 */
  updateSource(e) {
    const key = JSON.stringify(e.heal) + '|' + (this.aiPrev ? this.aiPrevKey : '');
    if (key === this.healKey && this.srcTex) return;
    this.healKey = key;
    const build = (base, tag) => {
      if (!e.heal.length) return base;
      const c = mkCanvas(this.PW, this.PH), x = c.getContext('2d'); x.drawImage(base, 0, 0);
      drawHeals(x, e.heal, base, this.PW, this.PH, { x: 0, y: 0, w: this.PW, h: this.PH }, 1, tag + this.rec.id); return c;
    };
    this.srcTex = Engine.uploadImage(this.srcTex, build(this.prev, 'p'), this.PW, this.PH);
    if (this.aiPrev) this.dnTex = Engine.uploadImage(this.dnTex, build(this.aiPrev, 'pa'), this.PW, this.PH);
  }
  setAiPreview(canvas, key) { this.aiPrev = canvas; this.aiPrevKey = key; this.healKey = null; this.guideKey = ''; }
  ensureSky() {
    if (this.skyTex) return;
    const id = imgData(this.prev, 384); const s = detectSky(id);
    this.skyTex = Engine.uploadImage(null, s.data, s.W, s.H); this.skyLmin = s.lmin; this.skyFrac = s.frac; this.skyYbot = s.ybot;
  }
  brushPreview(e) {
    const out = {};
    for (const m of e.masks) {
      if (m.type !== 'brush') continue;
      const key = JSON.stringify(m.p.strokes);
      if (this.brushKeys[m.id] !== key) {
        const L = 1024, s = L / Math.max(this.SW, this.SH);
        const c = rasterBrush(m, this.SW, this.SH, [0, 0, 1, 1], this.SW * s, this.SH * s);
        const old = this.brushTex[m.id]; this.brushTex[m.id] = { tex: Engine.uploadImage(old && old.tex, c, c.width, c.height), rect: [0, 0, 1, 1] }; this.brushKeys[m.id] = key;
      }
      out[m.id] = this.brushTex[m.id];
    }
    return out;
  }
  lutFor(e) {
    if (!e._lut) return null; const p = CustomProfiles.map.get(e._lut.id); if (!p || !p.data) return null;
    this.lutTex = this.lutTex || {};
    if (!this.lutTex[p.id]) this.lutTex[p.id] = Engine.uploadImage(null, p.data, p.N * p.N, p.N);
    return { tex: this.lutTex[p.id], N: p.N, amt: e._lut.amt };
  }
  srcObj() { const ai = !!this.aiPrev; return { tex: this.srcTex, dn: ai ? this.dnTex : null, rect: [0, 0, 1, 1] }; }
  /* 天空置換參數（貼圖由 SkyLib 產生／快取） */
  skyRepFor(e) {
    const k = e.sky; if (!k || !k.on || !(k.amt > 0)) return null;
    this.ensureSky(); if (!(this.skyFrac > 0.004)) return null;
    const t = SkyLib.texSync(k.preset); if (!t) { SkyLib.load(k.preset).then(() => window.Editor && Editor.ses === this && Editor.changed()); return null; }
    const yb = clamp((this.skyYbot || 0.5) * 1.06, 0.15, 1); const sc = 1 + (k.pos || 0) / 100;
    const wb = Engine.wbGainJS((k.temp || 0) / 100, 0);
    return { mask: this.skyTex, rep: t.tex, box: [0, yb * (1 - sc), 1, yb * sc], lmin: this.skyLmin || 0.3, gaps: (k.gaps || 0) / 100, edge: (k.edge || 0) / 100, amt: k.amt / 100,
      gain: Math.pow(2, k.exp || 0) * t.gain, haze: (k.haze || 0) / 100, flip: !!k.flip, relight: (k.relight || 0) / 100 * 0.6, tgain: wb, avg: t.avg };
  }
  prepare(e, G, pre) {
    this.updateSource(e);
    if (e.masks.some((m) => m.type === 'sky')) this.ensureSky();
    e._skyRep = this.skyRepFor(e);
    const gk = JSON.stringify([e._skyRep ? e.sky : 0, e.exposure, e.temp, e.tint, e.ai.on && this.aiPrev ? e.ai.amt : 0, G.crop, G.F, G.rot, G.flipH, G.flipV, G.distK, e.optics.vigCorr, this.healKey, G.OW, G.OH]);
    const p = pre || 'g';
    if (gk !== this.guideKey || p !== 'g' || !this.guide) {
      const gi = Engine.buildGuide(e, G, this.srcObj(), 512, p);
      if (p === 'g') { this.guide = gi; this.guideKey = gk; this.atmKey = ''; } else return { guide: gi, atm: this.atmFor(e, gi, gk, true) };
    }
    return { guide: this.guide, atm: this.atmFor(e, this.guide, gk) };
  }
  atmFor(e, gi, gk, nocache) {
    const need = e.dehaze !== 0 || e.masks.some((m) => m.adj && m.adj.dehaze);
    if (!need) return [1, 1, 1];
    if (!nocache && this.atmKey === gk && this.atm) return this.atm;
    const a = Engine.estimateAtm(gi); if (!nocache) { this.atm = a; this.atmKey = gk; } return a;
  }
  /* 預覽 */
  renderPreview(e, o = {}) {
    const G = Engine.geometry(e, this.SW, this.SH, o.cropOverride);
    const dens = this.PW / this.SW; const long = o.long || CFG.prevLong;
    const sigma = Math.min(dens / Math.max(e.geo.scale / 100, .25) * 1.0, long / Math.max(G.OW, G.OH), 1);
    const W = Math.max(1, Math.round(G.OW * sigma)), H = Math.max(1, Math.round(G.OH * sigma));
    const { guide, atm } = this.prepare(e, G);
    const target = Engine.work(o.targetName || 'out', W, H, 'u8');
    const viz = o.maskViz ? Engine.work('viz', W, H, 'u8') : null;
    Engine.runPasses({ lut3: this.lutFor(e), e, G, W, H, origin: [0, 0], sigma, src: this.srcObj(), brush: this.brushPreview(e), target, guide: guide.tex, sky: this.skyTex, skyLmin: this.skyLmin, atm, alphaOut: true, maskViz: o.maskViz, vizTarget: viz, pool: 'p' });
    Engine.genMips(target);
    return { tex: target, W, H, sigma, G, viz };
  }
  /* 小縮圖（預設集/設定檔卡片） */
  renderThumb(e, long) {
    const G = Engine.geometry(e, this.SW, this.SH);
    const sigma = long / Math.max(G.OW, G.OH); const W = Math.max(1, Math.round(G.OW * sigma)), H = Math.max(1, Math.round(G.OH * sigma));
    this.updateSource(e);
    if (e.masks.some((m) => m.type === 'sky')) this.ensureSky();
    e._skyRep = this.skyRepFor(e);
    const gi = Engine.buildGuide(e, G, this.srcObj(), 96, 'h'); const atm = this.atmFor(e, gi, '', true);
    const target = Engine.work('thumb', W, H, 'u8');
    Engine.runPasses({ lut3: this.lutFor(e), e, G, W, H, origin: [0, 0], sigma, src: this.srcObj(), brush: this.brushPreview(e), target, guide: gi.tex, sky: this.skyTex, skyLmin: this.skyLmin, atm, pool: 'h' });
    const px = Engine.readTex(target, 0, 0, W, H); const c = mkCanvas(W, H); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), W, H), 0, 0); return c;
  }
  ensureFull() {   // 同時多次呼叫（背景預先載入＋放大）只解碼一次
    if (this.full) return Promise.resolve(this.full);
    if (!this._fullP) this._fullP = this._ensureFull().finally(() => { this._fullP = null; });
    return this._fullP;
  }
  async _ensureFull() {
    if (this.full) return this.full;
    const blob = await DB.get('files', this.rec.id);
    if (!blob && this.rec.rawLazy) {
      const raw = await DB.get('raw', this.rec.id); if (!raw) throw new Error('找不到 RAW 原始檔');
      this.full = await rawFull(raw, this.rec.rawK);
      // 第一次全解析度解碼後，在背景存一份 4:4:4 品質 100 的副本，之後放大／匯出直接讀取（不用再解 RAW）
      if (window.OffscreenCanvas) { const c = this.full, id = this.rec.id; setTimeout(async () => { try { const oc = new OffscreenCanvas(c.width, c.height); oc.getContext('2d').drawImage(c, 0, 0); const b = await oc.convertToBlob({ type: 'image/jpeg', quality: 1 }); oc.width = oc.height = 1; await DB.put('files', b, id); } catch (e) { console.warn('raw cache', e); } }, 1500); }
      if (this.full.width !== this.SW || this.full.height !== this.SH) { this.SW = this.full.width; this.SH = this.full.height; }
      return this.full;
    }
    if (!blob) throw new Error('找不到原始檔');
    this.full = await decodeOriented(blob, (this.rec.convFrom || this.rec.masterOri1) ? 1 : (this.rec.exif && this.rec.exif.orientation) || 1);
    if (this.full.width !== this.SW || this.full.height !== this.SH) { this.SW = this.full.width; this.SH = this.full.height; }
    return this.full;
  }
  /* 全解析度 AI 降噪結果：優先使用雲端結果 → 本機快取 → 重新計算（並存入快取） */
  async ensureFullDn(model, progress, signal, fast) {
    if (this.fullDn.cloud) return this.fullDn.cloud;
    if (this.fullDn[model]) return this.fullDn[model];
    const toCanvas = async (blob, fit) => { const bm = await createImageBitmap(blob); const W = fit ? this.SW : bm.width, H = fit ? this.SH : bm.height; const c = mkCanvas(W, H); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, W, H); bm.close(); return c; };
    const cloud = await DB.get('ai', 'cloud:' + this.rec.id).catch(() => null);
    if (cloud) {
      if (this.rec.rawLazy && this.SW === this.rec.w && !this.full) await this.ensureFull().catch(() => {});
      const bm = await createImageBitmap(cloud); const dw = Math.abs(bm.width - this.SW), dh = Math.abs(bm.height - this.SH);
      if (dw <= 16 && dh <= 16) { const c = mkCanvas(this.SW, this.SH); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, this.SW, this.SH); bm.close(); this.fullDn.cloud = c; return c; }
      bm.close();
    }
    const key = `full:${this.rec.id}:${model}`; const cached = await DB.get('ai', key).catch(() => null);
    if (cached) { const c = await toCanvas(cached); if (c.width === this.SW && c.height === this.SH) { this.fullDn[model] = c; return c; } }
    const full = await this.ensureFull();
    const c = await AI.denoise(full, 0, 0, this.SW, this.SH, model, { progress, signal, fast });
    this.fullDn[model] = c;
    canvasBlob(c, 'image/jpeg', 0.97).then((b) => DB.put('ai', b, key)).catch(() => {});
    return c;
  }
  /* 依輸出區塊計算需要的原圖範圍（像素） */
  srcBox(G, ox, oy, w, h, sigma) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0; const OWs = G.OW * sigma, OHs = G.OH * sigma; const N = 16;
    for (let i = 0; i <= N; i++) for (const [px, py] of [[ox + w * i / N, oy], [ox + w * i / N, oy + h], [ox, oy + h * i / N], [ox + w, oy + h * i / N]]) {
      const s = Engine.outToSrc(G, [px / OWs, py / OHs]); x0 = Math.min(x0, s[0]); y0 = Math.min(y0, s[1]); x1 = Math.max(x1, s[0]); y1 = Math.max(y1, s[1]);
    }
    const SW = this.SW, SH = this.SH;
    let X0 = Math.floor(x0 * SW) - 4, Y0 = Math.floor(y0 * SH) - 4, X1 = Math.ceil(x1 * SW) + 4, Y1 = Math.ceil(y1 * SH) + 4;
    X0 = clamp(X0, 0, SW - 1); Y0 = clamp(Y0, 0, SH - 1); X1 = clamp(X1, X0 + 1, SW); Y1 = clamp(Y1, Y0 + 1, SH);
    return { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 };
  }
  regionCanvas(base, box, scale, heal, tag) {
    const cw = Math.max(1, Math.round(box.w * scale)), ch = Math.max(1, Math.round(box.h * scale));
    const c = mkCanvas(cw, ch), x = c.getContext('2d'); x.drawImage(base, box.x, box.y, box.w, box.h, 0, 0, cw, ch);
    drawHeals(x, heal, base, this.SW, this.SH, box, scale, tag + this.rec.id); return c;
  }
  /* 全解析度（或指定 sigma）渲染一個輸出區塊：x,y,w,h 為輸出像素；回傳工作貼圖與 apron */
  async renderRegion(e, G, x, y, w, h, sigma, o = {}) {
    const ap = 32; const ox = x - ap, oy = y - ap, W = w + ap * 2, H = h + ap * 2;
    const box = this.srcBox(G, ox, oy, W, H, sigma);
    let scale = Math.min(1, sigma * 1.25 / Math.max(.25, Math.min(1, e.geo.scale / 100)));
    const mt = Math.min(Engine.maxTex, 8192); if (box.w * scale > mt || box.h * scale > mt) scale = Math.min(mt / box.w, mt / box.h);
    const full = await this.ensureFull();
    const rc = this.regionCanvas(full, box, scale, e.heal, 'f');
    this.regTex = Engine.uploadImage(this.regTex, rc, rc.width, rc.height);
    let dnTex = null;
    if (e.ai.on) {
      let dnBase = o.dnBase;
      if (!dnBase && o.regionAi) {
        // 只對可見範圍做 AI 降噪（100% 檢視）
        const k = e.ai.model + '|' + JSON.stringify(box) + '|' + scale;
        let c = this.regionDn.get(k);
        if (!c) { c = await AI.denoise(rc, 0, 0, rc.width, rc.height, e.ai.model, { signal: o.signal, progress: o.progress }); if (this.regionDn.size > 6) this.regionDn.clear(); this.regionDn.set(k, c); }
        const rd = mkCanvas(rc.width, rc.height); const rx = rd.getContext('2d'); rx.drawImage(c, 0, 0);
        // 修復貼片也套到降噪版
        const fullDnLike = c; void fullDnLike;
        this.regDnTex = Engine.uploadImage(this.regDnTex, rd, rd.width, rd.height); dnTex = this.regDnTex;
      } else if (dnBase) {
        const dc = this.regionCanvas(dnBase, box, scale, e.heal, 'fd');
        this.regDnTex = Engine.uploadImage(this.regDnTex, dc, dc.width, dc.height); dnTex = this.regDnTex;
      }
    }
    const rect = [box.x / this.SW, box.y / this.SH, box.w / this.SW, box.h / this.SH];
    // 筆刷
    const brush = {};
    for (const m of e.masks) if (m.type === 'brush') {
      const bs = Math.min(1, 1024 / Math.max(box.w, box.h)) * Math.min(1, scale * 2);
      const c = rasterBrush(m, this.SW, this.SH, rect, Math.max(2, box.w * bs), Math.max(2, box.h * bs));
      const t = Engine.uploadImage(null, c, c.width, c.height); brush[m.id] = { tex: t, rect };
    }
    const { guide, atm } = this.prepare(e, G);
    const target = Engine.work(o.targetName || 'tileOut', W, H, 'u8');
    Engine.runPasses({ lut3: this.lutFor(e), e, G, W, H, origin: [ox, oy], sigma, src: { tex: this.regTex, dn: dnTex, rect }, brush, target, guide: guide.tex, sky: this.skyTex, skyLmin: this.skyLmin, atm, alphaOut: !!o.alphaOut, pool: 't' });
    for (const k in brush) Engine.freeTex(brush[k].tex);
    return { tex: target, ap, W, H };
  }
  /* 匯出：分塊渲染整張 */
  async exportPixels(edit, o = {}) {
    const e = effective(normEdit(edit));
    // 輸出銳化（與 Lightroom 匯出的「銳化輸出」相同概念）：補回重新取樣與降噪損失的清晰度
    const os = CFG.exp.osharp || 'std'; if (os !== 'off') { const add = os === 'high' ? 32 : 18; e.sharp.amt = Math.min(150, (e.sharp.amt || 0) + add); if (!e.sharp.rad || e.sharp.amt === add) e.sharp.rad = 0.9; e.sharp.det = Math.max(e.sharp.det || 0, 30); }
    await this.ensureFull();
    const G = Engine.geometry(e, this.SW, this.SH);
    let sigma = 1; if (o.long && o.long < Math.max(G.OW, G.OH)) sigma = o.long / Math.max(G.OW, G.OH);
    const OW = Math.max(1, Math.round(G.OW * sigma)), OH = Math.max(1, Math.round(G.OH * sigma));
    let dnBase = null;
    if (e.ai.on) {
      o.stage && o.stage('AI 降噪（全解析度）');
      dnBase = await this.ensureFullDn(e.ai.model, (f) => o.progress && o.progress(f * 0.6), o.signal, true);
    }
    // 預覽來源與導引圖（全域資訊沿用預覽，以確保與畫面一致）
    if (e.ai.on && !this.aiPrev) { const c = mkCanvas(this.PW, this.PH); c.getContext('2d').drawImage(dnBase, 0, 0, this.PW, this.PH); this.setAiPreview(c, 'exp'); }
    o.stage && o.stage('渲染全解析度影像');
    const out = new Uint8ClampedArray(OW * OH * 4); const T = 1024; const nx = Math.ceil(OW / T), ny = Math.ceil(OH / T); let k = 0;
    for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
      if (o.signal && o.signal.aborted) throw new Error('aborted');
      const x = tx * T, y = ty * T, w = Math.min(T, OW - x), h = Math.min(T, OH - y);
      const r = await this.renderRegion(e, G, x, y, w, h, sigma, { dnBase, alphaOut: o.alpha });
      const px = Engine.readTex(r.tex, r.ap, r.ap, w, h);
      for (let j = 0; j < h; j++) out.set(px.subarray(j * w * 4, (j + 1) * w * 4), ((y + j) * OW + x) * 4);
      k++; o.progress && o.progress((e.ai.on ? 0.6 : 0) + (e.ai.on ? 0.3 : 0.9) * k / (nx * ny));
      await sleep(0);
    }
    return { data: out, W: OW, H: OH };
  }
}

/* ================= 匯出 ================= */
const Exporter = {
  moz: null,
  async mozjpeg() {
    if (this.moz) return this.moz;
    if (!window.MozJpegFactory) return null;
    try { this.moz = await MozJpegFactory({ noInitialRun: true, wasmBinary: b64ToBytes(WASM_MOZJPEG) }); } catch (e) { console.warn('mozjpeg', e); this.moz = null; }
    return this.moz;
  },
  /* AI 畫質增強選項（單張與多張匯出共用） */
  srRow(redraw) {
    const ok = Cloud.ready(); const cur = String(CFG.exp.sr || 0);
    const seg = h('div', { class: 'seg srSeg' }, [['0', '關閉'], ['1', '原尺寸增強'], ['1.5', '放大 1.5×'], ['2', '放大 2×']].map(([k, n]) => h('button', { class: 'btn' + (k === cur ? ' on' : ''), onclick: () => { if (k !== '0' && !Cloud.ready()) { toast('請先到「設定 → 雲端 AI 降噪」連接 GitHub'); return; } CFG.exp.sr = +k; saveCfg(); redraw(); } }, n)));
    return h('div', { class: 'srBox' }, h('div', { class: 'srHd' }, h('b', null, '☁ AI 畫質增強'), h('span', { class: 'sub' }, ok ? '像 OPPO「AI 畫素超高解析度」：雲端以 AI 修復模糊、補回細節與清晰度；可維持原尺寸，或順便放大。2400 萬像素約 10–20 分鐘／張' : '需先在設定連接 GitHub 雲端')), seg);
  },
  fmtFor(rec) {
    const f = CFG.exp.fmt;
    if (f !== 'orig') return f;
    const m = (rec.outMime || rec.mime || '').toLowerCase();
    return m.includes('png') ? 'png' : m.includes('webp') ? 'webp' : 'jpeg';
  },
  nameFor(rec, fmt) {
    if (rec.outName) return rec.outName + '.' + (fmt === 'jpeg' ? ((/\.(jpe?g)$/i.exec(rec.name || '') || [, 'jpg'])[1]) : fmt);
    const name = rec.name || 'photo.jpg'; const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot + 1) : '';
    const ok = fmt === 'jpeg' ? ['jpg', 'jpeg', 'jpe'] : [fmt];
    if (ok.includes(ext.toLowerCase())) return name; // 原檔名完全不變
    return base + '.' + (fmt === 'jpeg' ? 'jpg' : fmt);
  },
  async encode(px, W, H, fmt, q) {
    // 品質 100：瀏覽器內建編碼器本身就是 4:4:4、多執行緒、不卡畫面，比 WebAssembly 快 10 倍以上
    const nativeOk = fmt !== 'jpeg' || q >= 100 || !CFG.exp.sub444;
    if (nativeOk && window.OffscreenCanvas) {
      try {
        const oc = new OffscreenCanvas(W, H); oc.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
        const mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
        const b = await oc.convertToBlob({ type: mime, quality: Math.min(1, q / 100) }); oc.width = oc.height = 1;
        return new Uint8Array(await b.arrayBuffer());
      } catch (e) { console.warn('native encode failed', e); }
    }
    if (fmt === 'jpeg') {
      const m = await this.mozjpeg();
      if (m) {
        try {
          const r = m.encode(px, W, H, { quality: q, baseline: false, arithmetic: false, progressive: true, optimize_coding: true, smoothing: 0, color_space: 3, quant_table: 3, trellis_multipass: false, trellis_opt_zero: false, trellis_opt_table: false, trellis_loops: 1, auto_subsample: !CFG.exp.sub444, chroma_subsample: CFG.exp.sub444 ? 1 : 2, separate_chroma_quality: false, chroma_quality: q });
          return new Uint8Array(r.buffer ? r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) : r);
        } catch (e) { console.warn('mozjpeg encode failed, fallback', e); }
      }
    }
    const c = mkCanvas(W, H); c.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
    const mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
    const b = await canvasBlob(c, mime, q / 100); c.width = c.height = 1;
    return new Uint8Array(await b.arrayBuffer());
  },
  async metaFor(rec, W, H, edit) {
    if (CFG.exp.meta === 'none') return {};
    const blob = rec.rawLazy ? null : await DB.get('files', rec.fixOrig && rec.fixOrig.hadFiles ? rec.id + ':orig' : rec.id);
    let m = { exif: null, xmp: null };
    if (blob) { const buf = await blob.slice(0, Math.min(blob.size, 4 * 1024 * 1024)).arrayBuffer(); m = Meta.extract(buf); }
    else if (rec.rawLazy) {
      // 每次匯出都從 RAW 原檔重新取出相機原始 EXIF（舊版匯入的相片也能補回拍攝時間、曝光補償等）
      let ex = null; try { const raw = await DB.get('raw', rec.id); if (raw) ex = Meta.fromRawTiff(new Uint8Array(await raw.slice(0, 16 << 20).arrayBuffer()), { w: W, h: H, lens: (rec.exif && rec.exif.lens) || '' }); } catch (e) {}
      if (ex && rec.exifBin) { const a = Meta.summary(ex) || {}, b = Meta.summary(new Uint8Array(rec.exifBin)) || {}; if (!a.lat && b.lat) ex = Meta.withGps(ex, { lat: b.lat, lon: b.lon, alt: b.alt }); }
      m.exif = ex || (rec.exifBin ? new Uint8Array(rec.exifBin) : null);
    }
    const strip = CFG.exp.meta === 'nogps';
    let exif = m.exif ? Meta.patch(m.exif, { w: W, h: H, stripGps: strip }) : null, xmp = m.xmp ? Meta.patchXmp(m.xmp, { w: W, h: H, stripGps: strip }) : null;
    const loc = edit && edit.loc;
    if (loc && isFinite(loc.lat) && isFinite(loc.lon)) { exif = Meta.withGps(exif, loc); xmp = Meta.xmpLoc(xmp, loc); }
    return { exif, xmp, loc: !!loc };
  },
  async save(name, mime, bytes) {
    if (isApp) {
      const tok = NAT.call('saveBegin', name, mime);
      if (!tok) throw new Error('無法建立檔案');
      const C = 512 * 1024;
      for (let i = 0; i < bytes.length; i += C) { if (!NAT.call('saveChunk', tok, bytesToB64(bytes.subarray(i, i + C)))) throw new Error('寫入失敗'); if ((i / C) % 8 === 7) await sleep(0); }
      const r = NAT.json('saveEnd', tok); if (!r || !r.ok) throw new Error((r && r.err) || '儲存失敗'); return r;
    }
    const blob = new Blob([bytes], { type: mime });
    // 在 claude.ai 頁面中：使用平台的下載功能（會顯示確認）
    try {
      const dl = window.claude && window.claude.use ? await Promise.race([window.claude.use('downloads'), sleep(3000).then(() => null)]) : null;
      if (dl) { await dl.save({ filename: name, data: blob }); return { ok: true, where: '下載資料夾' }; }
    } catch (e) { if (e && e.code === 'declined') throw new Error('已取消下載'); console.warn('downloads', e); }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000); this.lastBlob = { blob, name };
    return { ok: true, where: '瀏覽器下載資料夾' };
  },
  /* 匯出多張 */
  /* 匯出一律排隊執行；opt.silent＝背景匯出（雲端完成後自動匯出用）：不跳出全螢幕進度框，只用通知列與小提示 */
  run(recs, getEdit, opt = {}) { const p = (this.chain || Promise.resolve()).then(() => this._run(recs, getEdit, opt)); this.chain = p.catch(() => {}); return p; },
  async _run(recs, getEdit, opt) {
    const box = $('#expProg'); if (!opt.silent) box.classList.add('on'); const ctl = { aborted: false };
    if (opt.silent) { toast(`☁ 雲端結果已回傳，背景匯出 ${recs.length} 張到相簿…`, 3000); BG.set('export', `背景匯出 0 / ${recs.length}`, 0); }
    $('#epCancel').onclick = () => { ctl.aborted = true; $('#epTx').textContent = '取消中…'; };
    const done = []; let fail = 0;
    try {
      for (let i = 0; i < recs.length; i++) {
        if (ctl.aborted) break;
        const rec = recs[i]; const fmt = this.fmtFor(rec); const name = this.nameFor(rec, fmt);
        $('#epTitle').textContent = `匯出中 ${i + 1} / ${recs.length}`; $('#epTx').textContent = name; $('#epSub').textContent = '';
        if (opt.silent) BG.set('export', `背景匯出 ${i + 1} / ${recs.length}：${name}`, Math.round(i / recs.length * 100));
        const setP = (f) => { $('#epBar').style.width = Math.round(((i + clamp(f, 0, 1)) / recs.length) * 100) + '%'; };
        setP(0);
        let ses = (window.Editor && Editor.ses && Editor.ses.rec.id === rec.id) ? Editor.ses : null; const own = !ses;
        try {
          if (own) { ses = new Session(rec); await ses.load(); }
          const edit = await refreshLens(rec, normEdit(getEdit(rec)));
          const r = await ses.exportPixels(edit, { long: CFG.exp.size === 'orig' ? 0 : CFG.exp.long, alpha: fmt !== 'jpeg', signal: ctl, progress: (f) => setP(f * 0.92), stage: (s) => ($('#epSub').textContent = s) });
          $('#epSub').textContent = '編碼（' + (fmt === 'jpeg' ? `JPEG 品質 ${CFG.exp.q}${CFG.exp.sub444 ? '・4:4:4' : ''}` : fmt.toUpperCase()) + '）';
          await sleep(30);
          let bytes = await this.encode(r.data, r.W, r.H, fmt, CFG.exp.q);
          const meta = await this.metaFor(rec, r.W, r.H, normEdit(edit));
          bytes = fmt === 'jpeg' ? Meta.jpeg(bytes, meta) : fmt === 'png' ? Meta.png(bytes, meta) : Meta.webp(bytes, meta, r.W, r.H);
          setP(0.97);
          const mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
          if (opt.sr && fmt === 'jpeg') { (this.srList = this.srList || []).push({ name, bytes, meta }); done.push({ name, W: r.W, H: r.H, size: bytes.length, exif: !!meta.exif, res: { where: '雲端' }, sr: true }); setP(1); continue; }
          const res = await this.save(name, mime, bytes);
          done.push({ name, W: r.W, H: r.H, size: bytes.length, exif: !!meta.exif, res });
          setP(1);
        } catch (err) {
          if (String(err.message).includes('aborted')) break;
          console.error(err); fail++; toast(`「${name}」匯出失敗：${err.message}`, 4000);
        } finally { if (own && ses) ses.dispose(); }
      }
    } finally { if (!opt.silent) box.classList.remove('on'); }
    if (this.srList && this.srList.length) { const l = this.srList; this.srList = null; try { await Cloud.enqueueSR(l, opt.srScale || 2); } catch (e) { toast('無法送出 AI 畫質增強：' + e.message, 5000); } return done; }
    if (opt.silent) { BG.end('export'); if (done.length) { toast(`✓ 已背景匯出 ${done.length} 張到「圖片／AI修圖軟體」`, 3500); NAT.call('notifyDone', '自動匯出完成', `${done.length} 張已存到 圖片／AI修圖軟體`); } return done; }
    if (done.length) {
      const d = done[0];
      const where = isApp ? '圖片 / AI修圖軟體' : d.res.where;
      UI.sheet('匯出完成', h('div', null,
        h('div', { class: 'kv2' }, h('b', null, '檔案'), h('span', null, done.length === 1 ? d.name : `${done.length} 張相片`),
          h('b', null, '尺寸'), h('span', null, done.length === 1 ? `${d.W} × ${d.H}（原始畫質）` : '原始尺寸'),
          h('b', null, '大小'), h('span', null, fmtBytes(done.reduce((a, b) => a + b.size, 0))),
          h('b', null, 'EXIF'), h('span', null, CFG.exp.meta === 'none' ? '已移除' : done.every((x) => x.exif) ? (CFG.exp.meta === 'nogps' ? '已保留（移除位置）' : '已完整保留') : '原檔無 EXIF 或部分保留'),
          h('b', null, '位置'), h('span', null, where)),
        fail ? h('div', { class: 'note' }, `${fail} 張失敗`) : null,
        h('div', { class: 'acts' }, isApp ? h('button', { class: 'btn', onclick: () => { NAT.call('shareLast'); } }, '分享') : null, h('button', { class: 'btn pri', onclick: () => UI.close() }, '好'))));
    }
  }
};
