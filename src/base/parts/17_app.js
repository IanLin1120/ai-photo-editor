/* ================= 對話框 ================= */
const UI = {
  sheet(title, content) {
    const s = $('#sheet'); s.innerHTML = ''; s.append(h('h3', null, title), content);
    $('#sheetBg').classList.add('on'); requestAnimationFrame(() => s.classList.add('on')); this.open = true;
  },
  close() { $('#sheet').classList.remove('on', 'tall'); $('#sheetBg').classList.remove('on'); this.open = false; },
  menu(title, items) {
    this.sheet(title, h('div', null, items.map((it) => h('div', { class: 'mrow', style: it.danger ? { color: 'var(--warn)' } : null, onclick: () => { this.close(); setTimeout(it.fn, 120); } }, h('i', null, it.icon || ''), it.label))));
  },
  /* 自訂檔名（含 X 清除鈕）；多張時自動加上流水號 */
  rename(recs, onDone) {
    if (!recs.length) return; const one = recs.length === 1; const r0 = recs[0];
    const ext = (rec) => { const f = Exporter.fmtFor(rec); return f === 'jpeg' ? ((/\.(jpe?g)$/i.exec(rec.name || '') || [, 'jpg'])[1]) : f; };
    const orig = (rec) => (rec.name || '').replace(/\.[^.]+$/, '');
    const inp = h('input', { type: 'text', value: one ? (r0.outName || orig(r0)) : (r0.outName || '').replace(/-\d+$/, ''), placeholder: one ? orig(r0) : '例如：日月潭之旅', enterkeyhint: 'done', autocomplete: 'off' });
    const x = h('button', { class: 'clr-x', type: 'button', 'aria-label': '清除', onclick: () => { inp.value = ''; inp.focus(); upd(); } }, '✕');
    const prev = h('div', { class: 'sub' });
    const clean = (v) => v.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+$/, '').replace(/^\s+/, '').slice(0, 120);
    const names = () => { const v = clean(inp.value); return recs.map((r, i) => (v ? (one ? v : `${v}-${String(i + 1).padStart(recs.length >= 100 ? 3 : 2, '0')}`) : orig(r)) + '.' + ext(r)); };
    const upd = () => { x.style.visibility = inp.value ? 'visible' : 'hidden'; const n = names(); prev.textContent = '匯出檔名：' + (one ? n[0] : `${n[0]}、${n[1] || ''}${n.length > 2 ? '…' : ''}（共 ${n.length} 張）`); };
    inp.oninput = upd;
    const save = async () => {
      const v = clean(inp.value);
      for (let i = 0; i < recs.length; i++) { const r = recs[i]; if (v) r.outName = one ? v : `${v}-${String(i + 1).padStart(recs.length >= 100 ? 3 : 2, '0')}`; else delete r.outName; const d = await DB.get('photos', r.id); if (d) { if (v) d.outName = r.outName; else delete d.outName; await DB.put('photos', d); } }
      this.close(); toast(v ? '已設定檔名' : '已改回原檔名'); onDone && onDone();
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') save(); };
    this.sheet(one ? '自訂檔名' : `自訂檔名（${recs.length} 張）`, h('div', null,
      h('div', { class: 'clr-wrap' }, inp, x), prev,
      h('div', { class: 'note' }, one ? '副檔名會自動加上；清空則使用原檔名。' : '會依序加上流水號（-01、-02…）；清空則使用各自的原檔名。'),
      h('div', { class: 'acts', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => this.close() }, '取消'), h('button', { class: 'btn pri', onclick: save }, '儲存'))));
    upd(); setTimeout(() => { inp.focus(); inp.select(); }, 280);
  },
  confirm(msg, ok = '確定', danger) {
    return new Promise((res) => { this.sheet('確認', h('div', null, h('div', null, msg), h('div', { class: 'acts', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => { this.close(); res(false); } }, '取消'), h('button', { class: 'btn ' + (danger ? 'dang' : 'pri'), onclick: () => { this.close(); res(true); } }, ok)))); });
  }
};

/* ================= 圖庫 ================= */
const Library = {
  recs: [], filter: 'all', sel: new Set(), selecting: false, urls: [],
  async init() {
    $('#libAdd').onclick = () => this.pick(); $('#emptyAdd').onclick = () => this.pick();
    $('#fileIn').onchange = (e) => { const fs = [...e.target.files]; e.target.value = ''; this.importFiles(fs.map((f) => ({ blob: f, name: f.name, mime: f.type }))); };
    $('#libSelect').onclick = () => this.setSelecting(!this.selecting);
    $('#libTheme').onclick = () => { const cur = document.documentElement.dataset.theme; CFG.theme = cur === 'dark' ? 'light' : 'dark'; saveCfg(); applyLook(); };
    $('#libSort').value = CFG.sort || 'added'; $('#libSort').onchange = () => { CFG.sort = $('#libSort').value; CFG.sortRev = false; saveCfg(); this.render(); };
    $('#libDir').onclick = () => { CFG.sortRev = !CFG.sortRev; saveCfg(); this.render(); };
    $('#libView').onclick = () => { CFG.libView = CFG.libView === 'list' ? 'grid' : 'list'; saveCfg(); this.render(); };
    // 拖放匯入（桌面）
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => { e.preventDefault(); const fs = [...(e.dataTransfer.files || [])].filter((f) => /image|heic|dng/i.test(f.type + f.name)); if (fs.length) this.importFiles(fs.map((f) => ({ blob: f, name: f.name, mime: f.type }))); });
    await this.refresh();
    this.fixOrientation();
    // v1.12：RAW 改用 16-bit 新處理方式，舊版建立的 RAW 預覽與全解析度暫存重新產生（原始 RAW 與修圖設定不變）
    try { for (const r of this.recs) if (r.hasRaw && r.rawV !== 2 && !r.prevEmb) { r.prevEmb = true; await DB.put('photos', r); await DB.del('files', r.id).catch(() => {}); } } catch (e) { console.warn('raw migrate', e); }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.dirty) { this.dirty = false; this.render(); } });
    setTimeout(() => { this.resumePending(); this.developAll(); }, 1500);
  },
  /* 舊版匯入的直拍相片：依 EXIF 重新轉正預覽與尺寸 */
  async fixOrientation() {
    const bad = this.recs.filter((r) => !r.oriV && !r.convFrom && r.exif && r.exif.orientation >= 2);
    for (const r of bad) {
      try {
        const blob = await DB.get('files', r.id); if (!blob) continue;
        const bm = await decodeOriented(blob, r.exif.orientation); const W = bm.width, H = bm.height;
        if (W !== r.w || H !== r.h) {
          const mk = async (long, q) => { const s = Math.min(1, long / Math.max(W, H)); const c = mkCanvas(W * s, H * s); c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height); return canvasBlob(c, 'image/jpeg', q); };
          await DB.put('prev', await mk(CFG.prevLong, .95), r.id); await DB.put('thumbs', await mk(480, .85), r.id); await DB.del('thumbs', 'e:' + r.id).catch(() => {});
          r.w = W; r.h = H; r.edited = r.edited && !isDefault(normEdit(r.edit));
        }
        if (bm.close) bm.close(); r.oriV = 1; await DB.put('photos', r);
      } catch (e) { console.warn('fixOrientation', e); }
    }
    if (bad.length) { toast(`已將 ${bad.length} 張直拍相片轉正`); this.render(); }
  },
  async refresh() { this.recs = await DB.all('photos'); this.render(); },
  pick() { if (isApp && window.AIP && AIP.mediaList) { Gallery.open(); return; } if (isApp && NAT.call('pick') !== null) return; $('#fileIn').click(); },
  projRecs() {
    let r = this.recs.slice();
    { const cur = CFG.curProj || 'all', known = new Set((CFG.projects || []).map((p) => p.id));
      if (cur === 'none') r = r.filter((x) => !x.project || !known.has(x.project)); else if (cur !== 'all' && known.has(cur)) r = r.filter((x) => x.project === cur); }
    return r;
  },
  filtered() {
    let r = this.projRecs();
    if (this.filter === 'edited') r = r.filter((x) => x.edited); else if (this.filter === 'pick') r = r.filter((x) => x.flag === 1); else if (this.filter === 'star') r = r.filter((x) => (x.rating || 0) >= 3);
    // 排序：拍攝時間（新→舊，沒有拍攝時間的排最後）、檔名（自然排序 A→Z，IMG_2 在 IMG_10 前）、匯入時間（新→舊）；可反轉
    const k = CFG.sort || 'added', rev = CFG.sortRev ? -1 : 1, coll = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
    const byName = (a, b) => coll.compare(a.name || '', b.name || '');
    const cmp = k === 'name' ? (a, b) => byName(a, b) || (a.added || 0) - (b.added || 0)
      : k === 'taken' ? (a, b) => { const ta = this.takenKey(a), tb = this.takenKey(b);
        if (!ta !== !tb) return ta ? -1 : 1;   // 有拍攝時間的永遠在前（反轉時也一樣）
        return (ta && tb ? tb.localeCompare(ta) * rev : 0) || byName(a, b); }
      : (a, b) => (b.added || 0) - (a.added || 0) || byName(a, b);
    r.sort(k === 'taken' ? cmp : (a, b) => cmp(a, b) * rev);
    return r;
  },
  /* 拍攝時間鍵：EXIF DateTimeOriginal → DateTime，統一成「YYYY-MM-DD HH:MM:SS」以便比較 */
  takenKey(r) {
    const e = r.exif || {}; const s = String(e.dateOrig || e.date || '').replace(/\0/g, '').trim();
    const m = /^(\d{4})[:\-\/](\d{1,2})[:\-\/](\d{1,2})[ T]?(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?/.exec(s); if (!m || m[1] === '0000') return '';
    const p = (v) => String(+(v || 0)).padStart(2, '0'); return `${m[1]}-${p(m[2])}-${p(m[3])} ${p(m[4])}:${p(m[5])}:${p(m[6])}`;
  },
  takenText(r) { const t = this.takenKey(r); return t ? t.slice(0, 16).replace(/-/g, '/') : ''; },
  render() {
    try { this.projBar(); } catch (e) { console.warn('projBar', e); }
    const f = $('#libFilter'); f.innerHTML = '';
    const PR = this.projRecs(), cnt = { all: PR.length, edited: PR.filter((x) => x.edited).length, pick: PR.filter((x) => x.flag === 1).length, star: PR.filter((x) => (x.rating || 0) >= 3).length };
    for (const [k, n] of [['all', '全部'], ['edited', '已編輯'], ['pick', '精選'], ['star', '★3+']]) f.append(h('button', { class: 'btn' + (this.filter === k ? ' on' : ''), onclick: () => { this.filter = k; this.render(); } }, `${n} ${cnt[k]}`));
    for (const u of this.urls) URL.revokeObjectURL(u); this.urls = [];
    const g = $('#grid'); g.innerHTML = ''; g.classList.toggle('selecting', this.selecting);
    const isList = CFG.libView === 'list'; g.classList.toggle('list', isList);
    $('#libView').textContent = isList ? '▦' : '☰'; $('#libView').title = isList ? '切換為格狀' : '切換為清單';
    { const k = CFG.sort || 'added', asc = (k === 'name') !== !!CFG.sortRev; $('#libDir').textContent = asc ? '↑' : '↓';
      $('#libDir').title = k === 'name' ? (asc ? '目前 A→Z，點擊改為 Z→A' : '目前 Z→A，點擊改為 A→Z') : (asc ? '目前 舊→新，點擊改為 新→舊' : '目前 新→舊，點擊改為 舊→新'); }
    { const cb = $('#cloudBanner'); cb.innerHTML = ''; const bn = Cloud.banner(); if (bn) cb.append(bn); }
    const list = this.filtered();
    $('#empty').classList.toggle('hide', this.recs.length > 0);
    $('#empty').classList.toggle('hide', this.recs.length > 0 || this.queue.length > 0);
    this.queue.forEach((it, k) => { it.el = h('div', { class: 'tile qtile' }, h('div', { class: 'qin' }, h('span', { class: 'spin' + (k ? ' idle' : '') }), h('b', null, it.name), h('span', { class: 'qst' }, it.st))); g.append(it.el); });
    for (const r of list) {
      const img = h('img', { alt: r.name, loading: 'lazy' });
      const bd = h('div', { class: 'bd' }, r.edited ? h('span', { class: 'ed' }, '已編輯') : null, r.edit && r.edit.ai && r.edit.ai.on ? h('span', null, 'AI') : null, r.rating ? h('span', null, '★' + r.rating) : null, r.edit && r.edit.loc ? h('span', null, '📍') : null, r.outName ? h('span', null, '✏') : null, r.fixed && r.fixed.length ? h('span', { title: 'AI 修復' }, '🪄') : null, Cloud.badge(r));
      const fl = r.flag === 1 ? h('span', { class: 'fl' }, '🏳') : r.flag === -1 ? h('span', { class: 'fl' }, '✕') : null;
      const e = r.exif || {}; const cam = [e.model, e.fnumber ? 'f/' + (+e.fnumber).toFixed(1).replace(/\.0$/, '') : '', e.exposure ? (e.exposure < 1 ? '1/' + Math.round(1 / e.exposure) : e.exposure + '') + 's' : '', e.iso ? 'ISO ' + e.iso : ''].filter(Boolean).join('・');
      const t = isList
        ? h('div', { class: 'tile row' + (this.sel.has(r.id) ? ' sel' : '') }, h('div', { class: 'ph' }, img, fl, h('div', { class: 'ck' }, '✓')),
          h('div', { class: 'info' }, h('div', { class: 'nm' }, r.name), r.outName ? h('div', { class: 'mt' }, '匯出名稱：' + r.outName) : null,
            h('div', { class: 'mt' }, [this.takenText(r) ? '📷 ' + this.takenText(r) : '📷 無拍攝時間', r.w && r.h ? `${r.w}×${r.h}` : '', r.convFrom ? r.convFrom.toUpperCase() : '', r.size ? fmtBytes(r.size) : ''].filter(Boolean).join('・')),
            cam ? h('div', { class: 'mt' }, cam) : null, bd))
        : h('div', { class: 'tile' + (this.sel.has(r.id) ? ' sel' : '') }, h('div', { class: 'ph' }, img, bd, fl, h('div', { class: 'ck' }, '✓')), h('div', { class: 'nm', title: r.name }, r.name));
      this.loadThumb(r, img);
      let pressT = 0, long = false;
      t.addEventListener('pointerdown', () => { long = false; pressT = setTimeout(() => { long = true; if (!this.selecting) this.setSelecting(true); this.toggleSel(r.id); }, 480); });
      const cancel = () => clearTimeout(pressT);
      t.addEventListener('pointerup', cancel); t.addEventListener('pointerleave', cancel); t.addEventListener('pointercancel', cancel);
      t.addEventListener('click', () => { if (long) return; if (this.selecting) this.toggleSel(r.id); else Editor.open(r); });
      g.append(t);
    }
    this.renderSelBar();
  },
  async loadThumb(r, img) {
    const b = (r.edited && (await DB.get('thumbs', 'e:' + r.id))) || (await DB.get('thumbs', r.id));
    if (b) { const u = URL.createObjectURL(b); this.urls.push(u); img.src = u; }
  },
  setSelecting(v) { this.selecting = v; if (!v) this.sel.clear(); $('#libSelect').classList.toggle('on', v); $('#libAdd').classList.toggle('hide', v); this.render(); },
  toggleSel(id) { this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id); this.render(); },
  renderSelBar() {
    const b = $('#selBar'); b.classList.toggle('hide', !this.selecting); if (!this.selecting) return; b.innerHTML = '';
    const n = this.sel.size; const recs = () => this.recs.filter((r) => this.sel.has(r.id));
    const B = (t, fn, dis) => h('button', { class: 'btn sm', disabled: dis, onclick: fn }, t);
    b.append(h('b', { style: { alignSelf: 'center', padding: '0 6px', whiteSpace: 'nowrap' } }, `已選 ${n}`),
      B('全選', () => { this.filtered().forEach((r) => this.sel.add(r.id)); this.render(); }),
      B('⬆ 匯出', () => this.exportSheet(recs()), !n),
      B('複製設定', () => { const r = recs()[0]; if (!r) return; App.clip = pickGroups(normEdit(r.edit), Object.keys(COPY_GROUPS).filter((g) => !['裁切', '遮色片', '修復', '位置（GPS）'].includes(g))); toast('已複製第一張的設定'); }, n !== 1),
      B('貼上設定', async () => { if (!App.clip) { toast('請先複製設定'); return; } for (const r of recs()) { r.edit = deepMerge(normEdit(r.edit), App.clip); r.edited = !isDefault(r.edit); await DB.put('photos', r); await this.rerenderThumb(r); } toast(`已套用到 ${n} 張`); this.render(); }, !n),
      B('☁ 雲端降噪', () => Cloud.enqueue(recs()), !n),
      B('🪄 AI 修復', () => this.fixSheet(recs()), !n),
      B('✏️ 命名', () => UI.rename(recs(), () => this.render()), !n),
      B('📍 位置', () => this.batchLoc(recs()), !n),
      B('★ 評分', () => UI.menu('評分', [0, 1, 2, 3, 4, 5].map((k) => ({ label: k ? '★'.repeat(k) : '無評分', fn: async () => { for (const r of recs()) { r.rating = k; await DB.put('photos', r); } this.render(); } }))), !n),
      B('🏳 旗標', () => UI.menu('旗標', [[1, '🏳 精選'], [-1, '✕ 排除'], [0, '無旗標']].map(([k, l]) => ({ label: l, fn: async () => { for (const r of recs()) { r.flag = k; await DB.put('photos', r); } this.render(); } }))), !n),
      B('🗑 移除', async () => { if (!(await UI.confirm(`從 App 圖庫移除 ${n} 張相片？（不會刪除手機相簿中的原始檔）`, '移除', true))) return; for (const r of recs()) await this.remove(r.id); this.sel.clear(); await this.refresh(); }, !n),
      B('完成', () => this.setSelecting(false)));
  },
  /* 多張 AI 修復（AI 消除需逐張塗抹，請在編輯器中使用） */
  fixSheet(list) {
    const sel = { rescue: false, deblur: false, dereflect: false, relight: false, beauty: false, enhance: false }; const box = h('div');
    const draw = () => { box.innerHTML = '';
      box.append(h('div', { class: 'sub' }, `已選 ${list.length} 張。勾選要套用的雲端 AI 功能（AI 消除需要逐張塗抹，請在編輯器的「AI 修復」使用）：`),
        ...[['rescue', '🛟 AI 救援廢片（霧霾／逆光／光比）'], ['deblur', '📷 AI 消除拖影'], ['dereflect', '🪟 AI 消除反光'], ['relight', '💡 AI 人像補光'], ['beauty', '🌸 AI 人像美顏'], ['enhance', '✨ AI 畫質增強']].map(([k, n]) => { const i = h('input', { type: 'checkbox' }); i.checked = sel[k]; i.onchange = () => { sel[k] = i.checked; draw(); }; return h('label', { class: 'lab' }, h('span', null, n), h('span', { class: 'sw' }, i, h('span'))); }),
        h('div', { class: 'acts', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => UI.close() }, '取消'),
          h('button', { class: 'btn pri', disabled: !Object.values(sel).some(Boolean), onclick: () => { UI.close(); Cloud.enqueueFix(list, Object.keys(sel).filter((k) => sel[k]), { deblur: { type: 'motion', amt: 1 }, dereflect: { amt: 0.6 }, enhance: { amt: 0.8 }, relight: { amt: 0.6 }, beauty: { amt: 0.5 }, rescue: { amt: 0.8, mode: 'auto' } }); } }, '☁ 送雲端處理'))); };
    draw(); UI.sheet('AI 修復（雲端）', box);
  },
  /* 多張匯出（可選 AI 畫質增強） */
  exportSheet(list) {
    const box = h('div');
    const draw = () => {
      box.innerHTML = ''; const sr = CFG.exp.sr && Cloud.ready();
      const mp = list.reduce((a, r) => a + (r.w || 0) * (r.h || 0), 0) / 1e6;
      box.append(...[h('div', { class: 'kv2' }, h('b', null, '張數'), h('span', null, `${list.length} 張`), h('b', null, '檔名'), h('span', null, '沿用原始檔名（或自訂檔名）'), h('b', null, 'EXIF'), h('span', null, { all: '完整保留（含拍攝時間、自訂定位）', nogps: '保留（移除位置）', none: '移除' }[CFG.exp.meta])),
        h('div', { class: 'lbl2' }, h('span', null, '品質'), h('div', { class: 'seg' }, [['100', '100'], ['95', '95'], ['90', '90']].map(([k, n]) => h('button', { class: 'btn' + (String(CFG.exp.q) === k ? ' on' : ''), onclick: () => { CFG.exp.q = +k; saveCfg(); draw(); } }, n)))),
        Exporter.srRow(draw),
        sr ? h('div', { class: 'note' }, `共約 ${(mp * CFG.exp.sr * CFG.exp.sr).toFixed(0)} MP；手機先依序算好成品，再送到雲端做 AI 畫質增強，完成後逐張存到相簿（原檔名、完整 EXIF）。`) : null,
        h('div', { class: 'acts', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: () => UI.close() }, '取消'),
          h('button', { class: 'btn pri', onclick: () => { UI.close(); Exporter.run(list, (r) => r.edit || {}, sr ? { sr: true, srScale: CFG.exp.sr } : {}); } }, sr ? `匯出 ${list.length} 張並送雲端增強` : `匯出 ${list.length} 張`))].filter(Boolean));
    };
    draw(); UI.sheet('匯出相片', box);
  },
  batchLoc(list) {
    let v = null; const first = list.find((r) => r.edit && r.edit.loc) || list.find((r) => r.exif && r.exif.lat != null);
    const init = first ? (first.edit && first.edit.loc) || { lat: first.exif.lat, lon: first.exif.lon } : null;
    const pk = LocationPicker(init, { mapH: '240px', onChange: (x) => { v = x; } });
    UI.sheet(`設定拍攝地點（${list.length} 張）`, h('div', null, pk.el, h('div', { class: 'acts' },
      h('button', { class: 'btn pri', onclick: async () => { const loc = v || pk.value(); if (!loc) { toast('請先選擇位置'); return; } for (const r of list) { r.edit = normEdit(r.edit); r.edit.loc = loc; await DB.put('photos', r); } UI.close(); toast(`已為 ${list.length} 張相片設定位置，匯出時寫入 GPS`); this.render(); } }, '套用到選取的相片'),
      h('button', { class: 'btn', onclick: async () => { for (const r of list) { if (r.edit) { r.edit.loc = null; await DB.put('photos', r); } } UI.close(); toast('已清除自訂位置'); this.render(); } }, '清除自訂位置'))));
    setTimeout(() => pk.mount(), 320);
  },
  async rerenderThumb(r) {
    try { const s = new Session(r); await s.load(); const c = s.renderThumb(effective(normEdit(r.edit)), 480); const b = await canvasBlob(c, 'image/jpeg', .86); await DB.put('thumbs', b, 'e:' + r.id); s.dispose(); } catch (e) { console.warn(e); }
  },
  async remove(id) { for (const s of ['photos', 'files', 'thumbs', 'prev', 'raw']) await DB.del(s, id).catch(() => {}); await DB.del('thumbs', 'e:' + id).catch(() => {}); for (const k of ['fast', 'hq']) { DB.del('ai', `full:${id}:${k}`).catch(() => {}); for (const L of [1024, 1536, 2048, 2560, 3072]) DB.del('ai', `${id}:${k}:${L}`).catch(() => {}); } DB.del('ai', 'cloud:' + id).catch(() => {}); for (const s of ['files', 'prev', 'thumbs']) DB.del(s, id + ':orig').catch(() => {}); },
  queue: [], qRunning: false, qDone: 0, qTotal: 0,
  /* 匯入佇列：背景逐張處理，圖庫可繼續操作 */
  /* v1.21：專案 — 每次匯入建立一個專案（以資料夾名稱命名，可改名）；同一批分次送進來的（15 秒內）算同一個專案 */
  projFor() {
    const now = Date.now(); if (this.lastProj && now - this.lastProjAt < 15000) { this.lastProjAt = now; return this.lastProj; }
    const d = new Date(), p2 = (v) => String(v).padStart(2, '0');
    let name = (this.nextProj && now - this.nextProj.at < 600000 && this.nextProj.name) || `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} 匯入`;
    this.nextProj = null; const L = CFG.projects = CFG.projects || [];
    if (L.some((x) => x.name === name)) { let k = 2; while (L.some((x) => x.name === `${name} (${k})`)) k++; name = `${name} (${k})`; }
    const pj = { id: 'p' + uid(), name, created: now }; L.push(pj); CFG.curProj = pj.id; saveCfg();
    this.lastProj = pj.id; this.lastProjAt = now; return pj.id;
  },
  projName(id) { const p = (CFG.projects || []).find((x) => x.id === id); return p ? p.name : ''; },
  projRename(id) {
    const p = (CFG.projects || []).find((x) => x.id === id); if (!p) return;
    const inp = h('input', { type: 'text', value: p.name, style: { width: '100%', padding: '10px', fontSize: '16px', borderRadius: '10px' } });
    const n = this.recs.filter((r) => r.project === id).length;
    UI.sheet('專案名稱', h('div', null, inp, h('div', { class: 'sub', style: { margin: '8px 2px' } }, `建立於 ${new Date(p.created).toLocaleString('zh-TW')}，共 ${n} 張相片`),
      h('div', { class: 'acts' },
        h('button', { class: 'btn', onclick: async () => { if (!(await UI.confirm(`移除專案「${p.name}」？相片不會刪除，會移到「未分類」。`, '移除專案', true))) return; CFG.projects = CFG.projects.filter((x) => x !== p); if (CFG.curProj === id) CFG.curProj = 'all'; saveCfg(); for (const r of this.recs.filter((r) => r.project === id)) { r.project = null; await DB.put('photos', r); } UI.close(); this.render(); } }, '移除專案'),
        h('button', { class: 'btn pri', onclick: () => { const v = inp.value.trim(); if (!v) { toast('請輸入名稱'); return; } p.name = v; saveCfg(); UI.close(); this.render(); toast('已改名為「' + v + '」'); } }, '儲存'))));
    setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) {} }, 300);
  },
  projBar() {
    const f = $('#libFilter'); let pb = $('#projBar'); if (!pb) { pb = h('div', { id: 'projBar', class: 'projbar' }); f.before(pb); }
    pb.innerHTML = ''; const L = CFG.projects || []; const cur = CFG.curProj || 'all';
    const known = new Set(L.map((p) => p.id)), none = this.recs.filter((r) => !r.project || !known.has(r.project)).length;
    if (!L.length) { pb.style.display = 'none'; return; } pb.style.display = '';
    const sel = h('select', { class: 'projsel' }, h('option', { value: 'all', selected: cur === 'all' }, `📁 全部專案（${this.recs.length}）`),
      L.slice().sort((a, b) => b.created - a.created).map((p) => h('option', { value: p.id, selected: p.id === cur }, `📁 ${p.name}（${this.recs.filter((r) => r.project === p.id).length}）`)),
      none ? h('option', { value: 'none', selected: cur === 'none' }, `未分類（${none}）`) : null);
    sel.onchange = () => { CFG.curProj = sel.value; saveCfg(); this.render(); };
    pb.append(sel); if (known.has(cur)) pb.append(h('button', { class: 'btn sm', onclick: () => this.projRename(cur) }, '✎ 改名'));
  },
  importFiles(list) {
    if (!list.length) return;
    const pj = this.projFor();
    for (const it of list) this.queue.push(Object.assign({ st: '等待中', qid: uid(), proj: pj }, it));
    this.qTotal += list.length; this.render();
    if (!this.qRunning) this.runQueue();
  },
  async runQueue() {
    this.qRunning = true; let ok = 0, fail = 0; const t0 = Date.now();
    BG.set('import', `匯入相片 0 / ${this.qTotal}`, 0);
    const worker = async () => {
      while (true) {
        const it = this.queue.find((q) => !q.taken); if (!it) return; it.taken = true;
        const n = this.qDone + 1;
        const stage = (t) => { it.st = t; this.updQ(it); BG.set('import', `匯入相片 ${Math.min(n, this.qTotal)} / ${this.qTotal}：${it.name}`, Math.round(this.qDone / this.qTotal * 100)); };
        try {
          stage('讀取中…');
          if (!it.blob && it.get) it.blob = await it.get();
          const rec = await this.importOne(it, stage); ok++;
          const i = this.recs.findIndex((r) => r.id === rec.id); if (i < 0) this.recs.push(rec);
        } catch (e) { console.error(e); fail++; toast(`「${it.name}」無法匯入：${e.message}`, 4000); }
        this.queue.splice(this.queue.indexOf(it), 1); this.qDone++; it.blob = null;
        if (it.mid != null) this.pendDel(it.mid);
        this.renderSoon();
        await yieldNow();
      }
    };
    await Promise.all([worker(), worker()]);
    this.qRunning = false; BG.end('import');
    const total = this.qTotal; this.qTotal = 0; this.qDone = 0;
    toast(`已匯入 ${ok} 張相片${fail ? `，${fail} 張失敗` : ''}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`, 3000);
    if (total >= 3) NAT.call('notifyDone', '匯入完成', `已匯入 ${ok} 張相片`);
    await this.refresh();
    this.developAll();
  },
  /* 畫面更新節流：大量匯入時不必每張都重繪整個圖庫；App 在背景時完全不重繪 */
  renderSoon() {
    if (document.hidden) { this.dirty = true; return; }
    if (this.rT) return; const wait = Math.max(0, 1200 - (Date.now() - (this.rAt || 0)));
    this.rT = setTimeout(() => { this.rT = 0; this.rAt = Date.now(); this.render(); }, wait);
  },
  /* 未完成的匯入清單（相簿 ID）：App 被系統關閉後，下次開啟自動接續 */
  pendGet() { return lsGet('aip.impPend', []); },
  pendAdd(ids) { const a = new Set(this.pendGet()); ids.forEach((x) => a.add(x)); lsSet('aip.impPend', [...a]); },
  pendDel(id) { lsSet('aip.impPend', this.pendGet().filter((x) => x !== id)); },
  resumePending() {
    if (!isApp || !window.AIP || !AIP.pickIds) return;
    const have = new Set(this.recs.map((r) => r.mid).filter((x) => x != null));
    const rem = this.pendGet().filter((x) => !have.has(x)); lsSet('aip.impPend', rem);
    if (!rem.length || !NAT.call('mediaPerm')) return;
    toast(`繼續上次未完成的匯入（${rem.length} 張）`, 3500); AIP.pickIds(JSON.stringify(rem));
  },
  /* 背景把「內嵌預覽」換成真正的 RAW 解碼預覽（與編輯結果一致）；打開編輯時若尚未完成會優先處理那一張 */
  devJobs: new Map(),
  develop(rec, prio) {
    if (this.devJobs.has(rec.id)) return this.devJobs.get(rec.id);
    const p = (async () => {
      const r = (await DB.get('photos', rec.id)) || rec; if (!r.prevEmb) return r;
      const raw = await DB.get('raw', r.id); if (!raw) { delete r.prevEmb; await DB.put('photos', r); return r; }
      const d = await rawPreview(raw, r.name);
      const W = d.W, H = d.H, bm = d.canvas;
      const mk = async (long, q) => { const sc = Math.min(1, long / Math.max(W, H)); const c = mkCanvas(W * sc, H * sc); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, c.width, c.height); const b = await canvasBlob(c, 'image/jpeg', q); c.width = c.height = 1; return b; };
      await DB.put('prev', await mk(CFG.prevLong, .95), r.id); await DB.put('thumbs', await mk(480, .85), r.id); bm.width = bm.height = 1;
      r.w = W; r.h = H; r.exifBin = d.exif; r.rawK = d.k; r.rawV = 2; const ex = Meta.summary(d.exif); if (ex) r.exif = Object.assign({}, r.exif, ex);
      if (!r.edited && !r.lensKey) { try { const lp = await lensProfileFor(r); if (lp.lens) { r.lensKey = lp.key; r.lensName = lp.name; if (CFG.lensAutoRaw !== false) { r.edit = r.edit || {}; r.edit.optics = { prof: { on: true, key: lp.key, name: lp.name, d: 100, v: 100, tca: true, p: lp.p, camCrop: lp.camCrop } }; } } } catch (e) {} }
      delete r.prevEmb; await DB.put('photos', r);
      const lr = this.recs.find((x) => x.id === r.id); if (lr) Object.assign(lr, r); delete (lr || {}).prevEmb;
      if (rec !== lr) { Object.assign(rec, r); delete rec.prevEmb; }
      return r;
    })().finally(() => this.devJobs.delete(rec.id));
    this.devJobs.set(rec.id, p); return p;
  },
  async developAll() {
    if (this.devRunning) return; this.devRunning = true;
    try {
      while (!this.qRunning) {
        const todo = this.recs.filter((r) => r.prevEmb); if (!todo.length) break;
        const r = todo[0], left = todo.length;
        BG.set('develop', `建立 RAW 預覽：剩 ${left} 張`, -1);
        try { await this.develop(r); } catch (e) { console.warn('develop', r.name, e); r.prevEmb = false; }
        this.renderSoon(); await yieldNow();
      }
    } finally { this.devRunning = false; BG.end('develop'); }
  },
  updQ(it) { if (it.el && it.el.isConnected) it.el.querySelector('.qst').textContent = it.st; },
  async importOne({ blob, name, mime, conv, mid, proj }, stage) {
    mime = mime || blob.type || '';
    let wasRaw = false, rawBlob = null, preDecoded = null, exifBin = null, fullWH = null, emb = false, rawK = 0;
    if (isRawName(name) || /x-(sony|canon|nikon|fuji|panasonic|olympus|pentax|adobe-dng)|image\/(dng|raw)/i.test(mime)) {
      const ext = (/\.([a-z0-9]+)$/i.exec(name) || [, 'raw'])[1].toLowerCase();
      rawBlob = blob; mime = 'image/jpeg'; conv = ext; wasRaw = true;
      // 快速匯入：先用相機內嵌的 JPEG 預覽（與 Lightroom 相同），RAW 解碼留到背景或開啟編輯時
      try {
        stage && stage('讀取內嵌預覽…');
        const head = new Uint8Array(await blob.slice(0, 16 << 20).arrayBuffer());
        const e = await rawEmbeddedPreview(blob, head);
        if (e) { preDecoded = e.canvas; fullWH = [e.W, e.H]; exifBin = Meta.fromRawTiff(head, { w: e.W, h: e.H, lens: '', lensMake: '' }) || new Uint8Array(0); emb = true; }
      } catch (er) { console.warn('embedded', er); }
      if (!emb) {
        try { const r = await rawPreview(blob, name, (t) => stage && stage(t)); preDecoded = r.canvas; exifBin = r.exif; fullWH = [r.W, r.H]; rawK = r.k; }
        catch (e) { throw new Error('RAW 解碼失敗：' + e.message); }
      }
    }
    stage && stage('建立預覽…');
    let exif = null; if (exifBin && exifBin.length) exif = Meta.summary(exifBin); else try { const head = await blob.slice(0, Math.min(blob.size, 1024 * 1024)).arrayBuffer(); const m = Meta.extract(head); exif = Meta.summary(m.exif); } catch (e) {}
    let bm;
    try { bm = preDecoded || await decodeOriented(blob, conv ? 1 : (exif && exif.orientation) || 1); }
    catch (e) { throw new Error(/heic|heif|dng|raw/i.test(name + mime) ? '瀏覽器無法讀取 HEIC，請使用 App 版（會自動轉檔並保留 EXIF）' : '不支援的影像格式'); }
    const W = fullWH ? fullWH[0] : bm.width, H = fullWH ? fullWH[1] : bm.height;
    const mk = async (long, q) => { const s = Math.min(1, long / Math.max(W, H)); const c = mkCanvas(W * s, H * s); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, c.width, c.height); const b = await canvasBlob(c, 'image/jpeg', q); c.width = c.height = 1; return b; };
    const prev = await mk(CFG.prevLong, .95), thumb = await mk(480, .85); if (bm.close) bm.close(); else { bm.width = bm.height = 1; }
    if (emb) { stage && stage('儲存 RAW…'); }
    const id = uid();
    const rec = { id, name, mime: conv ? 'image/jpeg' : mime, outMime: conv ? 'image/jpeg' : mime, convFrom: conv || null, size: blob.size, w: W, h: H, added: Date.now(), rating: 0, flag: 0, edit: null, edited: false, versions: [], exif, oriV: 1 };
    const ck = exif && camKey(exif.make); if (ck && CFG.camAuto !== false) rec.edit = { profile: CAM_PROFILES[ck].def };
    if (wasRaw) { rec.edit = rec.edit || {}; rec.edit.nr = { col: 25 }; rec.edit.sharp = { amt: 40, rad: 1.0, det: 25, mask: 0 }; } // 與 Lightroom 相同：RAW 預設色彩雜訊減少 25、銳化 40
    // 自動偵測鏡頭描述檔：RAW 預設啟用（相機 JPEG 多半已在機內校正）
    try {
      const lp = await lensProfileFor(rec);
      if (lp.lens) { rec.lensKey = lp.key; rec.lensName = lp.name; const on = wasRaw ? CFG.lensAutoRaw !== false : !!CFG.lensAutoJpeg;
        if (on) { rec.edit = rec.edit || {}; rec.edit.optics = { prof: { on: true, key: lp.key, name: lp.name, d: 100, v: 100, tca: true, p: lp.p, camCrop: lp.camCrop } }; } }
    } catch (e) { console.warn('lens detect', e); }
    rec.raw = wasRaw; if (proj) rec.project = proj; if (mid != null) rec.mid = mid; if (emb) rec.prevEmb = true;
    if (wasRaw) { rec.rawLazy = true; rec.exifBin = exifBin; if (rawK) { rec.rawK = rawK; rec.rawV = 2; } await DB.put('raw', rawBlob, id); rec.hasRaw = true; }
    else await DB.put('files', blob, id);
    await DB.put('prev', prev, id); await DB.put('thumbs', thumb, id);
    await DB.put('photos', rec);
    return rec;
  },
  onNativePicked(list) {
    const mids = (list || []).map((it) => it.mid).filter((x) => x != null); if (mids.length) this.pendAdd(mids);
    const items = (list || []).map((it) => ({ name: it.name, mime: it.mime, conv: it.conv || null, mid: it.mid, get: async () => { const r = await fetch(location.origin + '/pick/' + it.id); if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); } }));
    this.importFiles(items);
  }
};


/* ================= App 內相簿（點選多張匯入） ================= */
const Gallery = {
  sel: new Set(), items: [], bucket: '', offset: 0, done: false,
  async open() {
    if (!AIP.mediaPerm()) { NAT.call('requestPerm', 'media'); toast('請允許讀取相片後再按一次「匯入」'); return; }
    this.sel = new Set(); this.items = []; this.offset = 0; this.done = false; this.all = null;
    const buckets = NAT.json('mediaBuckets') || [];
    const sel = h('select', { style: { padding: '5px 10px', fontSize: '14px', maxWidth: '55%' } }, h('option', { value: '' }, '所有相片'), buckets.map((b) => h('option', { value: b.name, selected: b.name === this.bucket }, `${b.name}（${b.count}）`)));
    const reset = () => { this.items = []; this.offset = 0; this.done = false; this.all = null; grid.innerHTML = ''; this.more(grid); };
    sel.onchange = () => { this.bucket = sel.value; reset(); };
    const SORTS = [['date-desc', '拍攝時間：新→舊'], ['date-asc', '拍攝時間：舊→新'], ['name-asc', '檔名：A→Z'], ['name-desc', '檔名：Z→A'], ['added-desc', '加入相簿：新→舊']];
    const srt = h('select', { style: { padding: '5px 10px', fontSize: '14px', maxWidth: '48%' } }, SORTS.map(([k, n]) => h('option', { value: k, selected: k === (CFG.gsort || 'date-desc') }, n)));
    srt.onchange = () => { CFG.gsort = srt.value; saveCfg(); reset(); };
    const grid = h('div', { class: 'ggrid' }); this.countEl = h('b', null, '已選 0');
    const goBtn = h('button', { class: 'btn pri', onclick: () => { if (!this.sel.size) { toast('請先點選相片'); return; } const ids = [...this.sel]; UI.close(); Library.nextProj = { name: this.bucket || '', at: Date.now() }; AIP.pickIds(JSON.stringify(ids)); toast(`開始匯入 ${ids.length} 張相片`); } }, '匯入');
    this.goBtn = goBtn;
    const box = h('div', null,
      h('div', { class: 'lbl2', style: { gap: '6px' } }, sel, srt), h('div', { class: 'lbl2' }, h('span', { class: 'sub' }, '點選相片可多選'), h('span', { style: { display: 'flex', gap: '6px' } }, h('button', { class: 'btn sm', onclick: () => this.selectAll(grid) }, '全選'),
        h('button', { class: 'btn sm', onclick: () => { this.sel.clear(); $$('.gcell', grid).forEach((c) => c.classList.remove('on')); this.upd(); } }, '清除'))),
      h('div', { class: 'gscroll' }, grid), h('div', { class: 'gbar' }, this.countEl, h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => { UI.close(); NAT.call('systemPick'); } }, '從檔案選取…'), goBtn));
    UI.sheet('選擇相片（可多選）', box); $('#sheet').classList.add('tall');
    const scroller = grid.parentNode;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) this.more(grid); }, { root: scroller, rootMargin: '600px 0px' });
    this.sentinel = h('div', { style: { height: '1px' } }); scroller.append(this.sentinel); io.observe(this.sentinel);
    this.more(grid); this.upd();
  },
  more(grid) {
    if (this.done || this.loading) return; this.loading = true;
    const mode = CFG.gsort || 'date-desc'; let arr;
    if (mode === 'added-desc') arr = NAT.json('mediaList', this.bucket, this.offset, 120) || [];
    else {
      if (!this.all) { // 依檔名或拍攝時間排序：先取得整個資料夾的清單（只有名稱與時間，很快），再分批顯示
        const all = []; for (let off = 0, g = 0; g < 200; g++) { const a = NAT.json('mediaList', this.bucket, off, 2000) || []; if (!Array.isArray(a) || !a.length) break; all.push(...a); off += a.length; if (a.length < 2000) break; }
        const col = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' }), dir = /desc$/.test(mode) ? -1 : 1;
        all.sort(/^name/.test(mode) ? (x, y) => dir * col.compare(x.name || '', y.name || '') : (x, y) => dir * ((x.date || 0) - (y.date || 0)) || col.compare(x.name || '', y.name || ''));
        this.all = all;
      }
      arr = this.all.slice(this.offset, this.offset + 120);
    }
    if (!Array.isArray(arr) || arr.length < 120) this.done = true;
    this.offset += arr.length;
    for (const it of arr) {
      this.items.push(it);
      const raw = isRawName(it.name);
      const img = h('img', { loading: 'lazy', src: location.origin + '/thumb/' + it.id, onerror: (e) => { e.target.replaceWith(h('div', { class: 'gph' }, raw ? 'RAW' : '🖼')); } });
      const c = h('div', { class: 'gcell' + (this.sel.has(it.id) ? ' on' : '') }, img, raw ? h('span', { class: 'gtag' }, (it.name.split('.').pop() || '').toUpperCase()) : null, h('i', null, '✓'));
      c.onclick = () => { this.sel.has(it.id) ? this.sel.delete(it.id) : this.sel.add(it.id); c.classList.toggle('on'); this.upd(); };
      grid.append(c);
    }
    this.loading = false;
  },
  /* 全選：一次取得整個資料夾所有相片（不只畫面上已載入的） */
  selectAll(grid) {
    let off = 0; const all = [];
    for (let guard = 0; guard < 200; guard++) { const arr = NAT.json('mediaList', this.bucket, off, 2000) || []; if (!Array.isArray(arr) || !arr.length) break; arr.forEach((it) => all.push(it.id)); off += arr.length; if (arr.length < 2000) break; }
    (all.length ? all : this.items.map((it) => it.id)).forEach((id) => this.sel.add(id));
    $$('.gcell', grid).forEach((c) => c.classList.add('on')); this.upd();
  },
  upd() { if (this.countEl) this.countEl.textContent = `已選 ${this.sel.size}`; if (this.goBtn) this.goBtn.textContent = this.sel.size ? `匯入 ${this.sel.size} 張` : '匯入'; }
};

/* ================= 預設集頁 ================= */
const PresetsPage = {
  render() {
    const my = $('#myPresets'); my.innerHTML = '';
    const ups = App.userPresets || [];
    if (!ups.length) my.append(h('div', { class: 'sub' }, '尚未建立預設集。'));
    for (const p of ups) my.append(h('div', { class: 'mitem' }, h('span', { class: 'mi' }, '★'), h('span', { class: 'grow' }, p.name, h('div', { class: 'sub' }, Object.keys(p.e).length + ' 項設定')),
      h('button', { class: 'btn sm', onclick: () => { App.clip = clone(p.e); toast('已複製，到圖庫選取相片後「貼上設定」'); } }, '套用到…'),
      h('button', { class: 'ib', onclick: async () => { if (await UI.confirm(`刪除預設集「${p.name}」？`, '刪除', true)) { await DB.del('presets', p.id); await App.loadPresets(); this.render(); } } }, '🗑')));
    const bi = $('#builtinPresets'); bi.innerHTML = '';
    for (const g of PRESETS) bi.append(h('div', { class: 'sec' }, g.g), h('div', { class: 'chips' }, g.items.map((p) => h('button', { class: 'btn sm', onclick: () => { App.clip = clone(p.e); toast(`已複製「${p.name}」，可貼上到多張相片`); } }, p.name))));
  }
};

/* ================= 設定 ================= */
const Settings = {
  render() {
    const root = $('#setScroll'); root.innerHTML = '';
    root.append(h('h2', { class: 'pt' }, '⚙️ 設定'));
    const card = (title, ...kids) => h('div', { class: 'card glass' }, h('h3', null, title), ...kids);
    const segRow = (label, items, cur, on, sub) => h('div', { class: 'lab' }, h('span', null, label, sub ? h('div', { class: 'sub' }, sub) : null), h('div', { class: 'seg' }, items.map(([k, n]) => h('button', { class: 'btn' + (String(cur) === String(k) ? ' on' : ''), onclick: () => { on(k); saveCfg(); this.render(); } }, n))));
    const sw = (label, get, set, sub) => { const i = h('input', { type: 'checkbox' }); i.checked = !!get(); i.onchange = () => { set(i.checked); saveCfg(); }; return h('label', { class: 'lab' }, h('span', null, label, sub ? h('div', { class: 'sub' }, sub) : null), h('span', { class: 'sw' }, i, h('span'))); };
    root.append(card('🎨 外觀',
      segRow('主題', [['auto', '自動'], ['light', '淺色'], ['dark', '深色']], CFG.theme, (k) => { CFG.theme = k; applyLook(); }),
      segRow('材質', [['liquid', '液態玻璃'], ['paper', '紙質'], ['solid', '霧面']], CFG.mat, (k) => { CFG.mat = k; applyLook(); }),
      h('div', { class: 'lab' }, h('span', null, '強調色'), h('div', { class: 'chips' }, [['terra', '陶土', '#a2613a'], ['moss', '苔綠', '#6f7d4c'], ['sand', '沙金', '#b0884a'], ['coffee', '咖啡', '#7a4e2d'], ['clay', '紅磚', '#b4553a']].map(([k, n, c]) => h('button', { class: 'btn sm' + (CFG.acc === k ? ' on' : ''), onclick: () => { CFG.acc = k; saveCfg(); applyLook(); this.render(); } }, h('i', { style: { width: '12px', height: '12px', borderRadius: '50%', background: c, display: 'inline-block' } }), n)))),
      (() => { const r = h('input', { type: 'range', min: .1, max: .8, step: .02, value: CFG.gA, style: { accentColor: 'var(--ac)' } }); r.oninput = () => { CFG.gA = +r.value; applyLook(); }; r.onchange = saveCfg; return h('div', { class: 'lab' }, h('span', null, '玻璃透明度'), h('span', { style: { width: '50%' } }, r)); })()));
    root.append(card('📤 匯出',
      segRow('格式', [['orig', '原始格式'], ['jpeg', 'JPEG'], ['png', 'PNG']], CFG.exp.fmt, (k) => (CFG.exp.fmt = k), '原始格式：JPEG→JPEG、PNG→PNG、WebP→WebP'),
      segRow('JPEG 品質', [[100, '100'], [95, '95'], [90, '90'], [85, '85']], CFG.exp.q, (k) => (CFG.exp.q = +k), '100 為原始畫質'),
      sw('4:4:4 色度（不降採樣）', () => CFG.exp.sub444, (v) => (CFG.exp.sub444 = v), '保留完整色彩解析度，畫質最高'),
      segRow('尺寸', [['orig', '原始解析度'], ['long', '縮小']], CFG.exp.size, (k) => (CFG.exp.size = k)),
      CFG.exp.size === 'long' ? segRow('長邊', [[2048, '2048'], [3000, '3000'], [4096, '4096'], [6000, '6000']], CFG.exp.long, (k) => (CFG.exp.long = +k)) : null,
      segRow('中繼資料', [['all', '全部保留'], ['nogps', '移除位置'], ['none', '不含']], CFG.exp.meta, (k) => (CFG.exp.meta = k), 'EXIF（相機、鏡頭、光圈、快門、ISO、時間、GPS、廠商資料）與 XMP'),
      h('div', { class: 'note' }, '檔名：沿用原始檔名（例如 IMG_1234.JPG 匯出仍為 IMG_1234.JPG）。', isApp ? '存放於「圖片／AI修圖軟體」資料夾；同名檔會覆寫為最新版本，不會動到原始相片。' : '瀏覽器版會下載到預設下載資料夾。')));
    root.append(card('🤖 AI 降噪',
      segRow('預設模型', [['fast', '快速'], ['hq', '高品質']], CFG.ai.model, (k) => (CFG.ai.model = k), '高品質模型較慢但細節更好'),
      segRow('分塊大小', [[192, '192'], [256, '256'], [384, '384'], [512, '512']], CFG.ai.tile, (k) => (CFG.ai.tile = +k), '記憶體不足時請調小'),
      segRow('推論引擎', [['auto', '自動'], ['webgl', 'GPU'], ['cpu', 'CPU']], CFG.ai.engine || 'auto', (k) => { CFG.ai.engine = k; AI.reset(); }, 'GPU 最快；若結果異常會自動改用 CPU'),
      sw('流暢模式', () => CFG.ai.smooth !== false, (v) => (CFG.ai.smooth = v), '分小塊並在每塊之間讓出時間給畫面，手機不會卡頓（稍慢）'),
      sw('背景執行緒', () => CFG.ai.worker !== false, (v) => { CFG.ai.worker = v; AI.reset(); }, 'AI 在獨立執行緒運算，不佔用畫面繪製（建議開啟）'),
      h('div', { class: 'sub' }, `目前：${AI.ready ? (AI.backend === 'webgl' ? 'GPU（WebGL）' : 'CPU') + (AI.mode === 'worker' ? '・背景執行緒' : '・主執行緒') + `，自我測試 ${AI.testMs} ms` : '尚未啟動（首次使用時載入）'}`),
      AI.log.length ? h('div', { class: 'note' }, AI.log.join('\n')) : null,
      h('div', { class: 'acts' }, h('button', { class: 'btn sm pri', onclick: async (ev) => { const b = ev.target; b.disabled = true; b.textContent = '測試中…'; await AI.reset(); try { await AI.init(); toast('AI 降噪正常：' + (AI.backend === 'webgl' ? 'GPU' : 'CPU') + `，${AI.testMs} ms`, 4000); } catch (e) { toast(e.message, 8000); } this.render(); } }, '🧪 AI 自我測試')),
      h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: async () => { const n = (await DB.all('photos')).length; await DB.tx('ai', 'readwrite', (s) => s.clear()); toast('已清除 AI 預覽快取（' + n + ' 張相片）'); } }, '清除 AI 快取'))));
    { const ki = h('input', { type: 'password', placeholder: 'Google Maps API 金鑰（選填）', value: Geo.key(), style: { width: '100%' } }); ki.onchange = () => { Geo.setKey(ki.value); toast(ki.value ? '已儲存金鑰' : '已移除金鑰'); };
      root.append(card('📍 地點搜尋', ki, h('div', { class: 'note' }, '填入 Google API 金鑰（需啟用 Places API (New)）後，搜尋地名會使用 Google 地圖資料，與「行跡導航」、「檔案批次改名工具」相同；未填則使用 OpenStreetMap。金鑰只存在這台裝置。'))); }
    root.append(Cloud.settingsCard(card, segRow, sw));
    root.append(card('🖼 編輯器',
      segRow('預覽解析度', [[1536, '1536'], [2048, '2048'], [2560, '2560']], CFG.prevLong, (k) => (CFG.prevLong = +k), '新匯入的相片生效；越高越清晰但較耗效能'),
      sw('顯示直方圖', () => CFG.histo, (v) => (CFG.histo = v)),
      sw('RAW 檔自動啟動鏡頭校正', () => CFG.lensAutoRaw !== false, (v) => (CFG.lensAutoRaw = v), '依 EXIF 的相機與鏡頭自動套用描述檔（變形、暈影、色差）'),
      sw('JPEG 也自動啟動鏡頭校正', () => !!CFG.lensAutoJpeg, (v) => (CFG.lensAutoJpeg = v), '多數相機 JPEG 已在機內校正過，開啟可能會過度校正'),
      sw('匯入時自動套用相機比對風格', () => CFG.camAuto !== false, (v) => (CFG.camAuto = v), '依 EXIF 判斷相機廠牌（Sony、Fujifilm、Canon、Nikon、Panasonic、OM、Ricoh、Leica），帶入該相機的預設風格')));
    const stor = h('div', { class: 'sub' }, '計算中…');
    (async () => { const n = (await DB.all('photos')).length; let est = ''; try { const q = await navigator.storage.estimate(); est = `・已使用 ${fmtBytes(q.usage || 0)}`; } catch (e) {} stor.textContent = `圖庫共 ${n} 張相片${est}`; })();
    root.append(card('💾 儲存空間', stor, h('div', { class: 'acts' }, h('button', { class: 'btn sm dang', onclick: async () => { if (!(await UI.confirm('清空 App 圖庫？手機相簿中的原始相片不受影響。', '清空', true))) return; for (const s of ['photos', 'files', 'thumbs', 'prev', 'ai', 'raw']) await DB.tx(s, 'readwrite', (st) => st.clear()); await Library.refresh(); this.render(); toast('已清空'); } }, '清空圖庫'))));
    if (isApp) {
      const pm = NAT.json('perms') || {};
      root.append(card('🔐 權限', h('div', { class: 'lab' }, h('span', null, '相片與位置中繼資料', h('div', { class: 'sub' }, '讀取原始 GPS 等 EXIF 資訊需要「相片」與「媒體位置」權限')), pm.media ? h('span', { class: 'sub' }, '✓ 已允許') : h('button', { class: 'btn sm pri', onclick: () => NAT.call('requestPerm', 'media') }, '允許')),
        h('div', { class: 'lab' }, h('span', null, '定位', h('div', { class: 'sub' }, '地點地圖的「📍 目前位置」使用')), !window.AIP2 ? h('span', { class: 'sub' }, '需安裝 v1.13 以上 APK') : AIP2.has() ? h('span', { class: 'sub' }, '✓ 已允許') : h('button', { class: 'btn sm pri', onclick: () => AIP2.request() }, '允許')),
        h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => NAT.call('openAppSettings') }, '開啟系統設定'))));
    }
    root.append(card('ℹ️ 關於',
      h('div', { class: 'kv2' }, h('b', null, '版本'), h('span', null, (isApp && NAT.call('version')) || APP_VERSION), h('b', null, 'GPU'), h('span', null, Editor.glInfo ? `WebGL2・最大貼圖 ${Editor.glInfo.maxTex}・${Editor.glInfo.HF ? '16-bit 浮點管線' : '8-bit 管線'}` : (Editor.glError || '—'))),
      h('div', { class: 'note' }, '所有影像處理（含 AI 降噪）都在裝置上完成，相片不會上傳到任何伺服器。'),
      h('div', { class: 'sub' }, '開源元件：Intel Open Image Denoise 權重（Apache-2.0）、TensorFlow.js（Apache-2.0）、MozJPEG（BSD/IJG）、MapLibre GL JS（BSD-3）。地圖：OpenFreeMap © OpenMapTiles，資料 © OpenStreetMap 貢獻者。')));
  }
};

/* ================= App ================= */
const APP_VERSION = '1.10.1';
const App = {
  view: 'lib', clip: null, userPresets: [],
  async init() {
    applyLook();
    $$('#nav .btn').forEach((b) => b.onclick = () => this.nav(b.dataset.v));
    $('#sheetBg').onclick = () => UI.close();
    Editor.init();
    try { await DB.open(); } catch (e) { toast('無法開啟儲存空間：' + e.message, 6000); }
    await this.loadPresets();
    await Library.init();
    Cloud.resume();
    window.addEventListener('popstate', () => { if (!this.back()) history.pushState({}, ''); });
    history.pushState({}, '');
  },
  async loadPresets() { try { const all = (await DB.all('presets')).sort((a, b) => a.t - b.t); this.userPresets = all.filter((p) => p.type !== 'profile'); CustomProfiles.set(all.filter((p) => p.type === 'profile')); } catch (e) { this.userPresets = []; } },
  nav(v) {
    if (v === 'ed') { const r = Editor.rec && Library.recs.find((x) => x.id === Editor.rec.id); if (r) Editor.open(r); else if (Library.recs.length) Editor.open(Library.filtered()[0] || Library.recs[0]); else { toast('請先匯入相片'); Library.pick(); } return; }
    this.show(v);
    if (v === 'set') Settings.render(); if (v === 'pre') PresetsPage.render();
  },
  show(v) {
    const was = this.view; this.view = v; if (was !== v) { const el = $('#v-' + v); if (el) { el.classList.remove('vin'); void el.offsetWidth; el.classList.add('vin'); } } $$('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
    $$('#nav .btn').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  },
  back() {
    if (UI.open) { UI.close(); return true; }
    if ($('#expProg').classList.contains('on')) return true;
    if (Editor.active) { if (Editor.tool === 'crop') { Editor.setTool('edit'); return true; } Editor.close(); return true; }
    if (Library.selecting) { Library.setSelecting(false); return true; }
    if (this.view !== 'lib') { this.show('lib'); return true; }
    return false;
  }
};
window.addEventListener('DOMContentLoaded', () => App.init());
