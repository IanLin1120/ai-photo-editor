/* ================= ③ 地點：搜尋地點，把座標寫進照片 =================
   搜尋方式與「行跡導航」相同：有 Google 金鑰時用 Google 地圖（Places API New）的結果排前面，
   同時查 Esri 門牌、Photon、OpenStreetMap，先回來的先顯示 */
const R2 = Math.PI / 180;
const gdist = (a, b, c, d) => { const x = (d - b) * R2 * Math.cos((a + c) / 2 * R2), y = (c - a) * R2; return Math.sqrt(x * x + y * y) * 6371000; };
const normQ = q => String(q || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[，、]/g, ' ').replace(/\s+/g, ' ').trim();
const isAddrQ = q => /\d+\s*(號|号)|[路街道]\S*\d|巷|弄|[縣市區鄉鎮里村]\S+[路街]/.test(q);
const withTO = (p, ms) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), ms))]);
async function getJSON(u, o = {}) { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), o.timeout || 15000); try { const r = await fetch(u, Object.assign({ signal: ctl.signal }, o)); if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; try { e.body = await r.text(); } catch (x) { } throw e; } return await r.json(); } finally { clearTimeout(t); } }
const GPC = new Map();
async function gPlaces(q, c) {
  if (!CFG.gkey || !q) return []; c = c || [23.9, 121]; const k = q + '|' + (+c[0]).toFixed(1) + ',' + (+c[1]).toFixed(1), hit = GPC.get(k); if (hit && Date.now() - hit.t < 6e5) return hit.r;
  const body = { textQuery: q, languageCode: 'zh-TW', regionCode: 'TW', maxResultCount: 10, locationBias: { circle: { center: { latitude: +c[0], longitude: +c[1] }, radius: 50000 } } };
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': CFG.gkey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName' }, body: JSON.stringify(body) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message || j.error.status);
  const out = (j.places || []).filter(p => p.location).map(p => ({ name: (p.displayName && p.displayName.text) || q, addr: (p.formattedAddress || '').replace(/^\d{3,6}\s*/, '').replace(/^台灣|^臺灣/, ''), lat: p.location.latitude, lon: p.location.longitude, tag: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '', g: 1 }));
  GPC.set(k, { t: Date.now(), r: out }); return out;
}
async function esriFind(q, c) {
  let u = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=8&outFields=Addr_type,PlaceName,Place_addr,Type&langCode=ZH&SingleLine=' + encodeURIComponent(normQ(q));
  if (c) u += `&location=${(+c[1]).toFixed(5)},${(+c[0]).toFixed(5)}`;
  const j = await getJSON(u, { timeout: 8000 }), tw = { PointAddress: '門牌', StreetAddress: '門牌(推估)', StreetInt: '路口', StreetName: '道路', POI: '地點', Locality: '區域' };
  return (j.candidates || []).filter(x => x.score >= 75 && x.location).map(x => { const a = x.attributes || {}; return { name: a.PlaceName && a.Addr_type === 'POI' ? a.PlaceName : (x.address || '').replace(/,\s*\d{3,6}$/, ''), addr: (a.Place_addr || x.address || '').replace(/,\s*\d{3,6}$/, '').replace(/,\s*/g, ' '), lat: x.location.y, lon: x.location.x, tag: tw[a.Addr_type] || '' }; });
}
async function photonFind(q, c) {
  let u = 'https://photon.komoot.io/api/?limit=6&q=' + encodeURIComponent(q); if (c) u += `&lat=${(+c[0]).toFixed(4)}&lon=${(+c[1]).toFixed(4)}`;
  const j = await getJSON(u, { timeout: 7000 });
  return (j.features || []).map(f => { const p = f.properties || {}, g = f.geometry.coordinates; const addr = [p.state, p.county, p.city, p.district, p.locality, p.street, p.housenumber ? p.housenumber + '號' : ''].filter(Boolean).filter((x, i, A) => A.indexOf(x) === i).join(' '); return { name: p.name || addr, addr, lat: g[1], lon: g[0] }; }).filter(x => x.name);
}
async function nomFind(q) { const j = await getJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=zh-TW,zh,en&q=' + encodeURIComponent(q), { timeout: 9000 }); return j.map(x => ({ name: x.name || x.display_name.split(',')[0], addr: x.display_name.split(', ').reverse().join(' '), lat: +x.lat, lon: +x.lon })); }
async function revGeo(lat, lon) {
  try { const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=zh-TW,zh&lat=${lat}&lon=${lon}`, { timeout: 8000 }); const a = j.address || {};
    return { name: j.name || a.amenity || a.tourism || a.road || '', addr: [a.state || a.city, a.county, a.city_district || a.town || a.suburb, a.village, a.road, a.house_number ? a.house_number + '號' : ''].filter(Boolean).filter((x, i, A) => A.indexOf(x) === i).join(' ') }; }
  catch (e) { return { name: '', addr: '' }; }
}
function parseLL(q) { const m = /^\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/.exec(q); return m ? { lat: +m[1], lon: +m[2] } : null; }

const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const Geo = {
  map: null, target: [], mk: null, phMk: [], pick: null, me: null,
  async init() {
    if (this.map) return;
    $('#geoGo').onclick = () => this.search();
    $('#geoQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.search(); } };
    $('#geoQ').oninput = () => { clearTimeout(this._t); const q = $('#geoQ').value.trim(); if (q.length >= 2) this._t = setTimeout(() => this.search(true), CFG.gkey ? 650 : 400); else $('#geoRes').innerHTML = ''; };
    $('#geoClr').onclick = () => { $('#geoQ').value = ''; $('#geoRes').innerHTML = ''; this.closeCard(); };
    $('#geoMenu').onclick = () => this.menu();
    $('#geoLoc').onclick = () => this.locate();
    $('#geo3d').onclick = () => { if (!this.map) return; const p = this.map.getPitch() > 5 ? 0 : 60; this.map.easeTo({ pitch: p, duration: 600 }); $('#geo3d b').textContent = p ? '2D' : '3D'; };
    if (!window.maplibregl) { $('#geoMap').innerHTML = '<div class="empty">此裝置無法載入地圖</div>'; return; }
    let st = null;
    try { st = lsGet('aip.style', null); if (!st || !st.layers) { st = await getJSON(OFM_STYLE, { timeout: 20000 }); lsSet('aip.style', st); } } catch (e) { toast('地圖樣式下載失敗，請檢查網路'); return; }
    st = JSON.parse(JSON.stringify(st));
    const ZH = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh-TW'], ['get', 'name'], ['get', 'name:zh'], ['get', 'name_en']];
    st.layers.forEach(l => { const tf = l.layout && l.layout['text-field']; if (tf == null) return; const js = JSON.stringify(tf); if (/name/.test(js) && !/"ref"/.test(js)) l.layout['text-field'] = ZH; });
    const v = CFG.view || { c: [120.96, 23.8], z: 7 };
    this.map = new maplibregl.Map({ container: 'geoMap', style: st, center: v.c, zoom: v.z, attributionControl: { compact: true }, maxPitch: 70, localIdeographFontFamily: '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif' });
    this.map.on('moveend', () => { CFG.view = { c: this.map.getCenter().toArray(), z: this.map.getZoom() }; saveCfg(); });
    // 長按地圖：在這裡放一個地點
    let lt = 0, sx = 0, sy = 0; const cv = this.map.getCanvasContainer();
    cv.addEventListener('touchstart', e => { clearTimeout(lt); if (e.touches.length !== 1) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; lt = setTimeout(() => { const r = cv.getBoundingClientRect(), ll = this.map.unproject([sx - r.left, sy - r.top]); this.dropAt(ll.lat, ll.lng); }, 600); }, { passive: true });
    cv.addEventListener('touchmove', e => { const t = e.touches[0]; if (!t || Math.hypot(t.clientX - sx, t.clientY - sy) > 10) clearTimeout(lt); }, { passive: true });
    ['touchend', 'touchcancel'].forEach(ev => cv.addEventListener(ev, () => clearTimeout(lt), { passive: true }));
    this.map.on('contextmenu', e => this.dropAt(e.lngLat.lat, e.lngLat.lng));
    this.map.on('load', () => this.drawPhotos());
  },
  onShow() { this.init().then(() => { if (this.map) { this.map.resize(); this.drawPhotos(); } this.hint(); }); },
  hint() {
    const n = this.target.length;
    if (n) $('#geoQ').placeholder = `搜尋地點，套用到 ${n} 張照片`; else $('#geoQ').placeholder = '搜尋地點、地址或座標';
  },
  onTheme() { },
  center() { return this.map ? [this.map.getCenter().lat, this.map.getCenter().lng] : [23.9, 121]; },
  async search(live) {
    const q = $('#geoQ').value.trim(); if (!q) return; const seq = this.seq = (this.seq || 0) + 1, c = this.center();
    const ll = parseLL(q); if (ll) { const r = await revGeo(ll.lat, ll.lon); this.choose({ name: r.name || '座標', addr: r.addr, lat: ll.lat, lon: ll.lon }); return; }
    const H = CFG.gkey ? `<div class="grh">🔎 「${esc(q)}」<small>Google 地圖搜尋結果</small></div>` : `<div class="grh">🔎 「${esc(q)}」<small>搜尋結果（到設定填入 Google 金鑰後改用 Google 地圖搜尋）</small></div>`;
    $('#geoRes').innerHTML = H + '<div class="sub" style="padding:8px">搜尋中…</div>';
    let GR = [], OR = [], gDone = !CFG.gkey;
    const show = () => {
      if (seq !== this.seq) return;
      const L = GR.concat(GR.length >= 3 ? [] : OR), out = [];
      L.forEach(x => { if (!out.some(y => y.name === x.name && gdist(y.lat, y.lon, x.lat, x.lon) < 40)) out.push(x); });
      this.list = out.slice(0, 12);
      $('#geoRes').innerHTML = H + (this.list.length ? this.list.map((x, i) => `<a class="gr" data-i="${i}">${x.g ? '<span class="gbad">G</span>' : ''}<b>${esc(x.name)}</b><span class="sub">${x.tag ? '〔' + esc(x.tag) + '〕' : ''}${esc(x.addr || '')}</span></a>`).join('') : `<div class="sub" style="padding:8px">${gDone ? '找不到符合的地點' : '搜尋中…'}</div>`);
      $$('#geoRes .gr').forEach(a => a.onclick = () => this.choose(this.list[+a.dataset.i]));
    };
    const jobs = [];
    if (CFG.gkey) jobs.push(gPlaces(q, c).then(r => { GR = r; }).catch(e => { GR = []; if (!live) toast('Google 搜尋失敗：' + e.message, 4000); }).then(() => { gDone = true; show(); }));
    const add = r => { r.forEach(x => { if (!OR.some(o => o.name === x.name && gdist(o.lat, o.lon, x.lat, x.lon) < 300)) OR.push(x); }); show(); };
    const nq = normQ(q);
    jobs.push(withTO(esriFind(nq, c), 8000).then(add).catch(() => { }), withTO(photonFind(nq, c), 7000).then(add).catch(() => { }));
    if (!live) jobs.push(withTO(nomFind(nq), 9000).then(add).catch(() => { }));
    await Promise.allSettled(jobs); gDone = true; show();
  },
  async dropAt(lat, lon) { const r = await revGeo(lat, lon); this.choose({ name: r.name || '自訂地點', addr: r.addr, lat, lon, drop: true }); },
  choose(x) {
    if (!x) return; $('#geoRes').innerHTML = ''; this.pick = x;
    if (this.map) {
      if (this.mk) this.mk.remove(); const el = h('div', { class: 'pin' });
      this.mk = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([x.lon, x.lat]).addTo(this.map);
      this.mk.on('dragend', async () => { const ll = this.mk.getLngLat(); const r = await revGeo(ll.lat, ll.lng); this.pick = Object.assign({}, this.pick, { lat: ll.lat, lon: ll.lng, addr: r.addr || this.pick.addr }); this.card(); });
      this.map.easeTo({ center: [x.lon, x.lat], zoom: Math.max(this.map.getZoom(), 15.5), duration: 700, offset: [0, -60] });
    }
    this.card();
  },
  card() {
    const x = this.pick, T = this.targets(), cur = Editor.p;
    $('#geoCard').innerHTML = `<div style="display:flex;gap:8px;align-items:flex-start"><div class="grow"><h3>${esc(x.name)}</h3><div class="sub">${esc(x.addr || '')}</div><div class="sub"><code>${x.lat.toFixed(6)}, ${x.lon.toFixed(6)}</code>・可拖曳圖釘微調</div></div><button class="ib" id="gcX">✕</button></div>
      <div class="acts">${T.length ? `<button class="btn pri" id="gcApply">📍 套用到 ${T.length === 1 ? '「' + esc(T[0].name) + '」' : T.length + ' 張照片'}</button>` : ''}
      ${cur && !(T.length === 1 && T[0] === cur) ? `<button class="btn ${T.length ? '' : 'pri'}" id="gcCur">套用到目前照片</button>` : ''}
      <button class="btn" id="gcSel">選擇照片…</button></div>`;
    $('#geoCard').classList.remove('hide');
    $('#gcX').onclick = () => this.closeCard();
    const ap = $('#gcApply'); if (ap) ap.onclick = () => this.apply(T);
    const cu = $('#gcCur'); if (cu) cu.onclick = () => this.apply([cur]);
    $('#gcSel').onclick = () => { Lib.setSel(true); App.show('v-lib'); toast('選好照片後，按下方「📍 地點」回到這裡'); };
  },
  closeCard() { $('#geoCard').classList.add('hide'); if (this.mk) { this.mk.remove(); this.mk = null; } },
  targets() { return this.target.map(id => Lib.photos.find(p => p.id === id)).filter(Boolean); },
  async apply(L) {
    const x = this.pick; if (!x || !L.length) return;
    for (const p of L) { p.edit = p.edit || newEdit(); p.edit.gps = { lat: +x.lat.toFixed(7), lon: +x.lon.toFixed(7), name: x.name, addr: x.addr }; await Lib.save(p); }
    if (Editor.p && L.includes(Editor.p)) { Editor.e = Editor.p.edit; Editor.tools(); }
    toast(`已把「${x.name}」設定到 ${L.length} 張照片，匯出時寫入 EXIF`);
    this.target = []; this.hint(); this.closeCard(); this.drawPhotos(); Lib.render();
  },
  /* 已有地點的照片顯示成小縮圖圖釘 */
  drawPhotos() {
    if (!this.map) return; this.phMk.forEach(m => m.remove()); this.phMk = [];
    Lib.photos.forEach(p => { const g = p.edit && p.edit.gps || (p.meta && p.meta.lat != null ? { lat: p.meta.lat, lon: p.meta.lon } : null); if (!g) return;
      const el = h('div', { class: 'pin ph2', style: p.thumb ? `background-image:url(${p.thumb})` : '' }); el.title = p.name; el.onclick = () => Editor.open(p);
      this.phMk.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([g.lon, g.lat]).addTo(this.map)); });
  },
  locate() {
    if (!navigator.geolocation) { toast('無法定位'); return; }
    navigator.geolocation.getCurrentPosition(p => { const { latitude: lat, longitude: lon } = p.coords; if (this.me) this.me.remove(); this.me = new maplibregl.Marker({ element: h('div', { class: 'meDot' }) }).setLngLat([lon, lat]).addTo(this.map); this.map.easeTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), 16) }); },
      e => toast(e.code === 1 ? '請到設定允許定位權限' : '定位失敗：' + e.message, 4000), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  },
  async menu() {
    const i = await ask('📍 地點', `<div class="sub">${this.target.length ? `目前要設定：${this.target.length} 張照片` : '可在照片頁多選後按「📍 地點」，一次設定很多張'}</div>`, ['📍 使用目前位置', '🗑 清除選取照片的地點', '關閉']);
    if (i === 0) { navigator.geolocation.getCurrentPosition(async p => { const r = await revGeo(p.coords.latitude, p.coords.longitude); this.choose({ name: r.name || '目前位置', addr: r.addr, lat: p.coords.latitude, lon: p.coords.longitude }); }, e => toast('定位失敗：' + e.message)); }
    if (i === 1) { const L = this.targets(); for (const p of L) { if (p.edit) { p.edit.gps = null; await Lib.save(p); } } toast(`已清除 ${L.length} 張照片的地點`); this.drawPhotos(); Lib.render(); }
  }
};
