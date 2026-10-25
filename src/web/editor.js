/* ================= ② 編輯 ================= */
/* 滑桿定義：UI 數值（像 Lightroom 的 -100～+100）↔ 引擎參數 */
const SL = {
  exposure: { n: '曝光', min: -5, max: 5, step: 0.05, to: v => v, from: p => p, fmt: v => (v > 0 ? '+' : '') + v.toFixed(2) },
  contrast: { n: '對比', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  highlights: { n: '亮部', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  shadows: { n: '陰影', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  whites: { n: '白色', min: -100, max: 100, to: v => v / 100 * 1.5, from: p => p / 1.5 * 100 },
  blacks: { n: '黑色', min: -100, max: 100, to: v => v / 100 * 1.5, from: p => p / 1.5 * 100 },
  temp: { n: '色溫', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  tint: { n: '色調', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  vibrance: { n: '鮮豔度', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  saturation: { n: '飽和度', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  texture: { n: '紋理', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  clarity: { n: '清晰度', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  dehaze: { n: '去朦朧', min: -100, max: 100, to: v => v / 100, from: p => p * 100 },
  sharpen: { n: '銳利化', min: 0, max: 150, to: v => v / 100, from: p => p * 100 },
  nr: { n: '雜訊減少', min: 0, max: 100, to: v => v / 100, from: p => p * 100 },
  cnr: { n: '彩色雜訊', min: 0, max: 100, to: v => v / 100, from: p => p * 100 },
  defringeP: { n: '去紫邊', min: 0, max: 100, to: v => v / 100, from: p => p * 100 },
  defringeG: { n: '去綠邊', min: 0, max: 100, to: v => v / 100, from: p => p * 100 }
};
const HSL_NAMES = ['紅', '橙', '黃', '綠', '青', '藍', '紫', '洋紅'], HSL_COL = ['#d9483b', '#e8873a', '#e6c43c', '#5aa84a', '#3fb3b0', '#3f73d6', '#8a55c9', '#cf4fa0'];
const TABS = [['auto', '✨ 自動'], ['light', '☀️ 光線'], ['color', '🎨 顏色'], ['fx', '🌫 效果'], ['detail', '🔍 細節'], ['lens', '🔭 鏡頭'], ['geo', '📍 地點']];
function newEdit() { return { P: {}, lens: { on: true, dist: 1, vig: 1, ca: true }, tmpl: { on: true, amt: CFG.tmplAmt }, atm: 0, hsl: Array.from({ length: 8 }, () => [0, 0, 0]), curve: null, gps: null, ai: false }; }

const Editor = {
  p: null, e: null, tab: 'auto', busy: false, pending: null, undo: [], hslBand: 3, loaded: null, W: mkWorker(),
  init() {
    $('#edBack').onclick = () => App.show('v-lib');
    $('#edExport').onclick = () => this.p && Exporter.sheet([this.p]);
    $('#edUndo').onclick = () => this.doUndo();
    $('#edMenu').onclick = () => this.menu();
    $('#edTabs').innerHTML = TABS.map(([k, n]) => `<button class="btn ${k === this.tab ? 'on' : ''}" data-t="${k}">${n}</button>`).join('');
    $('#edTabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { this.tab = b.dataset.t; $$('#edTabs .btn').forEach(x => x.classList.toggle('on', x === b)); this.tools(); } };
    this.gestures(); this.tools();
  },
  /* 把照片載入背景執行緒（半尺寸解碼做預覽） */
  async load(p, o = {}) {
    if (this.loaded === p.id && !o.force) { this.p = p; this.e = p.edit || newEdit(); return; }
    Lib.ensure(p);
    if (!o.quiet) this.setBusy('讀取 RAW…');
    const bytes = await photoBytes(p);
    const meta = EXIF.parse(bytes) || {}; p.meta = Object.assign(p.meta || {}, slimMeta(meta));
    this.e = p.edit || newEdit(); this.p = p;
    if (p.raw) {
      if (!o.quiet) this.setBusy('解碼 RAW…');
      const d = await RAW.decode(bytes, true);
      if (!o.quiet) this.setBusy('建立預覽…');
      const r = await this.W.call('load', { kind: 'raw', key: p.key, u16: d.u16, w: d.w, h: d.h, flip: d.flip, meta: p.meta, lens: this.e.lens }, [d.u16.buffer]);
      this.lensKind = r.lens; p.flip = d.flip;
    } else {
      const r = await this.W.call('load', { kind: 'rgb', key: 'JPEG', bytes }, [bytes.buffer]); this.lensKind = '';
    }
    this.loaded = p.id;
  },
  async open(p) {
    App.show('v-edit');
    $('#edName').textContent = p.name; $('#edInfo').textContent = this.info(p);
    $('#edEmpty').classList.add('hide');
    try {
      await this.load(p);
      if (!p.edit) { p.edit = this.e; if (CFG.autoAI) await this.runAI(true); }
      this.undo = []; this.tools(); await this.render(false); this.setBusy(null);
      $('#edCv').style.display = 'block'; $('#edHist').style.display = 'block';
    } catch (e) { this.setBusy(null); toast('無法開啟：' + e.message, 5000); console.error(e); }
  },
  info(p) { const m = p.meta || {}; return [camName(p.key), m.lens, m.focal ? Math.round(m.focal) + 'mm' : '', m.fnum ? 'f/' + (+m.fnum).toFixed(1) : '', m.exposure ? (m.exposure < 1 ? '1/' + Math.round(1 / m.exposure) : m.exposure + '"') : '', m.iso ? 'ISO ' + m.iso : ''].filter(Boolean).join('・'); },
  setBusy(t) { $('#edBusy').classList.toggle('hide', !t); if (t) $('#edBusyT').textContent = t; },
  /* 合成引擎參數 */
  params(e) {
    e = e || this.e; const P = Object.assign({}, E_DEF(), e.P);
    const T = TEMPLATES[this.p && this.p.key]; if (e.tmpl && e.tmpl.on && T) { P.look = T.hsl; P.lookAmt = e.tmpl.amt; }
    if (e.atm > 0) { P.grade = LOOKS.atmosphere.grade; P.gradeAmt = e.atm; }
    if (e.hsl && e.hsl.some(b => b.some(v => v))) P.hsl = e.hsl.map(([hh, s, l]) => [hh * 0.3, 1 + s / 100, l * 0.2]);
    if (e.curve && e.curve.length >= 2) P.curve = e.curve;
    return P;
  },
  lensP(e) { e = e || this.e; return Object.assign({ on: true, dist: 1, vig: 1, ca: true }, e.lens); },
  /* 渲染（fast：拖曳中用小圖） */
  async render(fast) {
    if (!this.p) return;
    if (this.busy) { this.pending = fast; return; }
    this.busy = true;
    try {
      const r = await this.W.call('render', { P: this.params(), lens: this.lensP(), fast, hist: !fast });
      this.draw(r); if (r.hist) this.drawHist(r.hist);
    } catch (e) { toast('預覽失敗：' + e.message); }
    this.busy = false;
    if (this.pending != null) { const f = this.pending; this.pending = null; this.render(f); }
  },
  draw(r) {
    const cv = $('#edCv'); if (cv.width !== r.w || cv.height !== r.h) { cv.width = r.w; cv.height = r.h; }
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.px.buffer || r.px), r.w, r.h), 0, 0);
    this.last = r;
  },
  drawHist(H) {
    const cv = $('#edHist'), x = cv.getContext('2d'), w = cv.width, hh = cv.height; x.clearRect(0, 0, w, hh);
    let mx = 1; for (let i = 0; i < 256; i++) if ((i & 63) > 0 && (i & 63) < 63) mx = Math.max(mx, H[i]);
    const cols = ['rgba(220,70,60,.55)', 'rgba(80,170,80,.55)', 'rgba(70,110,220,.55)', 'rgba(60,50,40,.35)'];
    x.globalCompositeOperation = 'source-over';
    for (let c = 0; c < 4; c++) { x.fillStyle = cols[c]; x.beginPath(); x.moveTo(0, hh); for (let i = 0; i < 64; i++) x.lineTo(i / 63 * w, hh - Math.min(1, H[c * 64 + i] / mx) * (hh - 4)); x.lineTo(w, hh); x.fill(); }
  },
  snapshot() { this.undo.push(JSON.stringify(this.e)); if (this.undo.length > 40) this.undo.shift(); },
  doUndo() { if (!this.undo.length) { toast('沒有可復原的步驟'); return; } this.e = JSON.parse(this.undo.pop()); this.p.edit = this.e; this.commit(); this.tools(); },
  commit() { this.p.edit = this.e; clearTimeout(this._sv); this._sv = setTimeout(() => { Lib.save(this.p); }, 600); this.render(false); },
  async saveThumb() {
    try { const r = await this.W.call('thumb', { P: this.params(), size: 420 }); const b = new Blob([r.jpg], { type: 'image/jpeg' }); this.p.thumb = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); this.p.port = r.h > r.w; await Lib.save(this.p); } catch (e) { }
  },
  /* AI 自動：依相機模板（你的修圖風格）閉迴路找出滑桿數值 */
  async runAI(quiet) {
    const T = TEMPLATES[this.p.key] && this.e.tmpl.on ? this.p.key : null;
    if (!quiet) this.setBusy('AI 分析中…');
    this.W.onProg = f => { if (!quiet) this.setBusy(`AI 分析中… ${Math.round(f * 100)}%`); };
    const r = await this.W.call('auto', { tmpl: T });
    this.W.onProg = null;
    const keep = { defringeP: this.e.P.defringeP, defringeG: this.e.P.defringeG };
    const P = {}; for (const k in SL) if (r.P[k] != null && !/^defringe/.test(k)) P[k] = Math.round(r.P[k] * 1000) / 1000;
    if (keep.defringeP != null) P.defringeP = keep.defringeP; if (keep.defringeG != null) P.defringeG = keep.defringeG;
    if (P.defringeP == null) P.defringeP = 0.5; if (P.defringeG == null) P.defringeG = 0.3;
    this.e.P = P; this.e.ai = { at: Date.now(), haze: r.P._haze, noise: r.P._noise };
    this.p.edit = this.e; await Lib.save(this.p);
    if (!quiet) { this.setBusy(null); this.tools(); await this.render(false); this.saveThumb(); toast(T ? `已依「${camName(T)}」模板自動調整` : '已自動調整'); }
  },
  /* ---------- 工具面板 ---------- */
  slider(k, v) {
    const d = SL[k]; const ui = d.from(v == null ? E_DEF()[k] : v); const def = d.from(E_DEF()[k]);
    const show = d.fmt ? d.fmt(ui) : Math.round(ui);
    return `<div class="sl ${Math.abs(ui - def) > 1e-6 ? 'changed' : ''}" data-k="${k}"><label>${d.n}</label><input type="range" min="${d.min}" max="${d.max}" step="${d.step || 1}" value="${ui}"><output>${show}</output></div>`;
  },
  tools() {
    const el = $('#edTools'), e = this.e || newEdit(), P = e.P, t = this.tab, key = this.p && this.p.key;
    const T = TEMPLATES[key], s = k => this.slider(k, P[k]);
    let html = '';
    if (!this.p) { el.innerHTML = '<div class="sub">尚未開啟照片</div>'; return; }
    if (t === 'auto') {
      html = `<div class="aiBox"><button class="btn pri" id="tAI">🤖 AI 自動調整</button><button class="btn" id="tAtm">🌅 AI 氛圍感</button></div>
        <div class="note">${T ? `相機模板：<b>${esc(camName(key))}</b>（從你的修圖成品學到的色調與 HSL）。` : `這台相機（${esc(camName(key))}）還沒有專屬模板，使用通用規則。`}AI 只會把結果寫成下面的滑桿數值，你可以再微調；不會整張套顏色、不會製造色偏。${e.ai && e.ai.haze != null ? `<br>偵測：霧氣 ${(e.ai.haze * 100 | 0)}・雜訊 ${(e.ai.noise * 1000).toFixed(1)}` : ''}</div>
        ${T ? `<div class="lab"><span>套用相機模板</span><label class="sw"><input type="checkbox" id="tTm" ${e.tmpl.on ? 'checked' : ''}><span></span></label></div>
        <div class="sl" data-x="tmpl"><label>模板強度</label><input type="range" min="0" max="150" value="${Math.round(e.tmpl.amt * 100)}"><output>${Math.round(e.tmpl.amt * 100)}%</output></div>` : ''}
        <div class="sl" data-x="atm"><label>氛圍感</label><input type="range" min="0" max="100" value="${Math.round(e.atm * 100)}"><output>${Math.round(e.atm * 100)}</output></div>
        <div class="note">氛圍感＝從你的樹林光束前後對照學到的調法（亮部金色、暗部壓深、陰影青綠），是刻意的色調，強度自己決定；最適合逆光、有霧、有光束的場景。</div>
        <div class="acts"><button class="btn sm" id="tReset">↺ 全部重設</button><button class="btn sm" id="tCopy">📋 複製設定</button><button class="btn sm" id="tPaste">📥 貼上設定</button></div>`;
    } else if (t === 'light') {
      html = s('exposure') + s('contrast') + s('highlights') + s('shadows') + s('whites') + s('blacks') +
        `<div class="sec">點曲線 <button class="btn sm" id="crvR" style="float:right">重設</button></div><canvas class="crv" id="crv" width="600" height="375"></canvas><div class="sub">點一下新增控制點、拖曳調整、雙擊刪除</div>`;
    } else if (t === 'color') {
      const b = this.hslBand, v = e.hsl[b];
      html = s('temp') + s('tint') + s('vibrance') + s('saturation') +
        `<div class="sec">HSL／顏色混合</div><div class="hslBands">${HSL_COL.map((c, i) => `<button style="background:${c}" class="${i === b ? 'on' : ''}" data-b="${i}" title="${HSL_NAMES[i]}"></button>`).join('')}</div>
        ${['色相', '飽和度', '明亮度'].map((n, j) => `<div class="sl ${v[j] ? 'changed' : ''}" data-h="${j}"><label>${HSL_NAMES[b]}・${n}</label><input type="range" min="-100" max="100" value="${v[j]}"><output>${v[j]}</output></div>`).join('')}`;
    } else if (t === 'fx') {
      html = s('texture') + s('clarity') + s('dehaze') + `<div class="sl" data-x="atm"><label>氛圍感</label><input type="range" min="0" max="100" value="${Math.round(e.atm * 100)}"><output>${Math.round(e.atm * 100)}</output></div>`;
    } else if (t === 'detail') {
      html = s('sharpen') + s('nr') + s('cnr') + `<div class="note">手機上的雜訊減少是輕量版，方便預覽。要把噪點和彩噪「完全清乾淨又不糊」，匯出時勾選「☁️ 雲端 AI 降噪」：照片會加密上傳到你的 GitHub，由 SCUNet AI 模型在全解析度處理後傳回。</div>`;
    } else if (t === 'lens') {
      const L = this.lensP(e), src = this.lensKind === 'sony' ? 'Sony 機身內嵌鏡頭校正資料（變形、暗角、色差）' : this.lensKind === 'db' ? '鏡頭資料庫（依相機直出 JPG 反推）' : this.p.raw ? '這顆鏡頭沒有校正資料' : 'JPG 已由相機校正';
      html = `<div class="lab"><span>啟用描述檔校正<div class="sub">${esc(src)}</div></span><label class="sw"><input type="checkbox" id="lOn" ${L.on ? 'checked' : ''}><span></span></label></div>
        <div class="sl" data-l="dist"><label>變形</label><input type="range" min="0" max="200" value="${Math.round(L.dist * 100)}"><output>${Math.round(L.dist * 100)}%</output></div>
        <div class="sl" data-l="vig"><label>暗角</label><input type="range" min="0" max="200" value="${Math.round(L.vig * 100)}"><output>${Math.round(L.vig * 100)}%</output></div>
        <div class="lab"><span>移除色差（橫向，紅／藍邊）</span><label class="sw"><input type="checkbox" id="lCa" ${L.ca ? 'checked' : ''}><span></span></label></div>
        <div class="sec">去邊（縱向色差：高對比邊緣的紫邊、綠邊）</div>` + s('defringeP') + s('defringeG');
    } else if (t === 'geo') {
      const g = e.gps, m = this.p.meta || {};
      html = `<div class="note">${g ? `📍 <b>${esc(g.name || '自訂地點')}</b><br>${esc(g.addr || '')}<br><code>${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}</code>` : m.lat != null ? `原始照片 GPS：<code>${(+m.lat).toFixed(6)}, ${(+m.lon).toFixed(6)}</code>` : '這張照片還沒有地點'}</div>
        <div class="acts"><button class="btn pri" id="gSet">🗺 在地圖上搜尋地點</button>${g ? '<button class="btn" id="gDel">移除</button>' : ''}</div>
        <div class="sub">匯出時會把座標寫進 EXIF 的 GPS 欄位（緯度、經度、地點名稱），其餘原始 EXIF 與拍攝時間保持不變。</div>`;
    }
    el.innerHTML = html; this.bind();
  },
  bind() {
    const e = this.e;
    $$('#edTools .sl').forEach(row => {
      const inp = row.querySelector('input'), out = row.querySelector('output');
      const k = row.dataset.k, x = row.dataset.x, hj = row.dataset.h, lk = row.dataset.l;
      let snap = false;
      const apply = (fin) => {
        const v = +inp.value; if (!snap) { this.snapshot(); snap = true; }
        if (k) { e.P[k] = SL[k].to(v); out.textContent = SL[k].fmt ? SL[k].fmt(v) : Math.round(v); }
        if (x === 'tmpl') { e.tmpl.amt = v / 100; out.textContent = v + '%'; }
        if (x === 'atm') { e.atm = v / 100; out.textContent = v; }
        if (hj != null) { e.hsl[this.hslBand][+hj] = v; out.textContent = v; }
        if (lk) { e.lens = this.lensP(); e.lens[lk] = v / 100; out.textContent = v + '%'; }
        row.classList.toggle('changed', true);
        if (fin) { snap = false; this.commit(); } else this.render(true);
      };
      inp.oninput = () => apply(false); inp.onchange = () => apply(true);
      out.onclick = () => { if (k) { this.snapshot(); delete e.P[k]; this.commit(); this.tools(); } };   // 點數字＝回到預設
      row.querySelector('label').ondblclick = out.onclick;
    });
    const on = (id, f) => { const b = $('#' + id); if (b) b.onclick = f; };
    on('tAI', () => { this.snapshot(); this.runAI(false); });
    on('tAtm', async () => { this.snapshot(); if (!this.e.ai) await this.runAI(true); this.e.atm = 0.85; this.commit(); this.tools(); toast('已套用氛圍感 85%，可用滑桿調整強度'); });
    const tm = $('#tTm'); if (tm) tm.onchange = () => { this.snapshot(); e.tmpl.on = tm.checked; this.commit(); };
    on('tReset', async () => { if (await ask('全部重設？', '清除這張照片的所有調整（地點保留）。', ['重設', '取消']) !== 0) return; this.snapshot(); const g = e.gps; this.e = newEdit(); this.e.gps = g; this.commit(); this.tools(); });
    on('tCopy', () => { lsSet('aip.clip', { P: e.P, tmpl: e.tmpl, atm: e.atm, hsl: e.hsl, curve: e.curve, lens: e.lens }); toast('已複製修圖設定'); });
    on('tPaste', () => { const c = lsGet('aip.clip', null); if (!c) { toast('還沒有複製的設定'); return; } this.snapshot(); Object.assign(this.e, JSON.parse(JSON.stringify(c))); this.commit(); this.tools(); toast('已貼上修圖設定'); });
    $$('#edTools .hslBands [data-b]').forEach(b => b.onclick = () => { this.hslBand = +b.dataset.b; this.tools(); });
    const lOn = $('#lOn'); if (lOn) lOn.onchange = () => { this.snapshot(); e.lens = this.lensP(); e.lens.on = lOn.checked; this.commit(); };
    const lCa = $('#lCa'); if (lCa) lCa.onchange = () => { this.snapshot(); e.lens = this.lensP(); e.lens.ca = lCa.checked; this.commit(); };
    on('gSet', () => { Geo.target = [this.p.id]; App.show('v-geo'); });
    on('gDel', () => { this.snapshot(); e.gps = null; this.commit(); this.tools(); Lib.render(); });
    if ($('#crv')) this.curveUI();
  },
  /* 點曲線編輯器 */
  curveUI() {
    const cv = $('#crv'), x = cv.getContext('2d'), W = cv.width, H = cv.height, e = this.e;
    let pts = e.curve ? e.curve.map(p => p.slice()) : [[0, 0], [255, 255]], drag = -1, lastTap = 0;
    const toXY = p => [p[0] / 255 * W, H - p[1] / 255 * H], fromEv = ev => { const r = cv.getBoundingClientRect(); return [clamp((ev.clientX - r.left) / r.width * 255, 0, 255), clamp((1 - (ev.clientY - r.top) / r.height) * 255, 0, 255)]; };
    const draw = () => {
      x.clearRect(0, 0, W, H); x.strokeStyle = 'rgba(125,108,87,.35)'; x.lineWidth = 1;
      for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * W / 4, 0); x.lineTo(i * W / 4, H); x.moveTo(0, i * H / 4); x.lineTo(W, i * H / 4); x.stroke(); }
      if (this.last && this.lastHist) { }
      const L = ENG.curveLUT(pts); x.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ac'); x.lineWidth = 4; x.beginPath();
      for (let i = 0; i <= 256; i++) { const v = L ? L[Math.round(i / 256 * 1024)] : i / 256; i ? x.lineTo(i / 256 * W, H - v * H) : x.moveTo(0, H - v * H); } x.stroke();
      pts.forEach(p => { const [a, b] = toXY(p); x.fillStyle = '#fff'; x.beginPath(); x.arc(a, b, 11, 0, 7); x.fill(); x.strokeStyle = '#3a2e22'; x.lineWidth = 2; x.stroke(); });
    };
    const near = q => { let bi = -1, bd = 1e9; pts.forEach((p, i) => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) { bd = d; bi = i; } }); return bd < 22 ? bi : -1; };
    cv.onpointerdown = ev => { cv.setPointerCapture(ev.pointerId); const q = fromEv(ev); drag = near(q); const now = Date.now();
      if (drag >= 0 && now - lastTap < 300 && pts.length > 2 && drag > 0 && drag < pts.length - 1) { pts.splice(drag, 1); drag = -1; apply(true); return; }
      lastTap = now; if (drag < 0) { pts.push(q); pts.sort((a, b) => a[0] - b[0]); drag = pts.indexOf(q); } this.snapshot(); draw(); };
    cv.onpointermove = ev => { if (drag < 0) return; const q = fromEv(ev); const lo = drag > 0 ? pts[drag - 1][0] + 2 : 0, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 2 : 255; pts[drag] = [drag === 0 ? Math.min(q[0], hi) : drag === pts.length - 1 ? Math.max(q[0], lo) : clamp(q[0], lo, hi), q[1]]; apply(false); };
    cv.onpointerup = () => { if (drag >= 0) apply(true); drag = -1; };
    const apply = fin => { const ident = pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255; e.curve = ident ? null : pts.map(p => [Math.round(p[0]), Math.round(p[1])]); draw(); fin ? this.commit() : this.render(true); };
    $('#crvR').onclick = () => { this.snapshot(); pts = [[0, 0], [255, 255]]; apply(true); };
    draw();
  },
  /* 預覽操作：雙指縮放／拖曳、雙擊放大、按住看原圖 */
  gestures() {
    const st = $('#edStage'), cv = $('#edCv'); let sc = 1, tx = 0, ty = 0, pts = new Map(), d0 = 0, s0 = 1, p0 = null, holdT = 0, lastTap = 0, moved = false;
    const set = () => { cv.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; };
    st.onpointerdown = ev => {
      pts.set(ev.pointerId, [ev.clientX, ev.clientY]); moved = false;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); s0 = sc; clearTimeout(holdT); }
      else { p0 = [ev.clientX - tx, ev.clientY - ty]; holdT = setTimeout(() => this.showOriginal(true), 380); }
    };
    st.onpointermove = ev => {
      if (!pts.has(ev.pointerId)) return; const prev = pts.get(ev.pointerId); pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (Math.hypot(ev.clientX - prev[0], ev.clientY - prev[1]) > 3) { moved = true; clearTimeout(holdT); }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; sc = clamp(s0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / d0, 1, 6); set(); }
      else if (sc > 1 && p0) { tx = ev.clientX - p0[0]; ty = ev.clientY - p0[1]; set(); }
    };
    const up = ev => {
      pts.delete(ev.pointerId); clearTimeout(holdT); this.showOriginal(false);
      if (!moved && pts.size === 0) { const now = Date.now(); if (now - lastTap < 300) { if (sc > 1) { sc = 1; tx = ty = 0; } else { sc = 2.5; const r = st.getBoundingClientRect(); tx = (r.width / 2 - (ev.clientX - r.left)) * 1.5; ty = (r.height / 2 - (ev.clientY - r.top)) * 1.5; } set(); } lastTap = now; }
      if (sc <= 1.01) { sc = 1; tx = ty = 0; set(); }
    };
    st.onpointerup = up; st.onpointercancel = up;
  },
  async showOriginal(on) {
    if (!this.p) return;
    $('#edBA').classList.toggle('hide', !on);
    if (on) { this._orig = true; try { const r = await this.W.call('original', {}); if (this._orig) { const keep = this.last; this.draw(r); this.last = keep; } } catch (e) { } }
    else if (this._orig) { this._orig = false; if (this.last) this.draw(this.last); }
  },
  async menu() {
    if (!this.p) return;
    const i = await ask('⋯ 更多', `<div class="sub">${esc(this.info(this.p))}</div>`, ['📋 套用這組設定到其他照片', '🔄 重新讀取原檔', '關閉']);
    if (i === 0) { lsSet('aip.clip', { P: this.e.P, tmpl: this.e.tmpl, atm: this.e.atm, hsl: this.e.hsl, curve: this.e.curve, lens: this.e.lens }); App.show('v-lib'); Lib.setSel(true); toast('已複製設定；選取照片後，到編輯頁「📥 貼上設定」或批次匯出時套用'); }
    if (i === 1) { this.loaded = null; this.open(this.p); }
  }
};
const E_DEF = () => ENG.DEFAULTS;
