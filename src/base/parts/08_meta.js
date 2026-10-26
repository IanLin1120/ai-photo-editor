/* ================= 中繼資料（EXIF / XMP） =================
   從原檔取出 EXIF（TIFF 區塊原封不動，包含 MakerNote 廠商資料）與 XMP，
   修正方向/尺寸後寫回輸出檔（JPEG / PNG / WebP）。 */
const Meta = (() => {
  'use strict';
  const te = new TextEncoder(), td = new TextDecoder();
  const EXIF_HDR = [0x45, 0x78, 0x69, 0x66, 0, 0];
  const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';
  function startsWith(u8, off, arr) { for (let i = 0; i < arr.length; i++) if (u8[off + i] !== arr[i]) return false; return true; }
  function strAt(u8, off, n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[off + i]); return s; }

  function extract(buf) {
    const u8 = new Uint8Array(buf); const r = { exif: null, xmp: null, fmt: null };
    if (u8[0] === 0xff && u8[1] === 0xd8) {
      r.fmt = 'jpeg'; let o = 2;
      while (o + 4 < u8.length) {
        if (u8[o] !== 0xff) { o++; continue; }
        const m = u8[o + 1]; if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { o += 2; continue; }
        if (m === 0xda || m === 0xd9) break;
        const len = (u8[o + 2] << 8) | u8[o + 3]; const p = o + 4;
        if (m === 0xe1) {
          if (!r.exif && startsWith(u8, p, EXIF_HDR)) r.exif = u8.slice(p + 6, o + 2 + len);
          else if (!r.xmp && strAt(u8, p, XMP_NS.length) === XMP_NS) r.xmp = td.decode(u8.subarray(p + XMP_NS.length, o + 2 + len));
        }
        o += 2 + len;
      }
    } else if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
      r.fmt = 'png'; let o = 8;
      while (o + 8 <= u8.length) {
        const len = ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0; const type = strAt(u8, o + 4, 4); const p = o + 8;
        if (type === 'eXIf') { let d = u8.slice(p, p + len); if (startsWith(d, 0, EXIF_HDR)) d = d.slice(6); r.exif = d; }
        else if (type === 'iTXt') { const kwEnd = u8.indexOf(0, p); if (strAt(u8, p, kwEnd - p) === 'XML:com.adobe.xmp' && u8[kwEnd + 1] === 0) { let q = kwEnd + 3; q = u8.indexOf(0, q) + 1; q = u8.indexOf(0, q) + 1; r.xmp = td.decode(u8.subarray(q, p + len)); } }
        else if (type === 'IEND') break;
        o = p + len + 4;
      }
    } else if (strAt(u8, 0, 4) === 'RIFF' && strAt(u8, 8, 4) === 'WEBP') {
      r.fmt = 'webp'; let o = 12;
      while (o + 8 <= u8.length) {
        const type = strAt(u8, o, 4); const len = (u8[o + 4] | (u8[o + 5] << 8) | (u8[o + 6] << 16) | (u8[o + 7] << 24)) >>> 0; const p = o + 8;
        if (type === 'EXIF') { let d = u8.slice(p, p + len); if (startsWith(d, 0, EXIF_HDR)) d = d.slice(6); r.exif = d; }
        else if (type === 'XMP ') r.xmp = td.decode(u8.subarray(p, p + len));
        o = p + len + (len & 1);
      }
    }
    return r;
  }

  /* ---- TIFF 解析 ---- */
  function tiff(t) {
    const le = t[0] === 0x49; const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    const w16 = (o, v) => dv.setUint16(o, v, le), w32 = (o, v) => dv.setUint32(o, v, le);
    return { le, dv, u16, u32, w16, w32, len: t.byteLength };
  }
  const TS = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8 };
  function readIFD(T, off) {
    if (!off || off + 2 > T.len) return { entries: [], next: 0, off };
    const n = T.u16(off); const entries = [];
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12; if (e + 12 > T.len) break;
      const tag = T.u16(e), type = T.u16(e + 2), count = T.u32(e + 4); const size = (TS[type] || 1) * count;
      entries.push({ tag, type, count, entry: e, valOff: size <= 4 ? e + 8 : T.u32(e + 8), size });
    }
    const nx = off + 2 + n * 12; return { entries, next: nx + 4 <= T.len ? T.u32(nx) : 0, off, nextPtr: nx };
  }
  function val(T, t8, e) {
    const o = e.valOff; if (o + e.size > T.len) return null;
    switch (e.type) {
      case 2: { let s = ''; for (let i = 0; i < e.count; i++) { const c = t8[o + i]; if (!c) break; s += String.fromCharCode(c); } try { s = decodeURIComponent(escape(s)); } catch (_) {} return s.trim(); }
      case 3: return e.count === 1 ? T.u16(o) : Array.from({ length: e.count }, (_, i) => T.u16(o + i * 2));
      case 4: return e.count === 1 ? T.u32(o) : Array.from({ length: e.count }, (_, i) => T.u32(o + i * 4));
      case 5: { const a = Array.from({ length: e.count }, (_, i) => T.u32(o + i * 8) / (T.u32(o + i * 8 + 4) || 1)); return e.count === 1 ? a[0] : a; }
      case 10: { const a = Array.from({ length: e.count }, (_, i) => T.dv.getInt32(o + i * 8, T.le) / (T.dv.getInt32(o + i * 8 + 4, T.le) || 1)); return e.count === 1 ? a[0] : a; }
      case 7: return t8.slice(o, o + e.size);
      default: return null;
    }
  }
  /* 擷取常用資訊（顯示在「相片資訊」） */
  function summary(t8) {
    if (!t8 || t8.length < 8) return null;
    try {
      const T = tiff(t8); const ifd0 = readIFD(T, T.u32(4)); const out = {};
      const get = (ifd, tag) => { const e = ifd.entries.find((x) => x.tag === tag); return e ? val(T, t8, e) : null; };
      out.make = get(ifd0, 0x010f); out.model = get(ifd0, 0x0110); out.orientation = get(ifd0, 0x0112); out.software = get(ifd0, 0x0131); out.date = get(ifd0, 0x0132);
      const exP = get(ifd0, 0x8769); if (exP) { const ex = readIFD(T, exP);
        out.exposure = get(ex, 0x829a); out.fnumber = get(ex, 0x829d); out.iso = get(ex, 0x8827); out.dateOrig = get(ex, 0x9003); out.bias = get(ex, 0x9204);
        out.focal = get(ex, 0x920a); out.focal35 = get(ex, 0xa405); out.lens = get(ex, 0xa434); out.lensMake = get(ex, 0xa433); out.flash = get(ex, 0x9209);
        out.w = get(ex, 0xa002); out.h = get(ex, 0xa003); out.wb = get(ex, 0xa403); out.metering = get(ex, 0x9207); }
      const gpP = get(ifd0, 0x8825); if (gpP) { const gp = readIFD(T, gpP);
        const la = get(gp, 2), laR = get(gp, 1), lo = get(gp, 4), loR = get(gp, 3), alt = get(gp, 6);
        if (Array.isArray(la) && Array.isArray(lo)) { out.lat = (la[0] + la[1] / 60 + la[2] / 3600) * (laR === 'S' ? -1 : 1); out.lon = (lo[0] + lo[1] / 60 + lo[2] / 3600) * (loR === 'W' ? -1 : 1); if (alt != null) out.alt = alt; } }
      return out;
    } catch (e) { return null; }
  }
  /* 修正：方向=1、像素尺寸、色彩空間 sRGB、移除縮圖 IFD1、可選移除 GPS */
  function patch(src, o) {
    const t8 = new Uint8Array(src); const T = tiff(t8);
    if (T.u16(2) !== 42) return t8;
    const ifd0 = readIFD(T, T.u32(4));
    for (const e of ifd0.entries) if (e.tag === 0x0112 && e.type === 3) T.w16(e.valOff, 1);
    // 移除縮圖（舊縮圖已不符合編輯後內容）
    if (ifd0.nextPtr + 4 <= T.len) T.w32(ifd0.nextPtr, 0);
    const ex = ifd0.entries.find((e) => e.tag === 0x8769);
    if (ex) { const exi = readIFD(T, T.u32(ex.valOff));
      for (const e of exi.entries) {
        if ((e.tag === 0xa002 || e.tag === 0xa003) && o.w) { const v = e.tag === 0xa002 ? o.w : o.h; if (e.type === 3) T.w16(e.valOff, Math.min(65535, v)); else if (e.type === 4) T.w32(e.valOff, v); }
        if (e.tag === 0xa001 && e.type === 3) T.w16(e.valOff, 1);
      } }
    // 0x0100/0x0101（部分相機寫在 IFD0 的寬高）
    for (const e of ifd0.entries) if ((e.tag === 0x0100 || e.tag === 0x0101) && o.w) { const v = e.tag === 0x0100 ? o.w : o.h; if (e.type === 3) T.w16(e.valOff, Math.min(65535, v)); else if (e.type === 4) T.w32(e.valOff, v); }
    if (o.stripGps) {
      const gi = ifd0.entries.findIndex((e) => e.tag === 0x8825);
      if (gi >= 0) {
        const gp = readIFD(T, T.u32(ifd0.entries[gi].valOff));
        for (const e of gp.entries) { if (e.valOff + e.size <= T.len) t8.fill(0, e.valOff, e.valOff + e.size); t8.fill(0, e.entry, e.entry + 12); }
        // 從 IFD0 移除 GPS 指標項目
        const n = ifd0.entries.length, base = ifd0.off + 2;
        t8.copyWithin(base + gi * 12, base + (gi + 1) * 12, base + n * 12 + 4);
        T.w16(ifd0.off, n - 1);
      }
    }
    return t8;
  }
  function patchXmp(x, o) {
    if (!x) return x;
    x = x.replace(/tiff:Orientation="\d"/g, 'tiff:Orientation="1"').replace(/<tiff:Orientation>\d<\/tiff:Orientation>/g, '<tiff:Orientation>1</tiff:Orientation>');
    if (o && o.w) x = x.replace(/exif:PixelXDimension="\d+"/g, `exif:PixelXDimension="${o.w}"`).replace(/exif:PixelYDimension="\d+"/g, `exif:PixelYDimension="${o.h}"`);
    if (o && o.stripGps) x = x.replace(/\s(exif:GPS\w+)="[^"]*"/g, '').replace(/<exif:GPS(\w+)>[\s\S]*?<\/exif:GPS\1>/g, '');
    return x;
  }


  /* 寫入自訂 GPS：重建 IFD0（附加在原 TIFF 區塊尾端，原有偏移量全部保持有效）並新增 GPS IFD */
  function withGps(src, loc) {
    let base = src && src.length >= 8 ? new Uint8Array(src) : null;
    if (!base || new DataView(base.buffer, base.byteOffset).getUint16(2, base[0] === 0x49) !== 42) {
      base = new Uint8Array(8); base.set([0x49, 0x49, 42, 0, 0, 0, 0, 0]);
    }
    const T = tiff(base); const le = T.le; const ifd0Off = T.u32(4);
    const ifd0 = ifd0Off ? readIFD(T, ifd0Off) : { entries: [] };
    // 清除舊 GPS 內容（避免舊座標殘留在檔案中）
    const old = ifd0.entries.find((e) => e.tag === 0x8825);
    if (old) { try { const g = readIFD(T, T.u32(old.valOff)); for (const e of g.entries) { if (e.valOff + e.size <= T.len && e.valOff >= 8) base.fill(0, e.valOff, e.valOff + e.size); base.fill(0, e.entry, e.entry + 12); } } catch (e) {} }
    const raws = ifd0.entries.filter((e) => e.tag !== 0x8825).map((e) => ({ tag: e.tag, raw: base.slice(e.entry, e.entry + 12) }));
    const align = (n) => n + (n & 1);
    const off0 = align(base.length); const n0 = raws.length + 1; const size0 = 2 + n0 * 12 + 4;
    const gpsOff = off0 + size0;
    // GPS 欄位
    const dms = (v) => { const a = Math.abs(v); const d = Math.floor(a); const mf = (a - d) * 60; const m = Math.floor(mf); const sec = Math.round((mf - m) * 60 * 10000); return [[d, 1], [m, 1], [sec, 10000]]; };
    const fields = [
      [0x0000, 1, 4, [2, 3, 0, 0]],
      [0x0001, 2, 2, (loc.lat >= 0 ? 'N' : 'S')],
      [0x0002, 5, 3, dms(loc.lat)],
      [0x0003, 2, 2, (loc.lon >= 0 ? 'E' : 'W')],
      [0x0004, 5, 3, dms(loc.lon)],
    ];
    if (loc.alt != null && isFinite(loc.alt)) { fields.push([0x0005, 1, 1, [loc.alt < 0 ? 1 : 0]]); fields.push([0x0006, 5, 1, [[Math.round(Math.abs(loc.alt) * 100), 100]]]); }
    fields.push([0x0012, 2, 7, 'WGS-84']);
    const gN = fields.length, gSize = 2 + gN * 12 + 4; let dataOff = gpsOff + gSize;
    const chunks = []; const gEntries = [];
    for (const [tag, type, count, val] of fields) {
      const e = new Uint8Array(12); const dv = new DataView(e.buffer);
      dv.setUint16(0, tag, le); dv.setUint16(2, type, le); dv.setUint32(4, count, le);
      let bytes;
      if (type === 2) { bytes = new Uint8Array(count); for (let i = 0; i < val.length && i < count - 1; i++) bytes[i] = val.charCodeAt(i); }
      else if (type === 1) bytes = new Uint8Array(val);
      else { bytes = new Uint8Array(count * 8); const bv = new DataView(bytes.buffer); val.forEach(([a, b], i) => { bv.setUint32(i * 8, a, le); bv.setUint32(i * 8 + 4, b, le); }); }
      if (bytes.length <= 4) e.set(bytes, 8); else { dv.setUint32(8, dataOff, le); chunks.push([dataOff, bytes]); dataOff = align(dataOff + bytes.length); }
      gEntries.push(e);
    }
    const ptr = new Uint8Array(12); { const dv = new DataView(ptr.buffer); dv.setUint16(0, 0x8825, le); dv.setUint16(2, 4, le); dv.setUint32(4, 1, le); dv.setUint32(8, gpsOff, le); }
    raws.push({ tag: 0x8825, raw: ptr }); raws.sort((a, b) => a.tag - b.tag);
    const out = new Uint8Array(dataOff); out.set(base, 0); const dv = new DataView(out.buffer);
    dv.setUint16(off0, n0, le); raws.forEach((r, i) => out.set(r.raw, off0 + 2 + i * 12)); dv.setUint32(off0 + 2 + n0 * 12, 0, le);
    dv.setUint16(gpsOff, gN, le); gEntries.forEach((e, i) => out.set(e, gpsOff + 2 + i * 12)); dv.setUint32(gpsOff + 2 + gN * 12, 0, le);
    for (const [o, d] of chunks) out.set(d, o);
    dv.setUint32(4, off0, le);
    return out;
  }
  const xesc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function xmpCoord(v, pos, neg) { const a = Math.abs(v), d = Math.floor(a); return `${d},${((a - d) * 60).toFixed(6)}${v >= 0 ? pos : neg}`; }
  /* XMP：寫入 GPS 與 IPTC 地點名稱（Lightroom、Google 相簿可讀） */
  function xmpLoc(x, L) {
    const props = [['exif:GPSLatitude', xmpCoord(L.lat, 'N', 'S')], ['exif:GPSLongitude', xmpCoord(L.lon, 'E', 'W')], ['exif:GPSMapDatum', 'WGS-84'], ['exif:GPSVersionID', '2.3.0.0'],
      ['Iptc4xmpCore:Location', L.name], ['photoshop:City', L.city], ['photoshop:State', L.state], ['photoshop:Country', L.country], ['Iptc4xmpCore:CountryCode', L.cc]].filter((p) => p[1]);
    const desc = '<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" xmlns:exif="http://ns.adobe.com/exif/1.0/">' + props.map(([k, v]) => `<${k}>${xesc(v)}</${k}>`).join('') + '</rdf:Description>';
    if (x && x.includes('</rdf:RDF>')) {
      const keys = ['exif:GPS\\w+', 'Iptc4xmpCore:Location', 'Iptc4xmpCore:CountryCode', 'photoshop:City', 'photoshop:State', 'photoshop:Country'];
      for (const k of keys) { x = x.replace(new RegExp('\\s(' + k + ')="[^"]*"', 'g'), '').replace(new RegExp('<(' + k + ')>[\\s\\S]*?</\\1>', 'g'), ''); }
      return x.replace('</rdf:RDF>', desc + '</rdf:RDF>');
    }
    return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' + desc + '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  }


  /* 從零建立 EXIF（RAW 轉檔用）。欄位：make, model, software, date(Date), artist, exposure(秒), fnumber, iso, focal, focal35, lens, lensMake, w, h */
  function buildExif(f) {
    const enc = (str) => { const b = te.encode(String(str)); const o = new Uint8Array(b.length + 1); o.set(b); return o; };
    const rat = (v) => { if (!(v > 0)) return null; if (v < 1) return [1, Math.round(1 / v)]; const d = 10000; return [Math.round(v * d), d]; };
    const pad = (n) => String(n).padStart(2, '0');
    const dt = f.date ? `${f.date.getFullYear()}:${pad(f.date.getMonth() + 1)}:${pad(f.date.getDate())} ${pad(f.date.getHours())}:${pad(f.date.getMinutes())}:${pad(f.date.getSeconds())}` : null;
    const ifd0 = [[0x010f, 'a', f.make], [0x0110, 'a', f.model], [0x0112, 's', 1], [0x0131, 'a', f.software], [0x0132, 'a', dt], [0x013b, 'a', f.artist]].filter((e) => e[2]);
    const exf = [[0x829a, 'r', rat(f.exposure)], [0x829d, 'r', f.fnumber > 0 ? [Math.round(f.fnumber * 10), 10] : null], [0x8827, 's', f.iso ? Math.min(65535, Math.round(f.iso)) : null], [0x9003, 'a', dt], [0x9004, 'a', dt],
      [0x920a, 'r', f.focal > 0 ? [Math.round(f.focal * 10), 10] : null], [0xa001, 's', 1], [0xa002, 'l', f.w], [0xa003, 'l', f.h], [0xa405, 's', f.focal35 ? Math.round(f.focal35) : null], [0xa433, 'a', f.lensMake], [0xa434, 'a', f.lens]].filter((e) => e[2]);
    // 版面：header(8) + IFD0 + ExifIFD + 資料
    const n0 = ifd0.length + 1, n1 = exf.length; const off0 = 8, offE = off0 + 2 + n0 * 12 + 4; let data = offE + 2 + n1 * 12 + 4;
    const chunks = []; const out = [];
    const mk = (list, extra) => { const ents = []; for (const [tag, t, v] of list) { const e = new Uint8Array(12); const dv = new DataView(e.buffer); dv.setUint16(0, tag, true);
      let bytes, type, count;
      if (t === 'a') { bytes = enc(v); type = 2; count = bytes.length; } else if (t === 's') { bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, v, true); type = 3; count = 1; }
      else if (t === 'l') { bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, v, true); type = 4; count = 1; } else { bytes = new Uint8Array(8); const b = new DataView(bytes.buffer); b.setUint32(0, v[0], true); b.setUint32(4, v[1], true); type = 5; count = 1; }
      dv.setUint16(2, type, true); dv.setUint32(4, count, true);
      if (bytes.length <= 4) e.set(bytes, 8); else { dv.setUint32(8, data, true); chunks.push([data, bytes]); data += bytes.length + (bytes.length & 1); }
      ents.push([tag, e]); } if (extra) ents.push(extra); ents.sort((a, b) => a[0] - b[0]); return ents; };
    const ptr = new Uint8Array(12); { const dv = new DataView(ptr.buffer); dv.setUint16(0, 0x8769, true); dv.setUint16(2, 4, true); dv.setUint32(4, 1, true); dv.setUint32(8, offE, true); }
    const e0 = mk(ifd0, [0x8769, ptr]), e1 = mk(exf);
    const buf = new Uint8Array(data); const dv = new DataView(buf.buffer);
    buf.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
    dv.setUint16(off0, e0.length, true); e0.forEach(([, e], i) => buf.set(e, off0 + 2 + i * 12)); dv.setUint32(off0 + 2 + e0.length * 12, 0, true);
    dv.setUint16(offE, e1.length, true); e1.forEach(([, e], i) => buf.set(e, offE + 2 + i * 12)); dv.setUint32(offE + 2 + e1.length * 12, 0, true);
    for (const [o, b] of chunks) buf.set(b, o);
    void out; return buf;
  }

  /* ---- 寫回 ---- */
  function cat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }
  function seg(marker, payload) { const n = payload.length + 2; return cat([new Uint8Array([0xff, marker, n >> 8, n & 255]), payload]); }
  function jpeg(enc, m) {
    const u8 = new Uint8Array(enc); const parts = [u8.subarray(0, 2)];
    if (m.exif && m.exif.length + 8 < 65535) parts.push(seg(0xe1, cat([new Uint8Array(EXIF_HDR), m.exif])));
    if (m.xmp) { const x = te.encode(XMP_NS + m.xmp); if (x.length + 2 < 65535) parts.push(seg(0xe1, x)); }
    if (m.icc) parts.push(m.icc);
    // 略過編碼器自帶的 APP0(JFIF)/APP1，其餘保持原樣
    let o = 2;
    while (o + 4 < u8.length && u8[o] === 0xff && (u8[o + 1] === 0xe0 || u8[o + 1] === 0xe1)) o += 2 + ((u8[o + 2] << 8) | u8[o + 3]);
    parts.push(u8.subarray(o)); return cat(parts);
  }
  let crcT = null;
  function crc32(u8) { if (!crcT) { crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } } let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function chunk(type, data) { const t = te.encode(type); const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, data.length); const crc = new Uint8Array(4); new DataView(crc.buffer).setUint32(0, crc32(cat([t, data]))); return cat([len, t, data, crc]); }
  function png(enc, m) {
    const u8 = new Uint8Array(enc); const ihdrEnd = 8 + 8 + 13 + 4; const parts = [u8.subarray(0, ihdrEnd)];
    if (m.exif) parts.push(chunk('eXIf', m.exif));
    if (m.xmp) parts.push(chunk('iTXt', cat([te.encode('XML:com.adobe.xmp'), new Uint8Array([0, 0, 0, 0, 0]), te.encode(m.xmp)])));
    parts.push(u8.subarray(ihdrEnd)); return cat(parts);
  }
  function webp(enc, m, w, h) {
    const u8 = new Uint8Array(enc); if (!m.exif && !m.xmp) return u8;
    const chunks = []; let o = 12; let hasVP8X = false, alpha = false;
    while (o + 8 <= u8.length) { const type = strAt(u8, o, 4); const len = (u8[o + 4] | (u8[o + 5] << 8) | (u8[o + 6] << 16) | (u8[o + 7] << 24)) >>> 0; const end = o + 8 + len + (len & 1); if (type === 'VP8X') { hasVP8X = true; alpha = !!(u8[o + 8] & 0x10); } else if (type !== 'EXIF' && type !== 'XMP ') { if (type === 'ALPH') alpha = true; chunks.push(u8.subarray(o, end)); } o = end; }
    const rc = (type, data) => { const h8 = new Uint8Array(8); h8.set(te.encode(type)); new DataView(h8.buffer).setUint32(4, data.length, true); return cat(data.length & 1 ? [h8, data, new Uint8Array(1)] : [h8, data]); };
    const x = new Uint8Array(10); x[0] = (alpha ? 0x10 : 0) | (m.exif ? 0x08 : 0) | (m.xmp ? 0x04 : 0);
    const W1 = w - 1, H1 = h - 1; x[4] = W1 & 255; x[5] = (W1 >> 8) & 255; x[6] = (W1 >> 16) & 255; x[7] = H1 & 255; x[8] = (H1 >> 8) & 255; x[9] = (H1 >> 16) & 255;
    const body = [te.encode('WEBP'), rc('VP8X', x), ...chunks];
    if (m.exif) body.push(rc('EXIF', m.exif)); if (m.xmp) body.push(rc('XMP ', te.encode(m.xmp)));
    const b = cat(body); const hd = new Uint8Array(8); hd.set(te.encode('RIFF')); new DataView(hd.buffer).setUint32(4, b.length, true);
    void hasVP8X; return cat([hd, b]);
  }
  /* RAW（TIFF 結構：ARW、NEF、CR2、DNG、ORF、RW2、PEF…）→ 乾淨的 EXIF：
     保留相機原始的拍攝資訊（拍攝時間、曝光補償、測光、閃光燈、白平衡、鏡頭、序號、GPS…），
     去掉 RAW 專用的影像結構欄位與 MakerNote，統一轉成 little-endian。 */
  const IFD0_KEEP = new Set([0x010e, 0x010f, 0x0110, 0x0112, 0x0131, 0x0132, 0x013b, 0x8298]);
  const EXIF_DROP = new Set([0x927c, 0xa005, 0xea1c, 0xa302, 0x9286]);
  function fromRawTiff(src, o = {}) {
    try {
      const t8 = src instanceof Uint8Array ? src : new Uint8Array(src); if (t8.length < 16) return null;
      if (!((t8[0] === 0x49 && t8[1] === 0x49) || (t8[0] === 0x4d && t8[1] === 0x4d))) return null;
      const T = tiff(t8); const magic = T.u16(2); if (![42, 0x4f52, 0x5352, 0x55].includes(magic)) return null;
      const ifd0 = readIFD(T, T.u32(4)); if (!ifd0.entries.length) return null;
      const conv = (e) => { // 取出欄位資料並轉成 little-endian
        if (e.valOff + e.size > T.len || e.size > 4096) return null;
        const out = new Uint8Array(e.size); const dv = new DataView(out.buffer); const sz = TS[e.type] || 1;
        if (sz === 1) { out.set(t8.subarray(e.valOff, e.valOff + e.size)); return out; }
        const unit = e.type === 5 || e.type === 10 ? 4 : e.type === 12 ? 8 : sz; const n = e.size / unit;
        for (let i = 0; i < n; i++) { const p = e.valOff + i * unit;
          if (unit === 2) dv.setUint16(i * 2, T.u16(p), true); else if (unit === 4) dv.setUint32(i * 4, T.u32(p), true); else dv.setFloat64(i * 8, T.dv.getFloat64(p, T.le), true); }
        return out;
      };
      const pick = (ifd, keep) => { const r = []; for (const e of ifd.entries) { if (!keep(e.tag) || !TS[e.type]) continue; const b = conv(e); if (b) r.push({ tag: e.tag, type: e.type, count: e.count, b }); } return r; };
      const L0 = pick(ifd0, (t) => IFD0_KEEP.has(t));
      const exP = ifd0.entries.find((e) => e.tag === 0x8769), gpP = ifd0.entries.find((e) => e.tag === 0x8825);
      const LE = exP ? pick(readIFD(T, T.u32(exP.valOff)), (t) => !EXIF_DROP.has(t)) : [];
      const LG = gpP ? pick(readIFD(T, T.u32(gpP.valOff)), () => true) : [];
      if (!LE.length && !L0.some((e) => e.tag === 0x010f)) return null;
      const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };
      const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
      const set = (L, tag, type, count, b) => { const i = L.findIndex((x) => x.tag === tag); const v = { tag, type, count, b }; if (i >= 0) L[i] = v; else L.push(v); };
      set(L0, 0x0112, 3, 1, u16(1));
      if (o.w && o.h) { set(LE, 0xa002, 4, 1, u32(o.w)); set(LE, 0xa003, 4, 1, u32(o.h)); }
      const asc = (str) => te.encode(str + '\0');
      if (o.lens && !LE.some((x) => x.tag === 0xa434)) { const b = asc(o.lens); set(LE, 0xa434, 2, b.length, b); }
      if (o.lensMake && !LE.some((x) => x.tag === 0xa433)) { const b = asc(o.lensMake); set(LE, 0xa433, 2, b.length, b); }
      if (o.software) { const b = te.encode(o.software + '\0'); set(L0, 0x0131, 2, b.length, b); }
      // 版面
      const ifds = [{ L: L0, ptrs: [] }, { L: LE }, { L: LG }];
      if (LE.length) L0.push({ tag: 0x8769, type: 4, count: 1, b: u32(0), ptr: 1 });
      if (LG.length) L0.push({ tag: 0x8825, type: 4, count: 1, b: u32(0), ptr: 2 });
      ifds.forEach((d) => d.L.sort((a, b) => a.tag - b.tag));
      let off = 8; const offs = [];
      for (const d of ifds) { offs.push(d.L.length ? off : 0); if (d.L.length) off += 2 + d.L.length * 12 + 4; }
      let data = off; const chunks = [];
      for (const d of ifds) for (const e of d.L) if (!e.ptr && e.b.length > 4) { e.at = data; chunks.push(e); data += e.b.length + (e.b.length & 1); }
      const buf = new Uint8Array(data); const dv = new DataView(buf.buffer); buf.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
      ifds.forEach((d, k) => { if (!d.L.length) return; const base = offs[k]; dv.setUint16(base, d.L.length, true);
        d.L.forEach((e, i) => { const p = base + 2 + i * 12; dv.setUint16(p, e.tag, true); dv.setUint16(p + 2, e.type, true); dv.setUint32(p + 4, e.count, true);
          if (e.ptr) dv.setUint32(p + 8, offs[e.ptr], true); else if (e.b.length > 4) dv.setUint32(p + 8, e.at, true); else buf.set(e.b, p + 8); });
        dv.setUint32(base + 2 + d.L.length * 12, 0, true); });
      for (const e of chunks) buf.set(e.b, e.at);
      return buf.length < 60000 ? buf : null;
    } catch (e) { console.warn('fromRawTiff', e); return null; }
  }
  return { extract, summary, patch, patchXmp, withGps, xmpLoc, buildExif, fromRawTiff, jpeg, png, webp };
})();
