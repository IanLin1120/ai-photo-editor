/* ================= RAW 解碼（LibRaw WASM）與背景執行緒 ================= */
const RAW = {
  mod: null,
  async LibRaw() { if (!this.mod) this.mod = await import(new URL('lib/libraw/index.js', location.href).href); return this.mod.default; },
  /* half：半尺寸（預覽用，快 4 倍）；回傳 16-bit 交錯 RGB（BT.709 曲線，由引擎查表轉線性） */
  async decode(bytes, half) {
    const L = await this.LibRaw(), r = new L();
    try {
      await r.open(bytes, { useCameraWb: true, noAutoBright: true, outputBps: 16, outputColor: 4, halfSize: !!half, userFlip: 0, highlight: 2 });
      const m = await r.metadata(false) || {}, im = await r.imageData();
      return { u16: im.data, w: im.width, h: im.height, flip: m.flip || 0, lr: m };
    } finally { try { r.dispose(); } catch (e) { } }
  }
};
function mkWorker() {
  const W = { n: 0, cb: {}, onProg: null };
  W.w = new Worker(URL.createObjectURL(new Blob([$('#wkSrc').textContent], { type: 'text/javascript' })));
  W.w.onmessage = e => { const d = e.data; if (d.prog != null) { if (W.onProg) W.onProg(d.prog); return; } const c = W.cb[d.id]; delete W.cb[d.id]; if (c) d.ok ? c.res(d.r) : c.rej(new Error(d.err)); };
  W.w.onerror = e => { for (const k in W.cb) { W.cb[k].rej(new Error('背景執行緒錯誤：' + (e.message || '記憶體不足？'))); delete W.cb[k]; } };
  W.call = (cmd, a, tr) => new Promise((res, rej) => { const id = ++W.n; W.cb[id] = { res, rej }; W.w.postMessage({ id, cmd, a }, tr || []); });
  W.restart = () => { try { W.w.terminate(); } catch (e) { } const n = mkWorker(); Object.assign(W, { w: n.w, cb: {}, n: 0 }); W.w.onmessage = n.w.onmessage; };
  return W;
}

/* 相機 → 描述檔／模板鍵值 */
function camKey(meta) {
  const mk = String(meta.make || '').toUpperCase().split(/[\s,]+/)[0];
  let md = String(meta.model || '').trim(); if (md.toUpperCase().startsWith(mk)) md = md.slice(mk.length).trim();
  return mk + '|' + md;
}
function camName(key) { return { 'SONY|ILCE-6700': 'Sony A6700', 'RICOH|GR III': 'Ricoh GR III' }[key] || key.replace('|', ' '); }

/* ================= ① 照片庫 ================= */
const Lib = {
  photos: [], sel: new Set(), selMode: false,
  async init() {
    this.photos = (await IDB.all()).sort((a, b) => (b.taken || 0) - (a.taken || 0) || (b.added || 0) - (a.added || 0));
    $('#libAdd').onclick = () => this.import();
    $('#libSel').onclick = () => this.setSel(!this.selMode);
    $('#fileIn').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; this.addFiles(fs.map(f => ({ file: f, name: f.name, size: f.size, mtime: f.lastModified }))); };
    $('#libBar').onclick = e => { const b = e.target.closest('[data-a]'); if (b) this.act(b.dataset.a); };
    this.render();
  },
  import() {
    if (isApp) { const id = 'p' + uid(); CBS[id] = L => this.addFiles(L.map(x => ({ pickId: x.id, uri: x.uri, name: x.name || 'photo', size: x.size || 0, mtime: x.mtime || 0 }))); NAT.call('pick', id, true); }
    else $('#fileIn').click();
  },
  async addFiles(items) {
    if (!items.length) return;
    Prog.show('匯入照片', `0 / ${items.length}`); let n = 0, added = 0;
    for (const it of items) {
      if (Prog.cancel) break;
      try {
        const tmp = { _file: it.file, src: it.pickId ? { pickId: it.pickId, uri: it.uri } : null };
        const head = await photoBytes(tmp, 0, 1048576);
        const meta = EXIF.parse(head) || {};
        const isRaw = RAW_EXT.test(it.name);
        const id = `${it.name}|${it.size}|${meta.dateOriginal || it.mtime}`;
        let p = this.photos.find(x => x.id === id);
        if (!p) { p = { id, name: it.name, size: it.size, added: Date.now(), edit: null, exported: [] }; this.photos.push(p); added++; }
        p.src = tmp.src; p._file = it.file; p.raw = isRaw;
        p.meta = slimMeta(meta); p.key = isRaw ? camKey(meta) : 'JPEG';
        p.taken = EXIF.exifDateMs(meta.dateOriginal, meta.offsetTime) || it.mtime || 0;
        p.port = meta.orientation >= 5;
        if (!p.thumb) p.thumb = await this.makeThumb(tmp, head, isRaw);
        await IDB.put(p);
      } catch (e) { console.warn(e); toast('無法匯入 ' + it.name + '：' + e.message, 4000); }
      Prog.set(++n / items.length, `${n} / ${items.length}`);
    }
    Prog.hide(); this.photos.sort((a, b) => (b.taken || 0) - (a.taken || 0)); this.render();
    if (added) toast(`已匯入 ${added} 張照片`);
  },
  /* 縮圖：RAW 用內嵌預覽（挑 100–600KB 的那張最快），JPG 直接縮 */
  async makeThumb(tmp, head, isRaw) {
    try {
      let bytes;
      if (isRaw) {
        const pv = EXIF.previews(head); if (!pv.length) return '';
        const mid = pv.filter(p => p.len >= 60000 && p.len <= 700000).sort((a, b) => a.len - b.len)[0] || pv.filter(p => p.len <= 4e6)[0] || pv[0];
        bytes = mid.off + mid.len <= head.length ? head.slice(mid.off, mid.off + mid.len) : await photoBytes(tmp, mid.off, mid.len);
      } else bytes = tmp._file ? new Uint8Array(await tmp._file.arrayBuffer()) : await photoBytes(tmp);
      const meta = EXIF.parse(head) || {};
      const bmp = await createImageBitmap(new Blob([bytes]));
      const k = 420 / Math.max(bmp.width, bmp.height), w = Math.round(bmp.width * k), hh = Math.round(bmp.height * k);
      const rot = isRaw ? ({ 6: 90, 8: -90, 3: 180 })[meta.orientation] || 0 : 0;
      const cv = h('canvas'); cv.width = rot % 180 ? hh : w; cv.height = rot % 180 ? w : hh; const cx = cv.getContext('2d');
      cx.translate(cv.width / 2, cv.height / 2); cx.rotate(rot * Math.PI / 180); cx.drawImage(bmp, -w / 2, -hh / 2, w, hh); bmp.close();
      return cv.toDataURL('image/jpeg', 0.8);
    } catch (e) { return ''; }
  },
  /* 重開 App 後重新取得原檔讀取權 */
  ensure(p) {
    if (p._file || !isApp || !p.src || !p.src.uri) return;
    if (p._reg) return; const r = NAT.json('reopen', p.src.uri); if (!r) throw new Error('原檔已移動或刪除，請重新匯入');
    p.src.pickId = r.id; p._reg = true;
  },
  setSel(on) { this.selMode = on; if (!on) this.sel.clear(); document.body.classList.toggle('selmode', on); $('#libSel').textContent = on ? '完成' : '選取'; this.render(); },
  render() {
    const G = $('#libGrid'), P = this.photos;
    $('#libHint').innerHTML = P.length ? `${P.length} 張・點照片開始修圖，長按可多選` : '';
    if (!P.length) { G.innerHTML = `<div class="empty"><div class="big">🖼️</div><b>還沒有照片</b><p>按「＋ 匯入」選擇 RAW（ARW、DNG、NEF、CR3…）或 JPG。<br>匯入後會自動辨識相機並套用你的相機模板。</p></div>`; }
    else G.innerHTML = P.map(p => {
      const d = p.taken ? new Date(p.taken) : null, gps = p.edit && p.edit.gps || p.meta && p.meta.lat != null;
      return `<div class="ph ${p.port ? 'port' : ''} ${this.sel.has(p.id) ? 'sel' : ''}" data-id="${esc(p.id)}">
        <div class="im" style="${p.thumb ? `background-image:url(${p.thumb})` : ''}">${p.thumb ? '' : '🖼️'}</div>
        <div class="ck">✓</div><div class="badges">${p.edit ? '<span>🎛️</span>' : ''}${gps ? '<span>📍</span>' : ''}${(p.exported || []).length ? '<span>✓</span>' : ''}</div>
        <div class="nm">${esc(p.name)}</div><div class="mt">${esc(camName(p.key || ''))}${d ? '・' + fmtMD(d) + ' ' + fmtHM(d) : ''}</div></div>`;
    }).join('');
    $$('#libGrid .ph').forEach(el => {
      let t = 0, moved = false;
      el.onpointerdown = () => { moved = false; t = setTimeout(() => { t = 0; if (!this.selMode) this.setSel(true); this.toggle(el.dataset.id); }, 520); };
      el.onpointermove = () => { moved = true; }; el.onpointerleave = () => clearTimeout(t);
      el.onpointerup = () => { if (t) { clearTimeout(t); t = 0; if (this.selMode) this.toggle(el.dataset.id); else Editor.open(this.photos.find(p => p.id === el.dataset.id)); } };
    });
    $('#libBar').classList.toggle('hide', !this.selMode);
    $('#libCnt').textContent = `已選 ${this.sel.size} 張`;
  },
  toggle(id) { this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id); this.render(); },
  selected() { return this.photos.filter(p => this.sel.has(p.id)); },
  async act(a) {
    const S = this.selected();
    if (a === 'all') { if (this.sel.size === this.photos.length) this.sel.clear(); else this.photos.forEach(p => this.sel.add(p.id)); this.render(); return; }
    if (!S.length) { toast('請先選取照片'); return; }
    if (a === 'ai') return this.batchAI(S);
    if (a === 'geo') { Geo.target = S.map(p => p.id); App.show('v-geo'); toast(`搜尋地點後，會套用到 ${S.length} 張照片`); return; }
    if (a === 'exp') return Exporter.sheet(S);
    if (a === 'del') { if (await ask('從清單移除？', `移除 ${S.length} 張照片的修圖設定與縮圖（手機裡的原檔不會被刪除）。`, ['移除', '取消']) !== 0) return; for (const p of S) { await IDB.del(p.id); } this.photos = this.photos.filter(p => !this.sel.has(p.id)); this.sel.clear(); this.render(); }
  },
  async batchAI(S) {
    Prog.show('AI 自動調整', `0 / ${S.length}`);
    for (let i = 0; i < S.length; i++) {
      if (Prog.cancel) break; const p = S[i];
      try { await Editor.load(p, { quiet: true }); await Editor.runAI(true); await Editor.saveThumb(); } catch (e) { toast(p.name + '：' + e.message, 4000); }
      Prog.set((i + 1) / S.length, `${i + 1} / ${S.length}・${p.name}`);
    }
    Prog.hide(); this.render(); toast('AI 自動調整完成');
  },
  save(p) { return IDB.put(p); }
};
function slimMeta(m) {
  const o = {}; ['make', 'model', 'lens', 'focal', 'iso', 'fnum', 'exposure', 'dateOriginal', 'offsetTime', 'orientation', 'lat', 'lon', 'sony'].forEach(k => { if (m[k] != null && m[k] !== '') o[k] = m[k]; });
  return o;
}
