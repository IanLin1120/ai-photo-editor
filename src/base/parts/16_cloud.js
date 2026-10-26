/* ================= 雲端 AI 降噪（GitHub Actions） =================
   流程：每批相片 → 建立暫存分支 aiphoto-job-xxx（只含這批相片）→ 觸發 workflow
   → 雲端以 Intel Open Image Denoise 全解析度降噪 → 結果推回同一分支
   → App 下載結果 → 刪除暫存分支與執行紀錄。佇列存在裝置上，App 重開會自動接續。 */
const Cloud = {
  API: 'https://api.github.com', WF: 'aiphoto-denoise.yml', jobs: [], running: false, msg: '',
  cfg() { // 原地補預設值（不可每次換新物件，否則設定畫面改到的是舊物件）
    if (!CFG.cloud || typeof CFG.cloud !== 'object') CFG.cloud = {};
    const d = { repo: '', model: 'hq', autoExport: false, ver: '' }; for (const k in d) if (!(k in CFG.cloud)) CFG.cloud[k] = d[k];
    return CFG.cloud;
  },
  token() { try { return localStorage.getItem('gh-token') || ''; } catch (e) { return ''; } },
  setToken(t) { try { t ? localStorage.setItem('gh-token', t.replace(/\s+/g, '')) : localStorage.removeItem('gh-token'); } catch (e) {} },
  ready() { return !!(this.cfg().repo && /^[\w.-]+\/[\w.-]+$/.test(this.cfg().repo) && this.token()); },
  load() { try { this.jobs = JSON.parse(localStorage.getItem('cloud-jobs') || '[]'); } catch (e) { this.jobs = []; } },
  save() { try { localStorage.setItem('cloud-jobs', JSON.stringify(this.jobs.map(({ _t, ...j }) => j))); } catch (e) {} this.updUI(); },
  active() { return this.jobs.filter((j) => !['done', 'error', 'canceled'].includes(j.state)); },

  /* App 版：透過原生網路連線（不受瀏覽器 CORS 限制，背景也穩定）；網頁版：fetch */
  hid: 0, hwait: new Map(),
  onHttp(m) { const r = this.hwait.get(m.id); if (r) { this.hwait.delete(m.id); r(m); } },
  async nfetch(url, method, headers, body) {
    const id = 'h' + (++this.hid) + Date.now().toString(36);
    AIP.httpBegin(id);
    if (body) for (let i = 0; i < body.length; i += 512 * 1024) { if (!AIP.httpChunk(id, body.slice(i, i + 512 * 1024))) throw new TypeError('原生連線寫入失敗'); if (i && i % (4 << 20) === 0) await sleep(0); }
    const m = await new Promise((res) => { this.hwait.set(id, res); AIP.httpSend(id, method, url, JSON.stringify(headers)); });
    if (m.err) { AIP.httpDone(id); throw new TypeError('無法連線到 GitHub：' + m.err); }
    let blob = new Blob([]);
    try { const r = await fetch(location.origin + '/http/' + id); if (r.ok) blob = await r.blob(); } finally { AIP.httpDone(id); }
    return { status: m.status, blob };
  },
  async api(path, opt = {}) {
    const url = /^https:/.test(path) ? path : `${this.API}/repos/${this.cfg().repo}${path}`;
    const method = opt.method || 'GET';
    const headers = { Authorization: 'Bearer ' + this.token(), Accept: opt.accept || 'application/vnd.github+json' };
    let body; if (opt.body) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opt.body); }
    let status, blob;
    if (isApp && window.AIP && AIP.httpSend) ({ status, blob } = await this.nfetch(url, method, headers, body));
    else {
      let r; try { r = await fetch(url, { method, headers, body }); } catch (e) { throw new TypeError('無法連線到 GitHub（請確認網路連線）'); }
      status = r.status; blob = await r.blob();
    }
    if (opt.ok404 && status === 404) return null;
    if (status < 200 || status >= 300) {
      let m = ''; try { m = JSON.parse(await blob.text()).message; } catch (e) {}
      const hint = status === 401 ? '（權杖無效或已過期，請重新貼上）' : status === 403 ? '（權杖權限不足或達到速率上限）' : status === 404 ? '（找不到儲存庫：請確認「帳號/儲存庫」拼字，以及權杖有選到這個儲存庫）' : '';
      const err = new Error(`GitHub ${status}：${m || ''}${hint}`); err.status = status; throw err;
    }
    if (opt.blob) return blob;
    if (status === 204 || !blob.size) return null;
    return JSON.parse(await blob.text());
  },
  b64text(s) { const u = new TextEncoder().encode(s); let o = ''; for (let i = 0; i < u.length; i += 0x8000) o += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(o); },
  blobB64(b) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(b); }); },
  scriptVer() { let h = 0; const s = CLOUD_YML + CLOUD_PY; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h >>> 0); },

  /* 安裝（或更新）雲端腳本到預設分支，並檢查權限 */
  async setup(force) {
    const repo = await this.api('');
    if (!repo.permissions || !repo.permissions.push) throw new Error('權杖沒有寫入此儲存庫的權限（需要 Contents：Read and write）');
    this.defBranch = repo.default_branch || 'main'; this.isPrivate = repo.private;
    if (!force && this.cfg().ver === this.scriptVer() + ':' + this.cfg().repo) return repo;
    for (const [path, text, msg] of [['.github/aiphoto/denoise.py', CLOUD_PY, '雲端降噪程式'], ['.github/workflows/' + this.WF, CLOUD_YML, '雲端降噪工作流程']]) {
      const cur = await this.api('/contents/' + path, { ok404: true });
      const b64 = this.b64text(text);
      if (cur && (cur.content || '').replace(/\n/g, '') === b64) continue;
      try { await this.api('/contents/' + path, { method: 'PUT', body: { message: `AI修圖軟體：安裝${msg}`, content: b64, sha: cur ? cur.sha : undefined } }); }
      catch (e) { if (path.includes('workflows') && (e.status === 403 || e.status === 404)) throw new Error('無法建立工作流程檔：權杖需要 Workflows：Read and write 權限'); throw e; }
    }
    this.cfg().ver = this.scriptVer() + ':' + this.cfg().repo; saveCfg();
    return repo;
  },
  /* 逐步診斷：權杖是誰的 → 看得到哪些儲存庫 → 權限 → 安裝程式 */
  async test() {
    const name = this.cfg().repo;
    let me;
    try { me = await this.api('https://api.github.com/user'); }
    catch (e) { if (e.status === 401) throw new Error('【步驟1 權杖】權杖無效或不完整（401）。請重新產生並完整複製貼上'); throw new Error('【步驟1 權杖】' + e.message); }
    try { await this.api(''); }
    catch (e) {
      if (e.status !== 404) throw new Error('【步驟2 儲存庫】' + e.message);
      let names = [];
      try { const list = await this.api('https://api.github.com/user/repos?per_page=100&sort=updated'); names = (list || []).map((r) => r.full_name); } catch (e2) {}
      const same = names.find((n) => n.toLowerCase() === name.toLowerCase());
      if (same) throw new Error(`【步驟2 儲存庫】權杖看得到 ${same}，但讀取失敗，請稍後再試`);
      throw new Error(`【步驟2 儲存庫】權杖屬於帳號「${me.login}」，但看不到「${name}」。\n這個權杖能存取的儲存庫：${names.length ? names.join('、') : '（一個都沒有）'}\n→ ${me.login.toLowerCase() !== name.split('/')[0].toLowerCase() ? '帳號名稱和權杖的帳號不同，請改成 ' + me.login + '/儲存庫名稱。' : '請把權杖的 Repository access 設為 Only select repositories 並勾選這個儲存庫，或改用 Tokens (classic)。'}`);
    }
    let repo;
    try { repo = await this.setup(true); } catch (e) { throw new Error('【步驟3 安裝雲端程式】' + e.message); }
    await this.api(`/actions/workflows/${this.WF}`).catch((e) => { if (e.status === 403) throw new Error('權杖需要 Actions：Read and write 權限'); });
    return repo;
  },

  /* 加入佇列：依大小分批（每批 ≤8 張、≤150MB） */
  async enqueue(recs, model) {
    if (!this.ready()) { toast('請先到「設定 → 雲端 AI 降噪」填入 GitHub 儲存庫與權杖', 4500); App.nav('set'); return; }
    model = model || this.cfg().model; const busy = new Set(this.active().flatMap((j) => j.items.map((i) => i.id)));
    const list = recs.filter((r) => !busy.has(r.id)); if (!list.length) { toast('這些相片已在雲端佇列中'); return; }
    let cur = null, size = 0;
    for (const r of list) {
      const isRaw = !!r.rawLazy && !r.masterOri1; const b = await DB.get(isRaw ? 'raw' : 'files', r.id); if (!b) continue;
      if (!cur || cur.items.length >= 8 || size + b.size > 150e6) { cur = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), state: 'queued', model, items: [], t: Date.now() }; cur.branch = 'aiphoto-job-' + cur.id; this.jobs.push(cur); size = 0; }
      cur.items.push({ id: r.id, name: r.name, raw: isRaw, chroma: (((r.edit || {}).ai || {}).chroma ?? 60) / 100, ori: (r.convFrom || r.masterOri1) ? 1 : (r.exif && r.exif.orientation) || 1, ext: isRaw ? ((/\.([a-z0-9]+)$/i.exec(r.name) || [, 'raw'])[1].toLowerCase()) : /png/.test(b.type) ? 'png' : /webp/.test(b.type) ? 'webp' : 'jpg' }); size += b.size;
    }
    this.jobs = this.jobs.filter((j) => j.items.length); this.save();
    toast(`已加入雲端佇列：${list.length} 張相片，可切到背景或關閉螢幕`, 4000);
    this.run();
  },

  /* AI 修復（消除拖影／反光／AI 消除／畫質增強／人像補光）：結果會成為新的原始影像（可還原） */
  OPS: { deblur: 'AI 消除拖影', dereflect: 'AI 消除反光', erase: 'AI 消除', rescue: 'AI 救援廢片', enhance: 'AI 畫質增強', relight: 'AI 人像補光', beauty: 'AI 人像美顏' },
  async enqueueFix(recs, ops, p, masks = {}) {
    if (!this.ready()) { toast('請先到「設定 → 雲端 AI 降噪」連接 GitHub', 4500); App.nav('set'); return false; }
    const busy = new Set(this.active().flatMap((j) => j.items.map((i) => i.id)));
    const list = recs.filter((r) => !busy.has(r.id)); if (!list.length) { toast('這些相片已在雲端處理中'); return false; }
    let cur = null;
    for (const r of list) {
      const isRaw = !!r.rawLazy && !r.masterOri1; const b = await DB.get(isRaw ? 'raw' : 'files', r.id); if (!b) continue;
      if (!cur || cur.items.length >= 3) { cur = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), state: 'queued', model: this.cfg().model, kind: 'fix', items: [], t: Date.now() }; cur.branch = 'aiphoto-job-' + cur.id; this.jobs.push(cur); }
      const o = ops.filter((k) => k !== 'erase' || masks[r.id]);
      const ed = normEdit(r.edit || {}); const wantDn = !!(ed.ai.on && (r.cloudAi || CFG.cloud.dnWithFix !== false));
      if (masks[r.id]) await DB.put('ai', masks[r.id], 'mask:' + r.id);
      cur.items.push({ id: r.id, name: r.name, raw: isRaw, fix: true, ops: wantDn ? [...o, 'dn'] : o, p, mask: !!masks[r.id], chroma: (ed.ai.chroma ?? 60) / 100,
        ori: (r.convFrom || r.masterOri1) ? 1 : (r.exif && r.exif.orientation) || 1, ext: isRaw ? ((/\.([a-z0-9]+)$/i.exec(r.name) || [, 'raw'])[1].toLowerCase()) : /png/.test(b.type) ? 'png' : /webp/.test(b.type) ? 'webp' : 'jpg' });
    }
    this.jobs = this.jobs.filter((j) => j.items.length); this.save();
    toast(`☁ 已送出 ${list.length} 張：${ops.map((k) => this.OPS[k]).join('、')}`, 4000); this.run(); return true;
  },
  /* AI 畫質增強（匯出後放大）：App 先照常算好最終成品，交給雲端放大 2 倍，回傳後補回 EXIF 存到相簿 */
  async enqueueSR(list, scale) {
    if (!this.ready()) throw new Error('請先到「設定 → 雲端 AI 降噪」設定 GitHub');
    // 每 2 張一個雲端工作：GitHub 會同時開多台機器平行處理，總時間大幅縮短
    let j = null;
    for (const x of list) {
      if (!j || j.items.length >= 2) { j = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), state: 'queued', model: 'sr', kind: 'sr', items: [], t: Date.now() }; j.branch = 'aiphoto-job-' + j.id; this.jobs.push(j); }
      const id = 'sr' + uid(); await DB.put('ai', new Blob([x.bytes], { type: 'image/jpeg' }), 'srin:' + id); await DB.put('ai', { exif: x.meta.exif || null, xmp: x.meta.xmp || null, name: x.name }, 'srmeta:' + id);
      j.items.push({ id, name: x.name, sr: true, scale: scale || 2, ext: 'jpg' });
    }
    this.save(); toast(`☁ 已送出 ${list.length} 張做 AI 畫質增強，完成後自動存到相簿`, 4000); this.run();
  },
  async upload(j) {
    j.state = 'uploading'; j.msg = '上傳中'; this.save();
    await this.setup();
    const tree = [];
    for (let k = 0; k < j.items.length; k++) {
      const it = j.items[k]; j.msg = `上傳 ${k + 1}/${j.items.length}`; this.save(); this.bg();
      const b = it.sr ? await DB.get('ai', 'srin:' + it.id) : await DB.get(it.raw ? 'raw' : 'files', it.id); if (!b) { it.err = '找不到原始檔'; continue; }
      it.file = `${it.id}.${it.ext}`;
      const r = await this.api('/git/blobs', { method: 'POST', body: { content: await this.blobB64(b), encoding: 'base64' } });
      tree.push({ path: 'in/' + it.file, mode: '100644', type: 'blob', sha: r.sha });
      if (it.mask) { const mb = await DB.get('ai', 'mask:' + it.id); if (mb) { const mr = await this.api('/git/blobs', { method: 'POST', body: { content: await this.blobB64(mb), encoding: 'base64' } }); tree.push({ path: `in/${it.id}_mask.png`, mode: '100644', type: 'blob', sha: mr.sha }); } }
    }
    const man = { app: 'AI修圖軟體', model: j.model, items: j.items.filter((i) => i.file).map(({ id, file, ori, name, raw, chroma, sr, scale, fix, ops, p }) => (sr ? { id, file, name, kind: 'sr', scale: scale || 2, dn: 0.7 } : fix ? { id, file, ori, name, raw: !!raw, kind: 'fix', ops, p, chroma: chroma ?? 0.6 } : { id, file, ori, name, raw: !!raw, chroma: chroma ?? 0.6 })) };
    if (!man.items.length) throw new Error('沒有可上傳的相片');
    const mb = await this.api('/git/blobs', { method: 'POST', body: { content: this.b64text(JSON.stringify(man)), encoding: 'base64' } });
    tree.push({ path: 'job.json', mode: '100644', type: 'blob', sha: mb.sha });
    const t = await this.api('/git/trees', { method: 'POST', body: { tree } });
    const c = await this.api('/git/commits', { method: 'POST', body: { message: `AI修圖軟體 暫存 ${j.id}（處理完成會自動刪除）`, tree: t.sha, parents: [] } });
    await this.api('/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + j.branch, sha: c.sha } });
    j.uploaded = true; j.msg = '啟動雲端工作'; this.save();
    for (let k = 0; ; k++) {
      try { await this.api(`/actions/workflows/${this.WF}/dispatches`, { method: 'POST', body: { ref: this.defBranch, inputs: { job: j.branch, model: j.model } } }); break; }
      catch (e) { if (k >= 5 || e.status === 401) throw e; await sleep(6000); }
    }
    j.state = 'running'; j.dispatched = Date.now(); j.msg = '雲端排隊中'; this.save();
  },

  async poll(j) {
    if (!j.runId) {
      const r = await this.api(`/actions/workflows/${this.WF}/runs?event=workflow_dispatch&per_page=50`);
      const run = (r.workflow_runs || []).find((x) => x.display_title === 'aiphoto ' + j.branch);
      if (!run) { if (Date.now() - j.dispatched > 5 * 60e3) throw new Error('找不到雲端工作（請確認儲存庫已啟用 Actions）'); return; }
      j.runId = run.id; j.runUrl = run.html_url;
    }
    const run = await this.api(`/actions/runs/${j.runId}`);
    if (run.status !== 'completed') {
      if (run.status !== 'in_progress') { j.msg = 'GitHub 排隊等待機器…'; this.save(); return; }
      let msg = '';
      try { // 雲端程式每處理一個步驟就回報 progress.json
        const pg = await this.api(`/contents/progress.json?ref=${encodeURIComponent(j.branch)}`, { ok404: true, accept: 'application/vnd.github.raw+json', blob: true });
        if (pg && pg.size) { const o = JSON.parse(await pg.text()); msg = o.text; j.pk = o.k; j.pn = o.n; }
      } catch (e) {}
      if (!msg) { try { const jr = await this.api(`/actions/runs/${j.runId}/jobs`); const st = (((jr.jobs || [])[0] || {}).steps || []).find((x) => x.status === 'in_progress'); if (st) msg = { '取得程式': '準備雲端環境', '取得相片': '下載相片到雲端', '設定 Git': '準備雲端環境', '安裝 AI 工具': '安裝 AI 工具與模型', 'AI 處理相片': 'AI 處理中', '回傳結果': '整理結果' }[st.name] || st.name; } catch (e) {} }
      const el = Math.round((Date.now() - (j.dispatched || Date.now())) / 60000);
      j.msg = (msg || '雲端處理中') + (el >= 1 ? `（已 ${el} 分鐘）` : ''); this.save(); this.bg(); return;
    }
    if (run.conclusion !== 'success') {
      // 取出失敗步驟與記錄最後幾行，方便判斷原因（工作紀錄刪除前先抓）
      let why = '';
      try {
        const jr = await this.api(`/actions/runs/${j.runId}/jobs`); const jb = (jr.jobs || [])[0] || {};
        const st = (jb.steps || []).find((x) => x.conclusion === 'failure'); if (st) why = `步驟「${st.name}」失敗`;
        const lg = await this.api(`/actions/jobs/${jb.id}/logs`, { blob: true, accept: 'text/plain' }).catch(() => null);
        if (lg && lg.size) { const t = (await lg.text()).replace(/\r/g, '').split('\n').map((l) => l.replace(/^\S+Z /, '')).filter((l) => l.trim() && !/^##\[(group|endgroup)/.test(l)); j.log = t.slice(-40).join('\n'); const er = t.filter((l) => /Error|錯誤|Killed|error:|Traceback|exit code/i.test(l)).slice(-2).join('｜'); if (er) why += (why ? '：' : '') + er.slice(0, 220); }
      } catch (e) {}
      throw new Error('雲端工作失敗（' + run.conclusion + '）' + (why ? '・' + why : ''));
    }
    await this.fetchResults(j);
  },

  async fetchResults(j) {
    j.state = 'downloading'; j.msg = '下載結果'; this.save();
    const tr = await this.api(`/git/trees/${encodeURIComponent(j.branch)}?recursive=1`);
    const files = {}; for (const e of tr.tree || []) if (e.type === 'blob') files[e.path] = e.sha;
    let status = {};
    if (files['out/status.json']) status = JSON.parse(await (await this.api(`/git/blobs/${files['out/status.json']}`, { blob: true, accept: 'application/vnd.github.raw+json' })).text());
    const done = [];
    for (let k = 0; k < j.items.length; k++) {
      const it = j.items[k]; const sha = files[`out/${it.id}.jpg`];
      if (!sha) { it.err = (status[it.id] && status[it.id].err) || it.err || '雲端未產生結果'; continue; }
      j.msg = `下載 ${k + 1}/${j.items.length}`; this.save(); this.bg();
      const b = await this.api(`/git/blobs/${sha}`, { blob: true, accept: 'application/vnd.github.raw+json' });
      if (it.sr) { await this.saveSR(it, b, status[it.id] || {}); it.ok = true; continue; }
      if (it.fix) {
        let dn = null; if (files[`out/${it.id}_dn.jpg`]) dn = await this.api(`/git/blobs/${files[`out/${it.id}_dn.jpg`]}`, { blob: true, accept: 'application/vnd.github.raw+json' });
        await this.applyFix(it, new Blob([b], { type: 'image/jpeg' }), dn ? new Blob([dn], { type: 'image/jpeg' }) : null, status[it.id] || {}); it.ok = true; done.push(it.id); continue;
      }
      await this.apply(it.id, new Blob([b], { type: 'image/jpeg' }), j.model); it.ok = true; done.push(it.id);
    }
    j.doneIds = done;
    await this.cleanup(j);
    j.state = 'done'; j.msg = `完成 ${done.length}/${j.items.length}`; j.tEnd = Date.now(); this.save();
    if (this.cfg().autoExport && done.length && j.kind !== 'fix') {
      // 只匯出這一批、且尚未自動匯出過的相片；背景執行，不會跳出匯出畫面打斷編輯
      const recs = (await Promise.all(done.map((id) => DB.get('photos', id)))).filter((r) => r && !(r.cloudExported >= r.cloudAi));
      for (const r of recs) { r.cloudExported = Date.now(); await DB.put('photos', r); const lr = Library.recs.find((x) => x.id === r.id); if (lr) lr.cloudExported = r.cloudExported; }
      if (recs.length) Exporter.run(recs, (r) => r.edit || {}, { silent: true }).catch((e) => console.warn(e));
    }
  },

  /* 套用 AI 修復結果：成為新的原始影像（第一次會先備份原圖，可隨時還原），並重建預覽與縮圖 */
  async applyFix(it, blob, dnBlob, st) {
    const id = it.id; const r = await DB.get('photos', id); if (!r) return;
    if (!r.fixOrig) {
      const of = await DB.get('files', id); if (of) await DB.put('files', of, id + ':orig');
      const op = await DB.get('prev', id); if (op) await DB.put('prev', op, id + ':orig');
      const ot = await DB.get('thumbs', id); if (ot) await DB.put('thumbs', ot, id + ':orig');
      r.fixOrig = { hadFiles: !!of, masterOri1: !!r.masterOri1, w: r.w, h: r.h };
    }
    await DB.put('files', blob, id); r.masterOri1 = true;
    const bm = await createImageBitmap(blob); const W = bm.width, H = bm.height;
    const mk = async (long, q) => { const s = Math.min(1, long / Math.max(W, H)); const c = mkCanvas(W * s, H * s); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, c.width, c.height); const b2 = await canvasBlob(c, 'image/jpeg', q); c.width = c.height = 1; return b2; };
    await DB.put('prev', await mk(CFG.prevLong, .95), id); await DB.put('thumbs', await mk(480, .85), id); bm.close();
    await DB.del('thumbs', 'e:' + id).catch(() => {});
    for (const k of ['fast', 'hq']) { DB.del('ai', `full:${id}:${k}`).catch(() => {}); for (const L of [1024, 1536, 2048, 2560, 3072]) DB.del('ai', `${id}:${k}:${L}`).catch(() => {}); }
    if (dnBlob) { await DB.put('ai', dnBlob, 'cloud:' + id); r.cloudAi = Date.now(); } else { await DB.del('ai', 'cloud:' + id).catch(() => {}); delete r.cloudAi; }
    r.w = W; r.h = H; r.fixed = [...new Set([...(r.fixed || []), ...(st.done || it.ops.filter((k) => k !== 'dn'))])]; r.fixAt = Date.now();
    DB.del('ai', 'mask:' + id).catch(() => {});
    await DB.put('photos', r);
    const lr = Library.recs.find((x) => x.id === id); if (lr) Object.assign(lr, r);
    const notes = []; if (st.relight) notes.push('人像補光：' + st.relight); if (st.beauty) notes.push('人像美顏：' + st.beauty); if (st.erase) notes.push('AI 消除：' + st.erase);
    if (st.rescue) { const q = st.rescue, f = []; if (q.haze >= 0.15) f.push('霧霾'); if (q.backlight >= 0.15) f.push('逆光／前景過暗'); else if (q.hdr >= 0.3) f.push('光比過高'); if (q.under >= 0.3 && !f.length) f.push('曝光不足'); notes.push('救援廢片：' + (f.length ? '偵測到' + f.join('、') + '，已自動修復' : '未發現明顯問題，已做輕度優化') + (q.nr ? '（暗部已 AI 降噪）' : '') + (q.faces ? `，人臉補光 ${q.faces} 張` : '')); }
    if (notes.length) { toast(`「${r.name}」${notes.join('；')}`, 6000); this.noteAt = Date.now(); }
    await this.syncEditor(id, r);
  },
  /* 編輯器正開著這張：把最新的相片紀錄同步給編輯器（避免關閉時用舊資料覆寫），再重新載入 */
  async syncEditor(id, r) {
    if (!(Editor.active && Editor.rec && Editor.rec.id === id)) return;
    if (Editor.edit) r.edit = Editor.edit; await DB.put('photos', r);
    const er = Editor.rec; for (const k of Object.keys(er)) if (!(k in r)) delete er[k]; Object.assign(er, r);
    const lr = Library.recs.find((x) => x.id === id); if (lr && lr !== er) { for (const k of Object.keys(lr)) if (!(k in r)) delete lr[k]; Object.assign(lr, r); }
    await Editor.open(er);
  },
  async restoreFix(id) {
    const r = await DB.get('photos', id); if (!r || !r.fixOrig) return;
    const o = r.fixOrig; const of = await DB.get('files', id + ':orig');
    if (of) await DB.put('files', of, id); else await DB.del('files', id).catch(() => {});
    for (const s of ['prev', 'thumbs']) { const b = await DB.get(s, id + ':orig'); if (b) await DB.put(s, b, id); await DB.del(s, id + ':orig').catch(() => {}); }
    await DB.del('files', id + ':orig').catch(() => {}); await DB.del('thumbs', 'e:' + id).catch(() => {});
    for (const k of ['fast', 'hq']) { DB.del('ai', `full:${id}:${k}`).catch(() => {}); for (const L of [1024, 1536, 2048, 2560, 3072]) DB.del('ai', `${id}:${k}:${L}`).catch(() => {}); }
    await DB.del('ai', 'cloud:' + id).catch(() => {}); delete r.cloudAi;
    r.masterOri1 = o.masterOri1; r.w = o.w; r.h = o.h; delete r.fixOrig; delete r.fixed; delete r.fixAt;
    await DB.put('photos', r); const lr = Library.recs.find((x) => x.id === id); if (lr) { Object.assign(lr, r); delete lr.fixOrig; delete lr.fixed; delete lr.cloudAi; if (!r.masterOri1) delete lr.masterOri1; }
    await this.syncEditor(id, r);
  },
  async saveSR(it, blob, st) {
    const m = (await DB.get('ai', 'srmeta:' + it.id)) || {}; let bytes = new Uint8Array(await blob.arrayBuffer());
    const W = st.w, H = st.h;
    const exif = m.exif ? Meta.patch(new Uint8Array(m.exif), { w: W, h: H }) : null, xmp = m.xmp ? Meta.patchXmp(m.xmp, { w: W, h: H }) : null;
    bytes = Meta.jpeg(bytes, { exif, xmp });
    await Exporter.save(m.name || it.name, 'image/jpeg', bytes);
    DB.del('ai', 'srin:' + it.id).catch(() => {}); DB.del('ai', 'srmeta:' + it.id).catch(() => {});
    toast(`✓ AI 畫質增強完成：${m.name || it.name}（${W}×${H}）已存到相簿`, 4000);
  },
  /* 把雲端結果套到相片：存入 AI 快取並開啟 AI 降噪 */
  async apply(id, blob, model) {
    await DB.put('ai', blob, 'cloud:' + id);
    const r = await DB.get('photos', id); if (!r) return;
    r.edit = normEdit(r.edit || {}); r.edit.ai.on = true; r.edit.ai.model = model === 'hq' ? 'hq' : 'fast'; r.cloudAi = Date.now(); r.edited = true;
    await DB.put('photos', r);
    const lr = Library.recs.find((x) => x.id === id); if (lr) Object.assign(lr, r);
    try { await Library.rerenderThumb(lr || r); } catch (e) {}
    if (Editor.active && Editor.rec && Editor.rec.id === id && Editor.ses) {
      Editor.edit.ai.on = true; Editor.ses.fullDn = {}; Editor.ses.aiPrev = null; Editor.ses.setAiPreview(null, ''); Editor.ensureAi(); Editor.renderPanel();
    }
  },
  async removeResult(id) { await DB.del('ai', 'cloud:' + id).catch(() => {}); const r = await DB.get('photos', id); if (r) { delete r.cloudAi; await DB.put('photos', r); const lr = Library.recs.find((x) => x.id === id); if (lr) delete lr.cloudAi; } },

  /* 刪除暫存分支與執行紀錄（含記錄檔） */
  async cleanup(j) {
    if (j.uploaded || j.branch) await this.api(`/git/refs/heads/${encodeURIComponent(j.branch)}`, { method: 'DELETE', ok404: true }).catch((e) => { if (e.status !== 422) console.warn(e); });
    if (j.runId) {
      for (let k = 0; k < 4; k++) { try { await this.api(`/actions/runs/${j.runId}`, { method: 'DELETE', ok404: true }); break; } catch (e) { await sleep(4000); } }
    }
    j.cleaned = true;
  },
  async cancel(j) {
    j.state = 'canceled'; j.msg = '已取消'; this.save();
    try { if (j.runId) await this.api(`/actions/runs/${j.runId}/cancel`, { method: 'POST' }).catch(() => {}); await sleep(3000); await this.cleanup(j); } catch (e) { console.warn(e); }
    this.save();
  },

  bg() {
    const a = this.active(); if (!a.length) return;
    const total = a.reduce((s, j) => s + j.items.length, 0); const run = a.filter((j) => j.state === 'running').length;
    const j = a.find((x) => x.state === 'running') || a[0];
    BG.set('cloud', `雲端 AI：${total} 張處理中${j && j.msg ? '・' + j.msg : ''}`, j && j.pn ? Math.round((j.pk || 0) / j.pn * 100) : 0);
  },
  async run() {
    if (this.running) return; this.running = true;
    try {
      while (this.active().length) {
        this.bg();
        for (const j of this.active()) {
          try {
            if (j.state === 'queued' || (j.state === 'uploading' && !j.uploaded)) await this.upload(j);
            else if (j.state === 'uploading' && j.uploaded) { j.state = 'queued'; j.uploaded = false; await this.cleanup(j); await this.upload(j); }
            else if (j.state === 'running') await this.poll(j);
            else if (j.state === 'downloading') await this.fetchResults(j);
          } catch (e) {
            console.warn('cloud', e);
            if (e instanceof TypeError || e.status >= 500 || e.status === 429) { j.msg = '網路中斷，稍後重試'; j.retry = (j.retry || 0) + 1; this.save(); if (j.retry < 40) continue; }
            j.state = 'error'; j.err = e.message || String(e); j.msg = '失敗'; this.save();
            try { await this.cleanup(j); } catch (e2) {}
            this.save();
          }
        }
        if (!this.active().length) break;
        if (this.active().some((j) => j.state === 'queued')) continue;
        await sleep(15000);
      }
    } finally {
      this.running = false; BG.end('cloud');
      const fin = this.jobs.filter((j) => j.state === 'done' && !j.notified); const n = fin.reduce((s, j) => s + (j.doneIds || []).length, 0);
      const bad = this.jobs.filter((j) => j.state === 'error' && !j.notified);
      if (fin.length || bad.length) {
        const kinds = new Set([...fin, ...bad].map((j) => j.kind || 'dn'));
        const ttl = kinds.size > 1 ? '雲端 AI 處理完成' : kinds.has('sr') ? '雲端 AI 畫質增強完成' : kinds.has('fix') ? '雲端 AI 修復完成' : '雲端 AI 降噪完成';
        NAT.call('notifyDone', ttl, `${n} 張完成${bad.length ? `，${bad.length} 批失敗` : ''}，GitHub 暫存檔已移除`);
        const msg = `☁ ${ttl}：${n} 張${bad.length ? `（${bad.length} 批失敗）` : ''}`;
        if (Date.now() - (this.noteAt || 0) < 6000) setTimeout(() => toast(msg, 4000), 6200 - (Date.now() - this.noteAt)); else toast(msg, 4500);
        [...fin, ...bad].forEach((j) => (j.notified = true));
      }
      // 只保留最近 30 筆紀錄
      const old = this.jobs.filter((j) => !this.active().includes(j)); if (old.length > 30) this.jobs = this.jobs.filter((j) => this.active().includes(j) || old.indexOf(j) >= old.length - 30);
      this.save(); Library.render();
    }
  },
  resume() { this.load(); if (this.active().length && this.ready()) setTimeout(() => this.run(), 1500); },

  /* 圖庫縮圖標記 */
  /* 圖庫縮圖上的雲端狀態：⇡ 上傳中 → ⟳ 雲端計算中 → ⇣ 回傳中 → ☁✓ 完成（✕ 失敗） */
  state(r) {
    const j = this.active().find((x) => x.items.some((i) => i.id === r.id));
    if (j) return j.state === 'uploading' ? 'up' : j.state === 'running' ? 'run' : j.state === 'downloading' ? 'down' : 'wait';
    const bad = this.jobs.find((x) => x.state === 'error' && x.items.some((i) => i.id === r.id) && !(r.cloudAi > x.t));
    if (bad) return 'err';
    return r.cloudAi ? 'done' : null;
  },
  badge(r) {
    const st = this.state(r); if (!st) return null;
    const M = { wait: ['☁ 排隊', 'cw'], up: ['⇡ 上傳', 'cu'], run: ['雲端計算', 'cr'], down: ['⇣ 回傳', 'cd'], done: ['☁✓', 'cok'], err: ['☁✕', 'cer'] }[st];
    if (st === 'run') { const j = this.active().find((x) => x.items.some((i) => i.id === r.id)); if (j && j.kind === 'fix') M[0] = 'AI 修復中'; else M[0] = '雲端降噪'; }
    return h('span', { class: 'cb ' + M[1], title: { wait: '排隊等待上傳', up: '正在上傳到 GitHub', run: '雲端降噪計算中', down: '正在回傳到手機', done: '已套用雲端降噪結果', err: '雲端處理失敗，點「雲端工作」查看' }[st] }, st === 'run' ? h('i', { class: 'spin' }) : null, M[0]);
  },
  /* 圖庫上方的雲端進度列 */
  banner() {
    const a = this.active(); if (!a.length) return null; const c = { wait: 0, up: 0, run: 0, down: 0 };
    for (const j of a) for (const it of j.items) c[j.state === 'uploading' ? 'up' : j.state === 'running' ? 'run' : j.state === 'downloading' ? 'down' : 'wait'] += 1;
    return h('div', { class: 'cloudBar glass', onclick: () => this.panel() }, h('i', { class: 'spin' }), h('b', null, '雲端 AI 工作'),
      c.up ? h('span', { class: 'cb cu' }, `⇡ 上傳 ${c.up}`) : null, c.run ? h('span', { class: 'cb cr' }, `計算 ${c.run}`) : null, c.down ? h('span', { class: 'cb cd' }, `⇣ 回傳 ${c.down}`) : null, c.wait ? h('span', { class: 'cb cw' }, `排隊 ${c.wait}`) : null, h('span', { class: 'grow' }), h('span', { class: 'sub' }, '詳細 ›'),
      (() => { const j = a.find((x) => x.state === 'running') || a[0]; return j && j.msg ? h('div', { class: 'cbMsg' }, '目前：' + j.msg) : null; })());
  },
  updUI() { clearTimeout(this.uiT); this.uiT = setTimeout(() => { if (this.panelEl && this.panelEl.isConnected) this.fillPanel(); if (App.view === 'lib' && !Editor.active) Library.render(); if (Editor.active && Editor.tool === 'aifix' && !Editor.drag && !document.querySelector('.sl.armed')) Editor.renderPanel(); }, 250); },

  /* 雲端工作面板 */
  panel() {
    this.panelEl = h('div'); this.fillPanel();
    UI.sheet('☁ 雲端 AI 降噪', this.panelEl);
  },
  fillPanel() {
    const el = this.panelEl; el.innerHTML = '';
    const ST = { queued: '排隊中', uploading: '上傳中', running: '雲端處理中', downloading: '下載結果', done: '完成', error: '失敗', canceled: '已取消' };
    if (!this.ready()) el.append(h('div', { class: 'note' }, '尚未設定 GitHub。請到「設定 → 雲端 AI 降噪」填入儲存庫與權杖。'));
    el.append(h('div', { class: 'legend' }, h('span', { class: 'cb cw' }, '☁ 排隊'), h('span', { class: 'cb cu' }, '⇡ 上傳中'), h('span', { class: 'cb cr' }, h('i', { class: 'spin' }), '雲端計算'), h('span', { class: 'cb cd' }, '⇣ 回傳中'), h('span', { class: 'cb cok' }, '☁✓ 完成'), h('span', { class: 'cb cer' }, '☁✕ 失敗')));
    if (!this.jobs.length) el.append(h('div', { class: 'sub' }, '目前沒有雲端工作。到圖庫按「選取」→ 勾選相片 →「☁ 雲端降噪」。'));
    for (const j of [...this.jobs].reverse()) {
      const act = this.active().includes(j);
      el.append(h('div', { class: 'mitem' }, h('span', { class: 'mi' }, act ? h('span', { class: 'spin' }) : j.state === 'done' ? '✓' : '!'),
        h('span', { class: 'grow' }, `${j.items.length} 張・${j.kind === 'sr' ? 'AI 畫質增強 ' + (j.items[0].scale || 2) + '×' : j.kind === 'fix' ? (j.items[0].ops || []).filter((k) => k !== 'dn').map((k) => this.OPS[k]).join('＋') : (j.model === 'hq' ? '降噪 高品質' : '降噪 快速')}・${ST[j.state] || j.state}`,
          h('div', { class: 'sub' }, (j.msg || '') + (j.err ? '：' + j.err : '') + '　' + new Date(j.t).toLocaleString('zh-TW')),
          h('div', { class: 'sub' }, j.items.map((i) => (i.ok ? '✓' : i.err ? '✗' : '') + i.name + (i.err ? `（${i.err}）` : '')).join('、')), j.log ? h('details', { class: 'jlog' }, h('summary', null, '查看雲端錯誤記錄'), h('pre', null, j.log), h('button', { class: 'btn sm', onclick: () => { try { navigator.clipboard.writeText(j.log); toast('已複製錯誤記錄'); } catch (e) {} } }, '複製')) : null),
        act ? h('button', { class: 'btn sm', onclick: () => this.cancel(j) }, '取消') : null));
    }
    el.append(h('div', { class: 'acts' },
      this.jobs.some((j) => !this.active().includes(j)) ? h('button', { class: 'btn sm', onclick: () => { this.jobs = this.active(); this.save(); } }, '清除紀錄') : null,
      this.active().length && !this.running ? h('button', { class: 'btn sm pri', onclick: () => this.run() }, '繼續執行') : null));
  },

  /* 設定卡片 */
  settingsCard(card, segRow, sw) {
    const c = this.cfg();
    const ri = h('input', { placeholder: '帳號/儲存庫，例如 ian/aiphoto-cloud', value: c.repo, style: { width: '100%' } });
    ri.onchange = () => { c.repo = ri.value.replace(/\s+/g, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, ''); ri.value = c.repo; c.ver = ''; saveCfg(); };
    const ti = h('input', { type: 'password', placeholder: 'GitHub 權杖（github_pat_…）', value: this.token(), style: { width: '100%', marginTop: '8px' } });
    ti.onchange = () => { this.setToken(ti.value); c.ver = ''; saveCfg(); };
    const st = h('div', { class: 'sub' }, this.ready() ? '已設定' : '尚未設定');
    const a = this.active().length;
    return card('☁ 雲端 AI 降噪（GitHub）', ri, ti, st,
      h('div', { class: 'acts' },
        h('button', { class: 'btn sm pri', onclick: async (ev) => { const b = ev.target; ri.onchange(); ti.onchange(); if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo)) { st.textContent = '⚠ 儲存庫格式應為「帳號/儲存庫」，例如 ianlin1120/aiphoto-cloud'; return; } if (!this.token()) { st.textContent = '⚠ 請貼上權杖'; return; } b.disabled = true; b.textContent = '連線中…'; try { const r = await this.test(); st.textContent = `✓ 連線成功：${r.full_name}（${r.private ? '私人' : '⚠ 公開，建議改為私人'}），雲端腳本已安裝`; toast('雲端設定完成', 3000); } catch (e) { st.textContent = '⚠ ' + e.message; st.style.whiteSpace = 'pre-line'; } b.disabled = false; b.textContent = '連線測試並安裝'; } }, '連線測試並安裝'),
        h('button', { class: 'btn sm', onclick: () => this.panel() }, a ? `雲端工作（${a}）` : '雲端工作')),
      segRow('雲端模型', [['hq', '高品質'], ['fast', '快速']], c.model, (k) => (c.model = k), '雲端以電腦版 Open Image Denoise 原始解析度處理'),
      sw('雲端降噪完成後自動匯出到相簿', () => c.autoExport, (v) => (c.autoExport = v), '開啟：降噪結果一回傳，就用目前的調整直接存一張到「圖片／AI修圖軟體」（適合大量照片不想一張張匯出）。關閉：結果只套用在 App 裡，之後你按「匯出」時才會存檔，匯出的照片一樣包含雲端降噪。'),
      h('div', { class: 'note', html: '<b>設定步驟</b><br>1. 在 GitHub 建立一個<b>私人（Private）</b>儲存庫，例如 aiphoto-cloud。<br>2. 到 GitHub → Settings → Developer settings → Fine-grained tokens 建立權杖：只選這個儲存庫，權限開啟 <b>Contents、Actions、Workflows</b> 為 Read and write。<br>（或用 Tokens (classic)：勾選 <b>repo</b> 與 <b>workflow</b> 兩個範圍，設定更簡單。）<br>3. 填入上方欄位，按「連線測試並安裝」。<br><br><b>使用</b>：圖庫「選取」→ 勾選多張 →「☁ 雲端降噪」。可切到背景或關螢幕，完成會通知；結果下載回手機後，GitHub 上的暫存分支與執行紀錄會自動刪除。<br>權杖只存在這台裝置。私人儲存庫每月有免費 Actions 分鐘數（約 2–3 分鐘／批）。' }));
  }
};
