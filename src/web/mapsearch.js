/* ================= 地點搜尋地圖（行跡導航樣式） =================
   全螢幕地圖 + 上方搜尋列：有 Google 金鑰時「G」Google 地圖搜尋結果排前面，同時查 Esri 門牌、Photon、OpenStreetMap。
   選到地點 → 可拖曳圖釘微調 → 套用到相片（寫入 edit.loc，匯出時寫進 EXIF GPS 與 XMP） */
const MS = (() => {
  const R2 = Math.PI / 180;
  const gdist = (a, b, c, d) => { const x = (d - b) * R2 * Math.cos((a + c) / 2 * R2), y = (c - a) * R2; return Math.sqrt(x * x + y * y) * 6371000; };
  const normQ = (q) => String(q || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[，、]/g, ' ').replace(/\s+/g, ' ').trim();
  const withTO = (p, ms) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), ms))]);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function getJSON(u, o = {}) { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), o.timeout || 15000); try { const r = await fetch(u, Object.assign({ signal: ctl.signal }, o)); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } }
  async function google(q, c) {
    const r = await Geo.google(q, c); if (!r) return [];
    return r.map((x) => Object.assign(x, { addr: (x.display || '').replace(/^\d{3,6}\s*/, '').replace(/^台灣|^臺灣/, ''), g: 1 }));
  }
  async function esriFind(q, c) {
    let u = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=8&outFields=Addr_type,PlaceName,Place_addr,Type&langCode=ZH&SingleLine=' + encodeURIComponent(normQ(q));
    if (c) u += `&location=${(+c[1]).toFixed(5)},${(+c[0]).toFixed(5)}`;
    const j = await getJSON(u, { timeout: 8000 }), tw = { PointAddress: '門牌', StreetAddress: '門牌(推估)', StreetInt: '路口', StreetName: '道路', POI: '地點', Locality: '區域' };
    return (j.candidates || []).filter((x) => x.score >= 75 && x.location).map((x) => { const a = x.attributes || {}; return { name: a.PlaceName && a.Addr_type === 'POI' ? a.PlaceName : (x.address || '').replace(/,\s*\d{3,6}$/, ''), addr: (a.Place_addr || x.address || '').replace(/,\s*\d{3,6}$/, '').replace(/,\s*/g, ' '), lat: x.location.y, lon: x.location.x, tag: tw[a.Addr_type] || '' }; });
  }
  async function photonFind(q, c) {
    let u = 'https://photon.komoot.io/api/?limit=6&q=' + encodeURIComponent(q); if (c) u += `&lat=${(+c[0]).toFixed(4)}&lon=${(+c[1]).toFixed(4)}`;
    const j = await getJSON(u, { timeout: 7000 });
    return (j.features || []).map((f) => { const p = f.properties || {}, g = f.geometry.coordinates; const addr = [p.state, p.county, p.city, p.district, p.locality, p.street, p.housenumber ? p.housenumber + '號' : ''].filter(Boolean).filter((x, i, A) => A.indexOf(x) === i).join(' ');
      return { name: p.name || addr, addr, lat: g[1], lon: g[0], city: p.city || p.county || '', state: p.state || '', country: p.country || '', cc: (p.countrycode || '').toUpperCase() }; }).filter((x) => x.name);
  }
  async function nomFind(q) { const j = await getJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=zh-TW,zh,en&q=' + encodeURIComponent(q), { timeout: 9000 }); return j.map((y) => { const x = Geo.fromNom(y); x.addr = (y.display_name || '').split(', ').reverse().join(' '); return x; }); }

  const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const S = { map: null, el: null, mk: null, phMk: [], pick: null, me: null, opt: null, seq: 0 };

  function build() {
    if (S.el) return;
    S.el = h('div', { id: 'msView' },
      h('div', { id: 'msMap' }),
      h('div', { id: 'msTop', class: 'glass' },
        h('div', { class: 'msBar' },
          h('button', { class: 'ib', id: 'msBack', title: '返回' }, '‹'),
          h('div', { class: 'msIn' }, h('input', { id: 'msQ', type: 'search', enterkeyhint: 'search', autocomplete: 'off', placeholder: '搜尋地點、地址或座標' }), h('button', { class: 'ib', id: 'msClr' }, '✕')),
          h('button', { class: 'btn pri', id: 'msGo' }, '搜尋')),
        h('div', { id: 'msRes' })),
      h('button', { class: 'msFab glass', id: 'ms3d' }, h('b', null, '3D')),
      h('button', { class: 'msFab glass', id: 'msLoc', title: '目前位置' }, '📍'),
      h('div', { id: 'msCard', class: 'glass hide' }));
    document.body.append(S.el);
    $('#msBack').onclick = () => close();
    $('#msGo').onclick = () => search();
    $('#msQ').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); search(); } });
    $('#msQ').oninput = () => { clearTimeout(S.t); const q = $('#msQ').value.trim(); if (q.length >= 2) S.t = setTimeout(() => search(true), Geo.key() ? 650 : 450); else $('#msRes').innerHTML = ''; };
    $('#msClr').onclick = () => { $('#msQ').value = ''; $('#msRes').innerHTML = ''; };
    $('#msLoc').onclick = () => locate();
    $('#ms3d').onclick = () => { if (!S.map) return; const p = S.map.getPitch() > 5 ? 0 : 60; S.map.easeTo({ pitch: p, duration: 600 }); $('#ms3d b').textContent = p ? '2D' : '3D'; };
  }
  async function initMap() {
    if (S.map) { S.map.resize(); return; }
    if (!window.maplibregl) { $('#msMap').innerHTML = '<div class="sub" style="padding:120px 20px;text-align:center">此裝置無法載入地圖，仍可搜尋地點</div>'; return; }
    let st = null;
    try { st = lsGet('aip.mapStyle', null); if (!st || !st.layers) { st = await getJSON(OFM_STYLE, { timeout: 20000 }); lsSet('aip.mapStyle', st); } } catch (e) { toast('地圖樣式下載失敗，請檢查網路（仍可搜尋地點）', 4000); return; }
    st = JSON.parse(JSON.stringify(st));
    const ZH = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh-TW'], ['get', 'name'], ['get', 'name:zh'], ['get', 'name_en']];
    st.layers.forEach((l) => { const tf = l.layout && l.layout['text-field']; if (tf == null) return; const js = JSON.stringify(tf); if (/name/.test(js) && !/"ref"/.test(js)) l.layout['text-field'] = ZH; });
    const v = lsGet('aip.mapView', { c: [120.96, 23.8], z: 7 });
    S.map = new maplibregl.Map({ container: 'msMap', style: st, center: v.c, zoom: v.z, attributionControl: false, maxPitch: 70, localIdeographFontFamily: '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif' });
    S.map.on('moveend', () => lsSet('aip.mapView', { c: S.map.getCenter().toArray(), z: S.map.getZoom() }));
    let lt = 0, sx = 0, sy = 0; const cv = S.map.getCanvasContainer();
    cv.addEventListener('touchstart', (e) => { clearTimeout(lt); if (e.touches.length !== 1) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; lt = setTimeout(() => { const r = cv.getBoundingClientRect(), ll = S.map.unproject([sx - r.left, sy - r.top]); dropAt(ll.lat, ll.lng); }, 600); }, { passive: true });
    cv.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (!t || Math.hypot(t.clientX - sx, t.clientY - sy) > 10) clearTimeout(lt); }, { passive: true });
    ['touchend', 'touchcancel'].forEach((ev) => cv.addEventListener(ev, () => clearTimeout(lt), { passive: true }));
    S.map.on('contextmenu', (e) => dropAt(e.lngLat.lat, e.lngLat.lng));
    S.map.on('load', () => { drawPhotos(); if (S.pick) choose(S.pick, true); });
  }
  const center = () => (S.map ? [S.map.getCenter().lat, S.map.getCenter().lng] : (S.pick ? [S.pick.lat, S.pick.lon] : [23.9, 121]));

  async function search(live) {
    const q = $('#msQ').value.trim(); if (!q) return; const seq = ++S.seq, c = center();
    const xy = Geo.parseCoords(q); if (xy) { $('#msRes').innerHTML = ''; dropAt(xy.lat, xy.lon); return; }
    const gk = !!Geo.key();
    const H = gk ? `<div class="grh">🔎 「${esc(q)}」<small>Google 地圖搜尋結果</small></div>` : `<div class="grh">🔎 「${esc(q)}」<small>搜尋結果（到設定填入 Google 金鑰後改用 Google 地圖搜尋）</small></div>`;
    $('#msRes').innerHTML = H + '<div class="sub" style="padding:8px">搜尋中…</div>';
    let GR = [], OR = [], gDone = !gk;
    const show = () => {
      if (seq !== S.seq) return;
      const out = GR.slice(); OR.forEach((x) => { if (!out.some((y) => y.name === x.name && gdist(y.lat, y.lon, x.lat, x.lon) < 40)) out.push(x); });
      S.list = out.slice(0, 12);
      $('#msRes').innerHTML = H + (S.list.length ? S.list.map((x, i) => `<a class="gr" data-i="${i}">${x.g ? '<span class="gbad">G</span>' : ''}<b>${esc(x.name)}</b><span class="sub">${x.tag ? '〔' + esc(x.tag) + '〕' : ''}${esc(x.addr || '')}</span></a>`).join('') : `<div class="sub" style="padding:8px">${gDone ? '找不到符合的地點，可換關鍵字、貼上座標，或長按地圖放置圖釘' : '搜尋中…'}</div>`);
      $$('#msRes .gr').forEach((a) => (a.onclick = () => choose(S.list[+a.dataset.i])));
    };
    const jobs = [];
    if (gk) jobs.push(google(q, c).then((r) => { GR = r; }).catch((e) => { GR = []; if (!live) toast('Google 搜尋失敗：' + e.message, 4000); }).then(() => { gDone = true; show(); }));
    const add = (r) => { r.forEach((x) => { if (!OR.some((o) => o.name === x.name && gdist(o.lat, o.lon, x.lat, x.lon) < 300)) OR.push(x); }); show(); };
    jobs.push(withTO(esriFind(q, c), 8000).then(add).catch(() => {}), withTO(photonFind(q, c), 7000).then(add).catch(() => {}));
    if (!live) jobs.push(withTO(nomFind(q), 9000).then(add).catch(() => {}));
    await Promise.allSettled(jobs); gDone = true; show();
  }
  async function rev(lat, lon) { const r = await Geo.reverse(lat, lon); return r || {}; }
  async function dropAt(lat, lon) { const r = await rev(lat, lon); choose(Object.assign({}, r, { name: r.name || '自訂地點', addr: r.display ? r.display.split(', ').reverse().join(' ') : '', lat, lon, drop: true })); }
  function choose(x, quiet) {
    if (!x) return; $('#msRes').innerHTML = ''; S.pick = x;
    if (S.map) {
      if (S.mk) S.mk.remove();
      S.mk = new maplibregl.Marker({ element: h('div', { class: 'mspin' }), anchor: 'bottom', draggable: true }).setLngLat([x.lon, x.lat]).addTo(S.map);
      S.mk.on('dragend', async () => { const ll = S.mk.getLngLat(); S.pick = Object.assign({}, S.pick, { lat: ll.lat, lon: ll.lng }); card(); const r = await rev(ll.lat, ll.lng); Object.assign(S.pick, { city: r.city || S.pick.city, state: r.state || S.pick.state, country: r.country || S.pick.country, cc: r.cc || S.pick.cc }); card(); });
      S.map.easeTo({ center: [x.lon, x.lat], zoom: Math.max(S.map.getZoom(), 15.5), duration: quiet ? 0 : 700, offset: [0, -60] });
    }
    card();
  }
  function card() {
    const x = S.pick, o = S.opt; const n = o.count || 0;
    $('#msCard').innerHTML = `<div style="display:flex;gap:8px;align-items:flex-start"><div class="grow"><h3>${esc(x.name || '自訂地點')}</h3><div class="sub">${esc(x.addr || [x.country, x.state, x.city].filter(Boolean).join(' '))}</div><div class="sub"><code>${x.lat.toFixed(6)}, ${x.lon.toFixed(6)}</code>・可拖曳圖釘微調</div></div><button class="ib" id="mcX">✕</button></div>
      <div class="acts"><button class="btn pri" id="mcApply">📍 ${esc(o.applyText || (n > 1 ? `套用到 ${n} 張相片` : '設為這張相片的拍攝地點'))}</button>
      <a class="btn" id="mcG">Google 地圖</a></div>`;
    $('#msCard').classList.remove('hide');
    $('#mcX').onclick = () => { $('#msCard').classList.add('hide'); if (S.mk) { S.mk.remove(); S.mk = null; } };
    $('#mcG').onclick = () => { const u = `https://www.google.com/maps/search/?api=1&query=${x.lat},${x.lon}`; if (isApp) NAT.call('openUrl', u); else window.open(u, '_blank'); };
    $('#mcApply').onclick = async () => {
      const b = $('#mcApply'); b.disabled = true;
      if (!x.country && !x.city) { b.textContent = '查詢地名…'; const r = await rev(x.lat, x.lon); Object.assign(x, { city: r.city || '', state: r.state || '', country: r.country || '', cc: r.cc || '' }); }
      const loc = { lat: +x.lat.toFixed(7), lon: +x.lon.toFixed(7), cc: x.cc || '', name: x.name || '', city: x.city || '', state: x.state || '', country: x.country || '' };
      const cb = o.onPick; close(); cb && cb(loc);
    };
  }
  function drawPhotos() {
    if (!S.map) return; S.phMk.forEach((m) => m.remove()); S.phMk = [];
    (window.Library && Library.recs || []).forEach((r) => {
      const g = (r.edit && r.edit.loc) || (r.exif && r.exif.lat != null ? { lat: r.exif.lat, lon: r.exif.lon } : null); if (!g) return;
      const el = h('div', { class: 'mspin ph2', title: r.name });
      DB.get('thumbs', 'e:' + r.id).then((b) => b || DB.get('thumbs', r.id)).then((b) => { if (b instanceof Blob) el.style.backgroundImage = `url(${URL.createObjectURL(b)})`; }).catch(() => {});
      S.phMk.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([g.lon, g.lat]).addTo(S.map));
    });
  }
  function locate() {
    if (!navigator.geolocation) { toast('無法定位'); return; }
    navigator.geolocation.getCurrentPosition(async (p) => { const { latitude: lat, longitude: lon } = p.coords;
      if (S.map) { if (S.me) S.me.remove(); S.me = new maplibregl.Marker({ element: h('div', { class: 'msMe' }) }).setLngLat([lon, lat]).addTo(S.map); S.map.easeTo({ center: [lon, lat], zoom: Math.max(S.map.getZoom(), 16) }); }
      dropAt(lat, lon); },
    (e) => { if (e.code === 1) { if (window.AIP2 && !AIP2.has()) AIP2.request(); toast('請允許定位權限（也可到 設定 → 權限 → 定位）', 4000); } else toast('定位失敗：' + e.message, 4000); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }
  /* opt：{ init:{lat,lon,name}, count, title, applyText, onPick(loc) } */
  function open(opt) {
    build(); S.opt = opt || {}; S.el.classList.add('on'); S.pick = null; $('#msCard').classList.add('hide'); $('#msRes').innerHTML = '';
    $('#msQ').value = ''; $('#msQ').placeholder = S.opt.count > 1 ? `搜尋地點，套用到 ${S.opt.count} 張相片` : '搜尋地點、地址或座標';
    initMap().then(() => { if (S.map) { S.map.resize(); drawPhotos(); } const i = S.opt.init; if (i && i.lat != null) choose({ name: i.name || '目前設定的地點', addr: [i.country, i.state, i.city].filter(Boolean).join(' '), lat: i.lat, lon: i.lon, city: i.city, state: i.state, country: i.country, cc: i.cc }, true); });
    setTimeout(() => { if (!S.opt.init) $('#msQ').focus(); }, 350);
  }
  function close() { if (S.el) S.el.classList.remove('on'); }
  return { open, close, isOpen: () => !!(S.el && S.el.classList.contains('on')) };
})();
