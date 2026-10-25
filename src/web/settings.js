/* ================= ⑤ 設定 ================= */
const Settings = {
  seg(id, opts, cur) { return `<div class="seg" id="${id}">${opts.map(([v, n]) => `<button class="btn ${String(cur) === String(v) ? 'on' : ''}" data-v="${v}">${n}</button>`).join('')}</div>`; },
  bindSeg(id, fn) { const e = $('#' + id); if (e) e.onclick = ev => { const b = ev.target.closest('[data-v]'); if (!b) return; $$('#' + id + ' .btn').forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset.v); saveCfg(); }; },
  link(u) { return isApp ? `href="#" onclick="NAT.call('openUrl','${u}');return false"` : `href="${u}" target="_blank" rel="noopener"`; },
  render() {
    const L = u => this.link(u);
    /* 金鑰與帳號 */
    $('#sKeys').innerHTML = `<h3>🔑 金鑰與帳號</h3>
      <div class="lab"><span>Google Maps API 金鑰<div class="sub">地點搜尋用（和行跡導航同一種金鑰，可以共用）</div></span><span id="kGSt" class="sub">${CFG.gkey ? '已設定' : '未設定'}</span></div>
      <div class="keyRow"><input id="kG" placeholder="AIza…" value="${esc(CFG.gkey)}" autocomplete="off" spellcheck="false"><button class="btn sm pri" id="kGT">儲存並測試</button></div>
      <ol class="how"><li>到 <a ${L('https://console.cloud.google.com/google/maps-apis/credentials')}>Google Cloud 主控台</a> 建立專案（可用行跡導航那個）</li><li>在「API 和服務 → 程式庫」啟用 <b>Places API (New)</b></li><li>「憑證」→ 建立 API 金鑰 → 貼上；應用程式限制選「無」，API 限制勾 Places API (New)</li></ol>
      <div class="sub">沒有金鑰也能搜尋（改用 Esri、OpenStreetMap），只是商家、景點的結果沒有 Google 完整。</div>
      <div class="lab" style="margin-top:16px"><span>GitHub 權杖（Personal access token）<div class="sub">雲端 AI 降噪、下載 APK 用</div></span><span id="kHSt" class="sub">${CFG.ghToken ? '已設定' : '未設定'}</span></div>
      <div class="keyRow"><input id="kH" type="password" placeholder="github_pat_… 或 ghp_…" value="${esc(CFG.ghToken)}" autocomplete="off" spellcheck="false"><button class="btn sm pri" id="kHT">儲存並測試</button></div>
      <div class="keyRow" style="margin-top:6px"><span class="sub" style="flex:none">儲存庫</span><input id="kR" value="${esc(CFG.ghRepo)}" spellcheck="false"></div>
      <ol class="how"><li>到 <a ${L('https://github.com/settings/personal-access-tokens/new')}>GitHub → Fine-grained tokens</a> 產生新權杖</li><li>Repository access 選 <b>Only select repositories → ai-photo-editor</b></li><li>Permissions 開啟：<b>Contents</b>、<b>Actions</b>、<b>Secrets</b> 設為 Read and write（Metadata 自動唯讀）</li><li>產生後複製貼上（權杖只會存在這支手機）</li></ol>
      <div id="kHInfo" class="sub"></div>`;
    $('#kGT').onclick = async () => { const k = $('#kG').value.trim(); CFG.gkey = k; saveCfg(); if (!k) { $('#kGSt').textContent = '未設定'; return; } $('#kGSt').textContent = '測試中…';
      try { const r = await gPlaces('台北101', [25.03, 121.56]); GPC.clear(); $('#kGSt').innerHTML = r.length ? '<span class="ok">✓ 可用</span>' : '<span class="bad">沒有結果</span>'; } catch (e) { $('#kGSt').innerHTML = `<span class="bad">✗ ${esc(e.message).slice(0, 80)}</span>`; } };
    const saveGh = () => { CFG.ghToken = $('#kH').value.trim(); CFG.ghRepo = $('#kR').value.trim() || DEF.ghRepo; saveCfg(); };
    $('#kR').onchange = saveGh;
    $('#kHT').onclick = async () => { saveGh(); if (!CFG.ghToken) { $('#kHSt').textContent = '未設定'; return; } $('#kHSt').textContent = '測試中…';
      const c = await Cloud.check(); if (c.err) { $('#kHSt').innerHTML = `<span class="bad">✗</span>`; $('#kHInfo').innerHTML = `<span class="bad">${esc(c.err)}</span>`; return; }
      $('#kHSt').innerHTML = '<span class="ok">✓ 可用</span>';
      $('#kHInfo').innerHTML = `儲存庫：<b>${esc(c.repo)}</b>（${c.private ? '私人' : '公開'}）・寫入權限 ${c.push ? '✓' : '✗'}・雲端工作流程 ${c.wf ? '✓' : '✗ 尚未上傳 .github/workflows/cloud-denoise.yml'}・加密金鑰 Secret ${c.secret ? '✓' : '✗（按下方「自動設定」）'}`;
      this.renderCloud(); };
    this.renderCloud();
    /* 匯出預設 */
    const X = CFG.exp;
    $('#sExport').innerHTML = `<h3>📤 匯出預設</h3>
      <div class="row"><span class="sub">格式</span>${this.seg('eF', [['jpeg', 'JPEG'], ['tiff', 'TIFF 16-bit'], ['png', 'PNG']], X.fmt)}</div>
      <div class="row"><span class="sub">JPEG 品質</span><input type="range" id="eQ" min="60" max="100" value="${X.q}" style="flex:1"><b id="eQv">${X.q}</b></div>
      <div class="row"><span class="sub">尺寸</span>${this.seg('eS', [['full', '原始最大畫素'], ['long', '指定長邊'], ['half', '一半']], X.size)}</div>
      <div class="row"><span class="sub">檔名</span>${this.seg('eN', [['keep', '維持原檔名'], ['custom', '自訂']], X.name)}<input id="eP" value="${esc(X.pattern)}" style="flex:1;min-width:160px"></div>
      <div class="row"><span class="sub">資料夾</span><span class="sub">Pictures／</span><input id="eD" value="${esc(X.folder)}" style="flex:1"></div>
      <div class="sub">檔名可用：{原檔名} {日期} {時間} {相機} {地點} {序號}。匯出一律保留原始 EXIF、拍攝時間，並寫入你設定的地點。</div>`;
    this.bindSeg('eF', v => X.fmt = v); this.bindSeg('eS', v => X.size = v); this.bindSeg('eN', v => X.name = v);
    $('#eQ').oninput = e => { X.q = +e.target.value; $('#eQv').textContent = X.q; }; $('#eQ').onchange = saveCfg;
    $('#eP').onchange = e => { X.pattern = e.target.value; saveCfg(); }; $('#eD').onchange = e => { X.folder = e.target.value.trim() || 'AI修圖'; saveCfg(); };
    /* AI 與相機模板 */
    $('#sAI').innerHTML = `<h3>🤖 AI 與相機模板</h3>
      <div class="lab"><span>開啟照片時自動 AI 調整<div class="sub">第一次開啟、還沒調整過的照片</div></span><label class="sw"><input type="checkbox" id="aAuto" ${CFG.autoAI ? 'checked' : ''}><span></span></label></div>
      <div class="row"><span class="sub">模板預設強度</span><input type="range" id="aT" min="0" max="150" value="${Math.round(CFG.tmplAmt * 100)}" style="flex:1"><b id="aTv">${Math.round(CFG.tmplAmt * 100)}%</b></div>
      ${Object.keys(TEMPLATES).map(k => `<div class="prm"><span style="font-size:22px">📷</span><div class="grow"><b>${esc(camName(k))}</b><span class="sub">相機描述檔（DNG 結構，由相機直出 JPG 擬合）＋ 你的色調目標與 HSL・${LENSDB[k] ? '鏡頭資料（反推）' : k.startsWith('SONY') ? '鏡頭校正讀機身內嵌資料' : ''}</span></div><span class="tag ok">已學習</span></div>`).join('')}
      <div class="prm"><span style="font-size:22px">🌅</span><div class="grow"><b>氛圍感</b><span class="sub">樹林光束前後對照學到的色彩分級</span></div><span class="tag ok">已學習</span></div>
      <div class="sub" style="margin-top:6px">其他相機也能用：會用通用的描述檔與 AI 規則；之後提供該相機的 RAW＋修好的 JPG，就能再學一份專屬模板。</div>`;
    $('#aAuto').onchange = e => { CFG.autoAI = e.target.checked; saveCfg(); };
    $('#aT').oninput = e => { CFG.tmplAmt = e.target.value / 100; $('#aTv').textContent = e.target.value + '%'; }; $('#aT').onchange = saveCfg;
    this.renderPerm();
    /* 外觀 */
    const accs = [['terra', '#a2613a'], ['moss', '#6f7d4c'], ['sand', '#b0884a'], ['coffee', '#7a4e2d'], ['clay', '#b4553a']];
    $('#sLook').innerHTML = `<h3>🎨 外觀</h3>
      <div class="row"><span class="sub">明暗</span>${this.seg('aTh', [['light', '☀️ 淺色'], ['dark', '🌙 暗色'], ['auto', '🌓 跟隨系統']], CFG.theme)}</div>
      <div class="row"><span class="sub">材質</span>${this.seg('aMat', [['liquid', '💧 液態玻璃'], ['paper', '📜 紙質'], ['solid', '🪨 霧面']], CFG.mat)}</div>
      <div class="row"><span class="sub">主色</span>${accs.map(([k, c]) => `<span class="swatch ${CFG.acc === k ? 'on' : ''}" data-a="${k}" style="background:${c}"></span>`).join('')}</div>
      <div class="row"><span class="sub">玻璃透明度</span><input type="range" id="aGa" min=".15" max=".8" step=".01" value="${CFG.gA}" style="flex:1"></div>`;
    this.bindSeg('aTh', v => { CFG.theme = v; applyLook(); }); this.bindSeg('aMat', v => { CFG.mat = v; applyLook(); });
    $$('#sLook .swatch').forEach(s => s.onclick = () => { CFG.acc = s.dataset.a; saveCfg(); applyLook(); this.render(); });
    $('#aGa').oninput = e => { CFG.gA = +e.target.value; applyLook(); }; $('#aGa').onchange = saveCfg;
    UPD.render();
    $('#sAbout').innerHTML = `<h3>ℹ️ 關於</h3><div class="sub" style="line-height:1.7">AI修圖軟體 ${esc(NAT.call('version') || 'v' + APP_VER + '（網頁版）')}<br>
      RAW 解碼：LibRaw（WASM）・雲端降噪：SCUNet（Apache-2.0）・鏡頭校正公式：darktable embedded metadata・描述檔結構：Adobe DNG 規格<br>
      地圖：© OpenFreeMap © OpenStreetMap・地點搜尋：Google Places、Esri、Photon、Nominatim<br>
      所有修圖在手機上完成；只有勾選雲端 AI 降噪的照片會加密上傳到你自己的 GitHub。</div>`;
  },
  renderCloud() {
    const ok = Cloud.ready();
    $('#sCloud').innerHTML = `<h3>☁️ 雲端 AI 降噪</h3>
      <div class="sub" style="line-height:1.6">在你的 GitHub 儲存庫用 Actions 跑 SCUNet AI 降噪（公開儲存庫的 Actions 免費）。照片以 AES-256 加密上傳，只有這支手機和儲存庫的 Secret 有金鑰。</div>
      <div class="row"><span class="sub">降噪強度</span>${this.seg('cS', [[0.6, '溫和（保留顆粒）'], [0.85, '標準'], [1, '完全清除']], CFG.cloudStrength)}</div>
      <div class="lab"><span>加密金鑰<div class="sub">${CFG.cloudKey ? '已產生' + (CFG.cloudSecretAt ? '・已設定到 GitHub Secret' : '・尚未設定到 GitHub') : '尚未產生'}</div></span><button class="btn sm ${ok ? '' : 'pri'}" id="cSet">⚙️ 自動設定</button></div>
      <div class="acts"><button class="btn sm" id="cCopy">複製金鑰</button><button class="btn sm" id="cNew">重新產生</button><button class="btn sm" id="cAct">開啟 GitHub Actions</button></div>
      <div class="sub">「自動設定」會用 GitHub 提供的公鑰把金鑰加密後存成儲存庫 Secret「CLOUD_KEY」（需要權杖的 Secrets 寫入權限）。也可以手動：複製金鑰 → GitHub 儲存庫 Settings → Secrets and variables → Actions → New repository secret，名稱 <code>CLOUD_KEY</code>。</div>`;
    this.bindSeg('cS', v => { CFG.cloudStrength = +v; });
    $('#cSet').onclick = async () => { if (!CFG.ghToken) { toast('請先填入 GitHub 權杖'); return; } try { $('#cSet').textContent = '設定中…'; await Cloud.setupSecret(); toast('✓ 已把加密金鑰設定到 GitHub'); } catch (e) { toast('設定失敗：' + e.message, 5000); } this.renderCloud(); Cloud.renderIntro(); };
    $('#cCopy').onclick = () => { if (!CFG.cloudKey) Cloud.newKey(); navigator.clipboard.writeText(CFG.cloudKey).then(() => toast('已複製'), () => prompt('金鑰', CFG.cloudKey)); this.renderCloud(); };
    $('#cNew').onclick = async () => { if (CFG.cloudKey && await ask('重新產生金鑰？', '舊金鑰加密、尚未完成的雲端工作會無法解密。產生後記得再按「自動設定」。', ['重新產生', '取消']) !== 0) return; Cloud.newKey(); CFG.cloudSecretAt = 0; saveCfg(); this.renderCloud(); };
    $('#cAct').onclick = () => NAT.call('openUrl', `https://github.com/${Cloud.repo()}/actions`);
  },
  async renderPerm() {
    let p; if (isApp) p = NAT.json('perms') || {}; else { p = {}; try { p.loc = (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch (e) { } }
    const row = (i, n, d, ok, act) => `<div class="prm"><span style="font-size:22px">${i}</span><div class="grow"><b>${n}</b><span class="sub">${d}</span></div>${ok ? '<span class="ok">✓ 已允許</span>' : `<button class="btn sm pri" data-p="${act}">允許</button>`}</div>`;
    $('#sPerm').innerHTML = `<h3>🛡 權限</h3>` +
      (isApp ? row('🖼', '相片與照片位置資訊', '讀取原始照片的 GPS（Android 會先把位置資訊遮掉）', p.media, 'media') : '') +
      row('📍', '定位', '在地圖上用「目前位置」設定照片地點', p.loc, 'loc') +
      (isApp ? row('🔔', '通知', '雲端 AI 降噪完成提醒', p.notif, 'notif') + row('📦', '安裝 APK', '從 GitHub 下載新版 APK 後直接安裝', p.install, 'install') +
        `<div class="acts"><button class="btn sm" onclick="NAT.call('openAppSettings')">⚙️ 開啟系統 App 設定</button></div>` : '<div class="sub">網頁版的權限由瀏覽器管理；匯出的照片會用瀏覽器下載。</div>');
    $$('#sPerm [data-p]').forEach(b => b.onclick = () => { const k = b.dataset.p; if (isApp) NAT.call('requestPerm', k); else if (k === 'loc') navigator.geolocation.getCurrentPosition(() => this.renderPerm(), () => { }); });
  }
};

/* ================= App 控制 ================= */
const App = {
  inited: {},
  async boot() {
    applyLook();
    $('#nav').onclick = e => { const b = e.target.closest('[data-v]'); if (b) this.show(b.dataset.v); };
    window.onAndroidBack = () => { if (!$('#sheet').classList.contains('hide')) { closeSheet(); return true; } const cur = $('.view.on').id; if (cur !== 'v-lib') { this.show('v-lib'); return true; } if (Lib.selMode) { Lib.setSel(false); return true; } return false; };
    Editor.init(); await Lib.init(); Cloud.render(); Cloud.renderIntro();
    UPD.auto(); setTimeout(() => Cloud.poll(), 3000);
    if (!isApp) $('#libHint').innerHTML += (Lib.photos.length ? '<br>' : '') + '網頁版：匯出的照片會用瀏覽器下載；雲端降噪與相簿存檔請用 Android App。';
  },
  show(id) {
    $$('.view').forEach(v => v.classList.toggle('on', v.id === id)); $$('#nav .btn').forEach(b => b.classList.toggle('on', b.dataset.v === id));
    if (id === 'v-geo') Geo.onShow();
    if (id === 'v-set') { if (!this.inited.set) { this.inited.set = 1; Settings.render(); } else Settings.renderPerm(); }
    if (id === 'v-cloud') { Cloud.renderIntro(); Cloud.render(); }
    if (id === 'v-edit' && !Editor.p && Lib.photos.length) $('#edEmpty').textContent = '在「照片」頁點一張照片開始修圖';
  },
  onResume() { if (this.inited.set) Settings.renderPerm(); Cloud.poll(); }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) App.onResume(); });
App.boot();
