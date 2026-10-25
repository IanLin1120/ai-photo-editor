/* ================= ④ 雲端 AI 降噪（GitHub Actions） =================
   流程：原檔 AES-GCM 加密 → 上傳成 GitHub「草稿 Release」的附件（不進 git 歷史）→ repository_dispatch 觸發 Actions
        → 雲端解密、LibRaw 解碼、SCUNet AI 降噪、用同一份修圖引擎全解析度渲染、寫 EXIF/GPS → 加密傳回 → 手機下載解密存檔 → 刪除 Release
   金鑰：手機產生 32 bytes 金鑰，用 GitHub 公鑰（libsodium sealed box）加密後設成儲存庫 Secret「CLOUD_KEY」 */
const Cloud = {
  jobs: lsGet('aip.jobs', []),
  save() { lsSet('aip.jobs', this.jobs); this.render(); },
  repo() { return (CFG.ghRepo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, ''); },
  ready() { return isApp && !!CFG.ghToken && !!this.repo() && !!CFG.cloudKey; },
  api(path, o = {}) {
    const u = path.startsWith('http') ? path : `https://api.github.com/repos/${this.repo()}${path}`;
    return fetch(u, Object.assign({}, o, { headers: Object.assign({ Authorization: 'Bearer ' + CFG.ghToken, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, o.headers || {}) }))
      .then(async r => { const t = r.status === 204 ? '' : await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { } if (!r.ok) { const e = new Error((j && j.message) || ('HTTP ' + r.status)); e.status = r.status; throw e; } return j; });
  },
  /* ---------- 加密 ---------- */
  keyBytes() { const s = atob(CFG.cloudKey); return Uint8Array.from(s, c => c.charCodeAt(0)); },
  newKey() { const k = crypto.getRandomValues(new Uint8Array(32)); CFG.cloudKey = btoa(String.fromCharCode(...k)); saveCfg(); },
  async enc(bytes) {
    const k = await crypto.subtle.importKey('raw', this.keyBytes(), 'AES-GCM', false, ['encrypt']), iv = crypto.getRandomValues(new Uint8Array(12));
    const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes)), out = new Uint8Array(16 + c.length);
    out.set([65, 73, 80, 49]); out.set(iv, 4); out.set(c, 16); return out;
  },
  async dec(bytes) {
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'AIP1') throw new Error('雲端結果格式錯誤');
    const k = await crypto.subtle.importKey('raw', this.keyBytes(), 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(4, 16) }, k, bytes.subarray(16)));
  },
  /* libsodium crypto_box_seal（GitHub Secret 要求的格式） */
  seal(msg, pk) {
    const ek = nacl.box.keyPair(), nonce = BLAKE.blake2b(new Uint8Array([...ek.publicKey, ...pk]), null, 24);
    const c = nacl.box(msg, nonce, pk, ek.secretKey), out = new Uint8Array(32 + c.length); out.set(ek.publicKey); out.set(c, 32); return out;
  },
  async setupSecret() {
    if (!CFG.cloudKey) this.newKey();
    const pk = await this.api('/actions/secrets/public-key');
    const sealed = this.seal(new TextEncoder().encode(CFG.cloudKey), Uint8Array.from(atob(pk.key), c => c.charCodeAt(0)));
    await this.api('/actions/secrets/CLOUD_KEY', { method: 'PUT', body: JSON.stringify({ encrypted_value: btoa(String.fromCharCode(...sealed)), key_id: pk.key_id }) });
    CFG.cloudSecretAt = Date.now(); saveCfg();
  },
  async check() {
    const out = {};
    try { const r = await this.api(''); out.repo = r.full_name; out.private = r.private; out.push = r.permissions && r.permissions.push; } catch (e) { out.err = e.status === 404 ? '找不到儲存庫（名稱錯誤或權杖沒有存取權）' : e.status === 401 ? '權杖無效或已過期' : e.message; return out; }
    try { await this.api('/contents/.github/workflows/cloud-denoise.yml'); out.wf = true; } catch (e) { out.wf = false; }
    try { const s = await this.api('/actions/secrets/CLOUD_KEY'); out.secret = !!s; } catch (e) { out.secret = false; }
    return out;
  },
  /* ---------- 送出 ---------- */
  async submitMany(L, o) {
    if (!this.ready()) { toast('請先到設定填入 GitHub 權杖並完成雲端設定', 4000); App.show('v-set'); return; }
    App.show('v-cloud');
    for (const p of L) { try { await this.submit(p, o); } catch (e) { toast(p.name + '：' + e.message, 5000); } }
    this.poll();
  },
  async submit(p, o) {
    const job = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), e = p.edit || newEdit();
    const J = { id: job, pid: p.id, name: p.name, st: '準備中', pct: 0, t: Date.now(), fmt: o.fmt, file: '', folder: o.folder, taken: o.mtime ? p.taken : 0 };
    this.jobs.unshift(J); this.save();
    const up = (st, pct) => { J.st = st; if (pct != null) J.pct = pct; this.save(); };
    try {
      Lib.ensure(p); up('讀取原檔');
      const bytes = await photoBytes(p);
      const P = Editor.params.call({ p, e }, e), lens = Object.assign({ on: true, dist: 1, vig: 1, ca: true }, e.lens);
      const outExt = o.fmt === 'tiff' ? 'tif' : o.fmt === 'png' ? 'png' : 'jpg';
      J.file = Exporter.fileName(p, o, 0, outExt);
      const spec = { v: 1, name: p.name, raw: !!p.raw, key: p.key, P, lens, strength: CFG.cloudStrength,
        opt: { fmt: o.fmt, q: o.q, long: o.size === 'long' ? o.long : 0, half: o.size === 'half', exif: o.exif, gps: o.gps && e.gps ? { lat: e.gps.lat, lon: e.gps.lon, name: e.gps.name } : null, software: 'AI修圖軟體 ' + APP_VER + '（雲端 AI 降噪）' } };
      up('加密中');
      const encIn = await this.enc(bytes), encJs = await this.enc(new TextEncoder().encode(JSON.stringify(spec)));
      up('建立雲端工作');
      const rel = await this.api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: 'aip-' + job, name: 'AI修圖雲端工作 ' + job, body: '由 AI修圖軟體 建立的暫存工作，處理完成會自動刪除。內容已加密。', draft: true }) });
      J.rel = rel.id; this.save();
      await this.upload(rel.id, job + '.json', encJs, J, 0, 0.02);
      await this.upload(rel.id, job + '.in', encIn, J, 0.02, 1);
      up('排隊中', 0);
      await this.api('/dispatches', { method: 'POST', body: JSON.stringify({ event_type: 'aip-denoise', client_payload: { release_id: rel.id, job } }) });
      J.sent = Date.now(); up('雲端處理中（排隊）');
    } catch (err) { J.st = '失敗：' + err.message; J.fail = true; this.save(); throw err; }
  },
  async upload(relId, name, bytes, J, p0, p1) {
    const tmp = 'up_' + name; await saveBytes(bytes, tmp, 'application/octet-stream', 'cache:', 0);
    const r = await netFile('POST', `https://uploads.github.com/repos/${this.repo()}/releases/${relId}/assets?name=${encodeURIComponent(name)}`,
      { Authorization: 'Bearer ' + CFG.ghToken, Accept: 'application/vnd.github+json', 'Content-Type': 'application/octet-stream' }, tmp, '',
      (d, t) => { J.st = `上傳中 ${fmtMB(d)} / ${fmtMB(t)}`; J.pct = p0 + (p1 - p0) * d / t; this.render(); });
    NAT.call('delCache', tmp);
    if (!(r.status >= 200 && r.status < 300)) throw new Error('上傳失敗（' + (r.status || r.text) + '）');
  },
  /* ---------- 進度與下載 ---------- */
  async poll() {
    clearTimeout(this._pt); if (!this.ready()) return;
    const act = this.jobs.filter(j => j.rel && !j.done && !j.fail);
    for (const J of act) {
      try {
        const assets = await this.api(`/releases/${J.rel}/assets?per_page=50`);
        const out = assets.find(a => a.name === J.id + '.out'), err = assets.find(a => a.name === J.id + '.err'), st = assets.find(a => a.name === J.id + '.status');
        if (err) { const t = await this.fetchAsset(err.id, true); J.st = '失敗：' + t; J.fail = true; this.save(); this.cleanup(J); continue; }
        if (out) { await this.finish(J, out); continue; }
        if (st) { try { const t = JSON.parse(await this.fetchAsset(st.id, true)); J.st = '雲端：' + t.msg; J.pct = t.pct || 0; } catch (e) { } }
        else if (Date.now() - J.sent > 20 * 60e3) J.st = '雲端處理中（等候 GitHub 排程）';
        this.save();
      } catch (e) { if (e.status === 404) { J.st = '工作已不存在'; J.fail = true; this.save(); } }
    }
    if (this.jobs.some(j => j.rel && !j.done && !j.fail)) this._pt = setTimeout(() => this.poll(), 20000);
  },
  async fetchAsset(id, text) {
    const name = 'dl_' + id;
    const r = await netFile('GET', `https://api.github.com/repos/${this.repo()}/releases/assets/${id}`, { Authorization: 'Bearer ' + CFG.ghToken, Accept: 'application/octet-stream' }, '', name);
    if (!(r.status >= 200 && r.status < 300)) throw new Error('下載失敗（' + r.status + '）');
    const b = new Uint8Array(await (await fetch(location.origin + '/cache/' + name, { cache: 'no-store' })).arrayBuffer()); NAT.call('delCache', name);
    return text ? new TextDecoder().decode(b) : b;
  },
  async finish(J, asset) {
    J.st = `下載結果（${fmtMB(asset.size)}）`; this.save();
    const enc = await this.fetchAsset(asset.id), bytes = await this.dec(enc);
    const mime = J.fmt === 'tiff' ? 'image/tiff' : J.fmt === 'png' ? 'image/png' : 'image/jpeg';
    await saveBytes(bytes, J.file, mime, J.folder, J.taken || 0);
    J.done = true; J.st = '✅ 完成，已存到相簿'; J.pct = 1; this.save();
    const p = Lib.photos.find(x => x.id === J.pid); if (p) { p.exported = (p.exported || []).concat({ t: Date.now(), name: J.file, fmt: J.fmt, cloud: true }); Lib.save(p); Lib.render(); }
    toast('☁️ ' + J.file + ' 雲端降噪完成', 4000); this.cleanup(J);
  },
  async cleanup(J) { try { if (J.rel) await this.api(`/releases/${J.rel}`, { method: 'DELETE' }); } catch (e) { } },
  async remove(id) { const J = this.jobs.find(j => j.id === id); if (!J) return; if (!J.done) await this.cleanup(J); this.jobs = this.jobs.filter(j => j.id !== id); this.save(); },
  render() {
    const el = $('#clJobs'); if (!el) return;
    el.innerHTML = `<h3>🗂 工作</h3>` + (this.jobs.length ? this.jobs.slice(0, 40).map(J => `<div class="job"><div class="grow"><b>${esc(J.name)}</b><div class="sub">${esc(J.st)}</div>${!J.done && !J.fail ? `<div class="bar"><i style="width:${Math.round((J.pct || 0) * 100)}%;background:var(--ac)"></i></div>` : ''}</div><button class="btn sm" data-rm="${J.id}">${J.done || J.fail ? '✕' : '取消'}</button></div>`).join('')
      + `<div class="acts"><button class="btn sm" id="clRe">⟳ 重新檢查</button><button class="btn sm" id="clAct">🔗 GitHub Actions</button></div>` : '<div class="sub">還沒有雲端工作。匯出時勾選「☁️ 雲端 AI 降噪」就會送到這裡。</div>');
    $$('#clJobs [data-rm]').forEach(b => b.onclick = () => this.remove(b.dataset.rm));
    const re = $('#clRe'); if (re) re.onclick = () => this.poll();
    const ac = $('#clAct'); if (ac) ac.onclick = () => NAT.call('openUrl', `https://github.com/${this.repo()}/actions`);
  },
  renderIntro() {
    $('#clIntro').innerHTML = `<h3>怎麼運作</h3><div class="sub" style="line-height:1.7">手機修圖時用的是輕量降噪；要把<b>噪點與彩噪完全清乾淨、又不把細節抹掉</b>，匯出時勾選「☁️ 雲端 AI 降噪」。照片會<b>加密</b>後上傳到你的 GitHub（${esc(this.repo() || '未設定')}），由 GitHub Actions 用 SCUNet 真實雜訊模型在<b>全解析度</b>處理，再套用你在手機上調好的所有設定、寫回原始 EXIF 與地點，加密傳回相簿。處理完雲端上的檔案會自動刪除。</div>
      <div class="acts">${this.ready() ? '<span class="ok">✓ 已設定完成</span>' : '<button class="btn pri" id="clSet">前往設定 GitHub</button>'}</div>`;
    const b = $('#clSet'); if (b) b.onclick = () => App.show('v-set');
  }
};
