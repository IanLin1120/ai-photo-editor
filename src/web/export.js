/* ================= 匯出 ================= */
const Exporter = {
  W: null,
  worker() { return this.W || (this.W = mkWorker()); },
  fileName(p, o, i, ext) {
    const base = p.name.replace(/\.[^.]+$/, ''), d = p.taken ? new Date(p.taken) : new Date(), g = p.edit && p.edit.gps;
    if (o.name === 'keep') return base + '.' + ext;
    const T = { '{原檔名}': base, '{日期}': `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`, '{時間}': `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
      '{相機}': camName(p.key || '').replace(/\s+/g, ''), '{地點}': g && g.name ? g.name : '', '{序號}': String(i + 1).padStart(3, '0') };
    let s = o.pattern || '{原檔名}'; for (const k in T) s = s.split(k).join(T[k]);
    s = s.replace(/[\\/:*?"<>|]+/g, '_').replace(/_+$/g, '').trim() || base;
    return s + '.' + ext;
  },
  sheet(L) {
    const o = Object.assign({}, CFG.exp), cloudReady = Cloud.ready();
    const fmtRow = (v, n, d) => `<button class="btn ${o.fmt === v ? 'on' : ''}" data-fmt="${v}">${n}</button>`;
    const sample = L[0];
    openSheet(`<h3>📤 匯出 ${L.length} 張</h3>
      <div class="sec">格式</div><div class="seg" id="xFmt">${fmtRow('jpeg', 'JPEG')}${fmtRow('tiff', 'TIFF 16-bit')}${fmtRow('png', 'PNG')}</div>
      <div class="sl" id="xQ" style="${o.fmt === 'jpeg' ? '' : 'display:none'}"><label>JPEG 品質</label><input type="range" min="60" max="100" value="${o.q}"><output>${o.q}</output></div>
      <div class="sec">尺寸</div><div class="seg" id="xSize"><button class="btn ${o.size === 'full' ? 'on' : ''}" data-s="full">原始最大畫素</button><button class="btn ${o.size === 'long' ? 'on' : ''}" data-s="long">指定長邊</button><button class="btn ${o.size === 'half' ? 'on' : ''}" data-s="half">一半（較快）</button></div>
      <div class="row" id="xLong" style="${o.size === 'long' ? '' : 'display:none'}"><input type="number" id="xLongV" value="${o.long}" min="400" max="12000" style="width:110px"> px（長邊）</div>
      <div class="sec">檔名</div><div class="seg" id="xName"><button class="btn ${o.name === 'keep' ? 'on' : ''}" data-n="keep">維持原檔名</button><button class="btn ${o.name === 'custom' ? 'on' : ''}" data-n="custom">自訂檔名</button></div>
      <div id="xPat" style="${o.name === 'custom' ? '' : 'display:none'}"><input id="xPatV" value="${esc(o.pattern)}" style="width:100%;margin-top:6px">
        <div class="chips">${['{原檔名}', '{日期}', '{時間}', '{相機}', '{地點}', '{序號}'].map(t => `<button class="btn sm" data-tok="${t}">${t}</button>`).join('')}</div></div>
      <div class="sub" id="xEx"></div>
      <div class="sec">儲存位置</div><div class="row"><span class="sub">相簿／Pictures／</span><input id="xFolder" value="${esc(o.folder)}" style="flex:1"></div>
      <div class="sec">中繼資料</div>
      <div class="lab"><span>保留原始 EXIF<div class="sub">相機、鏡頭、光圈、快門、ISO、拍攝時間（不變）</div></span><label class="sw"><input type="checkbox" id="xExif" ${o.exif ? 'checked' : ''}><span></span></label></div>
      <div class="lab"><span>寫入地點座標（GPS）</span><label class="sw"><input type="checkbox" id="xGps" ${o.gps ? 'checked' : ''}><span></span></label></div>
      <div class="lab"><span>檔案時間＝拍攝時間<div class="sub">相簿依拍攝時間排序，不會跑到「今天」</div></span><label class="sw"><input type="checkbox" id="xMt" ${o.mtime ? 'checked' : ''}><span></span></label></div>
      <div class="lab"><span>☁️ 雲端 AI 降噪<div class="sub">${cloudReady ? '全解析度 SCUNet 降噪，雜訊與彩噪清乾淨、細節保留（每張約 5–10 分鐘）' : '尚未設定 GitHub 權杖（設定頁）'}</div></span><label class="sw"><input type="checkbox" id="xCloud" ${cloudReady && o.cloud ? 'checked' : ''} ${cloudReady ? '' : 'disabled'}><span></span></label></div>
      <div class="acts"><button class="btn pri" id="xGo">📤 開始匯出</button><button class="btn" id="xCancel">取消</button></div>`);
    const ex = () => { const ext = o.fmt === 'tiff' ? 'tif' : o.fmt === 'png' ? 'png' : 'jpg'; $('#xEx').textContent = '範例：' + this.fileName(sample, o, 0, ext); };
    $('#xFmt').onclick = e => { const b = e.target.closest('[data-fmt]'); if (!b) return; o.fmt = b.dataset.fmt; $$('#xFmt .btn').forEach(x => x.classList.toggle('on', x === b)); $('#xQ').style.display = o.fmt === 'jpeg' ? '' : 'none'; ex(); };
    $('#xQ input').oninput = e => { o.q = +e.target.value; $('#xQ output').textContent = o.q; };
    $('#xSize').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; o.size = b.dataset.s; $$('#xSize .btn').forEach(x => x.classList.toggle('on', x === b)); $('#xLong').style.display = o.size === 'long' ? '' : 'none'; };
    $('#xName').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; o.name = b.dataset.n; $$('#xName .btn').forEach(x => x.classList.toggle('on', x === b)); $('#xPat').style.display = o.name === 'custom' ? '' : 'none'; ex(); };
    $('#xPatV').oninput = e => { o.pattern = e.target.value; ex(); };
    $$('#xPat [data-tok]').forEach(b => b.onclick = () => { const i = $('#xPatV'); i.value += b.dataset.tok; o.pattern = i.value; ex(); });
    $('#xCancel').onclick = closeSheet; ex();
    $('#xGo').onclick = () => {
      o.long = +$('#xLongV').value || 4000; o.folder = $('#xFolder').value.trim() || 'AI修圖'; o.exif = $('#xExif').checked; o.gps = $('#xGps').checked; o.mtime = $('#xMt').checked; o.cloud = $('#xCloud').checked;
      CFG.exp = Object.assign(CFG.exp, o); saveCfg(); closeSheet(); this.run(L, o);
    };
  },
  async run(L, o) {
    if (o.cloud) return Cloud.submitMany(L, o);
    Prog.show('匯出照片', '準備中…'); const W = this.worker(); let ok = 0;
    for (let i = 0; i < L.length; i++) {
      if (Prog.cancel) break; const p = L[i], tag = `${i + 1} / ${L.length}・${p.name}`;
      try {
        W.onProg = f => Prog.set((i + f * 0.92) / L.length, `${tag}・${Math.round(f * 100)}%`);
        const r = await this.one(p, o, W, s => Prog.set(i / L.length, `${tag}・${s}`));
        const name = this.fileName(p, o, i, r.ext);
        Prog.set((i + 0.95) / L.length, `${tag}・儲存中`);
        const where = await saveBytes(r.bytes, name, r.mime, o.folder, o.mtime ? p.taken : 0);
        p.exported = (p.exported || []).concat({ t: Date.now(), name, fmt: o.fmt, w: r.w, h: r.h, where }); await Lib.save(p); ok++;
      } catch (e) { console.error(e); if (Prog.cancel) break; toast(p.name + ' 匯出失敗：' + e.message, 5000); if (/memory|記憶體|Array buffer/i.test(e.message)) { W.restart(); } }
    }
    W.onProg = null; Prog.hide(); Lib.render();
    if (ok) toast(`已匯出 ${ok} 張到「${isApp ? '相簿／Pictures／' + o.folder : '下載'}」`, 4000);
  },
  /* 單張：讀原檔 → 解碼（全尺寸或一半）→ 背景執行緒全解析度渲染 → 位元組 */
  async one(p, o, W, say) {
    Lib.ensure(p); say('讀取原檔'); const bytes = await photoBytes(p);
    const meta = EXIF.parse(bytes) || {}, e = p.edit || newEdit();
    const P = Editor.params.call({ p, e: e }, e), lens = Object.assign({ on: true, dist: 1, vig: 1, ca: true }, e.lens);
    const gps = o.gps && e.gps ? { lat: e.gps.lat, lon: e.gps.lon, name: e.gps.name } : null;
    const opt = { fmt: o.fmt, q: o.q, long: o.size === 'long' ? o.long : 0, exif: o.exif, maker: false, gps, software: 'AI修圖軟體 ' + APP_VER };
    if (!o.exif) { opt.gps = gps; }
    if (p.raw) {
      say(o.size === 'half' ? '解碼 RAW（一半尺寸）' : '解碼 RAW（全尺寸）');
      const half = o.size === 'half' || (o.size === 'long' && o.long <= 3000);
      const d = await RAW.decode(bytes, half);
      say('渲染中');
      return W.call('export', { kind: 'raw', key: p.key, u16: d.u16, w: d.w, h: d.h, flip: d.flip, meta: o.exif ? meta : {}, lens, P, opt }, [d.u16.buffer]);
    }
    say('渲染中');
    return W.call('export', { kind: 'rgb', key: 'JPEG', bytes, meta: o.exif ? meta : {}, P, opt }, [bytes.buffer]);
  }
};
