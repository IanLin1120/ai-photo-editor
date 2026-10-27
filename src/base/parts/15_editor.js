/* ================= 編輯器 ================= */
const ICONS = {
  aifix: '<path d="M4 20L15 9"/><path d="M13.5 7.5l3 3"/><path d="M17 3v3M15.5 4.5h3M20 8v2M19 9h2M10 3v2M9 4h2"/>',
  presets: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  crop: '<path d="M6 2v14a2 2 0 002 2h14"/><path d="M2 6h14a2 2 0 012 2v14"/>',
  edit: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.3"/><circle cx="10" cy="17" r="2.3"/>',
  mask: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.6"/><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" opacity=".35"/>',
  heal: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"/><circle cx="12" cy="12" r=".6" fill="currentColor"/><circle cx="10.4" cy="12" r=".6" fill="currentColor"/><circle cx="13.6" cy="12" r=".6" fill="currentColor"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  versions: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  loc: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'
};
const svg = (k, sw = 1.9) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
const TOOLS = [['presets', '預設集'], ['crop', '裁切'], ['edit', '編輯'], ['mask', '遮色片'], ['heal', '修復'], ['ai', 'AI 降噪'], ['aifix', 'AI 修復'], ['loc', '位置'], ['versions', '版本']];
const SUBS = [['auto', 'AI 自動'], ['sky', '天空'], ['profile', '設定檔'], ['light', '光線'], ['curve', '曲線'], ['color', '色彩'], ['effects', '效果'], ['detail', '細節'], ['optics', '光學'], ['geo', '幾何']];
const HUES = [['紅', '#d8443a', 0], ['橙', '#e88a2e', 30], ['黃', '#e6c535', 60], ['綠', '#4fa34a', 120], ['淺綠', '#3fb8b0', 180], ['藍', '#3d6fd1', 240], ['紫', '#7a4fc9', 270], ['洋紅', '#c94fae', 300]];
const RATIOS = [['free', '自由'], ['orig', '原始'], ['1:1', '1:1'], ['4:5', '4:5'], ['5:4', '5:4'], ['3:2', '3:2'], ['2:3', '2:3'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:3', '4:3'], ['3:4', '3:4']];
const MASK_TYPES = [['brush', '筆刷', '🖌'], ['linear', '線性漸層', '▤'], ['radial', '放射狀漸層', '◎'], ['sky', '選取天空', '☁'], ['lum', '明亮度範圍', '◐'], ['zone', '亮暗分區（平滑）', '◑'], ['color', '顏色範圍', '🎨'], ['all', '整張影像', '▣']];

const Editor = {
  active: false, ses: null, rec: null, edit: null, hist: [], hi: -1, tool: 'edit', sub: 'light',
  view: { scale: 1, tx: 0, ty: 0, fit: true }, last: null, cmp: 'off', split: .5, detail: null, detailKey: '',
  curveCh: 'rgb', mixSel: 0, gradeZone: 'mid', selMask: null, maskOverlay: true, brush: { size: .04, feather: .6, flow: .8, erase: false },
  selSpot: null, heal: { size: .03, feather: .5, opacity: 1, mode: 'heal' }, presetGroup: '人像', presetBase: null, presetSel: null, presetAmt: 100,

  init() {
    const gl = $('#gl');
    try { const info = Engine.init(gl); this.glInfo = info; } catch (e) { this.glError = e.message; console.error(e); }
    Engine.onLost = () => toast('繪圖裝置重置，請重新開啟相片');
    const tb = $('#edTools');
    for (const [k, n] of TOOLS) tb.append(h('button', { class: 'tool', 'data-t': k, html: svg(k) + `<span>${n}</span><i class="dot"></i>`, onclick: () => { if (this.tool === k) this.toggleDock(); else { this.setDock(false); this.setTool(k); } } }));
    $('#dockGrip').onclick = () => this.toggleDock();
    $('#histo').onclick = () => this.cycleHud(); $('#hudBtn').onclick = () => { CFG.hud = 'histo'; saveCfg(); this.applyHud(); };
    $('#edBack').onclick = () => this.close();
    $('#edUndo').onclick = () => this.undo(); $('#edRedo').onclick = () => this.redo();
    $('#edMore').onclick = () => this.menu();
    $('#edExport').onclick = () => this.exportSheet();
    $('#zoomBadge').onclick = () => { if (this.view.fit) this.zoomTo(1, null); else this.fit(); };
    const cmp = $('#edCmp'); let t0 = 0;
    cmp.addEventListener('pointerdown', (e) => { e.preventDefault(); t0 = Date.now(); this.cmpPrev = this.cmp; this.cmp = 'hold'; $('#cmpHint').classList.remove('hide'); $('#cmpHint').textContent = '原圖'; this.requestRender(); });
    const up = () => { if (this.cmp !== 'hold') return; $('#cmpHint').classList.add('hide'); if (Date.now() - t0 < 260) { this.cmp = this.cmpPrev === 'split' ? 'off' : 'split'; } else this.cmp = this.cmpPrev; cmp.classList.toggle('on', this.cmp === 'split'); this.requestRender(); };
    cmp.addEventListener('pointerup', up); cmp.addEventListener('pointerleave', up); cmp.addEventListener('pointercancel', up);
    this.bindStage();
    new ResizeObserver(() => this.active && this.resize()).observe($('#stage'));
    window.addEventListener('keydown', (e) => {
      if (!this.active || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (e.key === '\\') { this.cmp = this.cmp === 'split' ? 'off' : 'split'; this.requestRender(); }
    });
  },

  /* ---------- 開啟 / 關閉 ---------- */
  async open(rec) {
    if (this.glError) { toast('此裝置無法使用 WebGL2：' + this.glError, 5000); return; }
    if (this.active) await this.close(true);
    if (this.curveFS) this.closeCurveFS();
    this.rec = rec; this.active = true; App.show('ed'); document.body.classList.add('editing');
    this.showName(); $('#edName').parentNode.onclick = () => this.rename(); this.applyHud(); $('#edMeta').textContent = `${rec.w} × ${rec.h}・${(rec.w * rec.h / 1e6).toFixed(1)} MP`;
    const tok = this.openTok = (this.openTok || 0) + 1;
    this.busy('載入中…', true); this.rawPill(null);
    this.ses = null; this.edit = normEdit(rec.edit); this.last = null;
    try { const ses = new Session(rec); await ses.load(); if (tok !== this.openTok || !this.active) { ses.dispose(); return; } this.ses = ses; } catch (e) { if (tok !== this.openTok) return; this.busy(null); toast('無法開啟：' + e.message); this.active = false; App.show('lib'); document.body.classList.remove('editing'); return; }
    this.busy(null);
    // RAW 剛匯入、真正的 RAW 預覽還沒建立：先用相機內嵌預覽立即開啟（可以照常調整），背景解碼完成後自動換成 RAW 畫面
    if (rec.prevEmb) this.upgradeRaw(rec, tok);
    this.edit = await refreshLens(rec, normEdit(rec.edit)); this.hist = [{ label: '開啟', s: JSON.stringify(this.edit) }]; this.hi = 0;
    this.detail = null; this.detailKey = ''; this.selMask = null; this.selSpot = null; this.cmp = 'off'; $('#edCmp').classList.remove('on');
    this.view.fit = true; this.resize();
    this.setTool(this.tool === 'versions' || this.tool === 'crop' ? 'edit' : this.tool);
    this.ensureAi();
    this.requestRender();
    if (!rec.prevEmb) this.prefetchFull(tok);
  },
  /* 開啟後在背景先準備好原始解析度（RAW 只解一次並快取），之後放大縮小直接顯示，不用再等解析 */
  prefetchFull(tok) {
    clearTimeout(this.pfT);
    this.pfT = setTimeout(() => { const s = this.ses; if (tok !== this.openTok || !this.active || !s || s.full || (this.rec.w * this.rec.h) > 6.2e7) return; s.ensureFull().catch((e) => console.warn('prefetch', e)); }, 1800);
  },
  async upgradeRaw(rec, tok) {
    this.rawPill('RAW 解碼中・完成後自動更新（可先調整）');
    try {
      await new Promise((r) => setTimeout(r, 700)); await new Promise((r) => requestAnimationFrame(() => r()));   // 先讓編輯畫面完成第一次繪製
      if (tok !== this.openTok || !this.active) return;
      await Library.develop(rec, true);
      if (tok !== this.openTok || !this.active || !this.ses) return;
      const ns = new Session(this.rec); await ns.load();
      if (tok !== this.openTok || !this.active || !this.ses) { ns.dispose(); return; }
      const old = this.ses; this.ses = ns; old.dispose(); this.detail = null; this.detailKey = ''; this.last = null;
      $('#edMeta').textContent = `${this.rec.w} × ${this.rec.h}・${(this.rec.w * this.rec.h / 1e6).toFixed(1)} MP`;
      this.ensureAi(); this.requestRender(); this.rawPill(null); toast('已切換為 RAW 解碼畫面', 1600); this.prefetchFull(tok);
    } catch (e) { console.warn('develop', e); if (tok === this.openTok) { this.rawPill(null); toast('RAW 預覽建立失敗，暫用內嵌預覽：' + e.message, 4000); } }
  },
  rawPill(tx) {
    let el = $('#rawPill'); if (!el) { el = h('div', { id: 'rawPill', class: 'glass' }); $('#stage').append(el); }
    el.classList.toggle('hide', !tx); if (tx) el.innerHTML = '<span class="spin"></span>' + tx;
  },
  async close(silent) {
    if (!this.active) return;
    this.active = false; this.openTok = (this.openTok || 0) + 1; this.rawPill(null); this.busy(null);
    if (this.ppl) this.ppl.on = false; this.pplPill(); this.ppl = null;
    clearTimeout(this.saveT);
    if (!this.ses) { document.body.classList.remove('editing'); if (!silent) App.show('lib'); Library.refresh(); return; }   // 還在載入就按返回：直接回圖庫
    await this.persist();
    try {
      const e = effective(this.edit); const c = this.ses.renderThumb(e, 480); const b = await canvasBlob(c, 'image/jpeg', .86);
      await DB.put('thumbs', b, 'e:' + this.rec.id); this.rec.edited = !isDefault(this.edit); this.rec.thumbV = Date.now(); await DB.put('photos', this.rec);
    } catch (err) { console.warn(err); }
    if (this.ses) { this.ses.dispose(); this.ses = null; }
    document.body.classList.remove('editing');
    if (!silent) { App.show('lib'); }
    Library.refresh();
  },
  async persist() { if (!this.rec) return; this.rec.edit = clone(this.edit); this.rec.mod = Date.now(); try { await DB.put('photos', this.rec); } catch (e) { console.warn(e); } },
  busy(tx, center) { const b = $('#busy'); if (!tx) { b.classList.add('hide'); b.classList.remove('center'); return; } b.classList.remove('hide'); b.classList.toggle('center', !!center); $('#busyTx').textContent = tx; },

  /* ---------- 歷程 ---------- */
  changed() { this.detailKey = ''; this.requestRender(); this.markTools(); },
  commit(label) {
    const s = JSON.stringify(this.edit); if (this.hist[this.hi] && this.hist[this.hi].s === s) return;
    this.hist = this.hist.slice(0, this.hi + 1); this.hist.push({ label, s, t: Date.now() }); if (this.hist.length > 120) this.hist.shift(); this.hi = this.hist.length - 1;
    this.updUndo(); clearTimeout(this.saveT); this.saveT = setTimeout(() => this.persist(), 600);
    if (this.tool === 'versions') this.renderPanel();
  },
  jump(i) { if (i < 0 || i >= this.hist.length) return; this.hi = i; this.edit = normEdit(JSON.parse(this.hist[i].s)); this.updUndo(); this.renderPanel(); this.changed(); this.ensureAi(); clearTimeout(this.saveT); this.saveT = setTimeout(() => this.persist(), 600); },
  undo() { if (this.hi > 0) { this.jump(this.hi - 1); toast('復原：' + this.hist[this.hi + 1].label, 1200); } },
  redo() { if (this.hi < this.hist.length - 1) { this.jump(this.hi + 1); toast('重做：' + this.hist[this.hi].label, 1200); } },
  updUndo() { $('#edUndo').disabled = this.hi <= 0; $('#edRedo').disabled = this.hi >= this.hist.length - 1; },
  markTools() {
    const e = this.edit, d = DEF_EDIT;
    const mod = { crop: JSON.stringify(e.crop) !== JSON.stringify(d.crop), mask: e.masks.length > 0, heal: e.heal.length > 0, ai: e.ai.on,
      edit: JSON.stringify({ ...e, crop: 0, masks: 0, heal: 0, ai: 0 }) !== JSON.stringify({ ...d, crop: 0, masks: 0, heal: 0, ai: 0 }), presets: !!this.presetSel, loc: !!e.loc, versions: (this.rec.versions || []).length > 0 };
    $$('#edTools .tool').forEach((b) => b.classList.toggle('mod', !!mod[b.dataset.t]));
  },

  /* ---------- 渲染 ---------- */
  requestRender() { if (this.rq) return; this.rq = requestAnimationFrame(() => { this.rq = 0; this.render(); }); },
  requestDisplay() { if (this.rd) return; this.rd = requestAnimationFrame(() => { this.rd = 0; this.display(); }); },
  render() {
    if (!this.active || !this.ses || !this.ses.prev || !this.edit) return;
    const e = effective(this.edit);
    const crop = this.tool === 'crop' ? { ...e.crop, x: 0, y: 0, w: 1, h: 1 } : null;
    const viz = this.tool === 'mask' && this.maskOverlay && this.selMask && this.vizOn ? this.selMask : null;
    const prevDims = this.last ? this.last.G.OW + 'x' + this.last.G.OH : '';
    try { this.last = this.ses.renderPreview(e, { cropOverride: crop, maskViz: viz, long: this.interactive ? Math.min(1080, CFG.prevLong) : 0 }); } catch (err) { console.error(err); toast('渲染錯誤：' + err.message, 4000); return; }
    if (prevDims !== this.last.G.OW + 'x' + this.last.G.OH && this.view.fit) this.fit(true);
    if (this.cmp !== 'off') {
      const be = effective(normEdit({ crop: this.edit.crop, geo: this.edit.geo, heal: this.edit.heal, optics: { dist: this.edit.optics.dist } }));
      const bk = JSON.stringify([be.crop, be.geo, be.heal, crop]);
      if (bk !== this.beforeKey || !this.beforeTex) { this.beforeTex = this.ses.renderPreview(be, { cropOverride: crop, targetName: 'before' }).tex; this.beforeKey = bk; this.ses.guideKey = ''; this.ses.renderPreview(e, { cropOverride: crop, maskViz: viz }); }
    }
    this.display();
    clearTimeout(this.histT); if (!this.interactive) { this.histT = setTimeout(() => this.drawHisto(), 120); this.scheduleDetail(); }
  },
  /* 拖動中以較低解析度即時預覽（更順暢），放開後再以完整預覽解析度重繪 */
  beginInteractive() { this.interactive = true; clearTimeout(this.detT); },
  endInteractive() { if (!this.interactive) return; this.interactive = false; this.requestRender(); },
  display() {
    if (!this.active || !this.last) return;
    const L = this.last; const cv = $('#gl');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim();
    const rgb = bg.startsWith('#') ? [1, 3, 5].map((i) => parseInt(bg.substr(i, 2), 16) / 255) : [0.9, 0.85, 0.75];
    const det = this.detail && this.detail.key === this.curKey() ? this.detail : null;
    let split = null; if (this.cmp === 'hold') split = cv.width + 1; else if (this.cmp === 'split') split = this.split * cv.width;
    Engine.display({ img: L.tex, imgSize: [L.G.OW, L.G.OH], scale: this.view.scale, tx: this.view.tx, ty: this.view.ty, before: this.cmp !== 'off' ? this.beforeTex : null, split,
      detail: det ? det.tex : null, detRect: det ? det.rect : null, overlay: L.viz || null, bg: rgb });
    this.drawOverlay();
    const z = $('#zoomBadge'); z.textContent = this.view.fit ? '適合' : Math.round(this.view.scale * 100) + '%';
  },
  curKey() { return JSON.stringify(this.edit) + '|' + (this.ses && this.ses.aiPrevKey); },
  /* 調整區收合：再點一次目前的工具（或拖曳條）→ 只留下工具列，照片放大顯示 */
  setDock(min) {
    const v = $('#v-ed'); if (matchMedia('(min-width:900px)').matches) min = false;
    if (v.classList.contains('dockMin') === !!min) return;
    v.classList.toggle('dockMin', !!min);
    const full = $('#edDock').offsetHeight;
    if (min) { const hh = $('#edTools').offsetHeight + parseFloat(getComputedStyle($('#edDock')).paddingBottom || 0) + 2; v.style.setProperty('--dockH', Math.round(hh) + 'px'); }
    else v.style.removeProperty('--dockH');
    // 調整區先以動畫收合／展開，畫面區在動畫結束後才重新配置，避免每一格都重繪
    v.style.setProperty('--stageB', (min ? full : Math.round(parseFloat(getComputedStyle($('#edDock')).height))) + 'px');
    v.classList.add('dockAnim'); clearTimeout(this.dockT);
    this.dockT = setTimeout(() => { v.classList.remove('dockAnim'); v.style.removeProperty('--stageB'); this.view.fit = true; }, 260);
    this.view.fit = true;
  },
  toggleDock() { const min = !$('#v-ed').classList.contains('dockMin'); this.setDock(min); if (min && !this.dockHinted) { this.dockHinted = true; toast('再點一次目前的工具即可展開調整區'); } },
  /* 左上角 HUD：直方圖 → 相片名稱＋拍攝時間 → 光圈／ISO／快門 → 隱藏（按按鈕叫回） */
  cycleHud() { const order = ['histo', 'info', 'exif', 'off']; CFG.hud = order[(order.indexOf(CFG.hud || 'histo') + 1) % order.length]; saveCfg(); this.applyHud(); },
  applyHud() {
    const mode = CFG.hud || 'histo', hb = $('#histo'), tx = $('#hudTx'); CFG.histo = mode === 'histo';
    hb.classList.toggle('hide', mode === 'off'); $('#hudBtn').classList.toggle('hide', mode !== 'off'); hb.classList.toggle('txt', mode === 'info' || mode === 'exif');
    const r = this.rec || {}, ex = r.exif || {};
    if (mode === 'info') {
      const d = String(ex.dateOrig || ex.date || '').replace(/^(\d{4}):(\d\d):(\d\d)/, '$1/$2/$3');
      tx.innerHTML = ''; tx.append(h('b', null, r.outName ? Exporter.nameFor(r, Exporter.fmtFor(r)) : (r.name || '')), h('div', null, d ? '📅 ' + d.slice(0, 16) : '📅 無拍攝時間'));
    } else if (mode === 'exif') {
      const sh = ex.exposure ? (ex.exposure >= 1 ? ex.exposure.toFixed(1).replace(/\.0$/, '') + 's' : '1/' + Math.round(1 / ex.exposure) + 's') : '—';
      const cell = (k, v) => h('span', null, h('small', null, k), v);
      tx.innerHTML = ''; tx.append(h('div', { class: 'r' }, cell('光圈', ex.fnumber ? 'f/' + (+ex.fnumber).toFixed(1).replace(/\.0$/, '') : '—'), cell('ISO', ex.iso ? String(ex.iso) : '—'), cell('快門', sh)));
    }
    if (mode === 'histo') this.drawHisto();
  },
  resize() {
    const st = $('#stage'); const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [$('#gl'), $('#ov')]) { c.width = Math.max(1, Math.round(st.clientWidth * dpr)); c.height = Math.max(1, Math.round(st.clientHeight * dpr)); }
    this.dpr = dpr; if (this.view.fit) this.fit(true); this.requestRender();
  },
  fit(noRender) {
    if (!this.last) { this.view.fit = true; return; }
    const cv = $('#gl'); const { OW, OH } = this.last.G; const pad = 14 * this.dpr;
    const s = Math.min((cv.width - pad * 2) / OW, (cv.height - pad * 2) / OH);
    this.view = { scale: s, tx: (cv.width - OW * s) / 2, ty: (cv.height - OH * s) / 2, fit: true };
    if (!noRender) { this.requestDisplay(); this.scheduleDetail(); }
  },
  zoomTo(s, at) {
    const cv = $('#gl'); at = at || [cv.width / 2, cv.height / 2];
    const ix = (at[0] - this.view.tx) / this.view.scale, iy = (at[1] - this.view.ty) / this.view.scale;
    this.view.scale = clamp(s, 0.02, 16); this.view.tx = at[0] - ix * this.view.scale; this.view.ty = at[1] - iy * this.view.scale; this.view.fit = false;
    this.clampView(); this.requestDisplay(); this.scheduleDetail();
  },
  clampView() {
    if (!this.last) return; const cv = $('#gl'); const { OW, OH } = this.last.G; const v = this.view;
    const w = OW * v.scale, hh = OH * v.scale;
    v.tx = w < cv.width ? (cv.width - w) / 2 : clamp(v.tx, cv.width - w - 40, 40);
    v.ty = hh < cv.height ? (cv.height - hh) / 2 : clamp(v.ty, cv.height - hh - 40, 40);
  },
  /* 100% 檢視：放大超過預覽解析度時，渲染可見範圍的全解析度影像 */
  scheduleDetail() {
    clearTimeout(this.detT);
    if (!this.last || this.tool === 'crop' || this.cmp === 'hold') return;
    if (this.view.scale <= this.last.sigma * 1.12) return;
    this.detT = setTimeout(() => this.renderDetail(), 320);
  },
  async renderDetail() {
    if (!this.active || !this.last) return;
    const cv = $('#gl'); const v = this.view; const { OW, OH } = this.last.G;
    const x0 = Math.max(0, Math.floor(-v.tx / v.scale)), y0 = Math.max(0, Math.floor(-v.ty / v.scale));
    const x1 = Math.min(OW, Math.ceil((cv.width - v.tx) / v.scale)), y1 = Math.min(OH, Math.ceil((cv.height - v.ty) / v.scale));
    const w = x1 - x0, hh = y1 - y0; if (w < 2 || hh < 2 || w * hh > 9e6) return;
    const key = this.curKey(); const rk = key + '|' + [x0, y0, w, hh].join(',');
    if (this.detailRk === rk) return; this.detailRk = rk;
    const e = effective(this.edit); const G = Engine.geometry(e, this.ses.SW, this.ses.SH);
    const tok = (this.detTok = (this.detTok || 0) + 1);
    try {
      let dnBase = null;
      if (e.ai.on) {
        // 100% 檢視使用背景算好的全解析度 AI 結果（雲端或本機）；尚未完成時先顯示預覽，不在拖曳時重算
        dnBase = this.ses.fullDn.cloud || this.ses.fullDn[e.ai.model];
        if (!dnBase) { this.detailRk = ''; this.bgFullDn(e.ai.model); return; }
      }
      const needFull = !this.ses.full; if (needFull) this.busy('載入原始解析度…');
      const r = await this.ses.renderRegion(e, G, x0, y0, w, hh, 1, { dnBase, targetName: 'detail' });
      if (tok !== this.detTok || !this.active) return;
      this.detail = { tex: r.tex, rect: [x0 - r.ap, y0 - r.ap, r.W, r.H], key };
      this.busy(null); this.requestDisplay();
    } catch (err) { console.warn(err); this.busy(null); this.detailRk = ''; }
  },
  /* 在背景計算全解析度 AI 降噪（Worker 執行，不阻塞操作），完成後自動更新 100% 檢視 */
  async bgFullDn(model) {
    const ses = this.ses; if (!ses) return; const k = ses.rec.id + ':' + model;
    if (this.fullRun === k) return; this.fullRun = k; this.fullPct = 0;
    const tt = setTimeout(() => toast('AI 正在背景以原始解析度降噪，可繼續編輯；完成後放大檢視會自動更新', 3500), 1500);
    try {
      await ses.ensureFullDn(model, (f) => { this.fullPct = f; this.aiStatus(); });
      clearTimeout(tt);
      if (ses === this.ses && this.active) { this.detailRk = ''; this.scheduleDetail(); }
    } catch (e) { clearTimeout(tt); console.warn(e); if (ses === this.ses) toast('全解析度 AI 降噪失敗：' + (e.message || e), 5000); }
    finally { if (this.fullRun === k) this.fullRun = null; this.aiStatus(); }
  },
  computeHist() {
    if (!this.last) return; const L = this.last; const s = Math.min(1, 200 / Math.max(L.W, L.H)); const W = Math.max(1, Math.round(L.W * s)), H = Math.max(1, Math.round(L.H * s));
    const px = Engine.downsample(L.tex, W, H); const hr = new Float32Array(64), hg = new Float32Array(64), hb = new Float32Array(64);
    for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 8) continue; hr[px[i] >> 2]++; hg[px[i + 1] >> 2]++; hb[px[i + 2] >> 2]++; }
    this.histData = { hr, hg, hb };
  },
  drawHisto() {
    if (this.curveFS) { this.computeHist(); return; }
    if (!this.last || (CFG.hud || 'histo') !== 'histo') return;
    const L = this.last; const s = Math.min(1, 200 / Math.max(L.W, L.H)); const W = Math.max(1, Math.round(L.W * s)), H = Math.max(1, Math.round(L.H * s));
    const px = Engine.downsample(L.tex, W, H); const hr = new Float32Array(64), hg = new Float32Array(64), hb = new Float32Array(64);
    for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 8) continue; hr[px[i] >> 2]++; hg[px[i + 1] >> 2]++; hb[px[i + 2] >> 2]++; }
    this.histData = { hr, hg, hb };
    const c = $('#histoCv'), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
    let mx = 1; for (let i = 1; i < 63; i++) mx = Math.max(mx, hr[i], hg[i], hb[i]);
    x.globalCompositeOperation = 'screen';
    for (const [arr, col] of [[hr, 'rgba(220,70,60,.75)'], [hg, 'rgba(90,180,80,.75)'], [hb, 'rgba(70,110,220,.75)']]) {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, c.height);
      for (let i = 0; i < 64; i++) x.lineTo(i / 63 * c.width, c.height - Math.min(1, arr[i] / mx) * c.height * .95);
      x.lineTo(c.width, c.height); x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    if (this.tool === 'edit' && this.sub === 'light') this.drawCurve && this.drawCurve();
  },

  /* ---------- 座標 ---------- */
  imgToScr(p) { return [p[0] * this.view.scale + this.view.tx, p[1] * this.view.scale + this.view.ty]; },
  scrToImg(p) { return [(p[0] - this.view.tx) / this.view.scale, (p[1] - this.view.ty) / this.view.scale]; },
  srcToScr(s) { const G = this.last.G; const o = Engine.srcToOut(G, s); return this.imgToScr([o[0] * G.OW, o[1] * G.OH]); },
  scrToSrc(p) { const G = this.last.G; const i = this.scrToImg(p); return Engine.outToSrc(G, [i[0] / G.OW, i[1] / G.OH]); },
  evPt(e) { const r = $('#ov').getBoundingClientRect(); return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr]; },

  /* ---------- 手勢 ---------- */
  bindStage() {
    const ov = $('#ov'); const P = new Map(); let mode = null, pinch = null, lastTap = 0, lastTapPt = null, downPt = null, moved = false;
    ov.addEventListener('pointerdown', (e) => {
      if (!this.active || !this.last) return;
      ov.setPointerCapture(e.pointerId); const p = this.evPt(e);
      if (this.curveFS) { if (P.size === 0) { P.set(e.pointerId, p); mode = 'curve'; this.curveDown(p); } return; }
      P.set(e.pointerId, p);
      if (P.size === 2) { clearTimeout(this.splitT); if (mode === 'tool') this.toolCancel(); const [a, b] = [...P.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s: this.view.scale, tx: this.view.tx, ty: this.view.ty }; mode = 'pinch'; return; }
      downPt = p; moved = false;
      this.panStart = [p[0], p[1], this.view.tx, this.view.ty];
      // 前後對比分隔線：按住圓形把手約 0.45 秒才開始拖動，避免誤觸跳線
      const sx = this.split * ov.width;
      if (this.cmp === 'split' && Math.hypot(p[0] - sx, p[1] - ov.height / 2) < 34 * this.dpr) {
        mode = 'splitWait'; clearTimeout(this.splitT);
        this.splitT = setTimeout(() => { if (mode !== 'splitWait') return; mode = 'split'; this.splitGrab = downPt[0] - this.split * ov.width; this.splitArmed = true; try { navigator.vibrate && navigator.vibrate(12); } catch (e2) {} this.drawOverlay(); }, 450);
        return;
      }
      mode = this.toolDown(p, e) ? 'tool' : 'pan';
    });
    ov.addEventListener('pointermove', (e) => {
      const p = this.evPt(e);
      if (!P.has(e.pointerId)) { this.hover = p; if ((this.tool === 'mask' && this.brushActive()) || (this.tool === 'aifix' && this.erasePaint)) this.drawOverlay(); return; }
      if (mode === 'curve') { this.curveMove(p); return; }
      P.set(e.pointerId, p); if (downPt && Math.hypot(p[0] - downPt[0], p[1] - downPt[1]) > 6 * this.dpr) moved = true;
      if (mode === 'pinch' && P.size >= 2) {
        const [a, b] = [...P.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const s = clamp(pinch.s * d / pinch.d, 0.02, 16); const ix = (pinch.c[0] - pinch.tx) / pinch.s, iy = (pinch.c[1] - pinch.ty) / pinch.s;
        this.view = { scale: s, tx: c[0] - ix * s, ty: c[1] - iy * s, fit: false }; this.clampView(); this.requestDisplay();
      } else if (mode === 'pan' && this.panStart) {
        if (this.view.fit && !moved) return;
        // v1.16：畫面為「符合視窗」大小時左右滑動 → 切換上一張／下一張（依圖庫目前的排序）
        if (this.view.fit && this.canSwipe() && Math.abs(p[0] - this.panStart[0]) > Math.abs(p[1] - this.panStart[1]) * 1.3) { mode = 'swipe'; this.swipeT0 = Date.now(); }
        else {
        this.view.tx = this.panStart[2] + p[0] - this.panStart[0]; this.view.ty = this.panStart[3] + p[1] - this.panStart[1]; if (moved) this.view.fit = false; this.clampView(); this.requestDisplay();
        }
      }
      if (mode === 'swipe') { this.view.tx = this.panStart[2] + (p[0] - this.panStart[0]) * 0.85; this.requestDisplay(); }
      else if (mode === 'tool') { this.hover = p; this.toolMove(p, e); }
      else if (mode === 'splitWait') { if (moved) { clearTimeout(this.splitT); mode = 'pan'; } }
      else if (mode === 'split') { this.split = clamp((p[0] - (this.splitGrab || 0)) / ov.width, 0.02, 0.98); this.requestDisplay(); }
    });
    const end = (e) => {
      if (!P.has(e.pointerId)) return; const p = this.evPt(e); P.delete(e.pointerId);
      if (mode === 'curve') { this.curveUp(); mode = null; return; }
      clearTimeout(this.splitT); if (mode === 'splitWait') mode = 'pan'; if (this.splitArmed) { this.splitArmed = false; this.drawOverlay(); }
      if (mode === 'tool') this.toolUp(p, e);
      if (mode === 'swipe') { const dx = p[0] - this.panStart[0], dt = Date.now() - (this.swipeT0 || 0); mode = null; pinch = null; moved = false; P.clear(); this.swipeEnd(dx, Math.abs(dx) > ov.width * 0.2 || (Math.abs(dx) > 40 * this.dpr && dt < 260)); return; }
      if (mode === 'pinch' || mode === 'pan') this.scheduleDetail();
      if (P.size === 0) {
        if (!moved && mode === 'pan') { const now = Date.now(); if (now - lastTap < 320 && lastTapPt && Math.hypot(p[0] - lastTapPt[0], p[1] - lastTapPt[1]) < 30 * this.dpr) { this.view.fit ? this.zoomTo(1, p) : this.fit(); lastTap = 0; } else { lastTap = now; lastTapPt = p; } }
        mode = null; pinch = null;
      } else if (mode === 'pinch') { mode = 'pan'; const q = [...P.values()][0]; this.panStart = [q[0], q[1], this.view.tx, this.view.ty]; }
    };
    ov.addEventListener('pointerup', end); ov.addEventListener('pointercancel', end);
    ov.addEventListener('pointerleave', () => { this.hover = null; if (this.tool === 'mask') this.drawOverlay(); });
    ov.addEventListener('wheel', (e) => { e.preventDefault(); const p = this.evPt(e); this.zoomTo(this.view.scale * Math.pow(1.0015, -e.deltaY), p); }, { passive: false });
  },

  canSwipe() {
    if (this.curveFS || this.cmp === 'split' || this.tool === 'crop' || (this.tool === 'mask' && this.brushActive && this.brushActive())) return false;
    if (this.tool === 'aifix' && (this.erasePaint || (this.ppl && this.ppl.on))) return false;
    return Library.filtered().length > 1;
  },
  swipeNeighbor(dir) { const L = Library.filtered(), i = L.findIndex((r) => r.id === this.rec.id); return i < 0 ? null : L[i + dir] || null; },
  swipeEnd(dx, go) {
    const dir = dx < 0 ? 1 : -1, nx = go ? this.swipeNeighbor(dir) : null;
    if (!nx) { if (go) toast(dir > 0 ? '已經是最後一張' : '已經是第一張', 1200); this.fit(); return; }
    // 滑出動畫後開啟下一張
    const cv = $('#gl'), from = this.view.tx, to = from + (dx < 0 ? -1 : 1) * cv.width, t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 160); this.view.tx = from + (to - from) * k * k; this.requestDisplay(); if (k < 1) requestAnimationFrame(step); else this.open(nx); };
    requestAnimationFrame(step);
  },

  /* ---------- 工具列 ---------- */
  setTool(t) {
    const prev = this.tool; this.tool = t;
    if (this.ppl && this.ppl.on && t !== 'aifix') { this.ppl.on = false; this.pplPill(); }
    $$('#edTools .tool').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    if (t === 'presets' && prev !== 'presets') { this.presetBase = clone(this.edit); this.presetSel = null; this.presetAmt = 100; }
    if (t === 'crop' || prev === 'crop') { this.view.fit = true; this.detail = null; }
    if (t === 'mask' && !this.selMask && this.edit.masks.length) this.selMask = this.edit.masks[this.edit.masks.length - 1].id;
    this.vizOn = false;
    this.renderSub(); this.renderPanel(); this.changed();
  },
  renderSub() {
    const s = $('#edSub'); s.innerHTML = '';
    if (this.tool !== 'edit') { s.classList.add('hide'); return; }
    s.classList.remove('hide');
    for (const [k, n] of SUBS) s.append(h('button', { class: 'btn sm' + (this.sub === k ? ' on' : ''), onclick: () => { if (k === 'curve') { this.openCurveFS(); return; } this.sub = k; this.renderSub(); this.renderPanel(); } }, n));
  },
  renderPanel() {
    const b = $('#edBody'); const st = b.scrollTop; b.innerHTML = '';
    const pk = this.tool + '/' + this.sub; if (pk !== this.panelKey) { this.panelKey = pk; b.classList.remove('swap'); void b.offsetWidth; b.classList.add('swap'); }
    const fn = this.tool === 'edit' ? 'p_' + this.sub : 't_' + this.tool;
    try { if (this[fn]) this[fn](b); } catch (e) { console.error(e); b.append(h('div', { class: 'note' }, '面板錯誤：' + e.message)); }
    if (this.panelKeep === fn) b.scrollTop = st; this.panelKeep = fn;
    this.updUndo(); this.markTools();
  },

  /* ---------- 控制元件 ---------- */
  slider(label, get, set, min, max, step, def, o = {}) {
    const fmt = o.fmt || ((v) => (step < 1 ? (+v).toFixed(step < .1 ? 2 : 1) : Math.round(v)) + (o.unit || ''));
    const inp = h('input', { type: 'range', min, max, step, value: get() });
    const vEl = h('span', { class: 'v' });
    const wrap = h('div', { class: 'sl' + (o.grad ? ' grad' : '') }, h('div', { class: 'hd' }, h('span', null, label), vEl), inp);
    const zero = clamp(o.zero != null ? o.zero : (min < 0 ? 0 : min), min, max);
    const upd = () => {
      const v = +inp.value; vEl.textContent = (o.sign && v > 0 ? '+' : '') + fmt(v); vEl.classList.toggle('mod', Math.abs(v - def) > 1e-9);
      if (o.grad) inp.style.setProperty('--trk', o.grad);
      else { const a = (Math.min(v, zero) - min) / (max - min) * 100, b2 = (Math.max(v, zero) - min) / (max - min) * 100; inp.style.setProperty('--trk', `linear-gradient(90deg,rgba(125,108,87,.28) ${a}%,var(--ac) ${a}%,var(--ac) ${b2}%,rgba(125,108,87,.28) ${b2}%)`); }
    };
    inp.addEventListener('input', () => { set(+inp.value); upd(); (o.onInput || (() => this.changed()))(); });
    inp.addEventListener('change', () => { (o.onCommit || (() => this.commit(label)))(); });
    const reset = () => { inp.value = def; set(def); upd(); (o.onInput || (() => this.changed()))(); (o.onCommit || (() => this.commit('重設 ' + label)))(); };
    vEl.addEventListener('click', reset); wrap.querySelector('.hd span').addEventListener('dblclick', reset);
    // 長按約 0.45 秒（震動提示）才開始拖動；拖動是相對位移，不會跳到手指位置；直接上下滑動則是捲動面板
    const g = h('div', { class: 'slg' }); wrap.append(g);
    let tm = null, armed = false, sx = 0, sy = 0, sv = 0, changedV = false, pid = null;
    const disarm = () => { clearTimeout(tm); tm = null; if (armed) { armed = false; wrap.classList.remove('armed'); this.endInteractive(); if (changedV) (o.onCommit || (() => this.commit(label)))(); } pid = null; };
    let pend = null; const flush = () => { const v = pend; pend = null; if (v == null || v === +inp.value) return; inp.value = v; set(v); upd(); changedV = true; (o.onInput || (() => this.changed()))(); };
    g.addEventListener('pointerdown', (e) => {
      pid = e.pointerId; sx = e.clientX; sy = e.clientY; sv = +inp.value; changedV = false;
      clearTimeout(tm); tm = setTimeout(() => { tm = null; armed = true; wrap.classList.add('armed'); this.beginInteractive(); try { g.setPointerCapture(pid); } catch (e2) {} try { navigator.vibrate && navigator.vibrate(15); } catch (e2) {} }, 450);
    });
    g.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      if (!armed) { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { clearTimeout(tm); tm = null; } return; }
      const w = inp.getBoundingClientRect().width - 20 || 1; let v = sv + (e.clientX - sx) / w * (max - min);
      v = clamp(Math.round((v - min) / step) * step + min, min, max); v = +v.toFixed(6);
      if (pend == null) requestAnimationFrame(flush); pend = v; // 每個畫格只更新一次
    });
    g.addEventListener('touchmove', (e) => { if (armed) e.preventDefault(); }, { passive: false });
    g.addEventListener('pointerup', disarm); g.addEventListener('pointercancel', disarm); g.addEventListener('lostpointercapture', () => { if (armed) disarm(); });
    g.addEventListener('contextmenu', (e) => e.preventDefault());
    upd(); wrap.sync = () => { inp.value = get(); upd(); }; return wrap;
  },
  S(path, label, min, max, step, o = {}) { return this.slider(label, () => getP(this.edit, path), (v) => setP(this.edit, path, v), min, max, step, getP(DEF_EDIT, path), { sign: min < 0, ...o }); },
  toggle(label, get, set, sub) {
    const i = h('input', { type: 'checkbox' }); i.checked = !!get();
    i.onchange = () => { set(i.checked); this.changed(); this.commit(label); };
    return h('label', { class: 'lbl2' }, h('span', null, label, sub ? h('div', { class: 'sub' }, sub) : null), h('span', { class: 'sw' }, i, h('span')));
  },
  section(title, build, open = true, key) {
    key = key || title; this.secState = this.secState || {}; if (this.secState[key] != null) open = this.secState[key];
    const hd = h('div', { class: 'sec' + (open ? '' : ' closed') }, title, h('span', { class: 'chev' }, '▾')); const body = h('div', { class: 'secBody' + (open ? '' : ' closed') });
    hd.onclick = () => { const c = !body.classList.contains('closed'); body.classList.toggle('closed', c); hd.classList.toggle('closed', c); this.secState[key] = !c; if (!c && !body.childElementCount) build(body); };
    if (open) build(body); return [hd, body];
  },
  seg(items, cur, on) { return h('div', { class: 'seg' }, items.map(([k, n]) => h('button', { class: 'btn' + (k === cur ? ' on' : ''), onclick: () => on(k) }, n))); },

  /* ---------- 編輯子面板 ---------- */
  p_auto(b) {
    const ae = this.edit.aiEnh || { amt: 0 };
    b.append(h('div', { class: 'aicard' },
      h('h4', null, '✨ AI 智慧增強'),
      h('div', { class: 'sub' }, '分析場景的亮度分佈、高光溢出、色彩與 ISO 雜訊風險，自動調整光線、局部對比、色彩，並單獨救回天空亮部。高 ISO 相片會節制暗部提亮、同時壓穩黑色，避免拉出雜訊色塊。'),
      h('div', { class: 'acts' }, h('button', { class: 'btn pri', onclick: () => this.runAiEnh() }, ae.d ? '↻ 重新分析' : '✨ 一鍵 AI 增強'),
        ae.d || ae.clear ? h('button', { class: 'btn sm', onclick: () => { this.aiEnhApply(0, 0); this.edit.aiEnh = { amt: 0 }; this.changed(); this.commit('移除 AI 增強'); this.renderPanel(); } }, '移除') : null,
        isApp ? h('button', { class: 'btn sm', onclick: () => this.lrEdit() }, '🅻 用 Lightroom 修圖') : null),
      ae.d ? this.slider('強度', () => this.edit.aiEnh.amt, (v) => this.aiEnhApply(v), 0, 100, 1, 80, { onCommit: () => this.commit('AI 增強強度') }) : null,
      this.slider('通透感', () => (this.edit.aiEnh || {}).clear || 0, (v) => this.aiEnhApply(null, v), 0, 100, 1, 0, { onCommit: () => this.commit('AI 通透感') }),
      h('div', { class: 'sub' }, '通透感：去除灰濛（大氣透視）、提升中大尺度的局部對比與微細節、穩住黑位並保護高光，讓畫面更清透立體；高 ISO 時會自動減少細節強化，避免放大雜訊。'),
      ae.d && ae.skyOn ? h('div', { class: 'sub' }, '☁ 已偵測到天空：自動加入「AI 天空」遮色片壓低亮部、加深藍色。天空完全過曝時，可到「天空」分頁置換天空。') : null));
    this.atmCard(b); this.styleCard(b); this.composeCard(b);
    b.append(h('div', { class: 'aicard' }, h('h4', null, '📐 AI 拉正'), h('div', { class: 'sub' }, '偵測建築、門窗、地平線等直線，自動修正歪斜與透視（像 Lightroom 的 Upright）：讓垂直線真正垂直、水平線水平，必要時拉伸垂直方向變成正視角度，並自動裁掉空白邊。'), this.uprightSeg()));
    b.append(h('div', { class: 'sec' }, '基本自動'));
    b.append(h('div', { class: 'note' }, '依照相片的明暗分佈自動設定曝光、對比、亮部、陰影、白色、黑色與飽和度，之後仍可手動微調。'));
    b.append(h('div', { class: 'acts' },
      h('button', { class: 'btn pri', onclick: () => this.doAuto(true, true) }, '✦ 自動（光線＋色彩）'),
      h('button', { class: 'btn', onclick: () => this.doAuto(true, false) }, '自動光線'),
      h('button', { class: 'btn', onclick: () => this.doAuto(false, true) }, '自動白平衡'),
      h('button', { class: 'btn', onclick: () => this.autoLevel() }, '自動水平')));
    if (this.autoUndo) b.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => { this.edit = normEdit(JSON.parse(this.autoUndo)); this.autoUndo = null; this.changed(); this.commit('取消自動'); this.renderPanel(); } }, '↶ 取消自動')));
  },
  doAuto(tone, wb) {
    this.autoUndo = JSON.stringify(this.edit); this.busy('AI 分析光線中…');
    setTimeout(() => {
      let msg = '已套用自動調整';
      try {
        const iso = (this.rec.exif || {}).iso;
        if (wb) { const w = AutoLight.wb(this.ses, this.edit); this.edit.wb = 'auto'; this.edit.temp = w.temp; this.edit.tint = w.tint; if (w.note) msg += '（' + w.note + '）'; }
        if (tone) { const zone = AutoLight.needZones(this.ses, this.edit); const r = zone ? AutoLight.solveZones(this.ses, this.edit, { iso }) : AutoLight.solve(this.ses, this.edit, { iso });
          const info = r._info, zm = r._masks || [], ex = r._extra; delete r._info; delete r._masks; delete r._extra; Object.assign(this.edit, r);
          this.edit.masks = this.edit.masks.filter((m) => !m.aiZone).concat(zm); if (ex) Object.assign(this.edit, ex);
          if (wb) { const c = AutoLight.color(this.ses, this.edit, { iso }); this.edit.vibrance = c.vibrance; this.edit.saturation = c.saturation; }
          msg = `已自動調整光線（${info.scene}場景）` + (wb ? '與色彩' : ''); }
      } catch (e) { console.error(e); const id = imgData(this.ses.aiPrev || this.ses.prev, 320); if (wb) { const w = autoWB(id); this.edit.wb = 'auto'; this.edit.temp = w.temp; this.edit.tint = w.tint; } if (tone) Object.assign(this.edit, autoTone(id, (this.rec.exif || {}).iso)); }
      this.busy(null); this.changed(); this.commit(tone && wb ? '自動' : tone ? '自動光線' : '自動白平衡'); this.renderPanel(); toast(msg, 2600);
    }, 30);
  },
  uprightSeg() {
    return h('div', { class: 'seg srSeg' }, [['off', '關閉'], ['auto', '自動'], ['level', '水平'], ['vertical', '垂直'], ['full', '完整']].map(([k, n]) => h('button', { class: 'btn' + ((this.edit.geo.upright || 'off') === k ? ' on' : ''), onclick: () => this.runUpright(k) }, n)));
  },
  runUpright(mode) {
    const g = this.edit.geo;
    if (mode === 'off') { Object.assign(g, { upright: 'off', rot: 0, vert: 0, horiz: 0 }); this.fitCropToImage('max'); this.changed(); this.commit('關閉拉正'); this.renderPanel(); return; }
    this.busy('AI 拉正分析中…');
    setTimeout(() => {
      let r = null; try { r = AutoAI.upright(this.ses, this.edit, mode); } catch (e) { console.error(e); }
      this.busy(null);
      if (!r) { toast('畫面中找不到足夠的直線（建築、門窗、地平線），無法判斷歪斜', 4000); return; }
      Object.assign(g, { upright: mode, rot: r.rot, vert: r.vert, horiz: r.horiz }); g.constrain = true;
      this.fitCropToImage('max'); this.changed(); this.commit('AI 拉正'); this.renderPanel();
      toast(`AI 拉正：旋轉 ${r.rot}°${r.vert ? `、垂直透視 ${r.vert}` : ''}${r.horiz ? `、水平透視 ${r.horiz}` : ''}（偵測 ${r.nV} 條垂直線、${r.nH} 條水平線）`, 4000);
    }, 30);
  },
  /* ---------- AI 自動構圖 ---------- */
  composeCard(b) {
    const box = h('div', { class: 'aicard' }, h('h4', null, '✂️ AI 自動構圖'), h('div', { class: 'sub' }, '找出畫面主體，依三分法、不切到主體、保留呼吸空間的原則，提供幾種比例的裁切建議；點選即套用，之後仍可在「裁切」微調。'));
    if (this.composeSug && this.composeSug.rec === this.rec.id) {
      const grid = h('div', { class: 'stg' });
      for (const sg of this.composeSug.list) {
        const cv = h('canvas'); const t = h('div', { class: 'stt' + (this.composeSel === sg.name ? ' on' : ''), onclick: () => this.applyCompose(sg) }, cv, h('b', null, sg.name));
        grid.append(t); requestAnimationFrame(() => { try { const e = normEdit(clone(this.edit)); Object.assign(e.crop, { x: sg.x, y: sg.y, w: sg.w, h: sg.h }); const th = this.ses.renderThumb(effective(e), 150); cv.width = th.width; cv.height = th.height; cv.getContext('2d').drawImage(th, 0, 0); } catch (er) { console.warn(er); } });
      }
      box.append(grid, h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => this.runCompose() }, '↻ 重新分析'), this.composeUndo ? h('button', { class: 'btn sm', onclick: () => { Object.assign(this.edit.crop, JSON.parse(this.composeUndo)); this.composeUndo = null; this.composeSel = null; this.changed(); this.commit('取消構圖'); this.renderPanel(); } }, '↶ 還原裁切') : null));
    } else box.append(h('div', { class: 'acts' }, h('button', { class: 'btn pri', onclick: () => this.runCompose() }, '✂️ 分析構圖')));
    b.append(box);
  },
  runCompose() {
    this.busy('AI 構圖分析中…');
    setTimeout(() => { try { this.composeSug = { rec: this.rec.id, list: AutoAI.compose(this.ses, this.edit) }; } catch (e) { console.error(e); toast('構圖分析失敗：' + e.message); } this.busy(null); this.requestRender(); this.renderPanel(); }, 30);
  },
  applyCompose(sg) {
    const c = this.edit.crop; if (!this.composeUndo) this.composeUndo = JSON.stringify({ x: c.x, y: c.y, w: c.w, h: c.h, ratio: c.ratio });
    Object.assign(c, { x: sg.x, y: sg.y, w: sg.w, h: sg.h, ratio: sg.ratio }); this.composeSel = sg.name; this.changed(); this.commit('AI 構圖：' + sg.name); this.renderPanel();
  },
  /* ---------- 氛圍感（v1.13）：改變「光線」本身的顏色與光暈，不是在整張照片蓋一層顏色 ---------- */
  ATM_D: {
    rays: { exposure: -0.7, contrast: 18, blacks: -20, dehaze: 22, vibrance: 15, saturation: 4, highlights: -25 },
    golden: { temp: 10, vibrance: 10, highlights: -15, contrast: 6 },
    jiufen: { highlights: -35, contrast: 8, fade: 6, shadows: 10, 'hsl.sat': [0, 8, 0, -30, -20, -15, 0, 0], 'hsl.hue': [3, 0, 0, 0, 0, 0, 0, 0] },
    mist: { dehaze: -8, contrast: -6, saturation: -8, fade: 6 }
  },
  atmShift(d, sign) {
    for (const k in d) { const v = d[k];
      if (Array.isArray(v)) { const a = getP(this.edit, k); for (let i = 0; i < 8; i++) a[i] = clamp(a[i] + sign * v[i], -100, 100); }
      else this.edit[k] = k === 'exposure' ? Math.round(((this.edit[k] || 0) + sign * v) * 100) / 100 : clamp((this.edit[k] || 0) + sign * v, -100, 100); }
  },
  setAtm(kind) {
    const a = this.edit.atm; if (a.on && a.d) this.atmShift(a.d, -1);
    if (!kind || (a.on && a.kind === kind)) { a.on = false; a.d = null; }
    else {
      const d = clone(this.ATM_D[kind]); a.on = true; a.kind = kind; a.d = d; this.atmShift(d, 1);
      // 氛圍光會讓暗部與光線更明顯：一併加強色彩雜訊減少，避免彩噪（夜景再加亮度降噪）
      this.edit.nr.col = Math.max(this.edit.nr.col || 0, kind === 'jiufen' ? 55 : 35); this.edit.nr.csm = Math.max(this.edit.nr.csm || 0, 60);
      if (kind === 'jiufen') this.edit.nr.lum = Math.max(this.edit.nr.lum || 0, 18);
    }
    this.changed(); this.commit(a.on ? '氛圍感：' + ATMOS[kind].name : '關閉氛圍感'); this.renderPanel();
  },
  atmCard(b) {
    const a = this.edit.atm || (this.edit.atm = { on: false, kind: 'rays', amt: 100, glow: 50 });
    const box = h('div', { class: 'aicard' }, h('h4', null, '🌅 AI 氛圍感'),
      h('div', { class: 'sub' }, '改變「光線」本身的顏色：亮的地方（陽光、光束、燈光）變成暖色並加上柔和光暈，暗的地方保持乾淨的冷暖對比。依模糊後的亮度判斷範圍，不會產生色塊；同時自動加強彩噪抑制。'),
      h('div', { class: 'chips' }, Object.keys(ATMOS).map((k) => h('button', { class: 'btn sm' + (a.on && a.kind === k ? ' on' : ''), onclick: () => this.setAtm(k) }, ATMOS[k].name))));
    if (a.on) {
      box.append(this.slider('氛圍強度', () => a.amt, (v) => { a.amt = v; this.changed(); }, 0, 150, 1, 100, { onCommit: () => this.commit('氛圍強度') }),
        this.slider('光暈', () => a.glow, (v) => { a.glow = v; this.changed(); }, 0, 100, 1, 50, { onCommit: () => this.commit('光暈') }),
        h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => this.setAtm(null) }, '關閉氛圍感')));
      if (a.kind === 'jiufen') box.append(h('div', { class: 'sub' }, '夜景燈光複雜：已自動加強降噪。若仍有雜訊，建議再開「AI 降噪」。'));
    }
    b.append(box);
  },
  /* ---------- AI 風格推薦 ---------- */
  styleCard(b) {
    const box = h('div', { class: 'aicard' }, h('h4', null, '🎨 AI 風格推薦'), h('div', { class: 'sub' }, '分析這張照片（灰平、昏暗、夜景、人像、風景、天空過曝…），推薦最適合、最驚艷的風格；例如灰灰平平的照片改成黃昏暖調。'));
    const S = this.styleState && this.styleState.rec === this.rec.id ? this.styleState : null;
    if (S) {
      const keys = S.more ? S.an.order : S.an.order.slice(0, 4); const grid = h('div', { class: 'stg' }); const base = JSON.parse(S.base);
      for (const k of keys) {
        const st = AutoAI.STYLES[k]; const cv = h('canvas');
        grid.append(h('div', { class: 'stt' + (S.key === k ? ' on' : ''), onclick: () => this.applyStyle(k) }, cv, h('b', null, st.name), S.an.why[k] ? h('small', null, S.an.why[k]) : null));
        requestAnimationFrame(() => { try { const th = this.ses.renderThumb(effective(AutoAI.applyStyle(base, k, 100)), 150); cv.width = th.width; cv.height = th.height; cv.getContext('2d').drawImage(th, 0, 0); } catch (er) { console.warn(er); } });
      }
      box.append(grid);
      if (!S.more) box.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => { S.more = true; this.renderPanel(); } }, `更多風格（${S.an.order.length}）`)));
      if (S.key) {
        box.append(this.slider('風格強度', () => S.amt, (v) => { S.amt = v; this.applyStyle(S.key, true); }, 0, 100, 1, 80, { onCommit: () => this.commit('風格強度') }));
        if (S.key === 'golden' && S.an.skyGold) box.append(this.toggle('天空一起換成黃昏天空', () => S.sky, (v) => { S.sky = v; this.applyStyle(S.key, true); }));
        box.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => { this.edit = normEdit(JSON.parse(S.base)); S.key = null; this.changed(); this.commit('取消風格'); this.renderPanel(); } }, '↶ 還原')));
      }
    } else box.append(h('div', { class: 'acts' }, h('button', { class: 'btn pri', onclick: () => { this.styleState = { rec: this.rec.id, an: AutoAI.analyze(this.ses, this.rec), base: JSON.stringify(this.edit), key: null, amt: 80, sky: true }; this.renderPanel(); } }, '🎨 分析並推薦風格')));
    b.append(box);
  },
  applyStyle(k, keep) {
    const S = this.styleState; if (!S) return; if (!keep && S.key !== k) S.amt = 80; S.key = k;
    const e = AutoAI.applyStyle(JSON.parse(S.base), k, S.amt);
    if (k === 'golden' && S.an.skyGold && S.sky) { e.sky = { ...e.sky, on: true, preset: 'golden', amt: Math.round(85 * S.amt / 100) }; this.loadSky('golden'); }
    this.edit = e; this.changed(); if (!keep) { this.commit('風格：' + AutoAI.STYLES[k].name); this.renderPanel(); }
  },
  runAiEnh() {
    const id = imgData(this.ses.aiPrev || this.ses.prev, 320); this.ses.ensureSky();
    const ex = this.rec.exif || {}; const base = aiEnhance(id, { iso: ex.iso, wb: null }); if (this.edit.wb === 'shot') { try { const w = AutoLight.wb(this.ses, this.edit); base.temp = w.temp - (this.edit.temp || 0); base.tint = w.tint - (this.edit.tint || 0); } catch (e) {} }
    const prev = this.edit.aiEnh || {}; if (prev.d) this.aiEnhApply(0);
    Object.assign(this.edit.aiEnh = this.edit.aiEnh || {}, { d: base, skyOn: false });   // v1.13：不再自動加天空遮色片（邊緣會產生白邊光暈），天空亮部改由閉迴路的「亮部」處理
    this.aiEnhApply(100, prev.clear || 0);
    // v1.13：光線部分改用閉迴路求解（實際渲染、量測、修正），過曝救高光、太暗提陰影都算到位
    try { const r = AutoLight.solve(this.ses, this.edit, { iso: ex.iso }); delete r._info; const ae = this.edit.aiEnh; for (const k of AutoLight.TONE) ae.d[k] = (k === 'exposure' ? Math.round((r[k] - ae.base[k]) * 100) / 100 : Math.round(r[k] - ae.base[k])); this.aiEnhApply(100);
      // v1.19.1：鮮豔度依照片原本彩度自動補足（之前固定只加一點點，顏色偏淡）
      const c = AutoLight.color(this.ses, this.edit, { iso: ex.iso }); for (const k of ['vibrance', 'saturation']) ae.d[k] = Math.round((ae.d[k] || 0) + (c[k] || 0) - (this.edit[k] || 0)); this.aiEnhApply(100); } catch (e) { console.warn('AutoLight', e); }
    this.changed(); this.commit('AI 智慧增強'); this.renderPanel();
    toast(ex.iso >= 1600 ? `AI 增強完成（ISO ${ex.iso}：已節制暗部提亮，建議再開 AI 降噪）` : 'AI 增強完成，可用「強度」調整', 3500);
  },
  aiEnhApply(amt, clear) {
    const ae = this.edit.aiEnh = this.edit.aiEnh || { amt: 0 }; const d = ae.d || {};
    const iso = (this.rec.exif || {}).iso || 100; const isoF = iso >= 6400 ? 0.4 : iso >= 3200 ? 0.55 : iso >= 1600 ? 0.75 : 1;
    const CLR = { dehaze: 24, clarity: 24 * isoF, texture: 12 * isoF, vibrance: 12, contrast: 6, blacks: -7, highlights: -10, saturation: 2 };
    const keys = [...new Set([...Object.keys(d), ...Object.keys(CLR)])];
    const contrib = (k) => (d[k] || 0) * (ae.d ? (ae.amt || 0) / 100 : 0) + (CLR[k] || 0) * (ae.clear || 0) / 100;
    ae.base = ae.base || {}; for (const k of keys) if (!(k in ae.base)) ae.base[k] = (this.edit[k] || 0) - contrib(k); // 套用前的手動值
    if (amt != null) ae.amt = amt; if (clear != null) ae.clear = clear;
    for (const k of keys) { const v = ae.base[k] + contrib(k); this.edit[k] = k === 'exposure' ? Math.round(v * 100) / 100 : Math.round(v); }
    const f = ae.d ? (ae.amt || 0) / 100 : 0;
    if (!ae.d) return;
    let m = this.edit.masks.find((x) => x.aiSky);
    if (ae.skyOn && f > 0) {
      if (!m) { m = { id: uid(), type: 'sky', aiSky: true, name: 'AI 天空', invert: false, amt: 100, on: true, p: {}, adj: clone(DEF_MASK_ADJ) }; this.edit.masks.push(m); }
      Object.assign(m.adj, { highlights: Math.round(-45 * f), dehaze: Math.round(12 * f), saturation: Math.round(14 * f), temp: Math.round(-5 * f), exposure: Math.round(-0.2 * f * 100) / 100 });
    } else if (m) this.edit.masks = this.edit.masks.filter((x) => x !== m);
  },
  /* ---------- 天空置換 ---------- */
  p_sky(b) {
    const k = this.edit.sky; this.ses.ensureSky(); const found = this.ses.skyFrac > 0.004;
    const sw = h('input', { type: 'checkbox' }); sw.checked = !!k.on;
    sw.onchange = () => { k.on = sw.checked; if (k.on) this.loadSky(k.preset); this.changed(); this.commit(k.on ? '開啟天空置換' : '關閉天空置換'); this.renderPanel(); };
    b.append(h('div', { class: 'aicard' }, h('h4', null, '☁ 天空置換', h('span', { class: 'grow' }), h('label', { class: 'sw' }, sw, h('span'))),
      h('div', { class: 'sub' }, '自動偵測天空並換上新的天空，邊緣依原圖亮度細修（樹梢、屋簷），前景色調會跟著新天空融合。適合救回過曝、灰白的天空。'),
      found ? null : h('div', { class: 'sub', style: { color: 'var(--warn)' } }, '⚠ 這張相片沒有偵測到明顯的天空（天空需位於畫面上方且偏亮）。')));
    const grid = h('div', { class: 'skyg' }); b.append(grid);
    const tile = (key, name, del) => {
      const img = h('img', { alt: name }); SkyLib.thumb(key).then((u) => (img.src = u)).catch(() => {});
      const t = h('div', { class: 'skyt' + (k.preset === key && k.on ? ' on' : ''), onclick: () => { k.preset = key; k.on = true; this.loadSky(key, () => this.commit('天空：' + name)); this.renderPanel(); } }, img, h('span', null, name),
        del ? h('i', { onclick: async (ev) => { ev.stopPropagation(); if (!(await UI.confirm(`刪除自訂天空「${name}」？`, '刪除', true))) return; await SkyLib.removeCustom(key); if (k.preset === key) { k.preset = 'cumulus'; } this.changed(); this.renderPanel(); } }, '✕') : null);
      grid.append(t);
    };
    for (const [key, name] of SkyLib.PRESETS) tile(key, name);
    for (const c of SkyLib.custom()) tile('c:' + c.id, c.name, true);
    const fi = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    fi.onchange = async () => { const f = fi.files[0]; fi.value = ''; if (!f) return; const key = await SkyLib.importFile(f); k.preset = key; k.on = true; this.loadSky(key, () => this.commit('自訂天空')); this.renderPanel(); };
    grid.append(h('div', { class: 'skyt add', onclick: () => fi.click() }, h('b', null, '＋'), h('span', null, '匯入天空照片')), fi);
    if (!k.on) return;
    b.append(this.S('sky.amt', '強度', 0, 100, 1), this.S('sky.exp', '天空亮度', -2, 2, 0.05, { unit: ' EV' }), this.S('sky.temp', '天空色溫', -100, 100, 1),
      this.S('sky.pos', '天空位置', -50, 50, 1), this.S('sky.edge', '邊緣柔化', 0, 100, 1), this.S('sky.gaps', '填補縫隙', 0, 100, 1),
      this.S('sky.haze', '地平線霧化', 0, 100, 1), this.S('sky.relight', '前景融合', 0, 100, 1),
      this.toggle('左右翻轉天空', () => k.flip, (v) => (k.flip = v)));
  },
  loadSky(key, done) {
    if (SkyLib.texSync(key)) { this.changed(); done && done(); return; }
    this.busy('產生天空中…'); SkyLib.load(key).then(() => { this.busy(null); this.changed(); done && done(); }).catch((e) => { this.busy(null); toast('天空載入失敗：' + e.message); });
  },
  /* ---------- 全螢幕色調曲線（Lightroom 樣式） ---------- */
  openCurveFS() {
    if (this.tool !== 'edit') this.setTool('edit');
    this.curveFS = { ch: ['rgb', 'r', 'g', 'b'].includes(this.curveCh) ? this.curveCh : 'rgb', start: JSON.stringify(this.edit.curve) };
    const v = $('#v-ed'); v.classList.add('curveFS'); this.renderCurveBar();
    requestAnimationFrame(() => { v.style.setProperty('--dockH', $('#curveBar').offsetHeight + 'px'); this.view.fit = true; this.computeHist(); this.requestRender(); });
  },
  closeCurveFS() {
    if (!this.curveFS) return; this.curveFS = null; const v = $('#v-ed'); v.classList.remove('curveFS');
    if (v.classList.contains('dockMin')) { v.classList.remove('dockMin'); this.setDock(true); } else v.style.removeProperty('--dockH');
    this.view.fit = true; this.renderPanel(); this.requestRender();
  },
  /* 曲線模板（v1.15）：選取後即時套用，之後仍可拖曳微調 */
  curvePresetSel() {
    const cur = this.edit.curvePreset || '';
    const sel = h('select', { class: 'cvPre' }, h('option', { value: '' }, '📐 曲線模板…'), CURVE_PRESETS.map((g) => h('optgroup', { label: g.g }, g.items.map((it) => h('option', { value: it.id, selected: it.id === cur }, it.name)))));
    sel.onchange = () => { const it = CURVE_PRESETS.flatMap((g) => g.items).find((x) => x.id === sel.value); if (!it) return; this.applyCurvePreset(it); };
    return sel;
  },
  applyCurvePreset(it) {
    const cv = (a) => (a ? a.map(([x, y]) => [x / 255, y / 255]) : clone(ID_CURVE));
    this.edit.curve.rgb = cv(it.rgb); this.edit.curve.r = cv(it.r); this.edit.curve.g = cv(it.g); this.edit.curve.b = cv(it.b); this.edit.curvePreset = it.id;
    this.changed(); this.commit('曲線模板：' + it.name); toast(it.name + '：' + it.desc, 3500);
    if (this.curveFS) { this.renderCurveBar(); this.drawOverlay(); } else this.renderPanel();
  },
  renderCurveBar() {
    const cb = $('#curveBar'); cb.innerHTML = ''; const ch = this.curveFS.ch;
    cb.append(h('div', { class: 'cbHd' }, h('b', null, '曲線'), this.curvePresetSel(), h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', onclick: () => { this.edit.curve[ch] = clone(ID_CURVE); delete this.edit.curvePreset; this.changed(); this.commit('重設曲線'); this.renderCurveBar(); this.drawOverlay(); } }, '重設'),
      h('button', { class: 'btn pri sm', onclick: () => this.closeCurveFS() }, '完成')),
      h('div', { class: 'cbCh' }, [['rgb', '#f2ebe0', '亮度'], ['r', '#e0574a', '紅'], ['g', '#5fb257', '綠'], ['b', '#5a86e0', '藍'], ['par', '#9a8a74', '參數']].map(([k, c, n]) => {
        const bt = h('button', { class: 'cbc' + (k === ch ? ' on' : '') + (k === 'par' ? ' par' : ''), title: n, onclick: () => { this.curveFS.ch = k; if (k !== 'par') this.curveCh = k; this.renderCurveBar(); this.drawOverlay(); requestAnimationFrame(() => $('#v-ed').style.setProperty('--dockH', $('#curveBar').offsetHeight + 'px')); } }, k === 'par' ? h('b', null, '≈') : h('i')); bt.style.setProperty('--c', c); return bt; })),
      ch === 'par' ? h('div', { class: 'cbPar' }, ...[['h', '亮部'], ['l', '亮調'], ['d', '暗調'], ['s', '陰影']].map(([k, n]) => this.S('curve.par.' + k, n, -100, 100, 1)))
        : h('div', { class: 'sub', style: { textAlign: 'center', marginTop: '6px' } }, '點曲線新增控制點・拖曳調整・往框外拖出或點兩下刪除'));
  },
  cbox() { const ov = $('#ov'); const w = ov.width * 0.84, hh = Math.min(ov.height * 0.66, w * 1.05); return { x: (ov.width - w) / 2, y: (ov.height - hh) / 2, w, h: hh }; },
  drawCurveFS(x, dpr) {
    const B = this.cbox(); const ch = this.curveFS.ch; if (ch === 'par') return; const pts = this.edit.curve[ch];
    const col = { rgb: '#ffffff', r: '#ff6b5e', g: '#6fd35f', b: '#6b97ff' }[ch];
    x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 3 * dpr;
    const dragging = !!this.cvDrag; x.strokeStyle = dragging ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.35)'; x.lineWidth = 1 * dpr; x.strokeRect(B.x, B.y, B.w, B.h); x.beginPath();
    for (let i = 1; i < 4; i++) { x.moveTo(B.x + B.w * i / 4, B.y); x.lineTo(B.x + B.w * i / 4, B.y + B.h); x.moveTo(B.x, B.y + B.h * i / 4); x.lineTo(B.x + B.w, B.y + B.h * i / 4); } x.stroke();
    const hd = this.histData; if (hd) { const a = ch === 'r' ? hd.hr : ch === 'g' ? hd.hg : ch === 'b' ? hd.hb : hd.hg.map((v, i) => (v + hd.hr[i] + hd.hb[i]) / 3); let m = 1; for (let i = 1; i < 63; i++) m = Math.max(m, a[i]);
      x.shadowBlur = 0; x.fillStyle = dragging ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.13)'; x.beginPath(); x.moveTo(B.x, B.y + B.h); for (let i = 0; i < 64; i++) x.lineTo(B.x + i / 63 * B.w, B.y + B.h - Math.min(1, a[i] / m) * B.h * 0.9); x.lineTo(B.x + B.w, B.y + B.h); x.fill(); x.shadowBlur = 3 * dpr; }
    const f = Engine.monotone(pts); x.strokeStyle = col; x.lineWidth = 2.2 * dpr; x.beginPath();
    for (let i = 0; i <= 200; i++) { const v = i / 200; const y = clamp(f(v), 0, 1); const X = B.x + v * B.w, Y = B.y + (1 - y) * B.h; i ? x.lineTo(X, Y) : x.moveTo(X, Y); } x.stroke();
    for (const p of pts) { x.beginPath(); x.arc(B.x + p[0] * B.w, B.y + (1 - p[1]) * B.h, 9 * dpr, 0, 7); x.fillStyle = 'rgba(235,235,235,.95)'; x.fill(); }
    x.restore();
  },
  curveDown(p) {
    if (this.curveFS.ch === 'par') { this.cvDrag = null; return; }
    const B = this.cbox(); const pts = this.edit.curve[this.curveFS.ch]; const dpr = this.dpr;
    const sp = (q) => [B.x + q[0] * B.w, B.y + (1 - q[1]) * B.h];
    let idx = -1, bd = 30 * dpr; pts.forEach((q, i) => { const s = sp(q); const d = Math.hypot(s[0] - p[0], s[1] - p[1]); if (d < bd) { bd = d; idx = i; } });
    const now = Date.now();
    if (idx >= 0 && this.cvLast && this.cvLast.i === idx && now - this.cvLast.t < 320 && idx > 0 && idx < pts.length - 1) { pts.splice(idx, 1); this.cvDrag = null; this.cvLast = null; this.changed(); this.drawOverlay(); return; }
    if (idx < 0) {
      if (p[0] < B.x - 10 * dpr || p[0] > B.x + B.w + 10 * dpr || p[1] < B.y - 10 * dpr || p[1] > B.y + B.h + 10 * dpr) { this.cvDrag = null; return; }
      const vx = clamp((p[0] - B.x) / B.w, 0.01, 0.99); const f = Engine.monotone(pts); pts.push([vx, clamp(f(vx), 0, 1)]); pts.sort((a, b2) => a[0] - b2[0]); idx = pts.findIndex((q) => q[0] === vx);
    }
    this.beginInteractive(); const s = sp(pts[idx]); this.cvDrag = { i: idx, dx: p[0] - s[0], dy: p[1] - s[1] }; this.cvLast = { i: idx, t: now }; this.changed(); this.drawOverlay();
  },
  curveMove(p) {
    const d = this.cvDrag; if (!d) return; const B = this.cbox(); const a = this.edit.curve[this.curveFS.ch];
    const vx = (p[0] - d.dx - B.x) / B.w, vy = 1 - (p[1] - d.dy - B.y) / B.h; const end = d.i === 0 || d.i === a.length - 1;
    if (!end && (vy < -0.18 || vy > 1.18)) { a.splice(d.i, 1); this.cvDrag = null; this.changed(); this.drawOverlay(); return; }
    const lo = d.i > 0 ? a[d.i - 1][0] + 0.01 : 0, hi = d.i < a.length - 1 ? a[d.i + 1][0] - 0.01 : 1;
    delete this.edit.curvePreset;
    a[d.i] = [end && a.length > 1 ? (d.i === 0 ? clamp(vx, 0, hi) : clamp(vx, lo, 1)) : clamp(vx, lo, hi), clamp(vy, 0, 1)];
    this.changed(); this.drawOverlay();
  },
  curveUp() { this.endInteractive(); if (this.cvDrag !== undefined) { this.cvDrag = null; this.commit('色調曲線'); } },
  autoLevel() { const a = autoLevel(imgData(this.ses.prev, 640)); this.edit.crop.angle = Math.round(a * 10) / 10; this.fitCropToImage('max'); this.changed(); this.commit('自動水平'); toast(`拉直 ${this.edit.crop.angle.toFixed(1)}°`); this.renderPanel(); },
  p_profile(b) {
    const ex = this.rec.exif || {}; const ck = camKey(ex.make); const cam = ck && CAM_PROFILES[ck];
    const groups = [];
    if (cam) groups.push(['cam', `相機比對（${cam.label}）`]);
    groups.push(['基本', 'Adobe 基本'], ['創意', '創意'], ['黑白', '黑白'], ['custom', `自訂（${CustomProfiles.list.length}）`]);
    if (!this.profGroup || !groups.find((g) => g[0] === this.profGroup)) this.profGroup = cam ? 'cam' : '基本';
    const sel = h('select', { style: { padding: '5px 12px', fontSize: '14px', fontWeight: '700' } }, groups.map(([k, n]) => h('option', { value: k, selected: k === this.profGroup }, n)));
    sel.onchange = () => { this.profGroup = sel.value; this.renderPanel(); };
    b.append(h('div', { class: 'lbl2' }, sel, h('button', { class: 'btn sm', onclick: () => this.importStyle() }, '＋ 匯入風格檔')));
    let items = [];
    if (this.profGroup === 'cam') {
      items = cam.list.map(([id, name]) => ({ id, name, star: id === cam.def }));
      b.append(h('div', { class: 'note' }, `已從 EXIF 偵測到 ${[ex.make, ex.model].filter(Boolean).join(' ')}。★ 為相機預設風格，與 Lightroom「相機比對」同樣的概念。JPEG 檔本身已套用過相機內的風格，在這裡切換會疊加在它上面。`));
    } else if (this.profGroup === 'custom') {
      items = CustomProfiles.list.map((p) => ({ id: p.id, name: p.name, custom: p }));
      if (!items.length) b.append(h('div', { class: 'note', html: '可以匯入：<br>• <b>.cube</b> 3D LUT 色彩風格檔（大多數調色軟體、相機 LUT 都能匯出）<br>• <b>.xmp</b> Lightroom／Camera Raw 的預設集或描述檔（會讀取其中的曝光、曲線、HSL、顏色分級等參數）' }));
    } else {
      items = PROFILES.filter((q) => q.g === this.profGroup).map((p) => ({ id: p.id, name: p.name }));
      if (!cam && this.profGroup === '基本' && ex.make) b.append(h('div', { class: 'sub' }, `相機：${ex.make}（目前沒有這個廠牌的相機比對風格）`));
    }
    const grid = h('div', { class: 'cards' }); b.append(grid);
    for (const it of items) {
      const cv = h('canvas', { width: 1, height: 1 });
      const card = h('div', { class: 'pcard' + (this.edit.profile === it.id ? ' on' : ''), style: { position: 'relative' }, onclick: () => { this.edit.profile = it.id; this.changed(); this.commit('設定檔：' + it.name); this.renderPanel(); } }, cv, h('div', null, (it.star ? '★ ' : '') + it.name));
      if (it.custom) card.append(h('span', { style: { position: 'absolute', top: '3px', right: '3px', background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: '50%', width: '20px', height: '20px', display: 'grid', placeItems: 'center', fontSize: '12px' },
        onclick: async (ev) => { ev.stopPropagation(); if (!(await UI.confirm(`刪除風格檔「${it.name}」？`, '刪除', true))) return; await DB.del('presets', it.id); if (this.edit.profile === it.id) { this.edit.profile = 'color'; this.changed(); this.commit('刪除風格檔'); } await App.loadPresets(); this.renderPanel(); } }, '✕'));
      grid.append(card); this.thumbLater(cv, () => ({ ...clone(this.edit), profile: it.id, profileAmt: 100 }));
    }
    b.append(this.S('profileAmt', '數量', 0, 200, 1, { sign: false, zero: 0 }));
  },
  importStyle() {
    const inp = h('input', { type: 'file', accept: '.xmp,.cube,.XMP,.CUBE', multiple: true, style: { display: 'none' } }); document.body.append(inp);
    inp.onchange = async () => {
      let ok = 0, last = null;
      for (const f of inp.files) {
        try {
          const text = await f.text(); const base = f.name.replace(/\.[^.]+$/, '');
          let p;
          if (/\.cube$/i.test(f.name)) { const c = parseCube(text); p = { id: 'cp_' + uid(), type: 'profile', kind: 'lut', name: c.title || base, N: c.N, data: c.data, t: Date.now() }; }
          else { const x = parseCrsXmp(text); p = { id: 'cp_' + uid(), type: 'profile', kind: 'params', name: x.name || base, d: x.d, hasTable: x.hasTable, t: Date.now() }; if (x.hasTable) toast(`「${p.name}」含 Adobe 專有色彩表，已匯入其中可讀取的 ${x.cnt} 項參數`, 5000); }
          await DB.put('presets', p); ok++; last = p;
        } catch (e) { toast(`「${f.name}」無法匯入：${e.message}`, 5000); }
      }
      inp.remove(); await App.loadPresets();
      if (last) { this.profGroup = 'custom'; this.edit.profile = last.id; this.changed(); this.commit('套用風格檔：' + last.name); toast(`已匯入 ${ok} 個風格檔`); }
      this.renderPanel();
    };
    inp.click();
  },
  thumbLater(cv, getEdit) {
    (this.thumbQ = this.thumbQ || []).push([cv, getEdit]);
    if (this.thumbRun) return; this.thumbRun = true;
    const step = () => {
      const j = this.thumbQ.shift(); if (!j || !this.active) { this.thumbRun = false; return; }
      const [c, ge] = j; if (c.isConnected) { try { const t = this.ses.renderThumb(effective(normEdit(ge())), 128); c.width = t.width; c.height = t.height; c.getContext('2d').drawImage(t, 0, 0); } catch (e) { console.warn(e); } }
      setTimeout(step, 8);
    }; setTimeout(step, 30);
  },
  p_light(b) {
    b.append(this.S('exposure', '曝光', -5, 5, 0.01, { fmt: (v) => v.toFixed(2) + ' EV' }), this.S('contrast', '對比', -100, 100, 1),
      this.S('highlights', '亮部', -100, 100, 1), this.S('shadows', '陰影', -100, 100, 1), this.S('whites', '白色', -100, 100, 1), this.S('blacks', '黑色', -100, 100, 1));
  },
  curveUI(s) {
    const chs = [['rgb', '⚪ RGB'], ['r', '紅'], ['g', '綠'], ['b', '藍'], ['par', '參數']];
    s.append(h('div', { class: 'chips' }, chs.map(([k, n]) => h('button', { class: 'btn sm' + (this.curveCh === k ? ' on' : ''), onclick: () => { this.curveCh = k; this.renderPanel(); } }, n)),
      h('button', { class: 'btn sm', onclick: () => { this.edit.curve = clone(DEF_EDIT.curve); this.changed(); this.commit('重設曲線'); this.renderPanel(); } }, '重設')));
    if (this.curveCh === 'par') {
      const P = (k, n, mn = -100, mx = 100) => this.S('curve.par.' + k, n, mn, mx, 1);
      s.append(P('h', '亮部'), P('l', '亮調'), P('d', '暗調'), P('s', '陰影'), P('s1', '分割：暗', 5, 45), P('s2', '分割：中', 30, 70), P('s3', '分割：亮', 55, 95));
      return;
    }
    s.append(h('div', { class: 'acts' }, this.curvePresetSel(), h('button', { class: 'btn sm pri', onclick: () => this.openCurveFS() }, '⤢ 全螢幕編輯曲線')));
    const cv = h('canvas', { id: 'curveCv', width: 600, height: 444 }); s.append(cv, h('div', { class: 'sub' }, '點一下新增控制點、拖曳調整，往外拖出即可刪除。'));
    const pts = () => this.edit.curve[this.curveCh];
    const col = { rgb: '#efe2cb', r: '#e0574a', g: '#5fb257', b: '#5a86e0' }[this.curveCh];
    const draw = this.drawCurve = () => {
      if (!cv.isConnected) return; const x = cv.getContext('2d'); const W = cv.width, H = cv.height; x.clearRect(0, 0, W, H);
      const dark = document.documentElement.dataset.theme === 'dark'; x.strokeStyle = dark ? 'rgba(255,240,220,.15)' : 'rgba(80,60,40,.15)'; x.lineWidth = 1;
      for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(W * i / 4, 0); x.lineTo(W * i / 4, H); x.moveTo(0, H * i / 4); x.lineTo(W, H * i / 4); x.stroke(); }
      if (this.histData) { const a = this.curveCh === 'r' ? this.histData.hr : this.curveCh === 'g' ? this.histData.hg : this.curveCh === 'b' ? this.histData.hb : this.histData.hg.map((v, i) => (v + this.histData.hr[i] + this.histData.hb[i]) / 3); let m = 1; for (let i = 1; i < 63; i++) m = Math.max(m, a[i]); x.fillStyle = dark ? 'rgba(255,240,220,.12)' : 'rgba(80,60,40,.12)'; x.beginPath(); x.moveTo(0, H); for (let i = 0; i < 64; i++) x.lineTo(i / 63 * W, H - Math.min(1, a[i] / m) * H * .9); x.lineTo(W, H); x.fill(); }
      x.strokeStyle = dark ? 'rgba(255,240,220,.25)' : 'rgba(80,60,40,.25)'; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(0, H); x.lineTo(W, 0); x.stroke(); x.setLineDash([]);
      const f = Engine.monotone(pts()); x.strokeStyle = this.curveCh === 'rgb' ? (dark ? '#efe2cb' : '#3a2e22') : col; x.lineWidth = 3; x.beginPath();
      for (let i = 0; i <= 200; i++) { const v = i / 200; const y = clamp(f(v), 0, 1); i ? x.lineTo(v * W, H - y * H) : x.moveTo(v * W, H - y * H); } x.stroke();
      for (const p of pts()) { x.fillStyle = '#fff'; x.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ac'); x.lineWidth = 3; x.beginPath(); x.arc(p[0] * W, H - p[1] * H, 9, 0, 7); x.fill(); x.stroke(); }
    };
    let drag = -1;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, -0.3, 1.3)]; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); const p = pos(e); const a = pts(); const r = cv.getBoundingClientRect(); const tol = 22 / r.width;
      drag = a.findIndex((q) => Math.hypot(q[0] - p[0], (q[1] - p[1]) * r.height / r.width) < tol);
      if (drag < 0) { a.push([p[0], clamp(p[1], 0, 1)]); a.sort((m, n) => m[0] - n[0]); drag = a.findIndex((q) => q[0] === p[0]); }
      this.changed(); draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (drag < 0) return; const p = pos(e); const a = pts(); const end = drag === 0 || drag === a.length - 1;
      if (!end && (p[1] < -0.15 || p[1] > 1.15)) { a.splice(drag, 1); drag = -1; this.changed(); draw(); return; }
      const lo = drag > 0 ? a[drag - 1][0] + 0.01 : 0, hi = drag < a.length - 1 ? a[drag + 1][0] - 0.01 : 1;
      a[drag] = [end && a.length > 1 ? (drag === 0 ? clamp(p[0], 0, hi) : clamp(p[0], lo, 1)) : clamp(p[0], lo, hi), clamp(p[1], 0, 1)];
      this.changed(); draw();
    });
    const up = () => { if (drag !== -2) { drag = -1; this.commit('色調曲線'); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    requestAnimationFrame(draw);
  },
  p_color(b) {
    const wbSel = h('select', { style: { padding: '4px 10px', fontSize: '13px' } }, [['shot', '原始設定'], ['auto', '自動'], ['custom', '自訂']].map(([k, n]) => h('option', { value: k, selected: this.edit.wb === k }, n)));
    wbSel.onchange = () => { const v = wbSel.value; this.edit.wb = v; if (v === 'shot') { this.edit.temp = 0; this.edit.tint = 0; } else if (v === 'auto') Object.assign(this.edit, autoWB(imgData(this.ses.prev, 320))); this.changed(); this.commit('白平衡'); this.renderPanel(); };
    b.append(h('div', { class: 'lbl2' }, h('span', null, '白平衡'), h('span', { style: { display: 'flex', gap: '6px' } }, wbSel, h('button', { class: 'btn sm' + (this.picking === 'wb' ? ' on' : ''), title: '滴管：點畫面中應為中性灰的地方', onclick: () => { this.picking = this.picking === 'wb' ? null : 'wb'; this.renderPanel(); toast(this.picking ? '點一下畫面中應為白或灰的位置' : '已取消滴管'); } }, '💧 滴管'))));
    const wbI = () => { if (this.edit.wb !== 'custom') { this.edit.wb = 'custom'; wbSel.value = 'custom'; } this.changed(); };
    b.append(this.S('temp', '色溫', -100, 100, 1, { grad: 'linear-gradient(90deg,#4f7fd6,#ddd 50%,#e6b33a)', onInput: wbI }), this.S('tint', '色調', -100, 100, 1, { grad: 'linear-gradient(90deg,#4fae58,#ddd 50%,#c94fae)', onInput: wbI }));
    b.append(this.S('vibrance', '自然飽和度', -100, 100, 1), this.S('saturation', '飽和度', -100, 100, 1));
    b.append(this.toggle('黑白', () => this.edit.mono, (v) => { this.edit.mono = v; this.renderPanel(); }));
    b.append(...this.section(this.edit.mono || this.isMono() ? '黑白混合' : '混色器', (s) => this.mixerUI(s), false, 'mixer'));
    b.append(...this.section('顏色分級', (s) => this.gradeUI(s), false, 'grade'));
    if (this.edit.mono || this.isMono()) b.append(...this.section('單色調色', (s) => s.append(this.S('toning.h', '色相', 0, 360, 1, { sign: false, grad: 'linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta,red)', fmt: (v) => Math.round(v) + '°' }), this.S('toning.s', '強度', 0, 100, 1)), false, 'tone'));
    b.append(this.S('fade', '褪色', -100, 100, 1));
  },
  isMono() { return effective(this.edit).mono; },
  mixerUI(s) {
    const mono = this.edit.mono || this.isMono();
    s.append(h('div', { class: 'cdots' }, HUES.map(([n, c], i) => h('div', { class: 'cdot' + (this.mixSel === i ? ' on' : ''), title: n, style: { background: c }, onclick: () => { this.mixSel = i; this.renderPanel(); } }))));
    const i = this.mixSel, nm = HUES[i][0];
    if (mono) s.append(this.S('bw.' + i, nm + '（黑白明度）', -100, 100, 1));
    else s.append(this.S('hsl.hue.' + i, nm + '・色相', -100, 100, 1), this.S('hsl.sat.' + i, nm + '・飽和度', -100, 100, 1), this.S('hsl.lum.' + i, nm + '・明亮度', -100, 100, 1));
    s.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => { if (mono) this.edit.bw = clone(DEF_EDIT.bw); else this.edit.hsl = clone(DEF_EDIT.hsl); this.changed(); this.commit('重設混色器'); this.renderPanel(); } }, '全部重設')));
  },
  gradeUI(s) {
    const zones = [['sh', '陰影'], ['mid', '中間調'], ['hi', '亮部'], ['glob', '全域']];
    s.append(h('div', { class: 'chips' }, zones.map(([k, n]) => h('button', { class: 'btn sm' + (this.gradeZone === k ? ' on' : ''), onclick: () => { this.gradeZone = k; this.renderPanel(); } }, n))));
    const z = this.gradeZone; const cv = h('canvas', { class: 'wheelCv', width: 300, height: 300 });
    const lum = this.S(`grade.${z}.l`, '明亮度', -100, 100, 1);
    const info = h('div', { class: 'sub' });
    s.append(h('div', { class: 'wheelWrap' }, cv, h('div', { class: 'grow' }, info, lum)));
    const draw = () => {
      const x = cv.getContext('2d'); const W = 300, R = 140; x.clearRect(0, 0, W, W);
      const img = x.createImageData(W, W);
      for (let yy = 0; yy < W; yy++) for (let xx = 0; xx < W; xx++) { const dx = xx - W / 2, dy = yy - W / 2, r = Math.hypot(dx, dy); if (r > R) continue; const hh = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360; const sat = r / R; const c = hsv(hh, sat * 0.85, 0.92); const k = (yy * W + xx) * 4; img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255; }
      x.putImageData(img, 0, 0);
      const g = this.edit.grade[z]; const a = g.h * Math.PI / 180, rr = g.s / 100 * R;
      x.strokeStyle = '#fff'; x.lineWidth = 4; x.beginPath(); x.arc(W / 2 + Math.cos(a) * rr, W / 2 - Math.sin(a) * rr, 11, 0, 7); x.stroke(); x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 1.5; x.stroke();
      info.textContent = `色相 ${Math.round(g.h)}°・飽和度 ${Math.round(g.s)}`;
    };
    const hsv = (hh, s2, v) => { const c = v * s2, x2 = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = v - c; const [r, g, b2] = hh < 60 ? [c, x2, 0] : hh < 120 ? [x2, c, 0] : hh < 180 ? [0, c, x2] : hh < 240 ? [0, x2, c] : hh < 300 ? [x2, 0, c] : [c, 0, x2]; return [(r + m) * 255, (g + m) * 255, (b2 + m) * 255]; };
    const set = (e) => { const r = cv.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width * 300 - 150, dy = (e.clientY - r.top) / r.height * 300 - 150; this.edit.grade[z].h = Math.round((Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360); this.edit.grade[z].s = Math.round(clamp(Math.hypot(dx, dy) / 140, 0, 1) * 100); draw(); this.changed(); };
    let down = false;
    cv.addEventListener('pointerdown', (e) => { down = true; cv.setPointerCapture(e.pointerId); set(e); });
    cv.addEventListener('pointermove', (e) => down && set(e));
    cv.addEventListener('pointerup', () => { down = false; this.commit('顏色分級'); });
    cv.addEventListener('dblclick', () => { this.edit.grade[z].s = 0; draw(); this.changed(); this.commit('重設顏色分級'); });
    draw();
    s.append(this.S('grade.blend', '混合', 0, 100, 1, { zero: 0 }), this.S('grade.balance', '平衡', -100, 100, 1));
  },
  p_effects(b) {
    b.append(this.S('texture', '紋理', -100, 100, 1), this.S('clarity', '清晰度', -100, 100, 1), this.S('dehaze', '去朦朧', -100, 100, 1));
    b.append(...this.section('暈影', (s) => s.append(this.S('vig.amt', '量', -100, 100, 1), this.S('vig.mid', '中點', 0, 100, 1, { zero: 0 }), this.S('vig.round', '圓度', -100, 100, 1), this.S('vig.feather', '羽化', 0, 100, 1, { zero: 0 }), this.S('vig.hl', '亮部', 0, 100, 1, { zero: 0 })), true, 'vig'));
    b.append(...this.section('顆粒', (s) => s.append(this.S('grain.amt', '量', 0, 100, 1), this.S('grain.size', '大小', 0, 100, 1, { zero: 0 }), this.S('grain.rough', '粗糙度', 0, 100, 1, { zero: 0 })), true, 'grain'));
  },
  p_detail(b) {
    this.aiCard(b);
    b.append(...this.section('銳化', (s) => s.append(this.S('sharp.amt', '量', 0, 150, 1), this.S('sharp.rad', '半徑', 0.5, 3, 0.1, { zero: 0.5 }), this.S('sharp.det', '細節', 0, 100, 1, { zero: 0 }), this.S('sharp.mask', '遮色', 0, 100, 1, { zero: 0 })), true, 'sharp'));
    b.append(...this.section('雜色減少（傳統）', (s) => s.append(this.S('nr.lum', '明度', 0, 100, 1), this.S('nr.ldet', '細節', 0, 100, 1, { zero: 0 }), this.S('nr.lcon', '對比', 0, 100, 1, { zero: 0 }), this.S('nr.col', '顏色', 0, 100, 1), this.S('nr.cdet', '顏色細節', 0, 100, 1, { zero: 0 }), this.S('nr.csm', '顏色平滑度', 0, 100, 1, { zero: 0 })), true, 'nr'));
    b.append(h('div', { class: 'note' }, '銳化與雜色減少屬於像素級效果，放大到 100% 以上時會以全解析度即時渲染可見範圍。'));
  },
  p_optics(b) {
    const pr = this.edit.optics.prof; const ex = this.rec.exif || {};
    b.append(this.toggle('移除色差', () => this.edit.optics.ca, (v) => { this.edit.optics.ca = v; this.renderPanel(); }, '偵測高反差邊緣的紫邊與綠邊並去除'));
    if (this.edit.optics.ca) b.append(this.S('optics.purple', '紫邊量', 0, 100, 1), this.S('optics.green', '綠邊量', 0, 100, 1));
    const sw = this.toggle('啟動鏡頭校正', () => pr.on, async (v) => {
      pr.on = v;
      if (v) { const r = await lensProfileFor(this.rec, pr.key); if (r.lens) Object.assign(pr, { key: r.key, name: r.name, p: r.p, camCrop: r.camCrop }); else { pr.on = false; toast('找不到符合的鏡頭描述檔，請手動選擇'); } }
      this.fitCropToImage(); this.changed(); this.commit(pr.on ? '啟動鏡頭校正' : '關閉鏡頭校正'); this.renderPanel();
    });
    b.append(sw);
    const lensTxt = pr.name ? pr.name : (this.rec.lensName || '');
    b.append(h('div', { class: 'lbl2' }, h('span', { class: 'sub', style: { flex: '1' } }, lensTxt ? `Lensfun（${lensTxt}）` : `未找到描述檔（EXIF 鏡頭：${ex.lens || '無'}）`),
      h('button', { class: 'btn sm', onclick: () => this.pickLens() }, '📷 選擇鏡頭')));
    if (pr.on) {
      const ci = () => { this.fitCropToImage(); this.changed(); };
      b.append(this.S('optics.prof.d', '扭曲校正', 0, 200, 1, { zero: 0, onInput: ci }), this.S('optics.prof.v', '暈影', 0, 200, 1, { zero: 0 }));
      b.append(h('div', { class: 'sub' }, `焦距 ${ex.focal ? Math.round(ex.focal) + 'mm' : '—'}・光圈 ${ex.fnumber ? 'f/' + (+ex.fnumber).toFixed(1) : '—'}・${pr.p && pr.p.tca ? '含色差（TCA）校正' : '無色差資料'}${pr.p && pr.p.vig ? '・含暈影資料' : ''}`));
    }
    b.append(h('div', { class: 'note' }, '描述檔來自開放的 Lensfun 鏡頭資料庫（約 1,300 支鏡頭、950 台相機），依 EXIF 的相機與鏡頭型號自動比對。RAW 檔建議開啟；相機直出 JPEG 多半已在機內校正。'));
    b.append(h('div', { class: 'sec' }, '手動鏡頭校正'), this.S('optics.dist', '扭曲', -100, 100, 1), this.S('optics.vigCorr', '暈影校正', -100, 100, 1));
  },
  async pickLens() {
    await LensDB.load(); const ex = this.rec.exif || {}; const cam = LensDB.camera(ex.make, ex.model);
    const q = h('input', { type: 'search', placeholder: '搜尋鏡頭，例如 18-135、Sigma 30', style: { width: '100%' } });
    const list = h('div', { class: 'mlist', style: { maxHeight: '50vh', overflow: 'auto' } });
    const draw = () => {
      const t = q.value.toLowerCase().split(/\s+/).filter(Boolean); list.innerHTML = '';
      let items = LensDB.d.l.filter((l) => { const n = (l[0] + ' ' + l[1]).toLowerCase(); return t.every((x) => n.includes(x)); });
      if (cam && !t.length) items = items.filter((l) => l[2].includes(cam.mount));
      items.slice(0, 80).forEach((l) => list.append(h('div', { class: 'mitem', onclick: async () => {
        const r = await lensProfileFor(this.rec, l[0] + '|' + l[1]); Object.assign(this.edit.optics.prof, { on: true, key: r.key, name: r.name, p: r.p, camCrop: r.camCrop });
        UI.close(); this.fitCropToImage(); this.changed(); this.commit('鏡頭描述檔：' + r.name); this.renderPanel(); } }, h('span', { class: 'mi' }, '📷'), h('span', { class: 'grow' }, l[1], h('div', { class: 'sub' }, l[0] + '・' + l[2].join(', '))))));
      if (!items.length) list.append(h('div', { class: 'sub' }, '找不到符合的鏡頭'));
    };
    q.oninput = draw; draw();
    UI.sheet(`選擇鏡頭${cam ? `（${cam.mount}）` : ''}`, h('div', null, q, list));
  },
  p_geo(b) {
    b.append(h('div', { class: 'sec' }, 'AI 拉正（Upright）'), this.uprightSeg());
    const gi = () => { this.fitCropToImage(); this.changed(); };
    b.append(this.S('geo.dist', '扭曲', -100, 100, 1, { onInput: gi }), this.S('geo.vert', '垂直', -100, 100, 1, { onInput: gi }), this.S('geo.horiz', '水平', -100, 100, 1, { onInput: gi }),
      this.S('geo.rot', '旋轉', -10, 10, 0.1, { onInput: gi, fmt: (v) => v.toFixed(1) + '°' }), this.S('geo.aspect', '外觀比例', -100, 100, 1, { onInput: gi }), this.S('geo.scale', '縮放', 50, 150, 1, { onInput: gi, zero: 100 }),
      this.S('geo.ox', 'X 位移', -100, 100, 1, { onInput: gi }), this.S('geo.oy', 'Y 位移', -100, 100, 1, { onInput: gi }));
    b.append(this.toggle('限制裁切', () => this.edit.geo.constrain, (v) => { this.edit.geo.constrain = v; if (v) this.fitCropToImage('max'); }, '自動裁掉變形後產生的空白邊'));
  },

  /* ---------- AI 降噪 ---------- */
  aiCard(b) {
    const a = this.edit.ai;
    const st = h('div', { class: 'sub' }); const bar = h('div', { class: 'prog hide' }, h('i'));
    this.aiUI = { st, bar };
    b.append(h('div', { class: 'aicard' },
      h('h4', null, h('span', { html: svg('ai', 2) }), 'AI 降噪', h('span', { class: 'grow' }), h('label', { class: 'sw' }, (() => { const i = h('input', { type: 'checkbox' }); i.checked = a.on; i.onchange = () => { a.on = i.checked; this.commit(a.on ? '開啟 AI 降噪' : '關閉 AI 降噪'); this.ensureAi(); this.changed(); this.renderPanel(); }; return i; })(), h('span'))),
      h('div', { class: 'sub' }, '以神經網路（Intel Open Image Denoise）在裝置上辨識並移除雜訊，保留細節；與 Lightroom 桌面版「降噪」相同的流程：先降噪、再進行其他調整。'),
      a.on ? this.slider('數量', () => a.amt, (v) => { a.amt = v; }, 0, 100, 1, 60, { onCommit: () => this.commit('AI 降噪數量') }) : null,
      a.on ? this.S('ai.chroma', '彩噪消除', 0, 100, 1) : null,
      a.on ? h('div', { class: 'lbl2' }, h('span', null, '模型'), this.seg([['fast', '快速'], ['hq', '高品質']], a.model, (k) => { a.model = k; this.commit('AI 降噪模型'); this.ses.setAiPreview(null, ''); this.ses.aiPrev = null; this.ensureAi(); this.renderPanel(); })) : null,
      a.on ? h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => { this.zoomTo(1, null); } }, '🔍 檢視 100%'), h('button', { class: 'btn sm', onclick: () => { this.cmp = 'split'; $('#edCmp').classList.add('on'); this.requestRender(); } }, '◐ 前後對比')) : null,
      h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => Cloud.enqueue([this.rec], a.model === 'hq' ? 'hq' : Cloud.cfg().model) }, '☁ 交給雲端處理（GitHub）'),
        this.rec.cloudAi ? h('button', { class: 'btn sm', onclick: async () => { await Cloud.removeResult(this.rec.id); this.rec.cloudAi = 0; this.ses.fullDn = {}; this.ses.aiPrev = null; this.ses.setAiPreview(null, ''); this.ensureAi(); this.renderPanel(); toast('已改回裝置上的 AI 結果'); } }, '移除雲端結果') : null),
      st, bar));
    this.aiStatus();
  },
  aiStatus(f) {
    if (!this.aiUI || !this.aiUI.st.isConnected) return; const { st, bar } = this.aiUI;
    if (f != null && f < 1) { bar.classList.remove('hide'); bar.firstChild.style.width = Math.round(f * 100) + '%'; st.textContent = `AI 分析中… ${Math.round(f * 100)}%`; return; }
    bar.classList.add('hide');
    if (this.aiErr && this.edit.ai.on) { st.innerHTML = ''; st.append(h('span', { style: { color: 'var(--warn)' } }, '⚠ ' + this.aiErr + ' '), h('button', { class: 'btn sm', onclick: async () => { this.aiErr = ''; await AI.reset(); this.ensureAi(); } }, '重試')); return; }
    if (!this.edit.ai.on) { st.textContent = ''; return; }
    const ses = this.ses; const full = ses && (ses.fullDn.cloud || ses.fullDn[this.edit.ai.model]);
    st.textContent = !(ses && ses.aiPrev) ? '準備中…'
      : ses.fullDn.cloud ? '☁ 已套用雲端全解析度降噪結果。'
      : full ? `✓ 已完成全解析度降噪（${AI.backend === 'webgl' ? 'GPU' : 'CPU'}${AI.mode === 'worker' ? '・背景執行緒' : ''}），匯出直接使用。`
      : this.fullRun ? `✓ 預覽完成；全解析度背景計算中 ${Math.round((this.fullPct || 0) * 100)}%…`
      : `✓ 預覽完成（${AI.backend === 'webgl' ? 'GPU' : 'CPU'}${AI.mode === 'worker' ? '・背景執行緒' : ''}）。放大或匯出時才計算全解析度。`;
  },
  async ensureAi() {
    const a = this.edit.ai; if (!a.on || !this.ses) return;
    const key = a.model; if (this.ses.aiPrev && this.ses.aiPrevKey === key) return;
    if (this.aiRunning === this.ses.rec.id + key) return; this.aiRunning = this.ses.rec.id + key;
    const ses = this.ses; const dbk = ses.rec.id + ':' + key + ':' + ses.PW;
    try {
      let c = null; let cached = await DB.get('ai', 'cloud:' + ses.rec.id).catch(() => null);
      if (cached) { const bm = await createImageBitmap(cached); c = mkCanvas(ses.PW, ses.PH); const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(bm, 0, 0, ses.PW, ses.PH); bm.close(); }
      else cached = await DB.get('ai', dbk).catch(() => null);
      if (c) { /* 雲端結果 */ }
      else if (cached) { const bm = await createImageBitmap(cached); c = mkCanvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0); bm.close(); }
      else {
        this.busy(AI.ready ? 'AI 降噪分析中…' : '啟動 AI 引擎（首次需數秒）…'); this.aiStatus(0);
        // 預覽用較小尺寸分析（速度快），放大到 100% 時會改用原始解析度
        const k = Math.min(1, 1024 / Math.max(ses.PW, ses.PH)); let srcI = ses.prev;
        if (k < 1) { srcI = mkCanvas(ses.PW * k, ses.PH * k); const sx = srcI.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(ses.prev, 0, 0, srcI.width, srcI.height); }
        const d = await AI.denoise(srcI, 0, 0, srcI.width, srcI.height, key, { progress: (f) => { this.busy(`AI 降噪分析中 ${Math.round(f * 100)}%`); this.aiStatus(f); } });
        if (k < 1) { c = mkCanvas(ses.PW, ses.PH); const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(d, 0, 0, ses.PW, ses.PH); } else c = d;
        canvasBlob(c, 'image/jpeg', .95).then((b) => DB.put('ai', b, dbk)).catch(() => {});
      }
      if (ses !== this.ses) return;
      ses.setAiPreview(c, key); this.busy(null); this.aiStatus(1); this.changed();
      this.aiErr = ''; if (!cached) toast('AI 降噪完成：可按「前後對比」或放大到 100% 檢查細節', 3500);
    } catch (e) { console.error(e); this.busy(null); this.aiErr = e.message || String(e); toast('AI 降噪失敗：' + this.aiErr, 6000); this.aiStatus(); }
    finally { this.aiRunning = null; }
  },
  /* ---------- AI 修復（GitHub 雲端） ---------- */
  eraseMaskFor() { if (!this.eraseMask || this.eraseMask.rec !== this.rec.id) this.eraseMask = { rec: this.rec.id, type: 'brush', p: { strokes: [] } }; return this.eraseMask; },
  /* ---------- v1.16：移除多餘人物（像 Lightroom）：雲端偵測輪廓 → 點選要消除的人 → 在手機上合成（立即完成） ---------- */
  async loadPeople() {
    const id = this.rec.id; if (this.ppl && this.ppl.rec === id) return this.ppl;
    const d = await DB.get('ai', 'people:' + id).catch(() => null); if (!d || !d.list) { this.ppl = { rec: id, list: [], sel: new Set(), on: false, none: !d }; return this.ppl; }
    const L = d.list, area = (p) => (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]);
    // 預設選取「多餘的人」：最大且明顯是主角的那一位不選，其他都選（和 Lightroom 一樣，可再點選調整）
    const sel = new Set(L.map((_, i) => i)); if (L.length && area(L[0]) > 0.03 && (L.length === 1 || area(L[0]) > 1.8 * area(L[1]))) sel.delete(0);
    this.ppl = { rec: id, list: L, sel, on: false }; return this.ppl;
  },
  pplPath(c, p) { c.beginPath(); for (const poly of p.polys) { poly.forEach((q, k) => { const s = this.srcToScr(q); k ? c.lineTo(s[0], s[1]) : c.moveTo(s[0], s[1]); }); c.closePath(); } },
  drawPeople(x, dpr) {
    const P = this.ppl; if (!P || !P.on || P.rec !== this.rec.id) return;
    const d = this.drag; if (d && d.kind === 'lasso' && d.scr.length > 1) { x.save(); x.lineWidth = 2.5 * dpr; x.setLineDash([8 * dpr, 6 * dpr]); x.strokeStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 4 * dpr; x.fillStyle = 'rgba(255,255,255,.15)'; x.beginPath(); d.scr.forEach((q, k) => (k ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); x.closePath(); x.fill(); x.stroke(); x.restore(); }
    P.list.forEach((p, i) => {
      x.save(); this.pplPath(x, p);
      if (P.sel.has(i)) { x.fillStyle = 'rgba(255,255,255,.5)'; x.fill(); x.lineWidth = 2.2 * dpr; x.strokeStyle = 'rgba(255,255,255,.95)'; x.stroke(); }
      else { x.setLineDash([6 * dpr, 4 * dpr]); x.lineWidth = 3 * dpr; x.strokeStyle = 'rgba(0,0,0,.55)'; x.stroke(); x.lineWidth = 1.6 * dpr; x.strokeStyle = '#fff'; x.stroke(); }
      x.restore();
    });
  },
  pplHit(p) {
    const P = this.ppl, s = this.scrToSrc(p); let best = -1, ba = 9;
    const inside = (poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > s[1]) !== (b[1] > s[1]) && s[0] < (b[0] - a[0]) * (s[1] - a[1]) / (b[1] - a[1] + 1e-12) + a[0]) c = !c; } return c; };
    P.list.forEach((q, i) => { const b = q.box, pad = 0.01; const inBox = s[0] > b[0] - pad && s[0] < b[2] + pad && s[1] > b[1] - pad && s[1] < b[3] + pad; if (!inBox) return; const a = (b[2] - b[0]) * (b[3] - b[1]); if ((q.polys.some(inside) || a < 0.002) && a < ba) { ba = a; best = i; } });
    return best;
  },
  pplPill() {
    let el = $('#pplPill'); const P = this.ppl;
    if (!P || !P.on) { if (el) el.remove(); return; }
    if (!el) { el = h('div', { id: 'pplPill', class: 'glass' }); $('#stage').append(el); }
    el.innerHTML = ''; el.append(h('button', { class: 'ib', onclick: () => { P.on = false; P.lasso = false; this.pplPill(); this.drawOverlay(); this.renderPanel(); } }, '✕'),
      h('div', { class: 'grow' }, h('b', null, this.pplWork || `消除選取的項目（${P.sel.size}）`), h('div', { class: 'sub' }, P.lasso ? '⭕ 用手指圈出物件；點一下可切換選取' : '點一下切換：白色＝消除、虛線＝保留')),
      h('button', { class: 'ib' + (P.lasso ? ' on' : ''), title: '圈選物件', onclick: () => { P.lasso = !P.lasso; this.pplPill(); } }, '⭕'),
      h('button', { class: 'ib ok', disabled: !P.sel.size || !!this.pplWork, onclick: () => this.applyPeople() }, '✓'));
  },
  /* v1.17：在手機上偵測（數秒），選好後只把「要消除的人」送到雲端 AI 消除（LaMa） */
  /* ---------- v1.18：消除引擎 ---------- */
  ENG: { oc: ['ObjectClear', '免費・最自然（建議）', 'CVPR 2026 的生成式消除模型，會連人影、倒影一起消，補出來的背景最連貫；在雲端 CPU 上跑，比較慢：一張約 10–15 分鐘（一次送多張會依序處理）。'],
    lama: ['LaMa', '免費・快', '雲端 CPU，約 3–5 分鐘。草地、牆面、天空等簡單背景效果好，複雜背景比較容易糊。'],
    gemini: ['Gemini', '付費', 'Google「Nano Banana」生成式編輯，最接近 OPPO／Lightroom，在手機上直接處理（約 10–30 秒）；用你的 Gemini API 金鑰計費，每一塊約 NT$1–3。'] },
  engineCard() {
    const c = GenErase.cfg(), E = this.ENG[c.engine] || this.ENG.lama;
    const inp = (ph, key, pw) => { const i = h('input', { type: pw ? 'password' : 'text', placeholder: ph, value: c[key] || '', class: 'engIn', autocomplete: 'off', spellcheck: 'false' }); i.onchange = () => { c[key] = i.value.trim(); saveCfg(); }; return i; };
    const box = h('div', { class: 'engBox' }, h('div', { class: 'lab' }, h('span', null, '消除引擎')),
      h('div', { class: 'seg engSeg' }, Object.keys(this.ENG).map((k) => h('button', { class: 'btn' + (c.engine === k ? ' on' : ''), onclick: () => { c.engine = k; saveCfg(); this.renderPanel(); } }, this.ENG[k][0]))),
      h('div', { class: 'sub' }, h('b', null, E[1] + '：'), E[2]));
    if (c.engine === 'gemini') {
      const sel = h('select', { class: 'engIn' }, [['gemini-nano-banana-2.1', 'Nano Banana 2.1（建議）'], ['gemini-3.1-flash-image', 'Nano Banana 2'], ['gemini-3-pro-image', 'Nano Banana Pro（較貴）'], ['gemini-2.5-flash-image', 'Nano Banana（舊版）']].map(([v, t]) => h('option', { value: v, selected: c.model === v }, t)));
      sel.onchange = () => { c.model = sel.value; saveCfg(); };
      box.append(inp('Gemini API 金鑰（AIza…）', 'key', true), sel, h('div', { class: 'sub' }, '到 Google AI Studio 建立 API 金鑰並開啟計費；金鑰只存在這支手機。'));
    }
    return box;
  },
  async runGemini(maskCanvas, note) {
    const id = this.rec.id;
    if (!GenErase.cfg().key) { toast('請先在「消除引擎 → Gemini」填入 API 金鑰', 4000); return false; }
    this.busy('Gemini 準備中…', true);
    try {
      await this.persist();
      const full = await this.ses.ensureFull();
      const r = await GenErase.run(full, maskCanvas, (t) => this.busy(t, true));
      await Cloud.applyFix({ id, ops: ['erase'] }, r.blob, null, { done: ['erase'], erase: note || 'Gemini 生成式消除' });
      this.busy(null); return true;
    } catch (e) { this.busy(null); console.error(e); toast('Gemini 消除失敗：' + e.message, 7000); return false; }
  },
  /* ---------- v1.18：用手機內建相簿編輯（例如 OPPO「AI 圖像助理」），取回結果、名稱不變 ---------- */
  async extEdit() {
    if (!(isApp && window.AIP2 && AIP2.editLast)) { toast('這個功能需要安裝 v1.18 以上的 APK', 4000); return; }
    const id = this.rec.id; this.busy('套用目前的調色、降噪後輸出…', true);
    try {
      await this.persist();
      // v1.18.1：手機相簿只能編輯 JPG → 先把目前所有調整（調色、降噪、裁切…）套用進去再送出，回來後這些調整歸零（已經在照片裡了）
      const edit = await refreshLens(this.rec, normEdit(this.edit));
      const r0 = await this.ses.exportPixels(edit, { long: 0, alpha: false, stage: (t) => this.busy(t, true) });
      const bytes = await Exporter.encode(r0.data, r0.W, r0.H, 'jpeg', 96);
      await DB.put('ai', new Blob([bytes], { type: 'image/jpeg' }), 'extSent:' + id);
      const base = (this.rec.name || 'photo').replace(/\.[^.]+$/, '');
      await Exporter.save(`${base}_手機相簿編輯中.jpg`, 'image/jpeg', bytes);
      const r = JSON.parse(AIP2.editLast('') || '{}'); if (!r.ok) throw new Error(r.err || '無法開啟');
      this.extPend = { id, t: Date.now(), src: r.src || '', t0: r.t0 || 0, mod: r.mod || 0, W: r0.W, H: r0.H }; lsSet('aip.extPend', this.extPend);
      this.busy(null);
      toast(r.pkg ? '已開啟手機相簿：可用「AI 圖像助理」裡的 AI 消除等功能，用完儲存（另存或覆蓋都可以），回到這個 App 就會自動取回' : '請選擇用手機相簿編輯；完成後儲存並回到這個 App', 7000);
    } catch (e) { this.busy(null); console.error(e); toast('無法開啟手機相簿編輯：' + e.message, 5000); }
  },
  /* v1.19.2：用 Lightroom 修圖：把原始 RAW（最好的畫質）分享給 Lightroom，修好「儲存到裝置」後回到這裡自動取回、名稱不變 */
  async lrEdit() {
    const LR = 'com.adobe.lrmobile';
    if (!(isApp && window.AIP2 && AIP2.openWith)) { toast('這個功能需要安裝 v1.19.2 以上的 APK', 4000); return; }
    if (AIP2.hasApp && !AIP2.hasApp(LR)) { Upd.dialog('手機沒有安裝 Lightroom', '請先從 Play 商店安裝 Adobe Lightroom。', [['前往 Play 商店', () => Upd.open('https://play.google.com/store/apps/details?id=' + LR)], ['取消', null]]); return; }
    const rec = this.rec, id = rec.id; await this.persist();
    let src = '';
    try {
      if (rec.mid != null && !rec.fixOrig && !rec.masterOri1) src = 'content://media/external/images/media/' + rec.mid;   // 相簿裡的原始檔（RAW）
      else {   // 已經用 AI 修復過（或不是從相簿匯入）：送目前的原圖（不含調整），讓 Lightroom 從頭調
        this.busy('準備相片…', true);
        const full = await this.ses.ensureFull(); const c = mkCanvas(full.width, full.height); c.getContext('2d').drawImage(full, 0, 0);
        const blob = await canvasBlob(c, 'image/jpeg', 0.97); c.width = c.height = 1;
        await Exporter.save((rec.name || 'photo').replace(/\.[^.]+$/, '') + '_給Lightroom.jpg', 'image/jpeg', new Uint8Array(await blob.arrayBuffer()));
        this.busy(null);
      }
      const r = JSON.parse(AIP2.openWith(src, LR, 'send') || '{}');
      if (!r.ok) throw new Error(r.err === 'notInstalled' ? '手機沒有安裝 Lightroom' : r.err || '無法開啟 Lightroom');
      DB.del('ai', 'extSent:' + id).catch(() => {});
      this.extPend = { id, t: Date.now(), src: r.src || '', t0: r.t0 || 0, mod: r.mod || 0, temp: !src, mode: 'lr' }; lsSet('aip.extPend', this.extPend);
      toast('已把' + (src ? '原始 RAW' : '相片') + '送到 Lightroom：修好後按右上角「分享 → 匯出為…／儲存到裝置」（JPG），回到這個 App 就會自動取回', 8000);
    } catch (e) { this.busy(null); toast('無法開啟 Lightroom：' + e.message, 5000); }
  },
  /* 回到 App 時自動找編輯結果（相簿存檔可能慢幾秒，會重試幾次） */
  async extBack(force) {
    const P = this.extPend || lsGet('aip.extPend', null); if (!P || !(window.AIP2 && AIP2.editResult) || this.extBusy) return;
    if (!force && Date.now() - P.t < 2500) return;
    this.extBusy = true;
    try {
      let r = {};
      for (let k = 0; k < 6; k++) {
        r = JSON.parse((AIP2.editResult3 ? AIP2.editResult3(P.src || '', P.t0 || 0, P.mod || 0, P.temp !== false) : AIP2.editResult2 ? AIP2.editResult2(P.src || '', P.t0 || 0, P.mod || 0) : AIP2.editResult()) || '{}');
        if (r.state === 'new' || r.state === 'same') break; await sleep(2000);
      }
      if (r.state !== 'new' && r.state !== 'same') {
        Upd.dialog('還沒有找到編輯後的相片', (P.mode === 'lr' ? '在 Lightroom 修好後，請按「分享 → 匯出為…」或「儲存到裝置」存成 JPG，再回到這裡就會自動取回；' : '如果還在手機相簿裡編輯，完成並儲存後再回來就會自動取回；') + '也可以按「再檢查一次」。' + (r.err ? '<br><small>' + Upd.esc(r.err) + '</small>' : ''), [['再檢查一次', () => this.extBack(true)], ['不要了', () => { this.extPend = null; lsSet('aip.extPend', null); try { AIP2.editCleanup(); } catch (e) {} }], ['稍後', null]]);
        return;
      }
      this.extPend = null; lsSet('aip.extPend', null);
      this.busy('取回手機相簿的編輯結果…', true);
      const b = await (await fetch(`https://aiphoto.app/pick/${r.key}`)).blob(); if (!b.size) throw new Error('讀不到檔案');
      const rec = await DB.get('photos', P.id); if (!rec) throw new Error('找不到原本的相片');
      const sent = await DB.get('ai', 'extSent:' + P.id).catch(() => null);
      const out = sent ? await this.extMerge(sent, b) : { blob: b, note: '' };
      // 調整已經套用在送出的照片裡 → 歸零（舊的調整保留，按「還原原圖」時一起恢復）
      rec.extPrevEdit = rec.edit; rec.edit = normEdit({}); await DB.put('photos', rec);
      const lr = Library.recs.find((x) => x.id === P.id); if (lr) { lr.edit = rec.edit; lr.extPrevEdit = rec.extPrevEdit; }
      if (this.active && this.rec && this.rec.id === P.id) { this.edit = normEdit({}); this.rec.edit = this.edit; this.rec.extPrevEdit = rec.extPrevEdit; }
      await Cloud.applyFix({ id: P.id, ops: ['erase'] }, out.blob, null, { done: ['erase'], ext: (P.mode === 'lr' ? '已套用 Lightroom 修好的相片' : '已套用手機相簿的編輯') + '（名稱維持「' + rec.name + '」）' + out.note });
      DB.del('ai', 'extSent:' + P.id).catch(() => {});
      try { AIP2.editCleanup(); } catch (e) {}
      this.busy(null);
      if (r.state === 'new') toast((P.mode === 'lr' ? 'Lightroom 在相簿另外存了一張「' : '手機相簿另外存了一張「') + (r.name || '新相片') + '」，不需要的話可以到相簿刪除', 6000);
    } catch (e) { this.busy(null); console.error(e); toast('取回編輯結果失敗：' + e.message, 5000); }
    finally { this.extBusy = false; }
  },
  /* 手機相簿的 AI 消除會把照片縮小（例如 2400 萬像素 → 1100 萬）：只把「有被改到的地方」換成相簿的結果，其他地方保留原本的高解析度；
     如果整張都被改了（例如用了濾鏡、AI 調色），就直接用相簿的結果 */
  async extMerge(sentBlob, newBlob) {
    const S = await createImageBitmap(sentBlob), B = await createImageBitmap(newBlob);
    try {
      const W = S.width, H = S.height, sameRatio = Math.abs(B.width / B.height - W / H) < 0.01;
      if (!sameRatio) return { blob: newBlob, note: '' };
      const g = 512 / Math.max(W, H), gw = Math.round(W * g), gh = Math.round(H * g);
      const px = (bm) => { const c = mkCanvas(gw, gh), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, gw, gh); return x.getImageData(0, 0, gw, gh).data; };
      const a = px(S), b = px(B), N = gw * gh, M = new Uint8Array(N); let n = 0;
      for (let i = 0; i < N; i++) { const d = Math.abs(a[i * 4] - b[i * 4]) + Math.abs(a[i * 4 + 1] - b[i * 4 + 1]) + Math.abs(a[i * 4 + 2] - b[i * 4 + 2]); if (d > 36) { M[i] = 1; n++; } }
      const f = n / N;
      if (f > 0.35 || n === 0) return { blob: newBlob, note: f > 0.35 ? '' : '' };
      // 遮罩：外擴＋羽化後放大到原尺寸
      const mc = mkCanvas(gw, gh), mx = mc.getContext('2d'), md = mx.createImageData(gw, gh);
      for (let i = 0; i < N; i++) { const v = M[i] ? 255 : 0; md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 255; md.data[i * 4 + 3] = v; }
      mx.putImageData(md, 0, 0);
      const big = mkCanvas(W, H), bx = big.getContext('2d'); bx.filter = `blur(${Math.max(2, Math.round(W / gw * 2.5))}px)`;
      for (let k = 0; k < 3; k++) bx.drawImage(mc, 0, 0, W, H);   // 疊三次 ≈ 外擴
      bx.filter = 'none'; bx.globalCompositeOperation = 'source-in'; bx.imageSmoothingQuality = 'high'; bx.drawImage(B, 0, 0, W, H);
      const o = mkCanvas(W, H), ox = o.getContext('2d'); ox.drawImage(S, 0, 0); ox.drawImage(big, 0, 0); big.width = big.height = 1;
      const blob = await canvasBlob(o, 'image/jpeg', 0.96); o.width = o.height = 1;
      return { blob, note: `；只替換被修改的區域（約 ${Math.max(1, Math.round(f * 100))}%），其餘保留原本 ${W}×${H} 的解析度` };
    } finally { S.close(); B.close(); }
  },
  async detectPeople(opt = {}) {
    if (this.pplBusy || !this.ses) return; const id = this.rec.id;
    const say = (t) => { this.pplBusy = t; const b = $('#pplBtn'); if (b) b.textContent = t; };
    say('準備中…'); this.renderPanel();
    try {
      const L = await People.detect(this.ses.prev, (t, f) => say(t + (f < 1 ? `（${Math.round(f * 100)}%）` : '')));
      await DB.put('ai', { list: L, t: Date.now(), on: 'device' }, 'people:' + id);
      if (!this.rec || this.rec.id !== id) return;
      this.ppl = null; await this.loadPeople();
      if (opt.lasso) { this.ppl.sel.clear(); this.ppl.on = true; this.ppl.lasso = true; this.pplPill(); this.drawOverlay(); toast('⭕ 用手指圈出要消除的物件（可以圈很多次）', 3500); }
      else if (L.length) { this.ppl.on = true; this.pplPill(); this.drawOverlay(); toast(`👥 偵測到 ${L.length} 位人物：白色＝要消除，點人物可切換；也可以按 ⭕ 圈選其他物件`, 4500); }
      else toast('畫面中沒有偵測到人物，可以按「⭕ 圈選物件」自己圈', 3500);
    } catch (e) { console.error(e); toast('人物偵測失敗：' + e.message, 5000); }
    finally { this.pplBusy = null; if (this.tool === 'aifix') this.renderPanel(); }
  },
  async doLasso(pts) {
    const P = this.ppl, id = this.rec.id; if (this.pplWork) return;
    this.pplWork = 'AI 偵測圈選範圍…'; this.pplPill();
    try {
      const r = await People.lasso(this.ses.prev, pts, P.list, (t) => { this.pplWork = t; this.pplPill(); });
      if (this.ppl !== P) return;
      r.hitOld.forEach((i) => P.sel.add(i));
      for (const o of r.add) { P.list.push(o); P.sel.add(P.list.length - 1); }
      const names = [...new Set([...r.add.map((o) => o.name), ...r.hitOld.map((i) => P.list[i].kind === 'obj' ? P.list[i].name : '人')])];
      toast(`已選取 ${r.add.length + r.hitOld.length} 個：${names.join('、')}`, 2500);
      DB.put('ai', { list: P.list, t: Date.now(), on: 'device' }, 'people:' + id).catch(() => {});
    } catch (e) { console.error(e); toast('圈選偵測失敗：' + e.message, 4000); }
    finally { this.pplWork = null; this.pplPill(); this.drawOverlay(); if (this.tool === 'aifix') this.renderPanel(); }
  },
  async applyPeople() {
    const P = this.ppl, id = this.rec.id, sel = [...P.sel].map((i) => P.list[i]); if (!sel.length) return;
    const SW = this.ses.SW, SH = this.ses.SH, s = Math.min(1, 2048 / Math.max(SW, SH)), w = Math.round(SW * s), hh = Math.round(SH * s);
    const c = mkCanvas(w, hh), x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, w, hh); x.fillStyle = x.strokeStyle = '#fff'; x.lineJoin = x.lineCap = 'round';
    for (const p of sel) {
      const bh = (p.box[3] - p.box[1]) * hh; x.lineWidth = Math.max(w * 0.004, bh * 0.07);   // 輪廓外擴：頭髮、衣角、邊緣殘影一起消除
      for (const poly of p.polys) { x.beginPath(); poly.forEach((q, k) => (k ? x.lineTo(q[0] * w, q[1] * hh) : x.moveTo(q[0] * w, q[1] * hh))); x.closePath(); x.fill(); x.stroke(); }
      // 腳下的影子：底部往下多延伸一點（只有人）
      if (p.kind === 'obj') continue;
      const bx0 = p.box[0] * w, bx1 = p.box[2] * w, by = p.box[3] * hh; x.beginPath(); x.ellipse((bx0 + bx1) / 2, by, (bx1 - bx0) * 0.55, bh * 0.05, 0, 0, 7); x.fill();
    }
    const eng = GenErase.cfg().engine;
    if (eng === 'gemini') { if (await this.runGemini(c, `Gemini 生成式消除 ${sel.length} 個`)) { P.on = false; this.pplPill(); await DB.del('ai', 'people:' + id).catch(() => {}); this.ppl = null; } return; }
    const mask = await canvasBlob(c, 'image/png'); c.width = c.height = 1;
    await this.persist();
    if (await Cloud.enqueueFix([this.rec], ['erase'], { erase: { people: sel.length, engine: eng } }, { [id]: mask })) {
      P.on = false; this.pplPill(); await DB.del('ai', 'people:' + id).catch(() => {}); this.ppl = null; this.drawOverlay(); this.renderPanel();
      toast(`☁ 已送出消除 ${sel.length} 位人物，完成後自動套用（可在「AI 修復」還原原圖）`, 4500);
    }
  },
  drawErase(x, ov, dpr) {
    this.drawPeople(x, dpr);
    const em = this.eraseMask; const has = em && em.rec === this.rec.id && em.p.strokes.length;
    if (has) {
      const oc = this._eoc = this._eoc || document.createElement('canvas'); oc.width = ov.width; oc.height = ov.height; const c = oc.getContext('2d');
      const L = Math.max(this.ses.SW, this.ses.SH);
      for (const st of em.p.strokes) {
        c.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over'; c.strokeStyle = c.fillStyle = '#ff3b30';
        const r = Math.max(2, st.size * L * this.view.scale); const pts = st.pts.map((q) => this.srcToScr(q));
        c.lineWidth = r * 2; c.lineCap = c.lineJoin = 'round'; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) c.lineTo(q[0], q[1]);
        if (pts.length === 1) { c.arc(pts[0][0], pts[0][1], r, 0, 7); c.fill(); } else c.stroke();
      }
      x.save(); x.globalAlpha = 0.5; x.drawImage(oc, 0, 0); x.restore();
    }
    if (this.erasePaint && this.hover) { const r = (this.eraseSize || 0.03) * Math.max(this.ses.SW, this.ses.SH) * this.view.scale; x.lineWidth = 1.5 * dpr; x.strokeStyle = '#fff'; x.beginPath(); x.arc(this.hover[0], this.hover[1], r, 0, 7); x.stroke(); }
  },
  t_aifix(b) {
    const P = this.fixP = this.fixP || { ops: {}, deblur: { type: 'motion', amt: 100, full: false }, dereflect: { amt: 60 }, enhance: { amt: 80 }, relight: { amt: 60 }, beauty: { amt: 50 } }; P.beauty = P.beauty || { amt: 50 }; P.rescue = P.rescue || { amt: 80, mode: 'auto' };
    const r = this.rec; const job = Cloud.active().find((j) => j.items.some((i) => i.id === r.id));
    const card = (k, title, desc, ...kids) => {
      const i = h('input', { type: 'checkbox' }); i.checked = !!P.ops[k]; i.onchange = () => { P.ops[k] = i.checked; if (k === 'erase') this.erasePaint = i.checked; this.renderPanel(); this.drawOverlay(); };
      return h('div', { class: 'aicard fixc' + (P.ops[k] ? ' on' : '') }, h('h4', null, title, h('span', { class: 'grow' }), h('label', { class: 'sw' }, i, h('span'))), h('div', { class: 'sub' }, desc), ...(P.ops[k] ? kids : []));
    };
    const sl = (label, obj, key, min, max, def) => this.slider(label, () => obj[key], (v) => (obj[key] = v), min, max, 1, def, { onInput: () => {}, onCommit: () => {} });
    if (job) b.append(h('div', { class: 'fixStat' }, h('span', { class: 'spin' }), h('div', null, h('b', null, '☁ 雲端處理中'), h('div', { class: 'sub' }, job.msg || '排隊中…')), h('button', { class: 'btn sm', onclick: () => Cloud.panel() }, '詳細')));
    else if (r.fixed && r.fixed.length) b.append(h('div', { class: 'fixStat ok' }, h('span', null, '🪄'), h('div', null, h('b', null, '已套用 AI 修復'), h('div', { class: 'sub' }, r.fixed.map((k) => Cloud.OPS[k]).join('、'))),
      h('button', { class: 'btn sm', onclick: async () => { if (!(await UI.confirm('還原成 AI 修復前的原圖？（其他調整會保留）', '還原'))) return; await Cloud.restoreFix(r.id); toast('已還原原圖'); } }, '還原原圖')));
    const em = this.eraseMaskFor(); const info = h('span', { class: 'sub' }); this.updEraseInfo = () => { info.textContent = em.p.strokes.length ? `已塗抹 ${em.p.strokes.filter((s) => !s.erase).length} 筆` : '尚未塗抹'; };
    b.append(
      card('erase', '🧽 AI 消除', '塗抹路人、雜物、電線或反光點，AI 會依周圍內容自然補上背景（使用上方「消除引擎」選的引擎）。',
        h('div', { class: 'acts' }, h('button', { class: 'btn sm' + (this.erasePaint ? ' pri' : ''), onclick: () => { this.erasePaint = !this.erasePaint; this.renderPanel(); this.drawOverlay(); } }, this.erasePaint ? '🖌 塗抹中（點此暫停）' : '🖌 開始塗抹'),
          h('div', { class: 'seg' }, h('button', { class: 'btn' + (!this.eraseRubber ? ' on' : ''), onclick: () => { this.eraseRubber = false; this.renderPanel(); } }, '塗抹'), h('button', { class: 'btn' + (this.eraseRubber ? ' on' : ''), onclick: () => { this.eraseRubber = true; this.renderPanel(); } }, '擦掉')),
          h('button', { class: 'btn sm', onclick: () => { em.p.strokes = []; this.updEraseInfo(); this.drawOverlay(); } }, '清除'), info),
        this.slider('筆刷大小', () => Math.round((this.eraseSize || 0.03) * 1000), (v) => { this.eraseSize = v / 1000; }, 5, 120, 1, 30, { onInput: () => this.drawOverlay(), onCommit: () => {} })),
      card('rescue', '🛟 AI 救援廢片', '大霧拍得霧茫茫、超級大逆光讓前景的人／物品／動物整個太暗、背景太亮前景太暗（光比過高）——AI 會自動判斷問題並修復：去霧、找回層次與色彩、拉亮前景但不把天空洗白，暗部提亮後自動 AI 降噪，偵測到人臉會順便補光。',
        h('div', { class: 'lbl2' }, h('span', null, '問題類型'), this.seg([['auto', 'AI 自動判斷'], ['haze', '霧霾'], ['backlight', '逆光'], ['hdr', '光比過高']], P.rescue.mode, (v) => { P.rescue.mode = v; this.renderPanel(); })),
        sl('救援強度', P.rescue, 'amt', 0, 100, 80), h('div', { class: 'sub' }, '提示：RAW 檔會以 16 位元原始資料處理，暗部可救回的細節比 JPG 多很多。')),
      card('deblur', '📷 AI 消除拖影', '修復手震、晃動或物體移動造成的模糊（Restormer 去模糊模型）。',
        h('div', { class: 'lbl2' }, h('span', null, '模糊類型'), this.seg([['motion', '晃動拖影'], ['defocus', '失焦模糊']], P.deblur.type, (v) => { P.deblur.type = v; this.renderPanel(); })),
        sl('強度', P.deblur, 'amt', 0, 100, 100), this.toggle('以完整解析度處理（較慢，約 3–4 倍時間）', () => P.deblur.full, (v) => (P.deblur.full = v))),
      card('dereflect', '🪟 AI 消除反光', '淡化隔著玻璃拍攝的反光、倒影與眩光。',
        sl('強度', P.dereflect, 'amt', 0, 100, 60), h('div', { class: 'sub' }, '說明：對淡淡的玻璃反光、霧狀眩光效果較好；很清楚、很亮的倒影只能減弱，無法完全去除。')),
      card('relight', '💡 AI 人像補光', '偵測人臉並找出臉、脖子、手等所有膚色：太暗的提亮、過曝的壓回合適範圍，讓臉和手亮度一致；修正黃光、雜光偏色，過曝死白處補回膚色，保留立體感與膚質紋理。',
        sl('補光強度', P.relight, 'amt', 0, 100, 60)),
      card('beauty', '🌸 AI 人像美顏', '自然磨皮（保留毛孔紋理）、淡化斑點與暗沉、均勻膚色、眼睛更清晰；眼睛、眉毛、嘴巴不會被磨糊。',
        sl('美顏強度', P.beauty, 'amt', 0, 100, 50)),
      card('enhance', '✨ AI 畫質增強', '提升模糊、低畫質或裁切過照片的細節與清晰度，尺寸不變（需要放大請用匯出時的「AI 畫質增強 → 放大」）。',
        sl('強度', P.enhance, 'amt', 0, 100, 80)));
    this.updEraseInfo();
    b.prepend(this.peopleCard(job));
    const sel = Object.keys(Cloud.OPS).filter((k) => P.ops[k]);
    b.append(h('div', { class: 'acts' }, h('button', { class: 'btn pri', disabled: !sel.length || !!job, onclick: () => this.sendFix(sel) }, sel.length ? `☁ 送雲端處理（${sel.map((k) => Cloud.OPS[k].replace('AI ', '')).join('＋')}）` : '請先開啟要使用的功能')),
      h('div', { class: 'note' }, '處理順序：消除拖影 → 消除反光 → AI 消除 → 救援廢片 → 畫質增強 → 人像補光 → 人像美顏。完成後會成為這張相片的新原圖（所有調整、遮色片都會保留），隨時可「還原原圖」。若有開 AI 降噪，雲端會一併重新降噪。一張 2400 萬像素約 5–20 分鐘，可切到背景，進度會顯示在這裡與通知列。'));
  },
  peopleCard(job) {
    const box = h('div', { class: 'aicard' }, h('h4', null, '👥 移除人物與物件'), h('div', { class: 'sub' }, '像 Lightroom：AI 在手機上找出畫面中的每一個人（連同背包、隨身物品）並沿著輪廓框起來；也可以按「⭕ 圈選物件」用手指圈出其他東西，AI 會自動描出物件輪廓，可以圈很多個。白色＝消除、虛線＝保留，按 ✓ 後送到雲端自然補上背景。第一次使用會先下載約 54 MB 的模型。'));
    const P = this.ppl && this.ppl.rec === this.rec.id ? this.ppl : null;
    if (!P) { this.loadPeople().then(() => this.tool === 'aifix' && this.renderPanel()); return box; }
    if (this.pplBusy) { box.append(h('div', { class: 'acts' }, h('button', { class: 'btn pri', id: 'pplBtn', disabled: true }, this.pplBusy))); return box; }
    if (P.list.length) box.append(h('div', { class: 'acts' }, h('button', { class: 'btn pri', disabled: !!job, onclick: () => { P.on = true; this.pplPill(); this.drawOverlay(); this.renderPanel(); } }, P.on ? `選取中（${P.sel.size}/${P.list.length}）` : `選擇要消除的人物（${P.list.length} 位）`),
      P.on ? h('button', { class: 'btn sm', onclick: () => { P.list.forEach((_, i) => P.sel.add(i)); this.pplPill(); this.drawOverlay(); this.renderPanel(); } }, '全選') : null,
      P.on ? h('button', { class: 'btn sm', onclick: () => { P.sel.clear(); this.pplPill(); this.drawOverlay(); this.renderPanel(); } }, '全不選') : null,
      h('button', { class: 'btn sm', disabled: !!job, onclick: () => { P.on = true; P.lasso = true; this.pplPill(); this.drawOverlay(); this.renderPanel(); } }, '⭕ 圈選物件'),
      h('button', { class: 'btn sm', onclick: () => this.detectPeople() }, '重新偵測')));
    else box.append(h('div', { class: 'acts' }, h('button', { class: 'btn pri', id: 'pplBtn', disabled: !!job, onclick: () => this.detectPeople() }, P.none ? '👥 偵測畫面中的人物' : '沒有偵測到人物・重新偵測'),
      h('button', { class: 'btn', disabled: !!job, onclick: () => this.detectPeople({ lasso: true }) }, '⭕ 圈選物件')));
    if (job) box.append(h('div', { class: 'sub' }, '這張相片正在雲端處理中，完成後再選擇。'));
    box.append(this.engineCard());
    if (isApp) box.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => this.extEdit() }, '📱 用手機相簿的 AI 編輯（OPPO AI 消除等）'), h('button', { class: 'btn sm', onclick: () => this.lrEdit() }, '🅻 用 Lightroom 修圖')),
      h('div', { class: 'sub' }, '會開啟手機內建相簿的編輯畫面；用完 AI 消除等功能並儲存後回到這裡，結果會自動套用到這張，相片名稱不變。'));
    return box;
  },
  async sendFix(ops) {
    const P = this.fixP; const masks = {};
    if (ops.includes('erase')) {
      const em = this.eraseMaskFor(); if (!em.p.strokes.some((s) => !s.erase)) { toast('請先在畫面上塗抹要消除的物件'); return; }
      const SW = this.ses.SW, SH = this.ses.SH, s = Math.min(1, 2048 / Math.max(SW, SH)); const w = Math.round(SW * s), hh = Math.round(SH * s);
      const m = rasterBrush(em, SW, SH, [0, 0, 1, 1], w, hh); const c = mkCanvas(w, hh); const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, w, hh); x.drawImage(m, 0, 0);
      if (GenErase.cfg().engine === 'gemini') {
        if (!(await this.runGemini(c, 'Gemini 生成式消除'))) return;
        this.eraseMask = null; this.erasePaint = false; ops = ops.filter((k) => k !== 'erase'); P.ops.erase = false;
        if (!ops.length) { this.renderPanel(); this.drawOverlay(); return; }
        await sleep(1500);
      } else masks[this.rec.id] = await canvasBlob(c, 'image/png');
    }
    const p = { erase: { engine: GenErase.cfg().engine === 'gemini' ? 'lama' : GenErase.cfg().engine }, deblur: { type: P.deblur.type, amt: P.deblur.amt / 100, full: !!P.deblur.full }, dereflect: { amt: P.dereflect.amt / 100 }, enhance: { amt: P.enhance.amt / 100 }, relight: { amt: P.relight.amt / 100 }, beauty: { amt: P.beauty.amt / 100 }, rescue: { amt: P.rescue.amt / 100, mode: P.rescue.mode } };
    await this.persist();
    if (await Cloud.enqueueFix([this.rec], ops, p, masks)) { if (ops.includes('erase')) { this.eraseMask = null; this.erasePaint = false; } P.ops = {}; this.renderPanel(); this.drawOverlay(); }
  },
  t_ai(b) {
    this.aiCard(b);
    b.append(h('div', { class: 'note', html: '<b>使用方式：</b>開啟後，App 會在<b>背景執行緒</b>先完成預覽解析度分析（不會卡住畫面）；放大到 100% 時會在背景以<b>原始解析度</b>計算一次並快取，之後拖曳檢視與匯出都直接使用。大量照片可在相簿多選後使用「☁ 雲端降噪」交給 GitHub 處理。<br>建議搭配「細節 → 銳化」少量補回銳利度。' }));
  },

  /* ---------- 預設集 ---------- */
  t_presets(b) {
    const user = (App.userPresets || []);
    const groups = [...PRESETS.map((g) => g.g), ...(user.length ? ['我的'] : [])];
    if (!groups.includes(this.presetGroup)) this.presetGroup = groups[0];
    b.append(h('div', { class: 'hscroll' }, groups.map((g) => h('button', { class: 'btn sm' + (g === this.presetGroup ? ' on' : ''), onclick: () => { this.presetGroup = g; this.renderPanel(); } }, g))));
    const items = this.presetGroup === '我的' ? user.map((u) => ({ id: u.id, name: u.name, e: u.e })) : PRESETS.find((g) => g.g === this.presetGroup).items;
    const grid = h('div', { class: 'cards' }); b.append(grid);
    for (const p of items) {
      const cv = h('canvas', { width: 1, height: 1 });
      grid.append(h('div', { class: 'pcard' + (this.presetSel === p.id ? ' on' : ''), onclick: () => { this.presetSel = p.id; this.presetObj = p; this.presetAmt = 100; this.edit = normEdit(applyPreset(this.presetBase, p.e, 100)); this.changed(); this.commit('預設集：' + p.name); this.ensureAi(); this.renderPanel(); } }, cv, h('div', null, p.name)));
      this.thumbLater(cv, () => applyPreset(this.presetBase, p.e, 100));
    }
    if (this.presetSel && this.presetObj) b.append(this.slider('數量', () => this.presetAmt, (v) => { this.presetAmt = v; this.edit = normEdit(applyPreset(this.presetBase, this.presetObj.e, v)); }, 0, 200, 1, 100, { onCommit: () => this.commit('預設集數量') }));
    b.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => this.savePreset() }, '＋ 儲存目前設定為預設集'),
      this.presetSel ? h('button', { class: 'btn sm', onclick: () => { this.edit = normEdit(clone(this.presetBase)); this.presetSel = null; this.changed(); this.commit('取消預設集'); this.renderPanel(); } }, '取消套用') : null));
  },
  savePreset() {
    const box = h('div'); const name = h('input', { placeholder: '預設集名稱', style: { width: '100%' } });
    const ck = {}; const grid = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } });
    for (const g of Object.keys(COPY_GROUPS)) { const i = h('input', { type: 'checkbox' }); i.checked = !['裁切', '遮色片', '修復', '幾何', '位置（GPS）'].includes(g); ck[g] = i; grid.append(h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '14px' } }, i, g)); }
    box.append(name, h('div', { class: 'sub', style: { margin: '8px 0 4px' } }, '包含項目'), grid, h('div', { class: 'acts' }, h('button', { class: 'btn pri', onclick: async () => {
      const groups = Object.keys(ck).filter((g) => ck[g].checked); if (!name.value.trim()) { toast('請輸入名稱'); return; }
      const p = { id: 'u' + uid(), name: name.value.trim(), e: pickGroups(this.edit, groups), t: Date.now() }; await DB.put('presets', p); await App.loadPresets(); UI.close(); toast('已儲存預設集'); this.presetGroup = '我的'; this.renderPanel(); } }, '儲存')));
    UI.sheet('儲存預設集', box); setTimeout(() => name.focus(), 300);
  },


  /* ---------- 位置（GPS） ---------- */
  t_loc(b) {
    const ex = this.rec.exif || {}; const cur = this.edit.loc;
    const orig = ex.lat != null ? `${ex.lat.toFixed(6)}, ${ex.lon.toFixed(6)}` : '無';
    b.append(h('div', { class: 'kv2', style: { margin: '6px 0' } }, h('b', null, '原始 GPS'), h('span', null, orig), h('b', null, '匯出時寫入'),
      h('span', { style: { color: cur ? 'var(--ac)' : '' } }, cur ? `自訂：${cur.name || ''} ${cur.lat.toFixed(5)}, ${cur.lon.toFixed(5)}` : CFG.exp.meta === 'all' ? (ex.lat != null ? '原始位置' : '不含位置') : '不含位置（設定為移除）')));
    let draft = null;
    const picker = LocationPicker(cur || (ex.lat != null ? { lat: ex.lat, lon: ex.lon } : null), { mapH: '220px', onChange: (v) => { draft = v; } });
    b.append(picker.el);
    b.append(h('div', { class: 'acts' },
      h('button', { class: 'btn pri', onclick: () => { const v = draft || picker.value(); if (!v) { toast('請先搜尋或在地圖上點選位置'); return; } this.edit.loc = v; this.changed(); this.commit('設定拍攝地點'); this.persist(); toast('已設定，匯出時會寫入 GPS 座標'); this.renderPanel(); } }, '✓ 設為這張相片的拍攝地點'),
      cur ? h('button', { class: 'btn', onclick: () => { this.edit.loc = null; this.changed(); this.commit('清除自訂位置'); this.renderPanel(); } }, '清除自訂位置') : null));
    b.append(h('div', { class: 'note' }, '座標會寫入 EXIF GPS 與 XMP（含地點名稱、城市、國家），Google 相簿、Lightroom、手機相簿都能讀取。要套用到多張相片：圖庫 → 選取 → 「📍 位置」。'));
    requestAnimationFrame(() => picker.mount());
  },

  /* ---------- 版本 / 歷程 ---------- */
  t_versions(b) {
    const vs = this.rec.versions || [];
    b.append(h('div', { class: 'sec' }, '版本', h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: async () => {
      const n = prompt('版本名稱', '版本 ' + (vs.length + 1)); if (!n) return; this.rec.versions = [...vs, { id: uid(), name: n, t: Date.now(), e: clone(this.edit) }]; await this.persist(); this.renderPanel(); toast('已建立版本'); } }, '＋ 建立版本')));
    if (!vs.length) b.append(h('div', { class: 'sub' }, '尚未建立版本。版本可保存不同風格，隨時切換比較。'));
    const list = h('div', { class: 'mlist' }); b.append(list);
    for (const v of vs) list.append(h('div', { class: 'mitem', onclick: () => { this.edit = normEdit(clone(v.e)); this.changed(); this.commit('套用版本：' + v.name); this.ensureAi(); } }, h('span', { class: 'mi' }, 'V'), h('span', { class: 'grow' }, v.name, h('div', { class: 'sub' }, new Date(v.t).toLocaleString('zh-TW'))),
      h('button', { class: 'ib', onclick: async (ev) => { ev.stopPropagation(); this.rec.versions = vs.filter((x) => x !== v); await this.persist(); this.renderPanel(); } }, '🗑')));
    b.append(h('div', { class: 'sec' }, '歷程記錄'));
    const hl = h('div', { class: 'hist' }); b.append(hl);
    this.hist.forEach((x, i) => hl.append(h('div', { class: i === this.hi ? 'on' : i > this.hi ? 'fut' : '', onclick: () => this.jump(i) }, `${i + 1}. ${x.label}`)));
    setTimeout(() => { const on = hl.querySelector('.on'); on && on.scrollIntoView({ block: 'nearest' }); }, 20);
  },

  /* ---------- 裁切 ---------- */
  ratioVal(r) { if (r === 'free') return null; if (r === 'orig') { const c = this.edit.crop; const rot = c.rot90 % 2; return rot ? this.ses.SH / this.ses.SW : this.ses.SW / this.ses.SH; } const [a, b2] = r.split(':').map(Number); return a / b2; },
  t_crop(b) {
    const c = this.edit.crop;
    b.append(h('div', { class: 'hscroll' }, RATIOS.map(([k, n]) => h('button', { class: 'btn sm' + (c.ratio === k ? ' on' : ''), onclick: () => { c.ratio = k; this.applyRatio(); this.changed(); this.commit('裁切比例'); this.renderPanel(); } }, n))));
    b.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm pri', onclick: () => { this.setTool('edit'); this.sub = 'auto'; this.renderSub(); this.renderPanel(); this.runCompose(); } }, '✨ AI 自動構圖'), h('button', { class: 'btn sm', onclick: () => this.runUpright('auto') }, '📐 AI 拉正')));
    b.append(this.S('crop.angle', '拉直', -45, 45, 0.1, { fmt: (v) => v.toFixed(1) + '°', onInput: () => { this.fitCropToImage('max'); this.changed(); } }));
    b.append(h('div', { class: 'acts' },
      h('button', { class: 'btn sm', onclick: () => { c.rot90 = (c.rot90 + 3) % 4; this.swapCrop(); this.changed(); this.commit('向左旋轉'); } }, '⟲ 左轉 90°'),
      h('button', { class: 'btn sm', onclick: () => { c.rot90 = (c.rot90 + 1) % 4; this.swapCrop(); this.changed(); this.commit('向右旋轉'); } }, '⟳ 右轉 90°'),
      h('button', { class: 'btn sm', onclick: () => { c.flipH = !c.flipH; c.x = 1 - c.x - c.w; this.changed(); this.commit('水平翻轉'); } }, '⇋ 水平翻轉'),
      h('button', { class: 'btn sm', onclick: () => { c.flipV = !c.flipV; c.y = 1 - c.y - c.h; this.changed(); this.commit('垂直翻轉'); } }, '⇵ 垂直翻轉'),
      h('button', { class: 'btn sm', onclick: () => this.autoLevel() }, '自動拉直'),
      h('button', { class: 'btn sm', onclick: () => { this.edit.crop = clone(DEF_EDIT.crop); this.changed(); this.commit('重設裁切'); this.renderPanel(); } }, '重設')));
    b.append(h('div', { class: 'note' }, '拖曳框線或四角調整範圍，拖曳框內可移動。完成後切換到其他工具即可看到裁切結果。'));
  },
  swapCrop() { const c = this.edit.crop; [c.x, c.y, c.w, c.h] = [c.y, c.x, c.h, c.w]; if (c.ratio !== 'free' && c.ratio !== 'orig' && c.ratio !== '1:1') { const [a, b2] = c.ratio.split(':'); c.ratio = b2 + ':' + a; } this.renderPanel(); },
  cropGeo() { const e = effective(this.edit); return Engine.geometry(e, this.ses.SW, this.ses.SH, { ...e.crop, x: 0, y: 0, w: 1, h: 1 }); },
  cropValid(G, r) {
    if (!this.edit.geo.constrain) return r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= 1 + 1e-6 && r.y + r.h <= 1 + 1e-6;
    const pts = []; for (let i = 0; i <= 4; i++) { const t = i / 4; pts.push([r.x + r.w * t, r.y], [r.x + r.w * t, r.y + r.h], [r.x, r.y + r.h * t], [r.x + r.w, r.y + r.h * t]); }
    return pts.every((p) => { const s = Engine.outToSrc(G, p); return s[0] >= -1e-4 && s[1] >= -1e-4 && s[0] <= 1 + 1e-4 && s[1] <= 1 + 1e-4; });
  },
  /* 在目前比例下，找出置中且落在影像內的最大裁切框 */
  fitCropToImage(mode) {
    // mode: 'max' 依比例設為最大（保持中心）；其他：僅在超出影像時縮小
    const c = this.edit.crop; const G = this.cropGeo(); const BW = G.BW, BH = G.BH;
    const cur = { x: c.x, y: c.y, w: c.w, h: c.h };
    if (mode !== 'max' && this.cropValid(G, cur)) return;
    const ratio = this.ratioVal(c.ratio) || (c.w * BW) / (c.h * BH);
    let w0 = 1, h0 = (BW / ratio) / BH; if (h0 > 1) { h0 = 1; w0 = (BH * ratio) / BW; }
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    let lo = 0, hi = 1;
    for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; const r = { w: w0 * m, h: h0 * m }; r.x = clamp(cx - r.w / 2, 0, 1 - r.w); r.y = clamp(cy - r.h / 2, 0, 1 - r.h); if (this.cropValid(G, r)) lo = m; else hi = m; }
    const r = { w: w0 * lo, h: h0 * lo }; r.x = clamp(cx - r.w / 2, 0, 1 - r.w); r.y = clamp(cy - r.h / 2, 0, 1 - r.h);
    Object.assign(c, r);
  },
  applyRatio() { const c = this.edit.crop; if (c.ratio === 'free') return; this.fitCropToImage('max'); },
  cropRectScr() { const c = this.edit.crop; const G = this.last.G; const a = this.imgToScr([c.x * G.OW, c.y * G.OH]), b2 = this.imgToScr([(c.x + c.w) * G.OW, (c.y + c.h) * G.OH]); return [a[0], a[1], b2[0], b2[1]]; },

  /* ---------- 遮色片 ---------- */
  t_mask(b) {
    const ms = this.edit.masks;
    b.append(h('div', { class: 'sec' }, '遮色片', h('span', { class: 'grow' }), h('button', { class: 'btn sm pri', onclick: () => this.addMaskMenu() }, '＋ 新增')));
    if (!ms.length) { b.append(h('div', { class: 'note' }, '遮色片可只調整局部：筆刷、線性漸層、放射狀漸層、自動選取天空、明亮度範圍與顏色範圍。')); return; }
    const list = h('div', { class: 'mlist' }); b.append(list);
    ms.forEach((m, i) => { const t = MASK_TYPES.find((x) => x[0] === m.type) || ['', m.type, '?'];
      list.append(h('div', { class: 'mitem' + (m.id === this.selMask ? ' on' : ''), onclick: () => { this.selMask = m.id; this.renderPanel(); this.changed(); } }, h('span', { class: 'mi' }, t[2]), h('span', { class: 'grow' }, m.name || `${t[1]} ${i + 1}`),
        h('button', { class: 'ib', title: m.on === false ? '顯示' : '隱藏', onclick: (ev) => { ev.stopPropagation(); m.on = m.on === false; this.changed(); this.commit('切換遮色片'); this.renderPanel(); } }, m.on === false ? '◌' : '●'),
        h('button', { class: 'ib', title: '刪除', onclick: (ev) => { ev.stopPropagation(); this.edit.masks = ms.filter((x) => x !== m); if (this.selMask === m.id) this.selMask = null; this.changed(); this.commit('刪除遮色片'); this.renderPanel(); } }, '🗑'))); });
    const m = ms.find((x) => x.id === this.selMask); if (!m) return;
    b.append(h('div', { class: 'acts' },
      h('label', { class: 'btn sm' + (this.vizOn ? ' on' : ''), onclick: () => { this.vizOn = !this.vizOn; this.renderPanel(); this.changed(); } }, '顯示遮罩'),
      h('label', { class: 'btn sm' + (m.invert ? ' on' : ''), onclick: () => { m.invert = !m.invert; this.changed(); this.commit('反轉遮色片'); this.renderPanel(); } }, '反轉'),
      h('button', { class: 'btn sm', onclick: () => { const c = clone(m); c.id = uid(); this.edit.masks.push(c); this.selMask = c.id; this.changed(); this.commit('複製遮色片'); this.renderPanel(); } }, '複製')));
    if (m.type === 'brush') {
      b.append(h('div', { class: 'lbl2' }, h('span', null, '筆刷'), this.seg([['paint', '繪製'], ['erase', '擦除']], this.brush.erase ? 'erase' : 'paint', (k) => { this.brush.erase = k === 'erase'; this.renderPanel(); })));
      b.append(this.slider('大小', () => this.brush.size * 100, (v) => { this.brush.size = v / 100; this.drawOverlay(); }, 0.5, 25, 0.5, 4, { onCommit: () => {}, onInput: () => {} }),
        this.slider('羽化', () => this.brush.feather * 100, (v) => { this.brush.feather = v / 100; }, 0, 100, 1, 60, { onCommit: () => {}, onInput: () => {} }),
        this.slider('流量', () => this.brush.flow * 100, (v) => { this.brush.flow = v / 100; }, 5, 100, 1, 80, { onCommit: () => {}, onInput: () => {} }));
    }
    if (m.type === 'radial') b.append(this.slider('羽化', () => m.p.feather, (v) => { m.p.feather = v; }, 0, 100, 1, 50));
    if (m.type === 'lum' || m.type === 'zone') b.append(this.slider('範圍下限', () => m.p.lo, (v) => { m.p.lo = Math.min(v, m.p.hi - 1); }, 0, 100, 1, 50), this.slider('範圍上限', () => m.p.hi, (v) => { m.p.hi = Math.max(v, m.p.lo + 1); }, 0, 100, 1, 100), this.slider('平滑', () => m.p.sm, (v) => { m.p.sm = v; }, 0, 50, 1, 15));
    if (m.type === 'color') {
      b.append(h('div', { class: 'lbl2' }, h('span', null, '目標顏色'), h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { style: { width: '26px', height: '26px', borderRadius: '8px', background: `rgb(${m.p.r * 255},${m.p.g * 255},${m.p.b * 255})`, border: '2px solid #fff' } }), h('button', { class: 'btn sm' + (this.picking === 'color' ? ' on' : ''), onclick: () => { this.picking = this.picking === 'color' ? null : 'color'; this.renderPanel(); } }, '💧 從畫面選取'))));
      b.append(this.slider('範圍', () => m.p.range, (v) => { m.p.range = v; }, 1, 100, 1, 30));
    }
    if (m.type === 'sky') b.append(h('div', { class: 'note' }, this.ses.skyFrac != null ? (this.ses.skyFrac < 0.01 ? '畫面中似乎沒有偵測到天空，可改用線性漸層或筆刷。' : `已自動選取天空（約 ${Math.round(this.ses.skyFrac * 100)}% 畫面）。`) : '偵測中…'));
    b.append(this.slider('遮色片量', () => m.amt == null ? 100 : m.amt, (v) => { m.amt = v; }, 0, 100, 1, 100));
    b.append(h('div', { class: 'sec' }, '局部調整'));
    const A = (k, n, mn, mx, st, o = {}) => this.slider(n, () => m.adj[k] || 0, (v) => { m.adj[k] = v; }, mn, mx, st, 0, { sign: true, ...o });
    b.append(A('exposure', '曝光', -4, 4, 0.01, { fmt: (v) => v.toFixed(2) }), A('contrast', '對比', -100, 100, 1), A('highlights', '亮部', -100, 100, 1), A('shadows', '陰影', -100, 100, 1), A('whites', '白色', -100, 100, 1),
      A('temp', '色溫', -100, 100, 1, { grad: 'linear-gradient(90deg,#4f7fd6,#ddd 50%,#e6b33a)' }), A('tint', '色調', -100, 100, 1, { grad: 'linear-gradient(90deg,#4fae58,#ddd 50%,#c94fae)' }), A('saturation', '飽和度', -100, 100, 1),
      A('texture', '紋理', -100, 100, 1), A('clarity', '清晰度', -100, 100, 1), A('dehaze', '去朦朧', -100, 100, 1), A('sharp', '銳利度', -100, 100, 1));
  },
  addMaskMenu() {
    UI.menu('新增遮色片', MASK_TYPES.map(([k, n, ic]) => ({ icon: ic, label: n, fn: () => this.addMask(k) })));
  },
  addMask(type) {
    const G = this.last.G; const src = (o) => Engine.outToSrc(G, o);
    const m = { id: uid(), type, invert: false, amt: 100, on: true, p: {}, adj: clone(DEF_MASK_ADJ) };
    if (type === 'linear') { const a = src([0.5, 0.15]), b2 = src([0.5, 0.55]); m.p = { ax: a[0], ay: a[1], bx: b2[0], by: b2[1] }; m.adj.exposure = -0.5; }
    else if (type === 'radial') { const c = src([0.5, 0.5]); m.p = { cx: c[0], cy: c[1], rx: 0.22, ry: 0.17, ang: 0, feather: 50 }; m.adj.exposure = 0.4; }
    else if (type === 'brush') { m.p = { strokes: [] }; this.brush.erase = false; toast('在畫面上拖曳繪製筆刷範圍'); }
    else if (type === 'sky') { this.ses.ensureSky(); m.adj.exposure = -0.3; m.adj.saturation = 15; if (this.ses.skyFrac < 0.01) toast('未偵測到明顯天空'); }
    else if (type === 'lum') { m.p = { lo: 60, hi: 100, sm: 15 }; m.adj.highlights = -30; }
    else if (type === 'zone') { m.p = { lo: 55, hi: 100, sm: 12 }; m.adj.exposure = -0.3; }
    else if (type === 'color') { m.p = { r: 0.25, g: 0.45, b: 0.8, range: 30 }; this.picking = 'color'; toast('點一下畫面選取要調整的顏色'); }
    this.edit.masks.push(m); this.selMask = m.id; this.vizOn = type !== 'linear' && type !== 'radial'; this.changed(); this.commit('新增' + (MASK_TYPES.find((x) => x[0] === type) || [])[1]); this.renderPanel();
    if (this.vizOn) setTimeout(() => { if (this.selMask === m.id) { this.vizOn = false; this.changed(); this.renderPanel(); } }, 1600);
  },
  brushActive() { const m = this.edit && this.edit.masks.find((x) => x.id === this.selMask); return this.tool === 'mask' && m && m.type === 'brush'; },

  /* ---------- 修復 ---------- */
  t_heal(b) {
    b.append(h('div', { class: 'note' }, '點一下要移除的斑點、灰塵或雜物，App 會自動找到合適的來源修補；可拖曳實線圓（目標）或虛線圓（來源）微調。'));
    b.append(h('div', { class: 'lbl2' }, h('span', null, '模式'), this.seg([['heal', '修復（自動融合）'], ['clone', '仿製']], this.heal.mode, (k) => { this.heal.mode = k; const s = this.curSpot(); if (s) { s.mode = k; this.changed(); this.commit('修復模式'); } this.renderPanel(); })));
    const sp = this.curSpot(); const L = 1;
    b.append(this.slider('大小', () => (sp ? sp.r : this.heal.size) * 100, (v) => { if (sp) sp.r = v / 100; else this.heal.size = v / 100; this.drawOverlay(); }, 0.3, 15, 0.1, 3, { onInput: () => sp && this.changed(), onCommit: () => sp && this.commit('修復大小') }),
      this.slider('羽化', () => (sp ? sp.feather : this.heal.feather) * 100, (v) => { if (sp) sp.feather = v / 100; else this.heal.feather = v / 100; }, 0, 100, 1, 50, { onInput: () => sp && this.changed(), onCommit: () => sp && this.commit('修復羽化') }),
      this.slider('不透明度', () => (sp ? sp.opacity : this.heal.opacity) * 100, (v) => { if (sp) sp.opacity = v / 100; else this.heal.opacity = v / 100; }, 0, 100, 1, 100, { onInput: () => sp && this.changed(), onCommit: () => sp && this.commit('修復不透明度') }));
    void L;
    b.append(h('div', { class: 'acts' }, sp ? h('button', { class: 'btn sm', onclick: () => { this.edit.heal = this.edit.heal.filter((x) => x !== sp); this.selSpot = null; this.changed(); this.commit('刪除修復點'); this.renderPanel(); } }, '刪除此點') : null,
      this.edit.heal.length ? h('button', { class: 'btn sm', onclick: () => { this.edit.heal = []; this.selSpot = null; this.changed(); this.commit('清除修復'); this.renderPanel(); } }, `全部清除（${this.edit.heal.length}）`) : null));
  },
  curSpot() { return this.selSpot != null ? this.edit.heal[this.selSpot] : null; },

  /* ---------- 工具互動 ---------- */
  toolDown(p) {
    const G = this.last.G; const tolS = 26 * this.dpr;
    if (this.tool === 'aifix' && this.ppl && this.ppl.on && this.ppl.rec === this.rec.id) {
      this.drag = { kind: 'lasso', scr: [p], pts: [this.scrToSrc(p)], len: 0 }; return true;
    }
    if (this.tool === 'aifix' && this.erasePaint) {
      const em = this.eraseMaskFor(); const st = { pts: [this.scrToSrc(p)], size: this.eraseSize || 0.03, feather: 0.1, flow: 1, erase: !!this.eraseRubber };
      em.p.strokes.push(st); this.drag = { kind: 'erase', st }; this.drawOverlay(); return true;
    }
    if (this.picking) {
      const i = this.scrToImg(p); const L = this.last; const x = clamp(Math.floor(i[0] * L.sigma), 0, L.W - 1), y = clamp(Math.floor(i[1] * L.sigma), 0, L.H - 1);
      if (this.picking === 'wb') {
        const s = this.scrToSrc(p); const id = imgData(this.ses.prev, 640); const px = clamp(Math.round(s[0] * id.width), 1, id.width - 2), py = clamp(Math.round(s[1] * id.height), 1, id.height - 2);
        let r = 0, g = 0, bb = 0; for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const q = ((py + j) * id.width + px + k) * 4; r += s2l(id.data[q] / 255); g += s2l(id.data[q + 1] / 255); bb += s2l(id.data[q + 2] / 255); }
        this.edit.temp = Math.round(clamp(Math.log(bb / r) / 0.72 * 100, -100, 100)); this.edit.tint = Math.round(clamp(Math.log(g / Math.sqrt(r * bb)) / 0.24 * 100, -100, 100)); this.edit.wb = 'custom';
        this.picking = null; this.changed(); this.commit('白平衡滴管'); this.renderPanel(); return true;
      }
      if (this.picking === 'color') {
        const m = this.edit.masks.find((q) => q.id === this.selMask); const px = Engine.readTex(L.tex, x, y, 1, 1);
        if (m) { m.p.r = px[0] / 255; m.p.g = px[1] / 255; m.p.b = px[2] / 255; }
        this.picking = null; this.changed(); this.commit('選取顏色'); this.renderPanel(); return true;
      }
    }
    if (this.tool === 'crop') {
      const [x0, y0, x1, y1] = this.cropRectScr(); const c = this.edit.crop;
      const near = (a, b2) => Math.abs(a - b2) < tolS;
      let hnd = '';
      if (p[0] > x0 - tolS && p[0] < x1 + tolS && p[1] > y0 - tolS && p[1] < y1 + tolS) {
        if (near(p[1], y0)) hnd += 'n'; else if (near(p[1], y1)) hnd += 's';
        if (near(p[0], x0)) hnd += 'w'; else if (near(p[0], x1)) hnd += 'e';
        if (!hnd && p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1) hnd = 'move';
      }
      if (!hnd) return false;
      this.drag = { kind: 'crop', hnd, start: p, orig: { ...c } }; return true;
    }
    if (this.tool === 'mask') {
      const m = this.edit.masks.find((q) => q.id === this.selMask); if (!m) return false;
      if (m.type === 'brush') { const s = this.scrToSrc(p); const st = { pts: [s], size: this.brush.size, feather: this.brush.feather, flow: this.brush.flow, erase: this.brush.erase }; m.p.strokes.push(st); this.drag = { kind: 'brush', st }; this.changed(); return true; }
      const hs = this.maskHandles(m); let best = null, bd = tolS;
      for (const hd of hs) { const d = Math.hypot(hd.p[0] - p[0], hd.p[1] - p[1]); if (d < bd) { bd = d; best = hd; } }
      if (!best && m.type === 'radial') { const c = this.srcToScr([m.p.cx, m.p.cy]); const rr = Math.hypot(...[0, 1].map((i) => hs[1].p[i] - c[i])); if (Math.hypot(p[0] - c[0], p[1] - c[1]) < rr) best = hs[0]; }
      if (!best) return false;
      this.drag = { kind: 'mask', m, hd: best, start: p, orig: clone(m.p), s0: this.scrToSrc(p) }; return true;
    }
    if (this.tool === 'heal') {
      const hit = this.spotHit(p);
      if (hit) { this.selSpot = hit.i; this.drag = { kind: 'spot', which: hit.which, i: hit.i, s0: this.scrToSrc(p), orig: { ...this.edit.heal[hit.i] } }; this.renderPanel(); this.drawOverlay(); return true; }
      const s = this.scrToSrc(p); if (s[0] < 0 || s[1] < 0 || s[0] > 1 || s[1] > 1) return false;
      this.drag = { kind: 'newspot', s, p }; return true;
    }
    return false;
  },
  toolMove(p) {
    const d = this.drag; if (!d) return;
    if (d.kind === 'lasso') { if (!this.ppl.lasso) return; const l = d.scr[d.scr.length - 1], dd = Math.hypot(p[0] - l[0], p[1] - l[1]); if (dd > 3 * this.dpr) { d.len += dd; d.scr.push(p); d.pts.push(this.scrToSrc(p)); this.drawOverlay(); } return; }
    if (d.kind === 'erase') { const s = this.scrToSrc(p); const last = d.st.pts[d.st.pts.length - 1]; if (Math.hypot((s[0] - last[0]) * this.ses.SW, (s[1] - last[1]) * this.ses.SH) > d.st.size * Math.max(this.ses.SW, this.ses.SH) * 0.2) d.st.pts.push(s); this.hover = p; this.drawOverlay(); return; }
    if (d.kind === 'crop') {
      const G = this.last.G; const c = this.edit.crop, o = d.orig; const dx = (p[0] - d.start[0]) / this.view.scale / G.OW, dy = (p[1] - d.start[1]) / this.view.scale / G.OH;
      const ratio = this.ratioVal(c.ratio); const Gc = this.cropGeo(); let r = { ...o };
      if (d.hnd === 'move') { r.x = clamp(o.x + dx, 0, 1 - o.w); r.y = clamp(o.y + dy, 0, 1 - o.h); }
      else {
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        if (d.hnd.includes('w')) x0 = clamp(o.x + dx, 0, x1 - 0.03); if (d.hnd.includes('e')) x1 = clamp(x1 + dx, x0 + 0.03, 1);
        if (d.hnd.includes('n')) y0 = clamp(o.y + dy, 0, y1 - 0.03); if (d.hnd.includes('s')) y1 = clamp(y1 + dy, y0 + 0.03, 1);
        r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        if (ratio) {
          const k = ratio * G.OH / G.OW; // w/h（正規化）
          if (d.hnd === 'n' || d.hnd === 's') { const nw = r.h * k; r.x = o.x + (o.w - nw) / 2; r.w = nw; }
          else if (d.hnd === 'e' || d.hnd === 'w') { const nh = r.w / k; r.y = o.y + (o.h - nh) / 2; r.h = nh; }
          else { const nh = r.w / k; if (d.hnd.includes('n')) r.y = y1 - nh; r.h = nh; }
          if (r.x < 0 || r.y < 0 || r.x + r.w > 1 || r.y + r.h > 1) return;
        }
      }
      if (this.cropValid(Gc, r)) Object.assign(c, r);
      else { let lo = 0, hi = 1; for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; const q = { x: o.x + (r.x - o.x) * m, y: o.y + (r.y - o.y) * m, w: o.w + (r.w - o.w) * m, h: o.h + (r.h - o.h) * m }; if (this.cropValid(Gc, q)) lo = m; else hi = m; } Object.assign(c, { x: o.x + (r.x - o.x) * lo, y: o.y + (r.y - o.y) * lo, w: o.w + (r.w - o.w) * lo, h: o.h + (r.h - o.h) * lo }); }
      this.requestDisplay(); return;
    }
    if (d.kind === 'brush') { const s = this.scrToSrc(p); const last = d.st.pts[d.st.pts.length - 1]; if (Math.hypot((s[0] - last[0]) * this.ses.SW, (s[1] - last[1]) * this.ses.SH) > d.st.size * Math.max(this.ses.SW, this.ses.SH) * 0.15) { d.st.pts.push(s); this.changed(); } this.drawOverlay(); return; }
    if (d.kind === 'mask') {
      const m = d.m, o = d.orig, s = this.scrToSrc(p); const ds = [s[0] - d.s0[0], s[1] - d.s0[1]]; const L = Math.max(this.ses.SW, this.ses.SH); const asp = [this.ses.SW / L, this.ses.SH / L];
      if (m.type === 'linear') {
        if (d.hd.id === 'a') { m.p.ax = o.ax + ds[0]; m.p.ay = o.ay + ds[1]; } else if (d.hd.id === 'b') { m.p.bx = o.bx + ds[0]; m.p.by = o.by + ds[1]; }
        else { m.p.ax = o.ax + ds[0]; m.p.ay = o.ay + ds[1]; m.p.bx = o.bx + ds[0]; m.p.by = o.by + ds[1]; }
      } else if (m.type === 'radial') {
        if (d.hd.id === 'c') { m.p.cx = o.cx + ds[0]; m.p.cy = o.cy + ds[1]; }
        else { const q = [(s[0] - o.cx) * asp[0], (s[1] - o.cy) * asp[1]]; const ca = Math.cos(o.ang), sa = Math.sin(o.ang); const lx = ca * q[0] + sa * q[1], ly = -sa * q[0] + ca * q[1];
          if (d.hd.id === 'rx') m.p.rx = Math.max(0.01, Math.abs(lx)); else if (d.hd.id === 'ry') m.p.ry = Math.max(0.01, Math.abs(ly)); else if (d.hd.id === 'rot') m.p.ang = Math.atan2(q[1], q[0]); }
      }
      this.changed(); return;
    }
    if (d.kind === 'spot') {
      const s = this.scrToSrc(p); const ds = [s[0] - d.s0[0], s[1] - d.s0[1]]; const sp = this.edit.heal[d.i];
      if (d.which === 'dst') { sp.x = d.orig.x + ds[0]; sp.y = d.orig.y + ds[1]; } else { sp.sx = d.orig.sx + ds[0]; sp.sy = d.orig.sy + ds[1]; }
      this.changed(); return;
    }
  },
  toolUp(p) {
    const d = this.drag; this.drag = null; if (!d) return;
    if (d.kind === 'lasso') {
      if (this.ppl.lasso && d.len > 40 * this.dpr && d.pts.length >= 6) this.doLasso(d.pts);
      else { const i = this.pplHit(d.scr[0]); if (i >= 0) { this.ppl.sel.has(i) ? this.ppl.sel.delete(i) : this.ppl.sel.add(i); this.pplPill(); } }
      this.drawOverlay(); return;
    }
    if (d.kind === 'erase') { this.updEraseInfo && this.updEraseInfo(); return; }
    if (d.kind === 'crop') { this.changed(); this.commit('裁切'); }
    else if (d.kind === 'brush') { this.changed(); this.commit(d.st.erase ? '擦除筆刷' : '筆刷'); }
    else if (d.kind === 'mask') this.commit('調整遮色片');
    else if (d.kind === 'spot') this.commit('移動修復點');
    else if (d.kind === 'newspot') {
      if (Math.hypot(p[0] - d.p[0], p[1] - d.p[1]) > 10 * this.dpr) return;
      const s = d.s; const id = this.healId || (this.healId = imgData(this.ses.prev, 900)); const L = Math.max(id.width, id.height);
      const src = findHealSource(id, s[0] * id.width, s[1] * id.height, this.heal.size * L);
      this.edit.heal.push({ x: s[0], y: s[1], r: this.heal.size, sx: src[0] / id.width, sy: src[1] / id.height, feather: this.heal.feather, opacity: this.heal.opacity, mode: this.heal.mode });
      this.selSpot = this.edit.heal.length - 1; this.changed(); this.commit('修復'); this.renderPanel();
    }
  },
  toolCancel() { if (this.drag && this.drag.kind === 'lasso') { this.drag = null; this.drawOverlay(); return; } this.toolCancel0(); },
  toolCancel0() { if (this.drag && this.drag.kind === 'brush') { const m = this.edit.masks.find((q) => q.id === this.selMask); if (m) m.p.strokes = m.p.strokes.filter((x) => x !== this.drag.st); this.changed(); } this.drag = null; },
  spotHit(p) {
    const tol = 18 * this.dpr; const L = Math.max(this.ses.SW, this.ses.SH);
    for (let i = this.edit.heal.length - 1; i >= 0; i--) { const sp = this.edit.heal[i];
      const c = this.srcToScr([sp.x, sp.y]), e = this.srcToScr([sp.x + sp.r * L / this.ses.SW, sp.y]); const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
      if (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.max(r, tol)) return { i, which: 'dst' };
      const sc = this.srcToScr([sp.sx, sp.sy]); if (Math.hypot(p[0] - sc[0], p[1] - sc[1]) < Math.max(r, tol)) return { i, which: 'src' }; }
    return null;
  },
  maskHandles(m) {
    const L = Math.max(this.ses.SW, this.ses.SH); const asp = [this.ses.SW / L, this.ses.SH / L];
    if (m.type === 'linear') { const a = this.srcToScr([m.p.ax, m.p.ay]), b2 = this.srcToScr([m.p.bx, m.p.by]); return [{ id: 'a', p: a }, { id: 'b', p: b2 }, { id: 'm', p: [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2] }]; }
    if (m.type === 'radial') {
      const P = (lx, ly) => { const ca = Math.cos(m.p.ang), sa = Math.sin(m.p.ang); const qx = ca * lx - sa * ly, qy = sa * lx + ca * ly; return this.srcToScr([m.p.cx + qx / asp[0], m.p.cy + qy / asp[1]]); };
      return [{ id: 'c', p: this.srcToScr([m.p.cx, m.p.cy]) }, { id: 'rx', p: P(m.p.rx, 0) }, { id: 'ry', p: P(0, -m.p.ry) }, { id: 'rot', p: P(m.p.rx * 1.25 + 0.02, 0) }, { id: 'ell', P }];
    }
    return [];
  },

  /* ---------- 疊加層 ---------- */
  drawOverlay() {
    const ov = $('#ov'), x = ov.getContext('2d'); x.clearRect(0, 0, ov.width, ov.height); if (!this.last) return;
    const ac = getComputedStyle(document.documentElement).getPropertyValue('--ac').trim() || '#a2613a'; const dpr = this.dpr;
    const dot = (p, r = 8, fill = '#fff') => { x.beginPath(); x.arc(p[0], p[1], r * dpr, 0, 7); x.fillStyle = fill; x.fill(); x.lineWidth = 2.5 * dpr; x.strokeStyle = ac; x.stroke(); };
    if (this.curveFS) { this.drawCurveFS(x, dpr); return; }
    if (this.tool === 'aifix') this.drawErase(x, ov, dpr);
    if (this.tool === 'crop') {
      const [x0, y0, x1, y1] = this.cropRectScr();
      x.fillStyle = 'rgba(20,14,8,.55)'; x.beginPath(); x.rect(0, 0, ov.width, ov.height); x.rect(x0, y0, x1 - x0, y1 - y0); x.fill('evenodd');
      x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 1.5 * dpr; x.strokeRect(x0, y0, x1 - x0, y1 - y0);
      x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = 1 * dpr; x.beginPath();
      for (let i = 1; i < 3; i++) { x.moveTo(x0 + (x1 - x0) * i / 3, y0); x.lineTo(x0 + (x1 - x0) * i / 3, y1); x.moveTo(x0, y0 + (y1 - y0) * i / 3); x.lineTo(x1, y0 + (y1 - y0) * i / 3); } x.stroke();
      x.strokeStyle = '#fff'; x.lineWidth = 4 * dpr; const L = 20 * dpr;
      for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) { x.beginPath(); x.moveTo(cx + sx * L, cy); x.lineTo(cx, cy); x.lineTo(cx, cy + sy * L); x.stroke(); }
      for (const [cx, cy, hz] of [[(x0 + x1) / 2, y0, 1], [(x0 + x1) / 2, y1, 1], [x0, (y0 + y1) / 2, 0], [x1, (y0 + y1) / 2, 0]]) { x.beginPath(); if (hz) { x.moveTo(cx - L / 2, cy); x.lineTo(cx + L / 2, cy); } else { x.moveTo(cx, cy - L / 2); x.lineTo(cx, cy + L / 2); } x.stroke(); }
      return;
    }
    if (this.cmp === 'split') { const sx = this.split * ov.width; x.strokeStyle = '#fff'; x.lineWidth = 2 * dpr; x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx, ov.height); x.stroke(); dot([sx, ov.height / 2], this.splitArmed ? 17 : 11); const pill = (t, right) => { x.font = `800 ${13 * dpr}px sans-serif`; const w = x.measureText(t).width + 18 * dpr, hh = 24 * dpr, y = ov.height - hh - 12 * dpr; const px = right ? sx + 10 * dpr : sx - 10 * dpr - w;
        x.fillStyle = 'rgba(20,14,8,.72)'; x.beginPath(); x.roundRect ? x.roundRect(px, y, w, hh, hh / 2) : x.rect(px, y, w, hh); x.fill(); x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(t, px + 9 * dpr, y + hh / 2 + 1); x.textBaseline = 'alphabetic'; };
      pill('原圖', false); pill('編輯後', true); }
    if (this.tool === 'mask') {
      const m = this.edit.masks.find((q) => q.id === this.selMask);
      if (m && m.type === 'linear') {
        const [a, b2, mm] = this.maskHandles(m).map((q) => q.p); const dx = b2[0] - a[0], dy = b2[1] - a[1]; const len = Math.hypot(dx, dy) || 1; const nx = -dy / len * 3000, ny = dx / len * 3000;
        x.lineWidth = 1.5 * dpr; x.strokeStyle = 'rgba(255,255,255,.9)';
        for (const p of [a, b2]) { x.beginPath(); x.moveTo(p[0] - nx, p[1] - ny); x.lineTo(p[0] + nx, p[1] + ny); x.stroke(); }
        x.setLineDash([6 * dpr, 5 * dpr]); x.beginPath(); x.moveTo(mm[0] - nx, mm[1] - ny); x.lineTo(mm[0] + nx, mm[1] + ny); x.stroke(); x.setLineDash([]);
        dot(a); dot(b2, 7, ac); dot(mm, 6);
      } else if (m && m.type === 'radial') {
        const hs = this.maskHandles(m); const P = hs[4].P; x.lineWidth = 1.8 * dpr; x.strokeStyle = 'rgba(255,255,255,.95)';
        for (const k of [1, 1 - (m.p.feather || 0) / 100]) { x.beginPath(); for (let i = 0; i <= 64; i++) { const t = i / 64 * Math.PI * 2; const q = P(Math.cos(t) * m.p.rx * k, Math.sin(t) * m.p.ry * k); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); } if (k < 1) x.setLineDash([5 * dpr, 4 * dpr]); x.stroke(); x.setLineDash([]); }
        dot(hs[0].p); dot(hs[1].p, 6); dot(hs[2].p, 6); dot(hs[3].p, 6, ac);
      }
      if (this.brushActive() && this.hover) { const r = this.brush.size * Math.max(this.ses.SW, this.ses.SH) * this.view.scale; x.lineWidth = 1.5 * dpr; x.strokeStyle = '#fff'; x.beginPath(); x.arc(this.hover[0], this.hover[1], r, 0, 7); x.stroke(); x.strokeStyle = 'rgba(0,0,0,.5)'; x.beginPath(); x.arc(this.hover[0], this.hover[1], r * (1 - this.brush.feather), 0, 7); x.stroke(); }
    }
    if (this.tool === 'heal') {
      const L = Math.max(this.ses.SW, this.ses.SH);
      this.edit.heal.forEach((sp, i) => {
        const c = this.srcToScr([sp.x, sp.y]), e = this.srcToScr([sp.x + sp.r * L / this.ses.SW, sp.y]); const r = Math.hypot(e[0] - c[0], e[1] - c[1]); const sc = this.srcToScr([sp.sx, sp.sy]);
        const on = i === this.selSpot; x.lineWidth = (on ? 2.5 : 1.5) * dpr;
        x.strokeStyle = on ? '#fff' : 'rgba(255,255,255,.7)'; x.beginPath(); x.arc(c[0], c[1], r, 0, 7); x.stroke();
        if (on) { x.setLineDash([5 * dpr, 4 * dpr]); x.beginPath(); x.arc(sc[0], sc[1], r, 0, 7); x.stroke(); x.beginPath(); const dd = Math.hypot(sc[0] - c[0], sc[1] - c[1]) || 1; x.moveTo(c[0] + (sc[0] - c[0]) / dd * r, c[1] + (sc[1] - c[1]) / dd * r); x.lineTo(sc[0] - (sc[0] - c[0]) / dd * r, sc[1] - (sc[1] - c[1]) / dd * r); x.stroke(); x.setLineDash([]); }
      });
    }
    if (this.picking) { x.fillStyle = 'rgba(0,0,0,.45)'; x.font = `bold ${13 * dpr}px sans-serif`; x.fillText(this.picking === 'wb' ? '💧 點選中性灰' : '💧 點選顏色', 12 * dpr, ov.height - 14 * dpr); }
  },

  /* ---------- 選單 ---------- */
  showName() { const r = this.rec; $('#edName').textContent = r.outName ? Exporter.nameFor(r, Exporter.fmtFor(r)) : r.name; },
  rename() { if (!this.rec) return; UI.rename([this.rec], () => { const lr = Library.recs.find((x) => x.id === this.rec.id); if (lr) lr.outName = this.rec.outName; this.showName(); this.applyHud(); }); },
  menu() {
    UI.menu('更多', [
      { icon: '✏️', label: '自訂檔名', fn: () => this.rename() },
      { icon: '📋', label: '複製設定', fn: () => this.copySettings() },
      { icon: '📥', label: '貼上設定', fn: () => { if (!App.clip) { toast('尚未複製設定'); return; } this.edit = normEdit(deepMerge(this.edit, App.clip)); this.changed(); this.commit('貼上設定'); this.ensureAi(); this.renderPanel(); toast('已貼上設定'); } },
      { icon: 'ℹ️', label: '相片資訊（EXIF）', fn: () => this.info() },
      { icon: '📊', label: (CFG.hud || 'histo') === 'off' ? '顯示直方圖' : '隱藏直方圖／資訊', fn: () => { CFG.hud = (CFG.hud || 'histo') === 'off' ? 'histo' : 'off'; saveCfg(); this.applyHud(); } },
      { icon: '⟲', label: '重設所有調整', danger: true, fn: () => { this.edit = normEdit({}); this.ses.setAiPreview(null, ''); this.changed(); this.commit('重設全部'); this.renderPanel(); } },
    ]);
  },
  copySettings() {
    const ck = {}; const grid = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } });
    for (const g of Object.keys(COPY_GROUPS)) { const i = h('input', { type: 'checkbox' }); i.checked = !['裁切', '遮色片', '修復', '位置（GPS）'].includes(g); ck[g] = i; grid.append(h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, i, g)); }
    UI.sheet('複製設定', h('div', null, grid, h('div', { class: 'acts' }, h('button', { class: 'btn pri', onclick: () => { App.clip = pickGroups(this.edit, Object.keys(ck).filter((g) => ck[g].checked)); UI.close(); toast('已複製，可在其他相片「貼上設定」'); } }, '複製'))));
  },
  info() {
    const r = this.rec, x = r.exif || {};
    const fmt = (v, f) => (v == null || v === '' ? null : f ? f(v) : v);
    const rows = [['檔名', r.name], ['尺寸', `${r.w} × ${r.h}（${(r.w * r.h / 1e6).toFixed(1)} MP）`], ['大小', fmtBytes(r.size || 0)], ['格式', r.convFrom ? `${r.convFrom.toUpperCase()}（已轉為 JPEG 編輯）` : r.mime],
      ['相機', fmt([x.make, x.model].filter(Boolean).join(' '))], ['鏡頭', fmt(x.lens)], ['快門', fmt(x.exposure, (v) => (v < 1 ? '1/' + Math.round(1 / v) : v) + ' 秒')], ['光圈', fmt(x.fnumber, (v) => 'f/' + (+v).toFixed(1))],
      ['ISO', fmt(x.iso)], ['焦距', fmt(x.focal, (v) => Math.round(v) + ' mm' + (x.focal35 ? `（等效 ${x.focal35} mm）` : ''))], ['曝光補償', fmt(x.bias, (v) => (+v).toFixed(1) + ' EV')],
      ['拍攝時間', fmt(x.dateOrig || x.date)], ['GPS', x.lat != null ? `${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}` : null], ['軟體', fmt(x.software)]].filter((q) => q[1]);
    const stars = h('span', { class: 'stars' }); const drawS = () => { stars.innerHTML = ''; for (let i = 1; i <= 5; i++) stars.append(h('span', { class: i <= (r.rating || 0) ? 'on' : '', onclick: async () => { r.rating = r.rating === i ? 0 : i; await this.persist(); drawS(); } }, '★')); }; drawS();
    UI.sheet('相片資訊', h('div', null, h('div', { class: 'kv2' }, rows.flatMap(([k, v]) => [h('b', null, k), h('span', { style: { userSelect: 'text' } }, String(v))]), h('b', null, '評分'), stars),
      h('div', { class: 'note' }, '匯出時這些 EXIF 資訊會完整保留（可在設定中選擇移除 GPS）。')));
  },
  exportSheet() {
    const srRow = (redraw) => Exporter.srRow(redraw);
    const rec = this.rec; const fmt = Exporter.fmtFor(rec); const name = Exporter.nameFor(rec, fmt); const e = effective(this.edit); const G = Engine.geometry(e, this.ses.SW, this.ses.SH);
    const box = h('div');
    const draw = () => {
      const f = Exporter.fmtFor(rec), n = Exporter.nameFor(rec, f); box.innerHTML = '';
      box.append(...[h('div', { class: 'kv2' }, h('b', null, '檔名'), h('span', null, n), h('b', null, '尺寸'), h('span', null, CFG.exp.size === 'orig' ? `${G.OW} × ${G.OH}（原始解析度）` : `長邊 ${CFG.exp.long}px`), h('b', null, 'EXIF'), h('span', null, { all: '完整保留', nogps: '保留（移除位置）', none: '移除' }[CFG.exp.meta])),
        h('div', { class: 'lbl2' }, h('span', null, '格式'), this.seg([['orig', '原始格式'], ['jpeg', 'JPEG'], ['png', 'PNG']], CFG.exp.fmt, (k) => { CFG.exp.fmt = k; saveCfg(); draw(); })),
        f === 'jpeg' || f === 'webp' ? h('div', { class: 'lbl2' }, h('span', null, '品質'), this.seg([['100', '100（原始畫質）'], ['95', '95'], ['90', '90']], String(CFG.exp.q), (k) => { CFG.exp.q = +k; saveCfg(); draw(); })) : null,
        h('div', { class: 'lbl2' }, h('span', null, '尺寸'), this.seg([['orig', '原始'], ['long', '縮小']], CFG.exp.size, (k) => { CFG.exp.size = k; saveCfg(); draw(); })),
        h('div', { class: 'lbl2' }, h('span', null, '中繼資料'), this.seg([['all', '全部'], ['nogps', '去位置'], ['none', '不含']], CFG.exp.meta, (k) => { CFG.exp.meta = k; saveCfg(); draw(); })),
        e.ai.on ? h('div', { class: 'note' }, '已開啟 AI 降噪：匯出時會以原始解析度重新計算，大尺寸相片需要較長時間。') : null,
        h('div', { class: 'lbl2' }, h('span', null, '輸出銳化', h('div', { class: 'sub' }, '補回清晰度（與 Lightroom 匯出銳化相同）')), this.seg([['off', '關'], ['std', '標準'], ['high', '高']], CFG.exp.osharp || 'std', (k) => { CFG.exp.osharp = k; saveCfg(); draw(); })),
        srRow(() => draw()),
        CFG.exp.sr ? h('div', { class: 'note' }, `輸出約 ${Math.round(G.OW * CFG.exp.sr)} × ${Math.round(G.OH * CFG.exp.sr)}（${(G.OW * G.OH * CFG.exp.sr * CFG.exp.sr / 1e6).toFixed(0)} MP），JPEG 品質 95、4:4:4，EXIF 完整保留。`) : null,
        h('div', { class: 'acts' }, h('button', { class: 'btn pri', onclick: async () => { UI.close(); await this.persist(); const sr = CFG.exp.sr && Cloud.ready() && Exporter.fmtFor(rec) === 'jpeg'; Exporter.run([rec], () => this.edit, sr ? { sr: true, srScale: CFG.exp.sr } : {}); } }, CFG.exp.sr ? (CFG.exp.sr > 1 ? '匯出並送雲端增強放大' : '匯出並送雲端畫質增強') : '開始匯出'))].filter(Boolean));
    };
    void name; void fmt; draw(); UI.sheet('匯出', box);
  }
};
