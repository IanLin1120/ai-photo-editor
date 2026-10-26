"""AI修圖軟體 v1.11+：以 v1.10.1（舊版，讀取／新增照片、調色、影調都沿用）為基礎，加上
   ① 行跡導航樣式的地點搜尋地圖 ② 版本與更新（線上更新、選版本下載 APK）
用法：VER=1.11.0 CODE=19 MINAPK=1.11.0 NOTES="…" python3 src/build.py  → src/dist/index.html、src/dist/gh/（把 gh 裡的檔案放到儲存庫根目錄）"""
import os, json, shutil
H = os.path.dirname(os.path.abspath(__file__)); W = H + '/web/'
VER = os.environ.get('VER', '1.11.0'); CODE = int(os.environ.get('CODE', '19')); MINAPK = os.environ.get('MINAPK', '1.11.0'); NOTES = os.environ.get('NOTES', '')
rd = lambda f: open(W + f, encoding='utf8').read()
P = H + '/base/parts/'; s = ''.join(open(P + f, encoding='utf8').read() for f in json.load(open(P + 'order.json')))
def rep(old, new, cnt=1):
    global s
    n = s.count(old); assert n == cnt, (old[:80], n); s = s.replace(old, new)

rep('<head>\n', '<head>\n<script>' + rd('ota_boot.js').replace('__VER__', VER) + '</script>\n')
rep('</style>\n</head>', rd('maplibre-gl.css') + '\n' + rd('extra.css') + '</style>\n</head>')
rep("<script>/* ================= 對話框 ================= */",
    '<script>' + rd('maplibre-gl.js') + '</script>\n<script>' + rd('mapsearch.js') + '\n' + rd('upd.js') + "</script>\n<script>/* ================= 對話框 ================= */")
rep("const APP_VERSION = '1.10.1';", f"const APP_VERSION = '{VER}';")
rep("    root.append(card('ℹ️ 關於',", "    root.append(Upd.card(card));\n    root.append(card('ℹ️ 關於',")
rep("    Cloud.resume();\n", "    Cloud.resume();\n    Upd.boot();\n")
rep("    if (UI.open) { UI.close(); return true; }\n", "    if (Upd.isOpen()) { Upd.closeDlg(); return true; }\n    if (UI.open) { UI.close(); return true; }\n    if (MS.isOpen()) { MS.close(); return true; }\n")
# 編輯器「位置」工具：改用全螢幕地圖搜尋
old_loc = s[s.index("    let draft = null;\n    const picker = LocationPicker(cur"):s.index("    requestAnimationFrame(() => picker.mount());\n  },") + len("    requestAnimationFrame(() => picker.mount());\n")]
rep(old_loc, """    const open = () => MS.open({ init: cur || (ex.lat != null ? { lat: ex.lat, lon: ex.lon } : null), count: 1, onPick: (v) => { this.edit.loc = v; this.changed(); this.commit('設定拍攝地點'); this.persist(); toast('已設定，匯出時會寫入 GPS 座標'); this.renderPanel(); } });
    b.append(h('div', { class: 'locBig', onclick: open }, h('span', { class: 'ic' }, '🗺'), h('div', { class: 'grow' }, h('b', null, cur ? '更改拍攝地點' : '搜尋地點並設定為拍攝地點'), h('div', { class: 'sub' }, 'Google 地圖搜尋、長按地圖放圖釘、可拖曳微調（與行跡導航相同）')), h('span', null, '›')));
    if (cur) b.append(h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: () => { this.edit.loc = null; this.changed(); this.commit('清除自訂位置'); this.renderPanel(); } }, '清除自訂位置')));
    b.append(h('div', { class: 'note' }, '座標會寫入 EXIF GPS 與 XMP（含地點名稱、城市、國家），Google 相簿、Lightroom、手機相簿都能讀取。要套用到多張相片：圖庫 → 選取 → 「📍 位置」。'));
""")
# 圖庫多選「📍 位置」
old_b = s[s.index("  batchLoc(list) {"):s.index("  async rerenderThumb(r) {")]
rep(old_b, """  batchLoc(list) {
    const first = list.find((r) => r.edit && r.edit.loc) || list.find((r) => r.exif && r.exif.lat != null);
    const init = first ? (first.edit && first.edit.loc) || { lat: first.exif.lat, lon: first.exif.lon } : null;
    const go = () => MS.open({ init, count: list.length, applyText: list.length > 1 ? `套用到選取的 ${list.length} 張相片` : '設為這張相片的拍攝地點', onPick: async (loc) => { for (const r of list) { r.edit = normEdit(r.edit); r.edit.loc = loc; await DB.put('photos', r); } toast(`已為 ${list.length} 張相片設定「${loc.name || '自訂地點'}」，匯出時寫入 GPS`); this.render(); } });
    if (!list.some((r) => r.edit && r.edit.loc)) { go(); return; }
    UI.sheet(`拍攝地點（${list.length} 張）`, h('div', null, h('div', { class: 'acts' },
      h('button', { class: 'btn pri', onclick: () => { UI.close(); go(); } }, '🗺 搜尋地點並套用'),
      h('button', { class: 'btn', onclick: async () => { for (const r of list) { if (r.edit) { r.edit.loc = null; await DB.put('photos', r); } } UI.close(); toast('已清除自訂位置'); this.render(); } }, '清除自訂位置'))));
  },
""")
os.makedirs(H + '/dist/gh', exist_ok=True)
open(H + '/dist/index.html', 'w', encoding='utf8').write(s)
open(H + '/dist/gh/index.html', 'w', encoding='utf8').write(s)
json.dump({'app': VER, 'apk': CODE, 'apkName': VER, 'minApk': MINAPK, 'notes': NOTES}, open(H + '/dist/gh/version.json', 'w', encoding='utf8'), ensure_ascii=False)
print(VER, len(s))
