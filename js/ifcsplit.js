/* ======================================================================
   Divisione di un file IFC in più file, uno per gruppo di elementi.
   Mantiene la struttura del progetto (progetto, sito, edificio, piani),
   gli elementi del gruppo con geometria, proprietà, materiali, assiemi e
   fori; elimina gli altri elementi e tutto ciò che resta senza riferimenti.
   ====================================================================== */
const IfcSplit = (() => {
  'use strict';
  const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  const tick = () => new Promise(r => setTimeout(r, 0));
  /** GUID in forma confrontabile: 32 caratteri esadecimali minuscoli. */
  function normGuid(g) {
    g = String(g || '').trim();
    if (/^[0-9A-Za-z_$]{22}$/.test(g)) {
      let n = 0n; for (const c of g) { const i = B64.indexOf(c); if (i < 0) return g; n = n * 64n + BigInt(i); }
      return n.toString(16).padStart(32, '0');
    }
    const h = g.replace(/[{}\-]/g, '').toLowerCase();
    return /^[0-9a-f]{32}$/.test(h) ? h : g.toLowerCase();
  }
  const SPATIAL = new Set(['IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCFACILITY', 'IFCFACILITYPART', 'IFCBRIDGE', 'IFCBRIDGEPART', 'IFCGRID']);
  const LAYERS = new Set(['IFCPRESENTATIONLAYERASSIGNMENT', 'IFCPRESENTATIONLAYERWITHSTYLE']);

  // riferimenti #n presenti nel testo (fuori dalle stringhe)
  function refs(text, s, e, out) {
    let inStr = false;
    for (let i = s; i < e; i++) {
      const c = text.charCodeAt(i);
      if (inStr) { if (c === 39) inStr = false; continue; }
      if (c === 39) { inStr = true; continue; }
      if (c === 35) { let j = i + 1, n = 0; while (j < e) { const d = text.charCodeAt(j); if (d < 48 || d > 57) break; n = n * 10 + d - 48; j++; } if (j > i + 1) out.push(n); i = j - 1; }
    }
    return out;
  }
  // argomenti di primo livello come testo grezzo
  function topArgs(text, s, e) {
    const out = []; let depth = 0, inStr = false, st = s;
    for (let i = s; i < e; i++) {
      const c = text.charCodeAt(i);
      if (inStr) { if (c === 39) inStr = false; continue; }
      if (c === 39) inStr = true;
      else if (c === 40) depth++;
      else if (c === 41) depth--;
      else if (c === 44 && depth === 0) { out.push(text.slice(st, i)); st = i + 1; }
    }
    out.push(text.slice(st, e));
    return out;
  }
  const refOf = a => { const m = /^\s*#(\d+)\s*$/.exec(a); return m ? +m[1] : null; };

  /**
   * Prepara l'analisi di un file IFC (si fa una volta, poi si possono creare più sottoinsiemi).
   */
  async function prepare(text, onProgress) {
    const M = new IFC.Model(text);
    await M.index(v => onProgress && onProgress(v * 0.6));
    const ents = M.ents, guidRe = /^\s*'([0-9A-Za-z_$]{22})'/;
    const products = new Map(); // id -> { guid, type }
    const rels = [], styled = [], layers = [];
    let project = null, k = 0, t0 = Date.now();
    for (const [id, e] of ents) {
      const T = e.t;
      if (T === 'IFCPROJECT') project = id;
      else if (T.startsWith('IFCREL')) rels.push(id);
      else if (T === 'IFCSTYLEDITEM') styled.push(id);
      else if (LAYERS.has(T)) layers.push(id);
      else {
        const m = guidRe.exec(text.slice(e.s, Math.min(e.e, e.s + 40)));
        if (m) {
          const a = M.get(id);
          const pl = a[5] && a[5].r ? M.ents.get(a[5].r) : null, sh = a[6] && a[6].r ? M.ents.get(a[6].r) : null;
          if ((pl && pl.t === 'IFCLOCALPLACEMENT') || (sh && sh.t === 'IFCPRODUCTDEFINITIONSHAPE')) products.set(id, { guid: normGuid(m[1]), type: T });
          M.cache.delete(id);
        }
      }
      if (++k % 20000 === 0 && Date.now() - t0 > 60) { onProgress && onProgress(0.6 + 0.4 * k / ents.size); await tick(); t0 = Date.now(); }
    }
    // relazioni utili: fori → elemento, assieme → parti
    const voids = [], aggr = [];
    for (const id of rels) {
      const e = ents.get(id);
      if (e.t === 'IFCRELVOIDSELEMENT') { const a = topArgs(text, e.s, e.e); voids.push([refOf(a[4]), refOf(a[5])]); }
      else if (e.t === 'IFCRELAGGREGATES' || e.t === 'IFCRELNESTS') { const a = topArgs(text, e.s, e.e); aggr.push([refOf(a[4]), refs(a[5], 0, a[5].length, [])]); }
    }
    const header = text.slice(0, text.search(/\bDATA\s*;/));
    onProgress && onProgress(1);
    return { text, M, products, rels, styled, layers, project, voids, aggr, header };
  }

  /**
   * Crea il testo IFC con i soli elementi i cui GUID (normalizzati) sono in `keep`.
   */
  async function subset(P, keep, onProgress) {
    const { text, M, products } = P, ents = M.ents;
    const kept = new Set();
    let matched = 0;
    for (const [id, p] of products) {
      if (SPATIAL.has(p.type)) kept.add(id);
      else if (keep.has(p.guid)) { kept.add(id); matched++; }
    }
    for (const [host, op] of P.voids) if (host != null && op != null && kept.has(host)) kept.add(op);
    for (let changed = true, it = 0; changed && it < 6; it++) {
      changed = false;
      for (const [par, kids] of P.aggr) if (par != null && !kept.has(par) && products.has(par) && !SPATIAL.has(products.get(par).type) && kids.some(c => kept.has(c))) {
        const t = products.get(par).type; if (t === 'IFCELEMENTASSEMBLY' || t.endsWith('ASSEMBLY')) { kept.add(par); changed = true; }
      }
    }
    const dropped = id => products.has(id) && !kept.has(id);
    // relazioni riscritte
    const relText = new Map(), relKeep = [];
    for (const id of P.rels) {
      const e = ents.get(id), args = topArgs(text, e.s, e.e);
      let drop = false, mod = false;
      for (let i = 0; i < args.length && !drop; i++) {
        const a = args[i].trim();
        if (a[0] === '#') { if (dropped(+a.slice(1))) drop = true; }
        else if (a[0] === '(' && a.includes('#')) {
          const items = topArgs(a, 1, a.length - 1).map(x => x.trim()).filter(Boolean);
          const left = items.filter(x => !(x[0] === '#' && dropped(+x.slice(1))));
          if (left.length !== items.length) { if (!left.length) drop = true; else { args[i] = '(' + left.join(',') + ')'; mod = true; } }
        }
      }
      if (drop) continue;
      relKeep.push(id);
      if (mod) relText.set(id, args.join(','));
    }
    // raggiungibilità
    const reach = new Set(), stack = [];
    const push = id => { if (id != null && !reach.has(id) && ents.has(id) && !dropped(id)) { reach.add(id); stack.push(id); } };
    const walk = async () => {
      let n = 0;
      while (stack.length) {
        const id = stack.pop(), rt = relText.get(id), e = ents.get(id), out = [];
        if (rt) refs(rt, 0, rt.length, out); else refs(text, e.s, e.e, out);
        for (const r of out) push(r);
        if (++n % 50000 === 0) await tick();
      }
    };
    push(P.project); kept.forEach(push); relKeep.forEach(push);
    await walk(); onProgress && onProgress(0.6);
    for (const id of P.styled) { const e = ents.get(id); const a = topArgs(text, e.s, e.e); const it = refOf(a[0]); if (it == null || reach.has(it)) push(id); }
    await walk();
    const layerText = new Map();
    for (const id of P.layers) {
      const e = ents.get(id), args = topArgs(text, e.s, e.e), a = (args[2] || '').trim();
      if (a[0] !== '(') continue;
      const left = topArgs(a, 1, a.length - 1).map(x => x.trim()).filter(x => x[0] === '#' && reach.has(+x.slice(1)));
      if (!left.length) continue;
      args[2] = '(' + left.join(',') + ')'; layerText.set(id, args.join(',')); push(id);
    }
    await walk(); onProgress && onProgress(0.8);
    // scrittura
    const parts = [P.header.trimEnd(), '\nDATA;\n']; let buf = [], n = 0;
    for (const [id, e] of ents) {
      if (!reach.has(id)) continue;
      const body = relText.get(id) || layerText.get(id) || text.slice(e.s, e.e);
      buf.push('#' + id + '=' + e.t + '(' + body + ');\n');
      if (buf.length >= 5000) { parts.push(textToBytes(buf.join(''))); buf = []; if (++n % 20 === 0) await tick(); }
    }
    parts.push(textToBytes(buf.join('') + 'ENDSEC;\nEND-ISO-10303-21;\n'));
    parts[0] = textToBytes(parts[0]); parts[1] = textToBytes(parts[1]);
    onProgress && onProgress(1);
    return { blob: new Blob(parts, { type: 'application/x-step' }), matched, entities: reach.size };
  }

  /* ---- conversione byte <-> testo senza perdite (1 carattere = 1 byte) ---- */
  function bytesToText(u8) {
    let out = ''; const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return out;
  }
  function textToBytes(str) {
    const u8 = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i) & 255;
    return u8;
  }
  /* ---- zip senza compressione (per scaricare più file insieme) ---- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  async function zip(files) {
    const enc = new TextEncoder(), out = [], central = []; let off = 0;
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name);
      let c = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 255] ^ (c >>> 8); c = (c ^ 0xFFFFFFFF) >>> 0;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, c, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      out.push(h.buffer, name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint32(16, c, true);
      cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true); cd.setUint32(42, off, true);
      central.push(cd.buffer, name);
      off += 30 + name.length + data.length;
      await tick();
    }
    const cdSize = central.reduce((s, b) => s + (b.byteLength || b.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob([...out, ...central, end.buffer], { type: 'application/zip' });
  }
  return { normGuid, prepare, subset, zip, bytesToText, textToBytes };
})();
if (typeof module !== 'undefined') module.exports = IfcSplit;
