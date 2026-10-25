/* ================= 版本與線上更新（GitHub：IanLin1120/ai-photo-editor） =================
   小改版（介面、功能調整）：開 App 時從 GitHub Pages 下載新的 index.html，直接套用，不用重裝 APK
   大改版（原生程式有改，version.json 的 minApk 大於手機上的 APK）：提示到 GitHub 下載新版 APK
   也可以在設定裡挑任一版本的 APK（最新或舊版）下載到手機安裝 */
const APP_VER='__APP_VER__';
const GH={user:'IanLin1120',repo:'ai-photo-editor',
  get pages(){return `https://${this.user.toLowerCase()}.github.io/${this.repo}/`},
  get web(){return `https://github.com/${this.user}/${this.repo}`},
  get api(){return `https://api.github.com/repos/${this.user}/${this.repo}`}};
const UPD={
  info(){return NAT.json('appInfo')||{apk:'',code:0,ota:''}},
  gt(a,b){const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const p=x[i]||0,q=y[i]||0;if(p!==q)return p>q}return false},
  async manifest(){const r=await fetch(GH.pages+'version.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error(r.status===404?'GitHub 上還沒有發布版本':'HTTP '+r.status);return r.json()},
  /* 開 App 時自動檢查（最多 6 小時一次） */
  auto(){if(!isApp||CFG.autoUpd===false)return;const last=lsGet('aip.updAt',0);if(Date.now()-last<6*3600e3)return;lsSet('aip.updAt',Date.now());setTimeout(()=>this.check(false),8000)},
  async check(manual){
    const st=$('#updSt');const say=t=>{if(st)st.textContent=t};
    try{say('檢查中…');const v=await this.manifest();const I=this.info();lsSet('aip.updLast',{v,t:Date.now()});
      if(isApp&&v.minApk&&I.code<v.minApk){say(`有新版 APK v${v.apkName||v.app}（大改版，需要重新安裝）`);
        this.dialog(`有新版 APK v${esc(v.apkName||v.app)}`,`${v.notes?esc(v.notes)+'<br><br>':''}這次是大改版（手機端程式有更新），需要下載新的 APK 安裝；安裝時直接覆蓋，照片清單與修圖設定都會保留。`,[['⬇ 下載最新版 APK',()=>this.releases()],['稍後',null]]);return}
      if(!this.gt(v.app,APP_VER)){say(`已經是最新版本 v${APP_VER}`);if(manual)toast('已經是最新版本 v'+APP_VER);return}
      if(!isApp){say(`有新版本 v${v.app}`);if(manual)this.dialog('有新版本 v'+esc(v.app),'網頁版請直接開啟 GitHub 上的最新網頁版。',[['🌐 開啟網頁版',()=>this.open(GH.pages)],['稍後',null]]);return}
      say(`下載新版本 v${v.app}…`);
      const r=await fetch(GH.pages+'index.html?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);
      const h=await r.text();
      if(!h.includes(`const APP_VER='${v.app}'`)||h.length<300000)throw new Error('下載不完整，稍後再試');
      if(!NAT.call('writeApp',h,String(v.app),+v.minApk||0))throw new Error('無法寫入手機');
      say(`已下載 v${v.app}，重新開啟後套用`);
      this.dialog(`已下載新版本 v${esc(v.app)}`,v.notes?esc(v.notes):'介面與功能更新',[['🔄 立即套用',()=>location.reload()],['下次開啟時套用',null]]);
    }catch(e){say('無法檢查更新：'+e.message);if(manual)toast('無法檢查更新：'+e.message)}
  },
  /* GitHub Releases：列出所有版本的 APK，選一個下載到手機 */
  async releases(){
    this.dialog('⬇ 下載 APK','<div id="relL" class="sub">讀取 GitHub 版本清單中…</div>',[['關閉',null]]);
    try{let L=[];
      // 1) 儲存庫裡的 apks.json（apk/ 資料夾，透過 GitHub Pages 下載）；2) 備援：GitHub Releases
      try{const r=await fetch(GH.pages+'apks.json?t='+Date.now(),{cache:'no-store'});if(r.ok)L=(await r.json()).map(x=>({tag:'v'+x.v,name:'v'+x.v,date:new Date(x.date),notes:x.notes||'',apk:{name:x.file,size:x.size||0,browser_download_url:GH.pages+'apk/'+encodeURIComponent(x.file)}}))}catch(e){}
      if(!L.length){const r=await fetch(GH.api+'/releases?per_page=50');if(!r.ok)throw new Error(r.status===404?'找不到 GitHub 儲存庫':'HTTP '+r.status);
        L=(await r.json()).filter(x=>!x.draft&&!/^aip-j/.test(x.tag_name)).map(x=>({tag:x.tag_name,name:x.name||x.tag_name,date:new Date(x.published_at||x.created_at),notes:(x.body||'').trim(),pre:x.prerelease,apk:(x.assets||[]).find(a=>/\.apk$/i.test(a.name))})).filter(x=>x.apk)}
      const I=this.info();
      $('#relL').innerHTML=L.length?L.map((x,i)=>`<div class="relR"><div class="grow"><b>${esc(x.name)}</b>${i===0?' <span class="tyTag" style="background:#5f9a5a">最新</span>':''}${x.pre?' <span class="tyTag" style="background:#9a8f80">測試版</span>':''}${I.apk&&x.tag.replace(/^v/,'')===I.apk?' <span class="tyTag" style="background:#a2613a">目前安裝</span>':''}
        <div class="sub">${fmtMD(x.date)}/${x.date.getFullYear()}・${(x.apk.size/1048576).toFixed(1)} MB</div>${x.notes?`<div class="sub relN">${esc(x.notes.split('\n').slice(0,4).join('\n')).replace(/\n/g,'<br>')}</div>`:''}</div>
        <button class="btn sm ${i===0?'pri':''}" data-u="${esc(x.apk.browser_download_url)}" data-n="${esc(/v\d/.test(x.apk.name)?x.apk.name:x.apk.name.replace(/\.apk$/i,'')+'_'+x.tag+'.apk')}">⬇</button></div>`).join(''):'<div class="sub">GitHub 上還沒有可下載的 APK</div>';
      $$('#relL [data-u]').forEach(b=>b.onclick=()=>this.download(b.dataset.u,b.dataset.n));
    }catch(e){$('#relL').textContent='⚠️ 無法讀取版本清單：'+e.message}
  },
  download(u,n){
    if(!isApp){this.open(u);return}
    if(!NAT.call('canInstall')){this.dialog('需要允許安裝','下載完成後要直接安裝，請先在系統設定中允許「AI修圖軟體」安裝不明應用程式，回來後再按一次下載。',[['前往設定',()=>NAT.call('askInstall')],['先下載就好',()=>{NAT.call('downloadApk',u,n);toast('開始下載，完成後在通知欄點一下即可安裝')}]]);return}
    NAT.call('downloadApk',u,n);toast('開始下載 '+n+'，完成後會跳出安裝畫面');
  },
  open(u){if(isApp)NAT.call('openUrl',u);else window.open(u,'_blank')},
  dialog(title,html,btns){let el=$('#updSheet');if(!el){el=h('div',{id:'updSheet'});document.body.append(el)}
    el.innerHTML=`<div class="plBg"></div><div class="plBox glass"><div class="lab"><span>${title}</span></div><div style="margin:6px 0 12px;line-height:1.6">${html}</div><div class="acts">${btns.map((b,i)=>`<button class="btn ${i===0?'pri':''}" data-i="${i}">${b[0]}</button>`).join('')}</div></div>`;
    el.classList.add('on');const close=()=>el.classList.remove('on');el.querySelector('.plBg').onclick=close;
    el.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{const f=btns[+b.dataset.i][1];close();if(f)f()})},
  render(){
    const el=$('#sUpd');if(!el)return;const I=this.info();const last=lsGet('aip.updLast',null);
    el.innerHTML=`<h3>🔄 版本與更新</h3>
      <div class="lab"><span>自動更新<div class="sub">開啟 App 時從 GitHub 下載最新版介面與功能（不用重新安裝 APK）；大改版才需要下載新 APK</div></span><label class="sw"><input type="checkbox" id="updAuto" ${CFG.autoUpd!==false?'checked':''}><span></span></label></div>
      <div class="setRow" id="updChk"><span class="ic">🔄</span><div class="grow"><b>檢查更新</b><div class="sub">目前版本 v${APP_VER}${isApp?'・APK v'+esc(I.apk||'?'):'・網頁版'}${I.ota?'（已線上更新）':''}</div><div class="sub" id="updSt">${last?'上次檢查 '+fmtHM(new Date(last.t))+(last.v&&this.gt(last.v.app,APP_VER)?'・有新版本 v'+esc(last.v.app):''):''}</div></div><span>›</span></div>
      ${isApp?`<div class="setRow" id="updApk"><span class="ic">⬇</span><div class="grow"><b>下載 APK 到手機</b><div class="sub">可選最新版或任一舊版本</div></div><span>›</span></div>
      <div class="setRow" id="updRst"><span class="ic">↩️</span><div class="grow"><b>還原為 APK 內建版本</b><div class="sub">線上更新後有問題時使用</div></div><span>›</span></div>`:''}
      <div class="setRow" id="updWeb"><span class="ic">🌐</span><div class="grow"><b>網頁版</b><div class="sub">${esc(GH.pages.replace('https://',''))}</div></div><span>›</span></div>
      <div class="setRow" id="updRepo"><span class="ic">📦</span><div class="grow"><b>GitHub 儲存庫</b><div class="sub">所有版本的 APK、更新說明</div></div><span>›</span></div>`;
    $('#updAuto').onchange=e=>{CFG.autoUpd=e.target.checked;saveCfg()};
    $('#updChk').onclick=()=>this.check(true);
    if(isApp){$('#updApk').onclick=()=>this.releases();$('#updRst').onclick=()=>this.dialog('還原為 APK 內建版本？','會刪除線上下載的新版介面，改回這支 APK 安裝時內建的 v'+esc(I.apk)+'。照片清單與修圖設定不受影響。',[['還原',()=>{NAT.call('resetApp');location.reload()}],['取消',null]])}
    $('#updWeb').onclick=()=>this.open(GH.pages);$('#updRepo').onclick=()=>this.open(GH.web);
  }
};
