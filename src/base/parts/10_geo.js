/* ================= 拍攝地點（GPS） =================
   和「檔案批次改名工具」相同方式：有 Google API 金鑰時用 Google 地圖地點搜尋，
   沒有金鑰則用 OpenStreetMap（Nominatim / Photon）。地圖可拖曳圖釘微調。 */
const Geo = {
  key() { try { return localStorage.getItem('g-api-key') || ''; } catch (e) { return ''; } },
  setKey(v) { try { localStorage.setItem('g-api-key', String(v || '').trim()); } catch (e) {} },
  async json(url, opt = {}) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 12000);
    try { const r = await fetch(url, { ...opt, signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); }
  },
  parseCoords(q) {
    q = String(q || '').trim();
    let m = q.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || q.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || q.match(/[?&](?:q|query|ll|center)=(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/) || q.match(/^\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/);
    if (m) { const lat = +m[1], lon = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }; }
    m = q.match(/(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([NS])[,\s]+(\d+)°\s*(\d+)['′]\s*([\d.]+)["″]?\s*([EW])/i);
    if (m) { const f = (d, mi, s, r) => (+d + mi / 60 + s / 3600) * (/[SW]/i.test(r) ? -1 : 1); return { lat: f(m[1], m[2], m[3], m[4]), lon: f(m[5], m[6], m[7], m[8]) }; }
    return null;
  },
  async google(q, c) {
    const key = this.key(); if (!key) return null;
    const body = { textQuery: q, languageCode: 'zh-TW', maxResultCount: 8 };
    if (c) body.locationBias = { circle: { center: { latitude: c[0], longitude: c[1] }, radius: 50000 } };
    const j = await this.json('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.addressComponents' }, body: JSON.stringify(body) });
    if (j.error) throw new Error(j.error.message);
    return (j.places || []).filter((p) => p.location).map((p) => {
      const ac = p.addressComponents || []; const f = (t) => { const x = ac.find((a) => (a.types || []).includes(t)); return x || null; };
      const ct = f('locality') || f('administrative_area_level_2') || f('administrative_area_level_3'); const st = f('administrative_area_level_1'); const co = f('country');
      return { lat: p.location.latitude, lon: p.location.longitude, name: (p.displayName && p.displayName.text) || '', city: ct ? ct.longText : '', state: st ? st.longText : '', country: co ? co.longText : '', cc: co ? co.shortText : '', display: p.formattedAddress || '', src: 'Google' };
    });
  },
  fromNom(r) { const a = r.address || {}; return { lat: +r.lat, lon: +r.lon, name: r.name || (r.display_name || '').split(',')[0], city: a.city || a.town || a.village || a.county || '', state: a.state || '', country: a.country || '', cc: (a.country_code || '').toUpperCase(), display: r.display_name || '', src: 'OSM' }; },
  async search(q, c) {
    const xy = this.parseCoords(q); if (xy) return [{ ...xy, name: '', display: `${xy.lat.toFixed(6)}, ${xy.lon.toFixed(6)}`, coord: true }];
    let list = [];
    try { const g = await this.google(q, c); if (g) list = g; } catch (e) { console.warn('google', e); }
    if (list.length < 3) {
      try { const r = await this.json(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=zh-TW,zh,en&q=${encodeURIComponent(q)}`); for (const x of r.map((y) => this.fromNom(y))) if (!list.some((o) => Math.abs(o.lat - x.lat) < 5e-4 && Math.abs(o.lon - x.lon) < 5e-4)) list.push(x); } catch (e) {}
    }
    if (!list.length) {
      try { const r = await this.json(`https://photon.komoot.io/api/?limit=6&q=${encodeURIComponent(q)}`); list = (r.features || []).map((f) => { const p = f.properties || {}; return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: p.name || '', city: p.city || p.county || '', state: p.state || '', country: p.country || '', cc: (p.countrycode || '').toUpperCase(), display: [p.name, p.city, p.state, p.country].filter(Boolean).join(', '), src: 'OSM' }; }); } catch (e) {}
    }
    return list;
  },
  async reverse(lat, lon) {
    try { const r = await this.json(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=zh-TW,zh,en&lat=${lat}&lon=${lon}`); return this.fromNom(r); } catch (e) {}
    try { const r = await this.json(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`); const p = (r.features && r.features[0] && r.features[0].properties) || {}; return { name: p.name || '', city: p.city || '', state: p.state || '', country: p.country || '', cc: (p.countrycode || '').toUpperCase() }; } catch (e) {}
    return null;
  }
};

/* 地點選擇器元件：搜尋列 + 結果 + 地圖 + 名稱欄位 */
function LocationPicker(init, opts = {}) {
  const st = { cur: init && isFinite(init.lat) ? { ...init } : null, map: null, marker: null, layer: 'street', tiles: [], req: 0 };
  const q = h('input', { type: 'search', placeholder: '搜尋地名、地址，或貼上座標／Google 地圖網址', style: { flex: '1' } });
  const go = h('button', { class: 'btn pri sm' }, '搜尋');
  const msg = h('div', { class: 'sub', style: { minHeight: '18px' } });
  const res = h('div', { class: 'mlist', style: { maxHeight: '170px', overflow: 'auto' } });
  const mapEl = h('div', { style: { height: opts.mapH || '230px', borderRadius: '14px', overflow: 'hidden', margin: '6px 0', background: 'color-mix(in srgb,var(--sub) 15%,transparent)', position: 'relative' } });
  const coord = h('b', { style: { userSelect: 'text' } });
  const fld = {}; const fields = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } });
  for (const [k, n] of [['name', '地點名稱'], ['city', '城市'], ['state', '省/州'], ['country', '國家']]) { fld[k] = h('input', { placeholder: n, value: (st.cur && st.cur[k]) || '' }); fields.append(fld[k]); }
  const seg = h('div', { class: 'seg' }, [['street', '街道'], ['sat', '衛星']].map(([k, n]) => { const b = h('button', { class: 'btn' + (k === 'street' ? ' on' : '') }, n); b.onclick = () => { st.layer = k; [...seg.children].forEach((x) => x.classList.toggle('on', x === b)); tiles(); }; return b; }));
  const gmap = h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', style: { display: 'none' } }, '在 Google 地圖開啟');
  gmap.onclick = (e) => { if (isApp) { e.preventDefault(); NAT.call('openUrl', gmap.href); } };
  const root = h('div', null, h('div', { style: { display: 'flex', gap: '6px' } }, q, go), msg, res, mapEl, h('div', { class: 'lbl2' }, h('span', null, '座標 ', coord), seg), fields, h('div', { class: 'acts' }, gmap));
  const say = (t, warn) => { msg.textContent = t || ''; msg.style.color = warn ? 'var(--warn)' : ''; };
  const show = () => {
    coord.textContent = st.cur ? `${st.cur.lat.toFixed(6)}, ${st.cur.lon.toFixed(6)}` : '未設定';
    if (st.cur) { gmap.style.display = ''; gmap.href = `https://www.google.com/maps/search/?api=1&query=${st.cur.lat},${st.cur.lon}`; } else gmap.style.display = 'none';
  };
  const fill = (r) => { for (const k in fld) fld[k].value = (r && r[k]) || ''; if (st.cur && r) st.cur.cc = r.cc || st.cur.cc || ''; };
  function tiles() {
    if (!st.map) return; st.tiles.forEach((t) => st.map.removeLayer(t)); st.tiles = [];
    const esri = (svc, x) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, Object.assign({ maxZoom: 20, maxNativeZoom: 19 }, x || {}));
    if (st.layer === 'sat') { st.tiles.push(esri('World_Imagery', { attribution: '© Esri, Maxar' })); st.tiles.push(esri('Reference/World_Boundaries_and_Places')); }
    else st.tiles.push(esri('World_Street_Map', { attribution: '© Esri, HERE, Garmin, OpenStreetMap' }));
    st.tiles.forEach((t) => t.addTo(st.map));
  }
  function setPoint(lat, lon, info, rev, zoom) {
    lat = clamp(+lat, -90, 90); lon = ((+lon + 540) % 360) - 180;
    st.cur = Object.assign(st.cur || {}, { lat: +lat.toFixed(7), lon: +lon.toFixed(7) });
    if (st.map) {
      if (!st.marker) { st.marker = L.marker([lat, lon], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="gpin"></div>', iconSize: [26, 26], iconAnchor: [13, 30] }) }).addTo(st.map); st.marker.on('dragend', () => { const p = st.marker.getLatLng(); setPoint(p.lat, p.lng, null, true); }); }
      else st.marker.setLatLng([lat, lon]);
      zoom ? st.map.setView([lat, lon], zoom) : st.map.panTo([lat, lon]);
    }
    if (info) fill(info);
    show(); opts.onChange && opts.onChange(picker.value());
    if (rev) { say('查詢地點名稱…'); clearTimeout(st.rt); st.rt = setTimeout(async () => { const r = await Geo.reverse(st.cur.lat, st.cur.lon); if (r) { fill(r); say('已帶入地點名稱，可直接修改'); opts.onChange && opts.onChange(picker.value()); } else say('查不到地點名稱，可手動填寫', true); }, 700); }
  }
  async function search() {
    const text = q.value.trim(); if (!text) return;
    if (/goo\.gl\/|maps\.app\./i.test(text)) { say('Google 短網址無法讀取：請在瀏覽器開啟後複製網址列完整網址再貼上。', true); return; }
    const id = ++st.req; say('搜尋中…'); res.innerHTML = '';
    let c = null; try { if (st.map) { const m = st.map.getCenter(); c = [m.lat, m.lng]; } } catch (e) {}
    const list = await Geo.search(text, c); if (id !== st.req) return;
    if (!list.length) { say('找不到這個地點，可換關鍵字，或貼上 Google 地圖的完整網址／座標。', true); return; }
    say(`找到 ${list.length} 個結果${Geo.key() ? '' : '（未設定 Google 金鑰，使用 OpenStreetMap）'}`);
    list.forEach((r, i) => res.append(h('div', { class: 'mitem', onclick: () => { [...res.children].forEach((x) => x.classList.remove('on')); res.children[i].classList.add('on'); setPoint(r.lat, r.lon, r.coord ? null : r, !!r.coord, 17); } }, h('span', { class: 'mi' }, '📍'), h('span', { class: 'grow' }, r.name || r.display, h('div', { class: 'sub' }, r.display)))));
    res.children[0].click();
  }
  go.onclick = search; q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); search(); } });
  for (const k in fld) fld[k].addEventListener('input', () => opts.onChange && opts.onChange(picker.value()));
  const picker = {
    el: root,
    value() { if (!st.cur) return null; const v = { lat: st.cur.lat, lon: st.cur.lon, cc: st.cur.cc || '' }; for (const k in fld) v[k] = fld[k].value.trim(); if (st.cur.alt != null) v.alt = st.cur.alt; return v; },
    mount() {
      show();
      if (!window.L) { mapEl.append(h('div', { class: 'sub', style: { padding: '20px', textAlign: 'center' } }, '地圖元件無法載入，仍可搜尋或貼上座標。')); return; }
      if (st.map) { st.map.invalidateSize(); return; }
      st.map = L.map(mapEl, { zoomControl: true, worldCopyJump: true, attributionControl: true }).setView(st.cur ? [st.cur.lat, st.cur.lon] : [23.7, 120.96], st.cur ? 15 : 7);
      st.map.attributionControl.setPrefix(''); tiles();
      st.map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng, null, true));
      if (st.cur) setPoint(st.cur.lat, st.cur.lon, null, false, 15);
      setTimeout(() => st.map && st.map.invalidateSize(), 120); setTimeout(() => st.map && st.map.invalidateSize(), 500);
    },
    setPoint
  };
  return picker;
}
