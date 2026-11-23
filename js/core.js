
/* ======================================================================
   Computo acciaio da IFC: nucleo di calcolo (nessuna dipendenza esterna)
   ====================================================================== */
const IFC = (() => {
  'use strict';
  const PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
    DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12 };
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------------------------------------------------------------- parser STEP */
  function decodeStr(s) {
    if (s.indexOf('\\') < 0) return s;
    s = s.replace(/\\X2\\([0-9A-F]+?)\\X0\\/gi, (m, h) => {
      let o = ''; for (let i = 0; i + 3 < h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o;
    });
    s = s.replace(/\\X\\([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
    s = s.replace(/\\S\\(.)/g, (m, c) => String.fromCharCode(c.charCodeAt(0) + 128));
    s = s.replace(/\\P.\\/g, '');
    return s.replace(/\\\\/g, '\\');
  }

  class Model {
    constructor(text) { this.text = text; this.ents = new Map(); this.byType = new Map(); this.cache = new Map(); this.schema = ''; }
    async index(onProgress) {
      const text = this.text, len = text.length;
      const sm = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(text.slice(0, 20000));
      this.schema = sm ? sm[1].toUpperCase() : '';
      const start = text.search(/\bDATA\s*;/);
      if (start < 0) throw new Error('il file non sembra un IFC in formato testo STEP (manca la sezione DATA)');
      const re = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/g;
      re.lastIndex = start;
      let m, t0 = Date.now(), count = 0;
      while ((m = re.exec(text))) {
        const id = +m[1], type = m[2].toUpperCase();
        let j = re.lastIndex, depth = 1, inStr = false;
        for (; j < len; j++) {
          const c = text.charCodeAt(j);
          if (inStr) { if (c === 39) inStr = false; continue; }
          if (c === 39) inStr = true; else if (c === 40) depth++; else if (c === 41) { if (--depth === 0) break; }
        }
        this.ents.set(id, { t: type, s: re.lastIndex, e: j });
        let arr = this.byType.get(type); if (!arr) this.byType.set(type, arr = []); arr.push(id);
        re.lastIndex = j + 1;
        if (++count % 4000 === 0 && Date.now() - t0 > 50) { onProgress && onProgress(j / len); await tick(); t0 = Date.now(); }
      }
      onProgress && onProgress(1);
      return count;
    }
    ids(type) { return this.byType.get(type) || []; }
    get(id) {
      if (id && typeof id === 'object') id = id.r;
      if (typeof id !== 'number') return null;
      let a = this.cache.get(id); if (a) return a;
      const e = this.ents.get(id); if (!e) return null;
      a = parseArgs(this.text, e.s, e.e); a.T = e.t; a.id = id;
      this.cache.set(id, a); return a;
    }
  }

  function parseArgs(s, p0, end) {
    let p = p0;
    const ws = () => { while (p < end) { const c = s.charCodeAt(p); if (c === 32 || c === 10 || c === 13 || c === 9) p++; else break; } };
    const val = () => {
      ws(); const c = s[p];
      if (c === '$' || c === '*') { p++; return null; }
      if (c === '#') { p++; let q = p; while (q < end && s.charCodeAt(q) >= 48 && s.charCodeAt(q) <= 57) q++; const r = +s.slice(p, q); p = q; return { r }; }
      if (c === "'") {
        p++; let out = '';
        while (p < end) { const k = s.indexOf("'", p); if (k < 0 || k >= end) { out += s.slice(p, end); p = end; break; }
          out += s.slice(p, k); if (s[k + 1] === "'") { out += "'"; p = k + 2; } else { p = k + 1; break; } }
        return decodeStr(out);
      }
      if (c === '"') { const k = s.indexOf('"', p + 1); const v = s.slice(p + 1, k); p = k + 1; return v; }
      if (c === '.') { const k = s.indexOf('.', p + 1); const v = s.slice(p + 1, k); p = k + 1; return { e: v.toUpperCase() }; }
      if (c === '(') { p++; return list(); }
      if (c === '-' || c === '+' || (c >= '0' && c <= '9')) {
        let q = p + 1; while (q < end && /[0-9.eE+\-]/.test(s[q])) q++; const v = parseFloat(s.slice(p, q)); p = q; return v;
      }
      if (/[A-Za-z_]/.test(c)) {
        let q = p; while (q < end && /[A-Za-z0-9_]/.test(s[q])) q++; const t = s.slice(p, q).toUpperCase(); p = q; ws();
        if (s[p] === '(') { p++; const inner = list(); return { t, v: inner.length === 1 ? inner[0] : inner }; }
        return { t };
      }
      p++; return null;
    };
    const list = () => {
      const arr = []; ws();
      if (s[p] === ')') { p++; return arr; }
      while (p < end) { arr.push(val()); ws(); if (s[p] === ',') { p++; continue; } if (s[p] === ')') { p++; break; } p++; }
      return arr;
    };
    const out = []; ws();
    while (p < end) { out.push(val()); ws(); if (s[p] === ',') { p++; continue; } break; }
    return out;
  }

  const tv = x => (x && typeof x === 'object' && 't' in x && 'v' in x) ? x.v : x;
  const num = x => { const v = tv(x); return typeof v === 'number' && isFinite(v) ? v : null; };
  const arr = x => Array.isArray(x) ? x : [];
  const str = x => typeof x === 'string' ? x : '';
  const en = x => (x && typeof x === 'object' && 'e' in x) ? x.e : null;

  /* ---------------------------------------------------------------- unità */
  function unitFactor(M, ref, depth = 0) {
    const u = M.get(ref); if (!u || depth > 5) return null;
    if (u.T === 'IFCSIUNIT') {
      const type = en(u[1]), pre = en(u[2]) ? (PREFIX[en(u[2])] || 1) : 1, name = en(u[3]);
      let f = pre;
      if (name === 'GRAM') f = pre / 1000;
      if (name === 'SQUARE_METRE') f = pre * pre;
      if (name === 'CUBIC_METRE') f = pre * pre * pre;
      return { type, f, label: (en(u[2]) ? en(u[2]).toLowerCase() : '') + (name || '').toLowerCase() };
    }
    if (u.T === 'IFCCONVERSIONBASEDUNIT' || u.T === 'IFCCONVERSIONBASEDUNITWITHOFFSET') {
      const type = en(u[1]); const mwu = M.get(u[3]);
      const v = mwu ? (num(mwu[0]) ?? 1) : 1; const base = mwu ? unitFactor(M, mwu[1], depth + 1) : null;
      return { type, f: v * (base ? base.f : 1), label: str(u[2]).toLowerCase() };
    }
    return null;
  }
  function projectUnits(M) {
    const U = { LENGTHUNIT: 1, MASSUNIT: 1, VOLUMEUNIT: 1, AREAUNIT: 1, labels: {} };
    let ua = null;
    const pr = M.ids('IFCPROJECT')[0];
    if (pr) { const p = M.get(pr); if (p && p[8]) ua = M.get(p[8]); }
    if (!ua) { const id = M.ids('IFCUNITASSIGNMENT')[0]; if (id) ua = M.get(id); }
    if (ua) for (const r of arr(ua[0])) { const uf = unitFactor(M, r); if (uf && uf.type in U) { U[uf.type] = uf.f; U.labels[uf.type] = uf.label; } }
    return U;
  }

  /* ---------------------------------------------------------------- matrici 3x4 (righe) */
  const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  function mul(a, b) {
    const r = new Array(12);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
      r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
    }
    return r;
  }
  const xf = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
  const xd = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z];
  const norm3 = v => Math.hypot(v[0], v[1], v[2]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function vec(M, ref, def) {
    const d = M.get(ref); if (!d) return def.slice();
    const c = arr(d[0]).filter(x => typeof x === 'number'); const v = [c[0] || 0, c[1] || 0, c[2] || 0];
    const n = norm3(v); return n > 1e-12 ? v.map(x => x / n) : def.slice();
  }
  function pt3(M, ref) {
    const p = M.get(ref); if (!p) return [0, 0, 0];
    const c = arr(p[0]).filter(x => typeof x === 'number'); return [c[0] || 0, c[1] || 0, c[2] || 0];
  }
  function frame(x, z, loc, s = 1) {
    let n = norm3(z) || 1; z = z.map(v => v / n);
    let d = dot(x, z); x = [x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]];
    if (norm3(x) < 1e-9) { x = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; d = dot(x, z); x = [x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]]; }
    n = norm3(x); x = x.map(v => v / n); const y = cross(z, x);
    return [x[0] * s, y[0] * s, z[0] * s, loc[0], x[1] * s, y[1] * s, z[1] * s, loc[1], x[2] * s, y[2] * s, z[2] * s, loc[2]];
  }
  function axisMatrix(M, ref) {
    const a = M.get(ref); if (!a) return I4();
    if (a.T === 'IFCAXIS2PLACEMENT3D') return frame(vec(M, a[2], [1, 0, 0]), vec(M, a[1], [0, 0, 1]), pt3(M, a[0]));
    if (a.T === 'IFCAXIS2PLACEMENT2D') return frame(vec(M, a[1], [1, 0, 0]), [0, 0, 1], pt3(M, a[0]));
    return I4();
  }
  function placementMatrix(M, ref, cache, depth = 0) {
    if (!ref || depth > 60) return I4();
    const key = ref.r ?? ref; if (cache.has(key)) return cache.get(key);
    const p = M.get(ref); let T = I4();
    if (p && p.T === 'IFCLOCALPLACEMENT') T = mul(placementMatrix(M, p[0], cache, depth + 1), axisMatrix(M, p[1]));
    cache.set(key, T); return T;
  }
  function ctoMatrix(M, ref) {
    const c = M.get(ref); if (!c) return I4();
    if (c.T.startsWith('IFCCARTESIANTRANSFORMATIONOPERATOR3D')) return frame(vec(M, c[0], [1, 0, 0]), vec(M, c[4], [0, 0, 1]), pt3(M, c[2]), num(c[3]) || 1);
    if (c.T.startsWith('IFCCARTESIANTRANSFORMATIONOPERATOR2D')) return frame(vec(M, c[0], [1, 0, 0]), [0, 0, 1], pt3(M, c[2]), num(c[3]) || 1);
    return I4();
  }

  /* ---------------------------------------------------------------- profili */
  function curvePoints(M, ref, depth = 0) {
    const c = M.get(ref); if (!c || depth > 6) return null;
    if (c.T === 'IFCPOLYLINE') return arr(c[0]).map(r => { const p = M.get(r); return p ? arr(p[0]) : null; }).filter(Boolean);
    if (c.T === 'IFCINDEXEDPOLYCURVE') {
      const pl = M.get(c[0]); if (!pl) return null; const co = arr(pl[0]);
      const segs = c[1];
      if (Array.isArray(segs) && segs.length) {
        const pts = [];
        for (const sg of segs) { const idx = tv(sg); if (Array.isArray(idx)) for (const i of idx) if (co[i - 1]) pts.push(co[i - 1]); }
        return pts;
      }
      return co;
    }
    if (c.T === 'IFCCOMPOSITECURVE') {
      const pts = [];
      for (const sr of arr(c[0])) { const sg = M.get(sr); if (!sg) continue; const sub = curvePoints(M, sg[2], depth + 1);
        if (sub) pts.push(...(en(sg[1]) === 'F' ? sub.slice().reverse() : sub)); }
      return pts;
    }
    return null;
  }
  function polyArea(pts) {
    if (!pts || pts.length < 3) return null;
    let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(a) / 2;
  }
  function curveArea(M, ref) {
    const c = M.get(ref); if (!c) return null;
    if (c.T === 'IFCCIRCLE') { const r = num(c[1]); return r ? Math.PI * r * r : null; }
    if (c.T === 'IFCELLIPSE') { const a = num(c[1]), b = num(c[2]); return a && b ? Math.PI * a * b : null; }
    return polyArea(curvePoints(M, ref));
  }
  function profileInfo(M, ref, depth = 0) {
    const p = M.get(ref); if (!p || depth > 4) return null;
    const name = str(p[1]).trim(); const n = i => num(p[i]);
    let area = null, cls = 'OTHER', dims = {};
    switch (p.T) {
      case 'IFCISHAPEPROFILEDEF': { const b = n(3), h = n(4), tw = n(5), tf = n(6), r = n(7) || 0;
        if (b && h && tw && tf) area = 2 * b * tf + (h - 2 * tf) * tw + (4 - Math.PI) * r * r; cls = 'I'; dims = { h, b, tw, tf }; break; }
      case 'IFCASYMMETRICISHAPEPROFILEDEF': { const bb = n(3), h = n(4), tw = n(5), tfb = n(6), bt = n(8), tft = n(9);
        if (bb && h && tw && tfb && bt && tft) area = bb * tfb + bt * tft + (h - tfb - tft) * tw; cls = 'IASYM'; dims = { h, b: Math.max(bb || 0, bt || 0) }; break; }
      case 'IFCUSHAPEPROFILEDEF': case 'IFCZSHAPEPROFILEDEF': { const h = n(3), b = n(4), tw = n(5), tf = n(6);
        if (h && b && tw && tf) area = 2 * b * tf + (h - 2 * tf) * tw; cls = p.T === 'IFCUSHAPEPROFILEDEF' ? 'U' : 'Z'; dims = { h, b, tw }; break; }
      case 'IFCLSHAPEPROFILEDEF': { const d = n(3), w = n(4) || n(3), t = n(5); if (d && w && t) area = t * (d + w - t); cls = 'L'; dims = { h: d, b: w, t }; break; }
      case 'IFCTSHAPEPROFILEDEF': { const h = n(3), b = n(4), tw = n(5), tf = n(6); if (h && b && tw && tf) area = b * tf + (h - tf) * tw; cls = 'T'; dims = { h, b }; break; }
      case 'IFCCSHAPEPROFILEDEF': { const h = n(3), b = n(4), t = n(5), g = n(6) || 0; if (h && b && t) area = t * (h + 2 * b + 2 * g - 4 * t); cls = 'C'; dims = { h, b, t }; break; }
      case 'IFCRECTANGLEPROFILEDEF': case 'IFCROUNDEDRECTANGLEPROFILEDEF': { const x = n(3), y = n(4); if (x && y) area = x * y; cls = 'RECT'; dims = { x, y }; break; }
      case 'IFCRECTANGLEHOLLOWPROFILEDEF': { const x = n(3), y = n(4), t = n(5); if (x && y && t) area = 2 * t * (x + y - 2 * t); cls = 'RHS'; dims = { x, y, t }; break; }
      case 'IFCCIRCLEPROFILEDEF': { const r = n(3); if (r) area = Math.PI * r * r; cls = 'ROUND'; dims = { d: r ? 2 * r : null }; break; }
      case 'IFCCIRCLEHOLLOWPROFILEDEF': { const r = n(3), t = n(4); if (r && t) area = Math.PI * (r * r - (r - t) * (r - t)); cls = 'CHS'; dims = { d: r ? 2 * r : null, t }; break; }
      case 'IFCELLIPSEPROFILEDEF': { const a = n(3), b = n(4); if (a && b) area = Math.PI * a * b; break; }
      case 'IFCARBITRARYCLOSEDPROFILEDEF': case 'IFCARBITRARYPROFILEDEFWITHVOIDS': {
        area = curveArea(M, p[2]);
        if (area != null && p.T === 'IFCARBITRARYPROFILEDEFWITHVOIDS') for (const ic of arr(p[3])) { const a2 = curveArea(M, ic); if (a2) area -= a2; }
        cls = 'ARB'; break; }
      case 'IFCDERIVEDPROFILEDEF': { const par = profileInfo(M, p[2], depth + 1); if (par) return { ...par, name: name || par.name }; break; }
      case 'IFCCOMPOSITEPROFILEDEF': { let tot = 0, ok = true;
        for (const r of arr(p[2])) { const sub = profileInfo(M, r, depth + 1); if (sub && sub.area) tot += sub.area; else ok = false; }
        area = ok ? tot : null; cls = 'COMPOSITE'; break; }
    }
    return { area, name, cls, dims, type: p.T };
  }
  function circ(r, n = 12, cx = 0, cy = 0) { const o = []; for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n; o.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return o; }
  function profileOutlines(M, ref, cache, depth = 0) {
    const key = ref && (ref.r ?? ref);
    if (cache && cache.has(key)) return cache.get(key);
    const p = M.get(ref); if (!p || depth > 4) return [];
    const n = i => num(p[i]); let P = null, out = null;
    switch (p.T) {
      case 'IFCISHAPEPROFILEDEF': { const b = n(3), h = n(4), tw = n(5), tf = n(6);
        if (b && h && tw && tf) P = [[-b/2,-h/2],[b/2,-h/2],[b/2,-h/2+tf],[tw/2,-h/2+tf],[tw/2,h/2-tf],[b/2,h/2-tf],[b/2,h/2],[-b/2,h/2],[-b/2,h/2-tf],[-tw/2,h/2-tf],[-tw/2,-h/2+tf],[-b/2,-h/2+tf]]; break; }
      case 'IFCASYMMETRICISHAPEPROFILEDEF': { const bb = n(3), h = n(4), tw = n(5), tfb = n(6), bt = n(8), tft = n(9);
        if (bb && h && tw && tfb && bt && tft) P = [[-bb/2,-h/2],[bb/2,-h/2],[bb/2,-h/2+tfb],[tw/2,-h/2+tfb],[tw/2,h/2-tft],[bt/2,h/2-tft],[bt/2,h/2],[-bt/2,h/2],[-bt/2,h/2-tft],[-tw/2,h/2-tft],[-tw/2,-h/2+tfb],[-bb/2,-h/2+tfb]]; break; }
      case 'IFCUSHAPEPROFILEDEF': { const h = n(3), b = n(4), tw = n(5), tf = n(6);
        if (h && b && tw && tf) P = [[-b/2,-h/2],[b/2,-h/2],[b/2,-h/2+tf],[-b/2+tw,-h/2+tf],[-b/2+tw,h/2-tf],[b/2,h/2-tf],[b/2,h/2],[-b/2,h/2]]; break; }
      case 'IFCLSHAPEPROFILEDEF': { const d = n(3), w = n(4) || n(3), t = n(5);
        if (d && w && t) P = [[-w/2,-d/2],[w/2,-d/2],[w/2,-d/2+t],[-w/2+t,-d/2+t],[-w/2+t,d/2],[-w/2,d/2]]; break; }
      case 'IFCTSHAPEPROFILEDEF': { const h = n(3), b = n(4), tw = n(5), tf = n(6);
        if (h && b && tw && tf) P = [[-b/2,h/2],[-b/2,h/2-tf],[-tw/2,h/2-tf],[-tw/2,-h/2],[tw/2,-h/2],[tw/2,h/2-tf],[b/2,h/2-tf],[b/2,h/2]]; break; }
      case 'IFCZSHAPEPROFILEDEF': case 'IFCCSHAPEPROFILEDEF': { const h = n(3), b = n(4); if (h && b) { const w = p.T === 'IFCZSHAPEPROFILEDEF' ? 2 * b : b; P = [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]]; } break; }
      case 'IFCRECTANGLEPROFILEDEF': case 'IFCROUNDEDRECTANGLEPROFILEDEF': case 'IFCRECTANGLEHOLLOWPROFILEDEF': { const x = n(3), y = n(4); if (x && y) P = [[-x/2,-y/2],[x/2,-y/2],[x/2,y/2],[-x/2,y/2]]; break; }
      case 'IFCCIRCLEPROFILEDEF': case 'IFCCIRCLEHOLLOWPROFILEDEF': { const r = n(3); if (r) P = circ(r); break; }
      case 'IFCELLIPSEPROFILEDEF': { const a = n(3), b = n(4); if (a && b) { P = []; for (let i = 0; i < 16; i++) { const t = 2 * Math.PI * i / 16; P.push([a * Math.cos(t), b * Math.sin(t)]); } } break; }
      case 'IFCARBITRARYCLOSEDPROFILEDEF': case 'IFCARBITRARYPROFILEDEFWITHVOIDS': {
        const c = M.get(p[2]);
        if (c && c.T === 'IFCCIRCLE' && num(c[1])) { const A = axisMatrix(M, c[0]); out = [circ(num(c[1]), 16, A[3], A[7])]; }
        else {
          const pts = curvePoints(M, p[2]);
          let Q = (pts || []).filter(q => Array.isArray(q) && q.length >= 2).map(q => [q[0], q[1]]);
          if (Q.length > 3 && Math.abs(Q[0][0] - Q[Q.length - 1][0]) < 1e-9 && Math.abs(Q[0][1] - Q[Q.length - 1][1]) < 1e-9) Q.pop();
          out = Q.length >= 3 ? [Q] : [];
        }
        break;
      }
      case 'IFCDERIVEDPROFILEDEF': out = profileOutlines(M, p[2], cache, depth + 1); break;
      case 'IFCCOMPOSITEPROFILEDEF': out = []; for (const r of arr(p[2])) out.push(...profileOutlines(M, r, cache, depth + 1)); break;
    }
    if (!out) {
      if (!P) out = [];
      else {
        if (p[2]) { const A = axisMatrix(M, p[2]); P = P.map(([x, y]) => [A[0] * x + A[1] * y + A[3], A[4] * x + A[5] * y + A[7]]); }
        out = [P];
      }
    }
    if (cache) cache.set(key, out);
    return out;
  }

  /* ---------------------------------------------------------------- triangolazione */
  function earcut2(P) {
    const n = P.length;
    if (n === 3) return [0, 1, 2];
    let a = 0; for (let i = 0; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
    let idx = [...Array(n).keys()]; if (a < 0) idx.reverse();
    const out = [];
    if (n > 200) { for (let i = 1; i + 1 < n; i++) out.push(idx[0], idx[i], idx[i + 1]); return out; }
    const crossz = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    let guard = 0;
    while (idx.length > 3 && guard++ < n * 3) {
      let found = false;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        const A = P[ia], B = P[ib], C = P[ic];
        if (crossz(A, B, C) <= 1e-12) continue;
        let inside = false;
        for (const k of idx) {
          if (k === ia || k === ib || k === ic) continue;
          const Q = P[k];
          if (crossz(A, B, Q) >= 0 && crossz(B, C, Q) >= 0 && crossz(C, A, Q) >= 0) { inside = true; break; }
        }
        if (inside) continue;
        out.push(ia, ib, ic); idx.splice(i, 1); found = true; break;
      }
      if (!found) break;
    }
    for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1]);
    return out;
  }
  // aggiunge i triangoli di un poligono 3D (array di punti) al buffer
  function pushPoly(buf, pts) {
    const n = pts.length; if (n < 3) return;
    if (n <= 4) { for (let i = 1; i + 1 < n; i++) buf.push(...pts[0], ...pts[i], ...pts[i + 1]); return; }
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n];
      nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const P2 = az >= ax && az >= ay ? pts.map(p => [p[0], p[1]]) : ax >= ay ? pts.map(p => [p[1], p[2]]) : pts.map(p => [p[2], p[0]]);
    const t = earcut2(P2);
    for (let i = 0; i < t.length; i++) buf.push(...pts[t[i]]);
  }

  /* ---------------------------------------------------------------- solidi */
  function meshItem(M, item) {
    // ritorna { vol, ext[3] ordinate decrescenti, polys: [[pt3...]] } in coordinate locali
    let vol = 0; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const polys = [];
    const acc = tri => { const [a, b, c] = tri;
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      for (const p of tri) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } };
    const P3 = p => [p[0] || 0, p[1] || 0, p[2] || 0];
    const T = item.T;
    if (T === 'IFCFACETEDBREP' || T === 'IFCFACETEDBREPWITHVOIDS') {
      const shells = [item[0], ...(T === 'IFCFACETEDBREPWITHVOIDS' ? arr(item[1]) : [])];
      for (const sref of shells) {
        const sh = M.get(sref); if (!sh) continue;
        for (const fr of arr(sh[0])) {
          const f = M.get(fr); if (!f) continue; const bounds = arr(f[0]);
          for (const br of bounds) {
            const b = M.get(br); if (!b) continue; const loop = M.get(b[0]); if (!loop || loop.T !== 'IFCPOLYLOOP') continue;
            let pts = arr(loop[0]).map(r => { const pe = M.get(r); return pe ? P3(arr(pe[0])) : null; }).filter(Boolean);
            if (en(b[1]) === 'F') pts.reverse();
            for (let i = 1; i + 1 < pts.length; i++) acc([pts[0], pts[i], pts[i + 1]]);
            if (pts.length >= 3 && (b.T === 'IFCFACEOUTERBOUND' || bounds.length === 1)) polys.push(pts);
          }
        }
      }
    } else if (T === 'IFCTRIANGULATEDFACESET' || T === 'IFCPOLYGONALFACESET') {
      const cl = M.get(item[0]); if (!cl) return null; const C = arr(cl[0]);
      const pn = T === 'IFCTRIANGULATEDFACESET' ? item[4] : item[3];
      const PN = Array.isArray(pn) && pn.length ? pn : null;
      const P = i => { const j = PN ? PN[i - 1] : i; const c = C[j - 1]; return c ? P3(c) : null; };
      if (T === 'IFCTRIANGULATEDFACESET') {
        for (const t of arr(item[3])) { const a = P(t[0]), b = P(t[1]), c = P(t[2]); if (a && b && c) { acc([a, b, c]); polys.push([a, b, c]); } }
      } else {
        for (const fr of arr(item[2])) { const f = M.get(fr); if (!f) continue; const pts = arr(f[0]).map(P).filter(Boolean);
          for (let i = 1; i + 1 < pts.length; i++) acc([pts[0], pts[i], pts[i + 1]]); if (pts.length >= 3) polys.push(pts); }
      }
    } else return null;
    if (!isFinite(mn[0])) return null;
    const ext = [0, 1, 2].map(k => mx[k] - mn[k]).sort((a, b) => b - a);
    return { vol: Math.abs(vol), ext, polys };
  }
  const CURVED = new Set(['IFCREVOLVEDAREASOLID', 'IFCREVOLVEDAREASOLIDTAPERED', 'IFCSURFACECURVESWEPTAREASOLID',
    'IFCFIXEDREFERENCESWEPTAREASOLID', 'IFCDIRECTRIXCURVESWEPTAREASOLID']);
  function collectItems(M, ref, mat, out, depth = 0) {
    const it = M.get(ref); if (!it || depth > 8) return;
    const T = it.T;
    if (T === 'IFCEXTRUDEDAREASOLID' || T === 'IFCEXTRUDEDAREASOLIDTAPERED')
      out.push({ k: 'ex', prof: it[0], depth: num(it[3]) || 0, mat: it[1] ? mul(mat, axisMatrix(M, it[1])) : mat, dir: vec(M, it[2], [0, 0, 1]), tapered: T.endsWith('TAPERED') });
    else if (T === 'IFCMAPPEDITEM') {
      const rm = M.get(it[0]); const rep = rm ? M.get(rm[1]) : null;
      if (rep) { const m2 = mul(mul(mat, ctoMatrix(M, it[1])), axisMatrix(M, rm[0])); for (const r of arr(rep[3])) collectItems(M, r, m2, out, depth + 1); }
    } else if (T === 'IFCBOOLEANCLIPPINGRESULT' || T === 'IFCBOOLEANRESULT') {
      collectItems(M, it[1], mat, out, depth + 1); if (en(it[0]) === 'UNION') collectItems(M, it[2], mat, out, depth + 1);
    } else if (T === 'IFCFACETEDBREP' || T === 'IFCFACETEDBREPWITHVOIDS' || T === 'IFCTRIANGULATEDFACESET' || T === 'IFCPOLYGONALFACESET')
      out.push({ k: 'mesh', item: it, mat });
    else if (T === 'IFCSWEPTDISKSOLID' || T === 'IFCSWEPTDISKSOLIDPOLYGONAL') out.push({ k: 'disk', item: it, mat });
    else if (CURVED.has(T)) out.push({ k: 'curved', item: it, mat });
    else if (T === 'IFCCSGSOLID') collectItems(M, it[0], mat, out, depth + 1);
  }
  function elementGeometry(M, el, pcache, ocache, origin, lf) {
    const G = { prof: null, vol: 0, ok: false, maxDepth: 0, meshExt: null, tris: [], axis: null, curved: false, tapered: false, len: 0 };
    const pds = M.get(el[6]); if (!pds) return G;
    const reps = arr(pds[2]).map(r => M.get(r)).filter(Boolean);
    let body = reps.filter(r => /^body$/i.test(str(r[1])));
    if (!body.length) body = reps.filter(r => !/^(axis|box|footprint|annotation|surface|clearance|center ?line|profile)$/i.test(str(r[1])));
    const base = placementMatrix(M, el[5], pcache);
    const items = []; for (const r of body) for (const i of arr(r[3])) collectItems(M, i, base, items);
    G.ok = items.length > 0;
    const out = G.tris; // coordinate mondo in metri, relative all'origine
    const W = (p) => [p[0] * lf - origin[0], p[1] * lf - origin[1], p[2] * lf - origin[2]];
    let best = 0;
    for (const it of items) {
      const A = it.mat;
      if (it.k === 'ex') {
        const pi = profileInfo(M, it.prof); if (!G.prof && pi) G.prof = pi;
        const d = it.depth; G.maxDepth = Math.max(G.maxDepth, d);
        if (pi && pi.area != null && d) G.vol += pi.area * d; else G.ok = false;
        if (it.tapered) G.tapered = true;
        if (d) for (const P of profileOutlines(M, it.prof, ocache)) {
          if (P.length < 3) continue;
          const dv = it.dir, n = P.length;
          const bot = P.map(([x, y]) => W(xf(A, x, y, 0)));
          const top = P.map(([x, y]) => W(xf(A, x + dv[0] * d, y + dv[1] * d, dv[2] * d)));
          pushPoly(out, bot); pushPoly(out, top.slice().reverse());
          for (let i = 0; i < n; i++) { const j = (i + 1) % n; out.push(...bot[i], ...bot[j], ...top[j], ...bot[i], ...top[j], ...top[i]); }
        }
        const wd = xd(A, it.dir[0], it.dir[1], it.dir[2]); const nw = norm3(wd);
        if (nw > 0 && nw * d > best) { best = nw * d; G.axis = wd.map(v => v / nw); }
      } else if (it.k === 'mesh') {
        const mv = meshItem(M, it.item);
        if (mv) {
          G.vol += mv.vol; if (!G.meshExt || mv.ext[0] > G.meshExt[0]) G.meshExt = mv.ext;
          for (const poly of mv.polys) pushPoly(out, poly.map(p => W(xf(A, p[0], p[1], p[2]))));
        } else G.ok = false;
      } else if (it.k === 'disk') {
        const item = it.item, dc = M.get(item[0]);
        const pts = curvePoints(M, item[0]); const r = num(item[1]) || 0, ri = num(item[2]) || 0;
        if (dc && dc.T !== 'IFCPOLYLINE' && dc.T !== 'IFCINDEXEDPOLYCURVE') G.curved = true;
        if (pts && pts.length >= 2 && r) {
          const P = pts.map(q => [q[0] || 0, q[1] || 0, q[2] || 0]);
          let L = 0; const segs = [];
          for (let i = 1; i < P.length; i++) { const s = [P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]]; const l = norm3(s); L += l; if (l > 0) segs.push(s.map(v => v / l)); }
          for (let i = 1; i < segs.length; i++) if (norm3(cross(segs[i - 1], segs[i])) > 0.02) G.curved = true;
          G.vol += Math.PI * (r * r - ri * ri) * L; G.maxDepth = Math.max(G.maxDepth, L);
          const Pw = P.map(p => W(xf(A, p[0], p[1], p[2]))); const rw = r * Math.hypot(A[0], A[4], A[8]) * lf;
          for (let i = 1; i < Pw.length; i++) {
            const a = Pw[i - 1], b = Pw[i]; let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = norm3(u); if (l < 1e-9) continue; u = u.map(v => v / l);
            let v = cross(u, [0, 0, 1]); if (norm3(v) < 1e-6) v = cross(u, [1, 0, 0]); const nv = norm3(v); v = v.map(x => x / nv * rw); const w = cross(u, v);
            const ring = [[v[0] + w[0], v[1] + w[1], v[2] + w[2]], [-v[0] + w[0], -v[1] + w[1], -v[2] + w[2]], [-v[0] - w[0], -v[1] - w[1], -v[2] - w[2]], [v[0] - w[0], v[1] - w[1], v[2] - w[2]]];
            for (let k = 0; k < 4; k++) { const q1 = ring[k], q2 = ring[(k + 1) % 4];
              pushPoly(out, [[a[0] + q1[0], a[1] + q1[1], a[2] + q1[2]], [a[0] + q2[0], a[1] + q2[1], a[2] + q2[2]], [b[0] + q2[0], b[1] + q2[1], b[2] + q2[2]], [b[0] + q1[0], b[1] + q1[1], b[2] + q1[2]]]); }
          }
          const ax = [Pw[Pw.length - 1][0] - Pw[0][0], Pw[Pw.length - 1][1] - Pw[0][1], Pw[Pw.length - 1][2] - Pw[0][2]]; const na = norm3(ax);
          if (na > 0 && L > best) { best = L; G.axis = ax.map(v => v / na); }
        } else G.ok = false;
      } else { G.curved = true; G.ok = false; }
    }
    if (!G.axis && out.length >= 9) G.axis = principalAxis(out);
    return G;
  }
  function principalAxis(t) {
    const n = t.length / 3, step = Math.max(1, Math.floor(n / 2000));
    let cx = 0, cy = 0, cz = 0, k = 0;
    for (let i = 0; i < n; i += step) { cx += t[3 * i]; cy += t[3 * i + 1]; cz += t[3 * i + 2]; k++; }
    cx /= k; cy /= k; cz /= k;
    const C = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i += step) { const x = t[3 * i] - cx, y = t[3 * i + 1] - cy, z = t[3 * i + 2] - cz;
      C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z; }
    let v = [1, 1, 1];
    for (let it = 0; it < 40; it++) { const w = [C[0] * v[0] + C[1] * v[1] + C[2] * v[2], C[1] * v[0] + C[3] * v[1] + C[4] * v[2], C[2] * v[0] + C[4] * v[1] + C[5] * v[2]];
      const nw = norm3(w); if (nw < 1e-15) return null; v = w.map(x => x / nw); }
    return v;
  }

  /* ---------------------------------------------------------------- materiali */
  function materialInfo(M, ref, depth = 0) {
    const m = M.get(ref); if (!m || depth > 4) return {};
    switch (m.T) {
      case 'IFCMATERIAL': return { name: str(m[0]) };
      case 'IFCMATERIALLIST': { const f = arr(m[0])[0]; return f ? materialInfo(M, f, depth + 1) : {}; }
      case 'IFCMATERIALPROFILESETUSAGE': case 'IFCMATERIALPROFILESETUSAGETAPERING': case 'IFCMATERIALLAYERSETUSAGE': return materialInfo(M, m[0], depth + 1);
      case 'IFCMATERIALPROFILESET': { const mp = M.get(arr(m[2])[0]); if (!mp) return { name: str(m[0]) }; const mat = M.get(mp[2]); return { name: mat ? str(mat[0]) : str(m[0]), profile: mp[3] }; }
      case 'IFCMATERIALPROFILE': { const mat = M.get(m[2]); return { name: mat ? str(mat[0]) : str(m[0]), profile: m[3] }; }
      case 'IFCMATERIALLAYERSET': { const layers = arr(m[0]).map(r => M.get(r)).filter(Boolean); const th = layers.reduce((s, l) => s + (num(l[1]) || 0), 0);
        const mat = layers[0] ? M.get(layers[0][0]) : null; return { name: mat ? str(mat[0]) : '', layer: th || null }; }
      case 'IFCMATERIALCONSTITUENTSET': { const c = M.get(arr(m[2])[0]); return c ? materialInfo(M, c[2], depth + 1) : { name: str(m[0]) }; }
      default: return {};
    }
  }

  /* ---------------------------------------------------------------- estrazione */
  const ELEMENT_TYPES = ['IFCBEAM', 'IFCBEAMSTANDARDCASE', 'IFCCOLUMN', 'IFCCOLUMNSTANDARDCASE', 'IFCMEMBER', 'IFCMEMBERSTANDARDCASE',
    'IFCPLATE', 'IFCPLATESTANDARDCASE', 'IFCBUILDINGELEMENTPART', 'IFCDISCRETEACCESSORY', 'IFCBUILDINGELEMENTPROXY', 'IFCRAILING',
    'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCMECHANICALFASTENER', 'IFCFASTENER'];
  const SPATIAL = new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCFACILITY', 'IFCFACILITYPART', 'IFCBRIDGE', 'IFCBRIDGEPART']);
  const PROFILE_KEYS = ['profile', 'profilo', 'profil', 'profilename', 'profile name', 'nome profilo', 'section', 'sectionname', 'section name', 'sezione', 'cross section', 'crosssection'];
  const WEIGHT_KEYS = ['netweight', 'net weight', 'weight', 'peso', 'peso netto', 'poids', 'masse', 'mass', 'massa', 'netmass', 'grossweight', 'gross weight', 'peso lordo'];
  const VOLUME_KEYS = ['netvolume', 'net volume', 'volume', 'volume netto', 'grossvolume', 'gross volume'];
  const LENGTH_KEYS = ['length', 'lunghezza', 'longueur', 'netlength', 'net length', 'cut length', 'cutlength'];
  const MATERIAL_KEYS = ['material', 'materiale', 'matériau', 'materiau', 'grade', 'steel grade', 'nuance'];
  const FASTENER_RE = /\b(ECROU|ÉCROU|RONDELLE|BOULON|VIS|NUT|NUTS|WASHER|BOLT|BOLTS|DADO|ROSETTA|BULLON[EI]|GOUJON|STUD|SCREW|CONTRE-?ECROU)\b/i;

  function normName(s) {
    s = String(s).trim().toUpperCase().replace(/\s+/g, ' ');
    s = s.replace(/^([A-Z]{1,4})\s+(\d)/, '$1$2');
    const he = /^HE\s*(\d+)\s*([ABM])$/.exec(s); if (he) s = 'HE' + he[2] + he[1];
    return s;
  }
  function synthName(p, lf) {
    const d = p.dims || {}; const f = v => v ? String(Math.round(v * lf * 10000) / 10) : '?';
    switch (p.cls) {
      case 'I': return `I ${f(d.h)}x${f(d.b)}x${f(d.tw)}x${f(d.tf)}`;
      case 'IASYM': return `I ASIM. ${f(d.h)}x${f(d.b)}`;
      case 'U': return `U ${f(d.h)}x${f(d.b)}x${f(d.tw)}`;
      case 'L': return `L ${f(d.h)}x${f(d.b)}x${f(d.t)}`;
      case 'RECT': return `RETT ${f(d.x)}x${f(d.y)}`;
      case 'RHS': return `TUBO RETT ${f(d.x)}x${f(d.y)}x${f(d.t)}`;
      case 'CHS': return `TUBO D${f(d.d)}x${f(d.t)}`;
      case 'ROUND': return `TONDO D${f(d.d)}`;
      default: return '';
    }
  }

  async function extract(M, onProgress) {
    const U = projectUnits(M); const lf = U.LENGTHUNIT;
    const props = new Map();
    const setProp = (id, key, rec) => { let m = props.get(id); if (!m) props.set(id, m = new Map()); const o = m.get(key); if (!o || rec.level < o.level) m.set(key, rec); };
    const readDef = (dref, targets, level) => {
      const d = M.get(dref); if (!d) return;
      if (d.T === 'IFCPROPERTYSET') {
        for (const pr of arr(d[4])) { const p = M.get(pr); if (!p || p.T !== 'IFCPROPERTYSINGLEVALUE') continue;
          const key = str(p[0]).trim().toLowerCase(); const rec = { v: tv(p[2]), vt: p[2] && p[2].t, level, unit: p[3], set: str(d[2]) };
          for (const t of targets) setProp(t, key, rec); }
      } else if (d.T === 'IFCELEMENTQUANTITY') {
        for (const qr of arr(d[5])) { const q = M.get(qr); if (!q) continue;
          const key = str(q[0]).trim().toLowerCase(); const rec = { v: num(q[3]), vt: q.T, level: level - 0.5, unit: q[2], set: str(d[2]) };
          for (const t of targets) setProp(t, key, rec); }
      }
    };
    const rels = [];
    for (const rid of M.ids('IFCRELDEFINESBYPROPERTIES')) { const r = M.get(rid); rels.push([arr(r[4]).map(x => x && x.r), r[5], 2]); }
    const typeOf = new Map();
    for (const rid of M.ids('IFCRELDEFINESBYTYPE')) {
      const r = M.get(rid); const t = M.get(r[5]); if (!t) continue; const objs = arr(r[4]).map(x => x && x.r);
      for (const o of objs) typeOf.set(o, t);
      for (const ps of arr(t[5])) rels.push([objs, ps, 4]);
    }
    rels.sort((a, b) => a[2] - b[2]);
    for (const [tg, def, lvl] of rels) { if (Array.isArray(def)) def.forEach(d => readDef(d, tg, lvl)); else readDef(def, tg, lvl); }
    const matOf = new Map();
    for (const rid of M.ids('IFCRELASSOCIATESMATERIAL')) { const r = M.get(rid); const info = materialInfo(M, r[5]);
      for (const o of arr(r[4])) if (o && !matOf.has(o.r)) matOf.set(o.r, info); }
    const parent = new Map();
    for (const rid of [...M.ids('IFCRELAGGREGATES'), ...M.ids('IFCRELNESTS')]) {
      const r = M.get(rid); const par = M.get(r[4]); if (!par || SPATIAL.has(par.T)) continue;
      for (const o of arr(r[5])) if (o && o.r != null) parent.set(o.r, par.id);
    }
    const find = (pm, keys, pred) => { if (!pm) return null; let best = null;
      for (const k of keys) { const rec = pm.get(k); if (rec && rec.v != null && (!pred || pred(rec.v)) && (!best || rec.level < best.level)) best = rec; } return best; };
    const ufac = (rec, def) => { if (rec.unit) { const uf = unitFactor(M, rec.unit); if (uf) return uf.f; } return def; };
    const isNum = v => typeof v === 'number' && v > 0;
    const isTxt = v => typeof v === 'string' && v.trim() !== '';

    const ids = []; for (const t of ELEMENT_TYPES) for (const id of M.ids(t)) ids.push(id);
    // origine del modello (per mantenere precisione con coordinate di cantiere)
    const pcache = new Map(), ocache = new Map();
    let origin = [0, 0, 0];
    for (const id of ids.slice(0, 50)) { const el = M.get(id); if (el && el[5]) { const T = placementMatrix(M, el[5], pcache); origin = [T[3] * lf, T[7] * lf, T[11] * lf]; break; } }

    const els = [], meshes = new Map(), fasteners = [];
    let t0 = Date.now();
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k]; const el = M.get(id); if (!el) continue;
      const pm = props.get(id);
      const ifcType = el.T.slice(3).replace(/STANDARDCASE$/, '');
      const rec = { id, guid: str(el[0]), ifcType, name: str(el[2]), objectType: str(el[4]), description: str(el[3]), tag: str(el[7]) };
      const anc = []; let pid = parent.get(id);
      while (pid != null && anc.length < 6) { const pe = M.get(pid); if (!pe) break; anc.push([pe.T, str(pe[2]) || str(pe[7]), pid]); pid = parent.get(pid); }
      rec.parentId = anc.length ? anc[0][2] : null; rec.ancTypes = anc.map(a => a[0]); rec.ancNames = anc.map(a => a[1]);
      rec.assembly = anc.length ? anc[0][1] : '';
      const asm = anc.find(a => a[0] === 'IFCELEMENTASSEMBLY'); rec.asmId = asm ? asm[2] : null; rec.asmName = asm ? asm[1] : '';

      const G = elementGeometry(M, el, pcache, ocache, origin, lf);
      if (G.tris.length) {
        const t = new Float32Array(G.tris); meshes.set(id, t);
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < t.length; i += 3) for (let c = 0; c < 3; c++) { const v = t[i + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
        rec.bbox = [...mn, ...mx];
      } else rec.bbox = null;
      if (G.axis && G.axis.every(isFinite)) {
        rec.incl = Math.asin(Math.min(1, Math.abs(G.axis[2]))) * 180 / Math.PI;
        rec.azim = ((Math.atan2(G.axis[1], G.axis[0]) * 180 / Math.PI) % 180 + 180) % 180;
      } else rec.incl = rec.azim = null;
      rec.curved = G.curved; rec.tapered = G.tapered;

      const mat = matOf.get(id) || {};
      const matProf = mat.profile ? profileInfo(M, mat.profile) : null;
      const prof = matProf || G.prof;
      const cands = [];
      const pp = find(pm, PROFILE_KEYS, isTxt); if (pp) cands.push([pp.v, 'proprietà IFC']);
      if (matProf && matProf.name) cands.push([matProf.name, 'profilo del materiale']);
      if (G.prof && G.prof.name) cands.push([G.prof.name, 'profilo della geometria']);
      const ty = typeOf.get(id); if (ty && str(ty[2])) cands.push([str(ty[2]), 'tipo IFC']);
      const rf = pm && pm.get('reference'); if (rf && isTxt(rf.v)) cands.push([rf.v, 'riferimento']);
      if (rec.objectType) cands.push([rec.objectType.split(':').pop(), 'ObjectType']);
      if (rec.name) cands.push([rec.name, 'nome elemento']);
      let pname = null, psrc = '';
      for (const [c, src] of cands) if (/\d/.test(c) && c.trim().length <= 60) { pname = c; psrc = src; break; }
      if (!pname && prof && prof.area) { pname = synthName(prof, lf); psrc = 'parametri geometria'; }
      rec.profile = pname ? normName(pname) : ''; rec.profileSrc = psrc;
      rec.profType = prof ? prof.type : ''; rec.profCls = prof ? prof.cls : '';
      const mp = find(pm, MATERIAL_KEYS, isTxt); rec.material = String(mat.name || (mp && mp.v) || '').trim();

      // valori grezzi, così come dichiarati nel file (la verifica di coerenza li può correggere)
      const lp = find(pm, LENGTH_KEYS, isNum);
      rec.lengthProp = lp ? lp.v * ufac(lp, lf) : null;
      rec.lengthGeo = G.maxDepth ? G.maxDepth * lf : (G.meshExt ? G.meshExt[0] * lf : null);
      rec.areaM2 = prof && prof.area ? prof.area * lf * lf : null;
      const wp = find(pm, WEIGHT_KEYS, isNum), vp = find(pm, VOLUME_KEYS, isNum);
      rec.weightDecl = wp ? wp.v * ufac(wp, U.MASSUNIT) : null;
      rec.weightKey = wp ? (wp.set ? wp.set + '.' : '') + [...pm.entries()].find(([k, v]) => v === wp)[0] : '';
      rec.volDecl = vp ? vp.v * ufac(vp, U.VOLUMEUNIT) : null;
      rec.volGeo = G.ok && G.vol > 0 ? G.vol * lf * lf * lf : null;

      let th = null;
      const m1 = /^(?:PLT?|FLT?|BPL|BL|PIATTO|LAMIERA|PLATE|FLAT|TOLE|TÔLE|PLAT|PL\.)\s*-?\s*(\d+(?:[.,]\d+)?)/i.exec(rec.profile);
      if (m1) th = parseFloat(m1[1].replace(',', '.'));
      else if (mat.layer) th = mat.layer * lf * 1000;
      else if (prof && prof.cls === 'RECT' && prof.dims.x && prof.dims.y) { const a = [prof.dims.x, prof.dims.y]; if (G.maxDepth) a.push(G.maxDepth); th = Math.min(...a) * lf * 1000; }
      else if (prof && prof.cls === 'ARB' && G.maxDepth) th = G.maxDepth * lf * 1000;
      else if (G.meshExt) th = G.meshExt[2] * lf * 1000;
      rec.thicknessMm = th ? Math.round(th * 10) / 10 : null;

      // bulloneria: separata dalla carpenteria
      const isFast = ifcType === 'MECHANICALFASTENER' || ifcType === 'FASTENER' ||
        ((ifcType === 'DISCRETEACCESSORY' || ifcType === 'BUILDINGELEMENTPROXY') && FASTENER_RE.test([rec.name, rec.objectType, rec.profile, rec.description].join(' ')));
      if (isFast) {
        let label = rec.name || rec.objectType || 'Bulloneria';
        const d = el.T === 'IFCMECHANICALFASTENER' ? num(el[8]) : null, l = el.T === 'IFCMECHANICALFASTENER' ? num(el[9]) : null;
        if (d && l) label += ` M${Math.round(d * lf * 1000)}x${Math.round(l * lf * 1000)}`;
        else if (rec.profile && rec.profile !== normName(label)) label += ' ' + rec.profile;
        const q = find(pm, ['number of bolts', 'bolt count', 'numero bulloni', 'nombre', 'count', 'quantity'], isNum);
        rec.fastLabel = label.trim(); rec.fastCount = q ? Math.round(q.v) : 1;
        fasteners.push(rec);
      } else els.push(rec);

      if (onProgress && k % 200 === 0 && Date.now() - t0 > 50) { onProgress(k / ids.length); await tick(); t0 = Date.now(); }
    }
    onProgress && onProgress(1);
    return { elements: els, fasteners, meshes, units: U, schema: M.schema, origin };
  }

  /* ---------------------------------------------------------------- catalogo profili (kg/m) */
  const CAT = {
    IPE: { 80: 6.0, 100: 8.1, 120: 10.4, 140: 12.9, 160: 15.8, 180: 18.8, 200: 22.4, 220: 26.2, 240: 30.7, 270: 36.1, 300: 42.2, 330: 49.1, 360: 57.1, 400: 66.3, 450: 77.6, 500: 90.7, 550: 106, 600: 122 },
    HEA: { 100: 16.7, 120: 19.9, 140: 24.7, 160: 30.4, 180: 35.5, 200: 42.3, 220: 50.5, 240: 60.3, 260: 68.2, 280: 76.4, 300: 88.3, 320: 97.6, 340: 105, 360: 112, 400: 125, 450: 140, 500: 155, 550: 166, 600: 178, 650: 190, 700: 204, 800: 224, 900: 252, 1000: 272 },
    HEB: { 100: 20.4, 120: 26.7, 140: 33.7, 160: 42.6, 180: 51.2, 200: 61.3, 220: 71.5, 240: 83.2, 260: 93.0, 280: 103, 300: 117, 320: 127, 340: 134, 360: 142, 400: 155, 450: 171, 500: 187, 550: 199, 600: 212, 650: 225, 700: 241, 800: 262, 900: 291, 1000: 314 },
    HEM: { 100: 41.8, 120: 52.1, 140: 63.2, 160: 76.2, 180: 88.9, 200: 103, 220: 117, 240: 157, 260: 172, 280: 189, 300: 238, 320: 245, 340: 248, 360: 250, 400: 256, 450: 263, 500: 270, 550: 278, 600: 285 },
    UPN: { 50: 5.59, 65: 7.09, 80: 8.64, 100: 10.6, 120: 13.4, 140: 16.0, 160: 18.8, 180: 22.0, 200: 25.3, 220: 29.4, 240: 33.2, 260: 37.9, 280: 41.8, 300: 46.2, 320: 59.5, 350: 60.6, 380: 63.1, 400: 71.8 },
    UPE: { 80: 7.9, 100: 9.82, 120: 12.1, 140: 14.5, 160: 17.0, 180: 19.7, 200: 22.8, 220: 26.6, 240: 30.2, 270: 35.2, 300: 44.4, 330: 53.2, 360: 61.2, 400: 72.2 },
    IPN: { 80: 5.94, 100: 8.34, 120: 11.1, 140: 14.3, 160: 17.9, 180: 21.9, 200: 26.2, 220: 31.1, 240: 36.2, 260: 41.9, 280: 47.9, 300: 54.2, 320: 61.0, 340: 68.0, 360: 76.1, 380: 84.0, 400: 92.4 },
  };
  CAT.UAP = {}; CAT.PFC = {};
  const n_ = s => parseFloat(String(s).replace(',', '.'));
  // ritorna { kgm, how } per 1 m di profilo, oppure null
  function catalogKgm(name, density = 7850) {
    if (!name) return null;
    const s = name.toUpperCase().replace(/\s+/g, '').replace(/×/g, 'X');
    const k = density / 1e6; // kg/m per mm²
    let m = /^(IPE|HEA|HEB|HEM|UPN|UPE|IPN)(\d+)$/.exec(s);
    if (m && CAT[m[1]][m[2]]) return { kgm: CAT[m[1]][m[2]] * density / 7850, how: 'catalogo' };
    m = /^(?:CHS|PD|TUBO|TUBE|TU|TRON|Ø|O|D)[-_]?(?:F)?(\d+(?:[.,]\d+)?)[*X\/](\d+(?:[.,]\d+)?)$/.exec(s);
    if (m) { const D = n_(m[1]), t = n_(m[2]); if (t < D / 2) return { kgm: Math.PI * (D - t) * t * k, how: 'dimensioni nel nome' }; }
    m = /^(?:RHS|SHS|TR|TC|TQ|TUBO|QHS|HFRHS|CFRHS|HFSHS|CFSHS|RRW|RRK|TREC|TCAR)[-_]?F?(\d+(?:[.,]\d+)?)[*X](\d+(?:[.,]\d+)?)(?:[*X](\d+(?:[.,]\d+)?))?$/.exec(s);
    if (m) { let h = n_(m[1]), b, t; if (m[3]) { b = n_(m[2]); t = n_(m[3]); } else { b = h; t = n_(m[2]); }
      if (t < Math.min(h, b) / 2) return { kgm: 2 * t * (h + b - 2 * t) * k, how: 'dimensioni nel nome' }; }
    m = /^(?:L|LU|CORNIERE|CORNIÈRE)(\d+(?:[.,]\d+)?)[*X](\d+(?:[.,]\d+)?)(?:[*X](\d+(?:[.,]\d+)?))?$/.exec(s);
    if (m) { const a = n_(m[1]); let b, t; if (m[3]) { b = n_(m[2]); t = n_(m[3]); } else { b = a; t = n_(m[2]); }
      if (t < Math.min(a, b) / 2) return { kgm: t * (a + b - t) * k, how: 'dimensioni nel nome' }; }
    m = /^(?:D|Ø|RD|TONDO|ROND|RB)(\d+(?:[.,]\d+)?)$/.exec(s);
    if (m) { const d = n_(m[1]); return { kgm: Math.PI * d * d / 4 * k, how: 'dimensioni nel nome' }; }
    return null;
  }

  /* ---------------------------------------------------------------- verifica di coerenza delle unità */
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
  // se r è vicino a 10^(3k) con k ≠ 0 restituisce il fattore correttivo 10^(-3k)
  function powerFix(r) {
    if (!(r > 0)) return null;
    const lg = Math.log10(r), k = Math.round(lg / 3);
    if (k === 0 || Math.abs(lg - 3 * k) > 0.2) return null;
    return Math.pow(10, -3 * k);
  }
  function checkUnits(data, density = 7850) {
    const E = data.elements, notes = [], fix = { geo: 1, len: 1, mass: 1, vol: 1 };
    const minN = n => Math.max(5, Math.min(30, Math.ceil(n * 0.05)));
    // 1) geometria: area di sezione vs catalogo
    let r = [];
    for (const e of E) { const c = catalogKgm(e.profile, density); if (c && e.areaM2) r.push(e.areaM2 * density / c.kgm); }
    if (r.length >= minN(E.length)) {
      const m = median(r), f = powerFix(m);
      if (f) { fix.geo = Math.sqrt(f); notes.push({ level: 'fix', text: `Le sezioni della geometria risultano ${fmtRatio(m)} rispetto al catalogo: l’unità di lunghezza dichiarata nel file non è coerente. Le misure geometriche sono state corrette.` }); }
    }
    if (fix.geo !== 1) {
      const g = fix.geo;
      for (const e of E) { if (e.areaM2) e.areaM2 *= g * g; if (e.volGeo) e.volGeo *= g * g * g; if (e.lengthGeo) e.lengthGeo *= g; if (e.bbox) e.bbox = e.bbox.map(v => v * g); }
      for (const [id, t] of data.meshes) for (let i = 0; i < t.length; i++) t[i] *= g;
    }
    // 2) lunghezze dichiarate vs geometria
    r = [];
    for (const e of E) if (e.lengthProp && e.lengthGeo && e.lengthGeo > 0.05) r.push(e.lengthProp / e.lengthGeo);
    if (r.length >= minN(E.length)) {
      const m = median(r), f = powerFix(m);
      if (f) { fix.len = f; for (const e of E) if (e.lengthProp) e.lengthProp *= f;
        notes.push({ level: 'fix', text: `Le lunghezze scritte nelle proprietà risultano ${fmtRatio(m)} rispetto alla geometria: sono state corrette.` }); }
    }
    for (const e of E) e.lengthM = e.lengthProp || e.lengthGeo || null;
    // 3) pesi dichiarati vs riferimento indipendente (catalogo x lunghezza, oppure volume geometrico x densità)
    const rw = [], rv = [];
    for (const e of E) {
      if (!e.weightDecl) continue;
      const c = catalogKgm(e.profile, density);
      if (c && e.lengthM) rw.push(e.weightDecl / (c.kgm * e.lengthM));
      else if (e.volGeo) rv.push(e.weightDecl / (e.volGeo * density));
    }
    const all = rw.length >= minN(E.length) ? rw : rw.concat(rv);
    const nDecl = E.filter(e => e.weightDecl).length;
    if (all.length >= Math.min(minN(E.length), Math.max(3, nDecl))) {
      const m = median(all), f = powerFix(m);
      if (f) {
        fix.mass = f; for (const e of E) if (e.weightDecl) e.weightDecl *= f;
        for (const fz of data.fasteners) if (fz.weightDecl) fz.weightDecl *= f;
        const unit = data.units.labels.MASSUNIT || 'non indicata';
        notes.push({ level: 'fix', text: `I pesi scritti nel file risultano ${fmtRatio(m)} rispetto al peso atteso da catalogo e geometria (unità di massa dichiarata: ${unit}). Sono stati corretti moltiplicando per ${fmtFactor(f)}.` });
      } else if (Math.abs(Math.log10(m)) > 0.1) {
        notes.push({ level: 'warn', text: `I pesi scritti nel file differiscono in media del ${Math.round((m - 1) * 100)} % dal peso atteso da catalogo e geometria. Verifica il modello.` });
      } else notes.push({ level: 'ok', text: `I pesi scritti nel file sono coerenti con catalogo e geometria (scarto medio ${Math.abs(Math.round((m - 1) * 1000) / 10)} %).` });
    } else if (nDecl) notes.push({ level: 'warn', text: 'Non ci sono abbastanza profili riconoscibili per verificare i pesi scritti nel file.' });
    // 4) volumi dichiarati vs geometria
    r = []; for (const e of E) if (e.volDecl && e.volGeo) r.push(e.volDecl / e.volGeo);
    if (r.length >= minN(E.length)) { const m = median(r), f = powerFix(m); if (f) { fix.vol = f; for (const e of E) if (e.volDecl) e.volDecl *= f;
      notes.push({ level: 'fix', text: `I volumi scritti nel file risultano ${fmtRatio(m)} rispetto alla geometria: sono stati corretti.` }); } }
    data.fix = fix; data.unitNotes = notes;
    return notes;
  }
  const fmtRatio = m => m < 1 ? `circa ${fmtFactor(1 / m)} volte più piccoli` : `circa ${fmtFactor(m)} volte più grandi`;
  const fmtFactor = f => { const k = Math.round(Math.log10(f)); return Math.abs(k) >= 3 ? (k > 0 ? '' : '1/') + Math.pow(10, Math.abs(k)).toLocaleString('it-IT') : String(Math.round(f * 100) / 100); };

  /* ---------------------------------------------------------------- calcolo */
  const CATS = [
    { k: 'light', label: 'Profilati leggeri' }, { k: 'heavy', label: 'Profilati pesanti' }, { k: 'vheavy', label: 'Profilati molto pesanti' },
    { k: 'weld', label: 'Profili saldati' }, { k: 'plate', label: 'Piatti e lamiere' }, { k: 'nd', label: 'Profilati non classificati' }];
  const DEFAULTS = {
    t1: 25, t2: 100, density: 7850, maxLen: 13.5, maxWeight: 5000,
    plateRe: '^(PLT?|FLT?|BPL|BL|PIATTO|LAMIERA|PLATE|FLAT|LAM|TOLE|TÔLE|PLAT)(?![A-Z])',
    weldRe: '^(PRS|WI|HI|HK|HQ|PHI|PHD|PHV|BH|BOX|WELD|SALD|RS)(?![A-Z])',
    excluded: [], contactTol: 3
  };
  const safeRe = (src, fb) => { try { return new RegExp(src, 'i'); } catch (e) { return new RegExp(fb, 'i'); } };
  const family = name => {
    if (!name) return 'N.D.';
    const he = /^HE([ABM])/.exec(name); if (he) return 'HE' + he[1];
    const m = /^[A-ZØ]+/.exec(name); return m ? m[0] : (name.split(/[\s\d]/)[0] || name);
  };
  function compute(data, S) {
    const d = S.density || 7850, plateRe = safeRe(S.plateRe, DEFAULTS.plateRe), weldRe = safeRe(S.weldRe, DEFAULTS.weldRe);
    const t1 = S.t1, t2 = Math.max(S.t2, S.t1), excl = new Set(S.excluded || []);
    let rows = [];
    for (const e of data.elements) {
      if (excl.has(e.ifcType)) continue;
      let w = null, src = null;
      if (e.weightDecl) { w = e.weightDecl; src = 'file IFC'; }
      else if (e.volDecl) { w = e.volDecl * d; src = 'volume del file'; }
      else if (e.volGeo) { w = e.volGeo * d; src = 'geometria'; }
      let kind = 'rolled';
      if (e.ifcType === 'PLATE' || plateRe.test(e.profile)) kind = 'plate';
      else if (weldRe.test(e.profile) || e.profType === 'IFCASYMMETRICISHAPEPROFILEDEF' || e.profType === 'IFCCOMPOSITEPROFILEDEF') kind = 'weld';
      rows.push(Object.assign(Object.create(e), { w, wsrc: src, kind }));
    }
    const inc = new Set(rows.map(r => r.id));
    const containers = new Set(rows.filter(r => r.parentId != null && inc.has(r.parentId)).map(r => r.parentId));
    if (containers.size) rows = rows.filter(r => !containers.has(r.id));

    const G = new Map();
    for (const r of rows) {
      let key, label;
      if (r.kind === 'plate') { key = 'plate|' + (r.thicknessMm ?? 'nd'); label = r.thicknessMm != null ? `PL ${String(r.thicknessMm).replace('.', ',')} mm` : 'Spessore n.d.'; }
      else { label = r.profile || 'Profilo n.d.'; key = r.kind + '|' + label; }
      let g = G.get(key);
      if (!g) G.set(key, g = { key, label, kind: r.kind, family: r.kind === 'plate' ? 'PL' : family(r.profile), n: 0, L: 0, Lw: 0, Wl: 0, w: 0, missW: 0, areas: [], mats: new Set(), th: r.thicknessMm, rows: [] });
      g.n++; g.rows.push(r);
      if (r.w != null) g.w += r.w; else g.missW++;
      if (r.lengthM) { g.L += r.lengthM; if (r.w != null) { g.Lw += r.lengthM; g.Wl += r.w; } }
      if (r.areaM2) g.areas.push(r.areaM2);
      if (r.material) g.mats.add(r.material);
    }
    const groups = [...G.values()];
    for (const g of groups) {
      const c = g.kind === 'plate' ? null : catalogKgm(g.label, d);
      const a = median(g.areas);
      g.kgmCat = c ? c.kgm : null; g.kgmNom = a ? a * d : null; g.kgmReal = g.Lw > 0 ? g.Wl / g.Lw : null;
      if (g.kind === 'plate') { g.kgm = null; g.kgmSrc = ''; }
      else if (g.kgmCat != null) { g.kgm = g.kgmCat; g.kgmSrc = c.how; }
      else if (g.kgmNom != null) { g.kgm = g.kgmNom; g.kgmSrc = 'sezione'; }
      else if (g.kgmReal != null) { g.kgm = g.kgmReal; g.kgmSrc = 'peso/lunghezza'; }
      else { g.kgm = null; g.kgmSrc = ''; }
      g.dev = (g.kgmReal && g.kgm && g.Lw > 1 && g.kgmSrc !== 'peso/lunghezza') ? g.kgmReal / g.kgm - 1 : null;
      if (g.kind === 'plate') g.cat = 'plate';
      else if (g.kind === 'weld') g.cat = 'weld';
      else if (g.kgm == null || g.label === 'Profilo n.d.') g.cat = 'nd';
      else g.cat = g.kgm <= t1 ? 'light' : g.kgm <= t2 ? 'heavy' : 'vheavy';
      g.material = [...g.mats].join(', ');
      for (const r of g.rows) { r.cat = g.cat; r.kgm = g.kgm; r.group = g; }
    }
    const cats = {}; CATS.forEach(c => cats[c.k] = { w: 0, n: 0, L: 0, profiles: 0 });
    let total = 0;
    for (const g of groups) { const c = cats[g.cat]; c.w += g.w; c.n += g.n; c.L += g.L; c.profiles++; total += g.w; }
    const src = {}; let missing = 0;
    for (const r of rows) { if (r.w == null) missing++; else src[r.wsrc] = (src[r.wsrc] || 0) + 1; }
    const fam = new Map();
    for (const g of groups) {
      if (g.kind === 'plate') continue;
      const key = g.family + '|' + g.kind; let f = fam.get(key);
      if (!f) fam.set(key, f = { family: g.family, kind: g.kind, p: 0, n: 0, L: 0, w: 0, cats: {} });
      f.p++; f.n += g.n; f.L += g.L; f.w += g.w; f.cats[g.cat] = (f.cats[g.cat] || 0) + g.w;
    }
    // bulloneria
    const fb = new Map();
    for (const f of data.fasteners) {
      if (excl.has(f.ifcType)) continue;
      let e = fb.get(f.fastLabel); if (!e) fb.set(f.fastLabel, e = { label: f.fastLabel, n: 0, w: 0, wn: 0 });
      e.n += f.fastCount; const w = f.weightDecl ?? (f.volGeo ? f.volGeo * d : null); if (w != null) { e.w += w; e.wn++; }
    }
    const bolts = [...fb.values()].sort((a, b) => b.n - a.n);
    return { rows, groups, cats, total, src, missing, t1, t2, families: [...fam.values()].sort((a, b) => b.w - a.w), bolts,
      boltsW: bolts.reduce((s, b) => s + b.w, 0), boltsN: bolts.reduce((s, b) => s + b.n, 0) };
  }

  /* ---------------------------------------------------------------- elementi particolari */
  const SPECIAL = [
    ['stair', 'Scale'], ['ladder', 'Scale alla marinara'], ['railing', 'Parapetti e ringhiere'], ['vbrace', 'Controventi verticali'],
    ['hbrace', 'Controventi orizzontali e di falda'], ['crane', 'Vie di corsa carroponte'], ['grating', 'Grigliati'], ['deck', 'Lamiere grecate'],
    ['tie', 'Tiranti e tenditori'], ['anchor', 'Tirafondi e ancoraggi'], ['curved', 'Elementi curvi'], ['tapered', 'Elementi rastremati (altezza variabile)'],
    ['long', 'Elementi oltre la lunghezza di trasporto'], ['heavy', 'Assiemi oltre il peso di sollevamento'], ['weld', 'Profili composti saldati'],
    ['tube', 'Profili cavi (tubolari)'], ['proxy', 'Elementi IFC generici (proxy) da verificare'], ['bolts', 'Bulloneria']];
  const EXCLUSIVE = ['railing', 'ladder', 'stair', 'crane', 'grating', 'deck', 'vbrace', 'hbrace', 'tie', 'anchor'];
  const OTHER_HL = ['curved', 'tapered', 'long', 'heavy'];
  const KW = {
    railing: /PARAPETT|RINGHIER|RAILING|HANDRAIL|GUARD\s*RAIL|CORRIMAN|MANCORRENT|BALAUSTR|FERMAPIED|TOE\s*BOARD|TOEBOARD|BATTIPIED|GARDE[\s-]*CORPS|\bG\.?C\.?\b|MAIN[\s-]*COURANTE|\bLISSE|PLINTHE|SOUS[\s-]*LISSE/i,
    ladder: /MARINAR|LADDER|\bPIOL[OI]|GABBIA|\bCAGE\b|[EÉ]CHELLE|CRINOLINE|BARREAU/i,
    stair: /\bSCAL[AE]\b|SCALIN|STAIR|GRADIN|STRINGER|COSCIAL|PEDAT|\bALZAT|PIANEROTTOL|LANDING|TREAD|\bSTEPS?\b|ESCALIER|\bLIMON|\bMARCHE|CONTRE[\s-]*MARCHE|\bPALIER|\bGIRON/i,
    crane: /VIA\s*(DI\s*)?CORSA|VIE\s*DI\s*CORSA|CARROPONT|CRANE|RUNWAY|ROTAIA|BINARIO|MONOROTAIA|CHEMIN\s*DE\s*ROULEMENT|PONT\s*ROULANT|MONORAIL/i,
    grating: /GRIGLIAT|GRATING|ORSOGRIL|CAILLEBOTIS/i,
    deck: /GRECAT|\bDECK|LAMIERA\s*COLLAB|HI-?BOND|BAC\s*ACIER|COFRASTRA/i,
    brace: /CONTROV|BRACING|\bBRACE|DIAGONAL|CROCE\s*(DI\s*)?S|S\.?\s*ANDREA|X-?BRAC|CONTREVENT|PAL[EÉ]E|STABILIT|POUTRE\s*AU\s*VENT|\bCROIX|ST\.?\s*ANDR[EÉ]/i,
    tie: /TIRANT|TENDITOR|TIE[\s-]*ROD|\bSTRALL|TENDEUR|SUSPENTE/i,
    anchor: /TIRAFOND|ANCHOR|ANCORAGG|BARRA\s*FILETT|TIGE\s*D.?ANCRAGE|\bANCRAGE|CHEVILLE|SCELLEMENT/i,
  };
  const TUBE_RE = /^(CHS|RHS|SHS|QHS|TUBO|TQ|TR|TC|PD\d|RRW|RRK|CFCHS|CFRHS|HFCHS|HFRHS|TREC|TCAR|TRON)/i;
  const TAPER_RE = /^PH[IVDCT]\d/i;
  function clusters(list, tol) {
    const it = list.filter(r => r.bbox); const n = it.length; if (!n || n > 4000) return null;
    const par = [...Array(n).keys()]; const f = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < n; i++) { const A = it[i].bbox;
      for (let j = i + 1; j < n; j++) { const B = it[j].bbox;
        if (B[0] <= A[3] + tol && B[3] >= A[0] - tol && B[1] <= A[4] + tol && B[4] >= A[1] - tol && B[2] <= A[5] + tol && B[5] >= A[2] - tol) { const a = f(i), b = f(j); if (a !== b) par[a] = b; } } }
    return new Set(it.map((_, i) => f(i))).size;
  }
  function analyzeSpecial(data, R, S) {
    const rows = R.rows, assign = new Map(), src = new Map();
    for (const r of rows) {
      const t = [r.name, r.objectType, r.description, ...r.ancNames].join(' ');
      const anc = new Set([...r.ancTypes, 'IFC' + r.ifcType]);
      let key = null, how = 'nome';
      if (anc.has('IFCRAILING')) { key = 'railing'; how = 'entità IFC'; }
      else if (KW.railing.test(t)) key = 'railing';
      else if (KW.ladder.test(t)) key = 'ladder';
      else if (anc.has('IFCSTAIR') || anc.has('IFCSTAIRFLIGHT')) { key = 'stair'; how = 'entità IFC'; }
      else if (KW.stair.test(t)) key = 'stair';
      else if (KW.crane.test(t)) key = 'crane';
      else if (KW.grating.test(t + ' ' + r.profile)) key = 'grating';
      else if (KW.deck.test(t + ' ' + r.profile)) key = 'deck';
      else if (KW.brace.test(t) && r.kind !== 'plate') key = (r.incl != null && r.incl < 15) ? 'hbrace' : 'vbrace';
      else if (KW.tie.test(t)) key = 'tie';
      else if (KW.anchor.test(t + ' ' + r.profile)) key = 'anchor';
      if (key) { assign.set(r.id, key); src.set(r.id, how); }
    }
    const hist = new Float64Array(90);
    for (const r of rows) if (r.incl != null && r.incl < 10 && (r.lengthM || 0) >= 2 && r.kind !== 'plate') hist[Math.floor(r.azim) % 90] += r.lengthM;
    const sm = new Float64Array(90); for (let a = 0; a < 90; a++) for (let k = -2; k <= 2; k++) sm[a] += hist[(a + k + 90) % 90];
    const peaks = []; const top = Math.max(...sm);
    for (let it = 0; it < 3 && top > 0; it++) { let a = 0; for (let i = 1; i < 90; i++) if (sm[i] > sm[a]) a = i;
      if (sm[a] <= 0 || sm[a] < 0.3 * top) break; peaks.push(a); for (let k = -10; k <= 10; k++) sm[(a + k + 90) % 90] = 0; }
    const dev = az => peaks.length ? Math.min(...peaks.map(p => { const x = Math.abs(az % 90 - p); return Math.min(x, 90 - x); })) : 0;
    for (const r of rows) {
      if (assign.has(r.id) || r.kind === 'plate' || r.incl == null || (r.lengthM || 0) < 0.8) continue;
      if (!['MEMBER', 'BEAM', 'COLUMN', 'BUILDINGELEMENTPROXY'].includes(r.ifcType)) continue;
      if (r.incl >= 20 && r.incl <= 75) { assign.set(r.id, 'vbrace'); src.set(r.id, 'geometria'); }
      else if (r.incl < 10 && peaks.length && dev(r.azim) >= 15 && (r.kgm == null || r.kgm <= 40)) { assign.set(r.id, 'hbrace'); src.set(r.id, 'geometria'); }
    }
    const found = {}; SPECIAL.forEach(([k]) => found[k] = []);
    for (const r of rows) {
      if (assign.has(r.id)) found[assign.get(r.id)].push(r);
      if (r.curved) found.curved.push(r);
      if (r.tapered || TAPER_RE.test(r.profile)) found.tapered.push(r);
      if (r.kind !== 'plate' && (r.lengthM || 0) > S.maxLen) found.long.push(r);
      if (r.kind === 'weld') found.weld.push(r);
      if (r.kind !== 'plate' && (r.profType === 'IFCCIRCLEHOLLOWPROFILEDEF' || r.profType === 'IFCRECTANGLEHOLLOWPROFILEDEF' || TUBE_RE.test(r.profile))) found.tube.push(r);
      if (r.ifcType === 'BUILDINGELEMENTPROXY') found.proxy.push(r);
    }
    const asm = new Map();
    for (const r of rows) { const k = r.asmId != null ? r.asmId : 'e' + r.id; let a = asm.get(k);
      if (!a) asm.set(k, a = { name: r.asmName || r.name || r.profile, w: 0, rows: [] }); a.w += r.w || 0; a.rows.push(r); }
    const heavy = [...asm.values()].filter(a => a.w > S.maxWeight).sort((a, b) => b.w - a.w);
    heavy.forEach(a => found.heavy.push(...a.rows));
    const fmt0 = v => Math.round(v).toLocaleString('it-IT');
    const items = [];
    for (const [k, title] of SPECIAL) {
      if (k === 'bolts') {
        if (R.boltsN) items.push({ key: k, title, count: `${fmt0(R.boltsN)} pezzi`, n: R.boltsN, w: R.boltsW || null, rows: [],
          note: 'Tipi principali: ' + R.bolts.slice(0, 6).map(b => `${b.label} (${fmt0(b.n)})`).join(', ') + '. ' + (R.boltsW ? 'Il peso è escluso dal totale della carpenteria.' : 'Peso non indicato nel file.'),
          profiles: R.bolts.map(b => [b.label, [b.n, b.w]]) });
        continue;
      }
      const lst = found[k]; if (!lst.length) continue;
      const n = lst.length, w = lst.reduce((s, r) => s + (r.w || 0), 0);
      let count = `${fmt0(n)} ${n === 1 ? 'elemento' : 'elementi'}`, note = '';
      if (k === 'stair' || k === 'ladder') {
        const ents = new Set(lst.filter(r => r.parentId != null && r.ancTypes.includes('IFCSTAIR')).map(r => r.parentId));
        const c = ents.size || clusters(lst, 0.3);
        if (c) count = `${fmt0(c)} ${c === 1 ? 'scala' : 'scale'}${k === 'ladder' ? ' alla marinara' : ''} (${fmt0(n)} elementi)`;
      } else if (k === 'railing') {
        const hl = lst.filter(r => r.incl != null && r.incl < 15).reduce((s, r) => s + (r.lengthM || 0), 0);
        if (hl) note = `Sviluppo complessivo dei correnti orizzontali circa ${fmt0(hl)} m. `;
      } else if (k === 'vbrace' || k === 'hbrace') {
        const c = clusters(lst, 0.05);
        count = `${fmt0(n)} ${n === 1 ? 'asta' : 'aste'}` + (c ? ` in circa ${fmt0(c)} ${c === 1 ? 'campo' : 'campi'}` : '');
        const ng = lst.filter(r => src.get(r.id) === 'geometria').length;
        const crit = k === 'vbrace' ? 'aste inclinate tra 20° e 75°' : 'aste orizzontali in diagonale rispetto alla maglia';
        note = ng === n ? `Tutte individuate dalla geometria (${crit}): da verificare. ` : ng ? `${fmt0(n - ng)} riconosciute dal nome, ${fmt0(ng)} individuate dalla geometria (${crit}): verifica queste ultime. ` : 'Riconosciute dal nome degli elementi. ';
      } else if (k === 'long') {
        const r0 = lst.reduce((a, b) => (b.lengthM || 0) > (a.lengthM || 0) ? b : a);
        note = `Limite impostato ${String(S.maxLen).replace('.', ',')} m. Il più lungo: ${r0.profile || r0.name} di ${(r0.lengthM).toLocaleString('it-IT', { maximumFractionDigits: 2 })} m. `;
      } else if (k === 'heavy') {
        count = `${fmt0(heavy.length)} ${heavy.length === 1 ? 'assieme' : 'assiemi'}`;
        note = `Limite impostato ${fmt0(S.maxWeight)} kg. Il più pesante: ${heavy[0].name || 'n.d.'} di ${fmt0(heavy[0].w)} kg. `;
      } else if (k === 'curved') note = 'Individuati da solidi di rivoluzione o lungo curve; gli elementi curvi esportati come superfici sfaccettate potrebbero sfuggire. ';
      else if (k === 'proxy') note = 'Elementi senza una classe IFC specifica: controlla che siano davvero carpenteria. ';
      if (EXCLUSIVE.includes(k) && k !== 'vbrace' && k !== 'hbrace') {
        const hows = [...new Set(lst.map(r => src.get(r.id) || 'nome'))].sort();
        note += 'Riconosciuti da: ' + hows.map(h => h === 'nome' ? 'nome dell’elemento o dell’assieme' : h).join(' e ') + '. ';
      }
      const profs = new Map(); for (const r of lst) { const pk = r.profile || 'n.d.'; const p = profs.get(pk) || [0, 0]; p[0]++; p[1] += r.w || 0; profs.set(pk, p); }
      items.push({ key: k, title, count, n, w, rows: lst, note: note.trim(), profiles: [...profs.entries()].sort((a, b) => b[1][1] - a[1][1]) });
    }
    const highlight = new Map();
    for (const k of OTHER_HL) for (const r of found[k]) highlight.set(r.id, 'other');
    for (const [id, k] of assign) highlight.set(id, k);
    return { items, assign, src, highlight };
  }

  /* ---------------------------------------------------------------- lavorazioni: taglio e foratura / officina */
  function eig3(C) { // Jacobi per matrice simmetrica 3x3 [a00,a01,a02,a11,a12,a22]
    const A = [[C[0], C[1], C[2]], [C[1], C[3], C[4]], [C[2], C[4], C[5]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 30; sweep++) {
      let off = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]); if (off < 1e-14) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(A[p][q]) < 1e-18) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
        for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
    return [0, 1, 2].map(i => ({ val: A[i][i], vec: [V[0][i], V[1][i], V[2][i]] })).sort((a, b) => b.val - a.val);
  }
  // riquadro orientato: c centro, u[3] assi (u[0] il più lungo), h[3] semi-dimensioni (m)
  function obbOf(t) {
    const n = t.length / 3; if (n < 3) return null;
    const step = Math.max(1, Math.floor(n / 3000));
    let cx = 0, cy = 0, cz = 0, k = 0;
    for (let i = 0; i < n; i += step) { cx += t[3 * i]; cy += t[3 * i + 1]; cz += t[3 * i + 2]; k++; }
    cx /= k; cy /= k; cz /= k;
    const C = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i += step) { const x = t[3 * i] - cx, y = t[3 * i + 1] - cy, z = t[3 * i + 2] - cz;
      C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z; }
    let u = eig3(C).map(e => e.vec);
    // assi quasi allineati a quelli globali: li raddrizza (evita riquadri storti su pezzi simmetrici)
    u = u.map(v => { const a = v.map(Math.abs), m = Math.max(...a); return m > 0.9999 ? v.map((x, i) => a[i] === m ? Math.sign(x) : 0) : v; });
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) { const x = t[3 * i], y = t[3 * i + 1], z = t[3 * i + 2];
      for (let a = 0; a < 3; a++) { const p = x * u[a][0] + y * u[a][1] + z * u[a][2]; if (p < lo[a]) lo[a] = p; if (p > hi[a]) hi[a] = p; } }
    const mid = [0, 1, 2].map(a => (lo[a] + hi[a]) / 2);
    const c = [0, 1, 2].map(i => mid[0] * u[0][i] + mid[1] * u[1][i] + mid[2] * u[2][i]);
    const h = [0, 1, 2].map(a => (hi[a] - lo[a]) / 2);
    // ordina per dimensione decrescente
    const ord = [0, 1, 2].sort((a, b) => h[b] - h[a]);
    const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 3; i++) { const r = Math.abs(u[0][i]) * h[0] + Math.abs(u[1][i]) * h[1] + Math.abs(u[2][i]) * h[2]; aabb[i] = c[i] - r; aabb[i + 3] = c[i] + r; }
    return { c, u: ord.map(a => u[a]), h: ord.map(a => h[a]), aabb };
  }
  function obbTouch(A, B, tol) { // separazione sugli assi (SAT) con tolleranza
    const ha = A.h.map(x => x + tol / 2), hb = B.h.map(x => x + tol / 2);
    const R = [0, 1, 2].map(i => [0, 1, 2].map(j => dot(A.u[i], B.u[j])));
    const AR = R.map(r => r.map(x => Math.abs(x) + 1e-9));
    const d = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]], t = [0, 1, 2].map(i => dot(d, A.u[i]));
    for (let i = 0; i < 3; i++) if (Math.abs(t[i]) > ha[i] + hb[0] * AR[i][0] + hb[1] * AR[i][1] + hb[2] * AR[i][2]) return false;
    for (let j = 0; j < 3; j++) if (Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]) > ha[0] * AR[0][j] + ha[1] * AR[1][j] + ha[2] * AR[2][j] + hb[j]) return false;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
      const ra = ha[i1] * AR[i2][j] + ha[i2] * AR[i1][j], rb = hb[j1] * AR[i][j2] + hb[j2] * AR[i][j1];
      if (Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]) > ra + rb) return false;
    }
    return true;
  }
  class Grid {
    constructor(cell) { this.s = cell; this.m = new Map(); }
    keys(b) { const s = this.s, k = [];
      const x0 = Math.floor(b[0] / s), x1 = Math.floor(b[3] / s), y0 = Math.floor(b[1] / s), y1 = Math.floor(b[4] / s), z0 = Math.floor(b[2] / s), z1 = Math.floor(b[5] / s);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 20000) return null;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) k.push(x + ',' + y + ',' + z);
      return k; }
    add(b, v) { const ks = this.keys(b); if (!ks) { (this.big || (this.big = [])).push(v); return; } for (const k of ks) { let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(v); } }
    query(b) { const out = new Set(this.big || []); const ks = this.keys(b); if (!ks) { for (const a of this.m.values()) a.forEach(v => out.add(v)); return out; }
      for (const k of ks) { const a = this.m.get(k); if (a) a.forEach(v => out.add(v)); } return out; }
  }
  function segHitsMesh(p, q, t, box) {
    if (!t) return false;
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    for (let i = 0; i < t.length; i += 9) {
      const ax = t[i], ay = t[i + 1], az = t[i + 2], bx = t[i + 3], by = t[i + 4], bz = t[i + 5], cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
      if (Math.max(ax, bx, cx) < box[0] || Math.min(ax, bx, cx) > box[3] || Math.max(ay, by, cy) < box[1] || Math.min(ay, by, cy) > box[4] || Math.max(az, bz, cz) < box[2] || Math.min(az, bz, cz) > box[5]) continue;
      const e1 = [bx - ax, by - ay, bz - az], e2 = [cx - ax, cy - ay, cz - az], h = cross(d, e2), det = dot(e1, h);
      if (Math.abs(det) < 1e-14) continue;
      const f = 1 / det, s = [p[0] - ax, p[1] - ay, p[2] - az], u = f * dot(s, h); if (u < 0 || u > 1) continue;
      const qv = cross(s, e1), v = f * dot(d, qv); if (v < 0 || u + v > 1) continue;
      const tt = f * dot(e2, qv); if (tt >= 0 && tt <= 1) return true;
    }
    return false;
  }
  const expand = (b, e) => [b[0] - e, b[1] - e, b[2] - e, b[3] + e, b[4] + e, b[5] + e];

  function analyzeWork(data, R, S) {
    const tol = Math.max(0.0005, (S.contactTol ?? 3) / 1000);
    if (!data.obb) data.obb = new Map();
    const obb = id => { if (!data.obb.has(id)) { const t = data.meshes.get(id); data.obb.set(id, t ? obbOf(t) : null); } return data.obb.get(id); };
    const parts = R.rows.filter(r => obb(r.id));
    const plates = parts.filter(r => r.kind === 'plate'), profs = parts.filter(r => r.kind !== 'plate');
    const gProf = new Grid(2), gPl = new Grid(2), gAll = new Grid(2);
    for (const r of profs) { gProf.add(expand(obb(r.id).aabb, tol), r); gAll.add(expand(obb(r.id).aabb, tol), r); }
    for (const r of plates) { gPl.add(expand(obb(r.id).aabb, tol), r); gAll.add(expand(obb(r.id).aabb, tol), r); }
    // bulloni: quali pezzi attraversa ciascun bullone
    const boltPairs = new Set(); let boltsGeo = 0;
    const pk = (a, b) => a < b ? a + ':' + b : b + ':' + a;
    const useBolts = !S.crit || S.crit.bolts !== 'ignore';
    for (const f of (useBolts ? data.fasteners : [])) {
      const o = obb(f.id); if (!o) continue; boltsGeo++;
      const a = o.u[0], p0 = [o.c[0] - a[0] * o.h[0], o.c[1] - a[1] * o.h[0], o.c[2] - a[2] * o.h[0]], p1 = [o.c[0] + a[0] * o.h[0], o.c[1] + a[1] * o.h[0], o.c[2] + a[2] * o.h[0]];
      // per le piastre basta il riquadro; per i profili il gambo deve attraversare davvero il materiale
      const hit = [...gAll.query(expand(o.aabb, tol))].filter(r => obbTouch(o, obb(r.id), tol) && (r.kind === 'plate' || segHitsMesh(p0, p1, data.meshes.get(r.id), o.aabb)));
      for (let i = 0; i < hit.length; i++) for (let j = i + 1; j < hit.length; j++) boltPairs.add(pk(hit[i].id, hit[j].id));
    }
    const bolted = (a, b) => boltPairs.has(pk(a.id, b.id));
    const kgmOf = r => r.kgm || (r.w && r.lengthM ? r.w / r.lengthM : 0);
    // archi saldati
    const adj = new Map(); const addW = (a, b) => { (adj.get(a.id) || adj.set(a.id, []).get(a.id)).push(b.id); (adj.get(b.id) || adj.set(b.id, []).get(b.id)).push(a.id); };
    const why = new Map(); const st = { endPlate: 0, single: 0, heaviest: 0, splice: 0, boltedOnly: 0, plPl: 0, isolated: 0, byBolts: 0 };
    const spliceSet = new Set();
    // criteri scelti dall'utente (C) e risposte per singolo tipo di caso (ans)
    const C = { bolts: 'use', end: 'y', one: 'y', multi: 'heavy', splice: 'n', pp: 'y', prpr: 'n', main: 'off', anchor: 'n', ...(S.crit || {}) };
    const ans = S.weldAns || {}, types = new Map();
    const IT = { COLUMN: 'colonna', BEAM: 'trave', MEMBER: 'asta', BUILDINGELEMENTPROXY: 'elemento generico', PLATE: 'piastra', BUILDINGELEMENTPART: 'parte', DISCRETEACCESSORY: 'accessorio', RAILING: 'parapetto', STAIRFLIGHT: 'rampa' };
    const sizeBand = o => { const m = 2 * o.h[0] * 1000; return m <= 300 ? 's' : m <= 1000 ? 'm' : 'l'; };
    const SIZE = { s: 'fino a 300 mm', m: 'da 300 a 1000 mm', l: 'oltre 1 m' };
    const fam = r => { const f = (r.profile.match(/^[A-ZØ]+/) || [''])[0]; return /^HE[ABM]/.test(r.profile) ? r.profile.slice(0, 3) : (f || 'n.d.'); };
    const anchorish = r => KW.anchor.test([r.name, r.objectType, r.description, r.profile, ...r.ancNames].join(' ')) || r.profCls === 'ROUND' || /^(D|Ø|TONDO|RD|M)\d/.test(r.profile);
    const what = r => `${IT[r.ifcType] || r.ifcType.toLowerCase()} ${fam(r)}`;
    // def: true / false / 'ask'
    const decide = (key, group, label, def, ex, w) => {
      let t = types.get(key);
      if (!t) types.set(key, t = { key, group, label, n: 0, w: 0, ex, yes: 0, pending: false });
      const a = ans[key];
      const v = a === 'y' ? true : a === 'n' ? false : def === true;
      t.n++; t.w += w || 0; if (v) t.yes++; t.ans = a || null; if (!a && def === 'ask') t.pending = true; t.rule = def;
      return { v, src: a ? 'tua risposta' : def === 'ask' ? 'da decidere' : 'criterio' };
    };
    const yn = v => v === 'ask' ? 'ask' : v === 'y';
    for (const p of plates) {
      const P = obb(p.id), band = sizeBand(P);
      const touch = [...gProf.query(expand(P.aabb, tol))].filter(r => obbTouch(P, obb(r.id), tol));
      if (!touch.length) { why.set(p.id, 'piastra non a contatto con profili'); continue; }
      if (touch.length >= 2) {
        const a0 = obb(touch[0].id).u[0];
        const par = touch.every(r => Math.abs(dot(obb(r.id).u[0], a0)) > 0.995);
        const coax = par && touch.every(r => { const o = obb(r.id), d = [o.c[0] - obb(touch[0].id).c[0], o.c[1] - obb(touch[0].id).c[1], o.c[2] - obb(touch[0].id).c[2]];
          return norm3(cross(d, a0)) < Math.max(o.h[1], 0.05); });
        if (coax && Math.abs(dot(P.u[2], a0)) < 0.3) {
          const d = decide(`splice|${fam(touch[0])}|${band}`, 'splice', `Coprigiunto tra due ${fam(touch[0])} allineati, piastra ${SIZE[band]}`, yn(C.splice), [p.id, ...touch.map(r => r.id)], p.w);
          if (d.v) { touch.forEach(r => addW(p, r)); why.set(p.id, `coprigiunto saldato (${d.src})`); }
          else { spliceSet.add(p.id); st.splice++; why.set(p.id, `coprigiunto sciolto (${d.src})`); }
          continue;
        }
      }
      const free = touch.filter(r => !bolted(p, r));
      if (touch.length > free.length) st.byBolts++;
      if (!free.length) { st.boltedOnly++; why.set(p.id, 'bullonata a tutti i profili che tocca'); continue; }
      const isEnd = r => { const o = obb(r.id), a = o.u[0]; if (Math.abs(dot(P.u[2], a)) < 0.95) return false;
        return Math.abs(dot([P.c[0] - o.c[0], P.c[1] - o.c[1], P.c[2] - o.c[2]], a)) > o.h[0] - Math.max(0.06, 2 * P.h[2]); };
      const cands = free.map(r => ({ r, end: isEnd(r), anc: anchorish(r) }))
        .sort((a, b) => (a.anc - b.anc) || (b.end - a.end) || (kgmOf(b.r) - kgmOf(a.r)));
      let blocked = false; const how = [];
      for (const c of cands) {
        const role = c.anc ? 'anc' : c.end ? 'end' : (free.length === 1 ? 'one' : 'multi');
        const second = blocked || how.length > 0;
        let def, label;
        if (role === 'anc') { def = yn(C.anchor); label = `Piastra su tirafondo o tondo ${fam(c.r)}`; }
        else if (role === 'end') { def = second ? false : yn(C.end); label = `Piastra di testa o di base su ${what(c.r)}, piastra ${SIZE[band]}`; }
        else if (role === 'one') { def = second ? false : yn(C.one); label = `Piastra su un solo profilo (costola, fazzoletto, squadretta) su ${what(c.r)}, piastra ${SIZE[band]}`; }
        else { def = second ? false : (C.multi === 'heavy' ? true : C.multi === 'ask' ? 'ask' : false); label = `Piastra che tocca più profili, verso ${what(c.r)} (il più pesante), piastra ${SIZE[band]}`; }
        if (second && role !== 'anc') label = `Piastra che tocca più profili, già saldata a un altro: anche a ${what(c.r)}?`;
        const key = `${role}|${c.r.ifcType}|${fam(c.r)}|${role === 'anc' ? '' : band}|${second && role !== 'anc' ? 2 : 1}`;
        const d = decide(key, second && role !== 'anc' ? 'second' : role, label, def, [p.id, c.r.id], p.w);
        if (d.src === 'da decidere') blocked = true;
        if (d.v) { addW(p, c.r); how.push(`${c.end ? 'piastra di testa o di base' : 'saldata'} a ${c.r.profile || c.r.name} (${d.src})`);
          if (d.src === 'criterio') { if (c.end) st.endPlate++; else if (free.length === 1) st.single++; else st.heaviest++; } }
      }
      why.set(p.id, how.length ? how.join('; ') : (blocked ? 'da decidere: nessuna saldatura finché non rispondi' : 'non saldata ai profili che tocca'));
    }
    // piastra contro piastra senza bulloni
    for (const p of plates) {
      if (spliceSet.has(p.id)) continue; const P = obb(p.id);
      for (const q of gPl.query(expand(P.aabb, tol))) {
        if (q.id <= p.id || spliceSet.has(q.id) || bolted(p, q) || !obbTouch(P, obb(q.id), tol)) continue;
        const Q = obb(q.id), small = P.h[0] <= Q.h[0] ? P : Q, band = sizeBand(small);
        const d = decide(`pp|${band}`, 'pp', `Piastra contro un’altra piastra (la più piccola ${SIZE[band]})`, yn(C.pp), [p.id, q.id], Math.min(p.w || 0, q.w || 0));
        if (d.v) { addW(p, q); st.plPl++; for (const x of [p, q]) if (!why.has(x.id) || /^(piastra non a contatto|non saldata|da decidere)/.test(why.get(x.id))) why.set(x.id, `saldata a un’altra piastra (${d.src})`); }
      }
    }
    // profilo contro profilo (diretto, senza bulloni)
    if (C.prpr !== 'n') {
      for (const p of profs) {
        if (anchorish(p)) continue; const P = obb(p.id);
        for (const q of gProf.query(expand(P.aabb, tol))) {
          if (q.id <= p.id || anchorish(q) || bolted(p, q) || !obbTouch(P, obb(q.id), tol)) continue;
          const [a, b] = [p, q].sort((x, y) => kgmOf(y) - kgmOf(x));
          const d = decide(`prpr|${a.ifcType}|${fam(a)}|${b.ifcType}|${fam(b)}`, 'prpr', `${what(b)[0].toUpperCase() + what(b).slice(1)} a contatto diretto con ${what(a)}`, yn(C.prpr), [b.id, a.id], b.w);
          if (d.v) addW(p, q);
        }
      }
    }
    // scelte manuali: un pezzo forzato in taglio e foratura perde le sue saldature
    const forced = S.forced || {};
    for (const k in forced) if (forced[k] === 'tf') { const id = +k; for (const y of adj.get(id) || []) { const l = adj.get(y); if (l) adj.set(y, l.filter(x => x !== id)); } adj.delete(id); }
    // componenti connesse = assemblati
    const byId = new Map(R.rows.map(r => [r.id, r])), comp = new Map(); let nc = 0;
    for (const r of R.rows) {
      if (comp.has(r.id)) continue;
      const stack = [r.id], members = []; comp.set(r.id, nc);
      while (stack.length) { const x = stack.pop(); members.push(x); for (const y of adj.get(x) || []) if (!comp.has(y)) { comp.set(y, nc); stack.push(y); } }
      nc++;
    }
    const groups = new Map();
    for (const r of R.rows) { const c = comp.get(r.id); (groups.get(c) || groups.set(c, []).get(c)).push(r); }
    const of = new Map(), assemblies = [];
    for (const [c, rs] of groups) {
      const welded = rs.length > 1 ? true : forced[rs[0].id] ? forced[rs[0].id] === 'off' : rs[0].kind === 'weld';
      if (welded) {
        const main = rs.filter(r => r.kind !== 'plate').sort((a, b) => (b.w || 0) - (a.w || 0))[0] || rs.slice().sort((a, b) => (b.w || 0) - (a.w || 0))[0];
        const a = { idx: assemblies.length + 1, main, name: (main.profile || main.name || 'Assemblato') + (main.tag ? ' ' + main.tag : ''), parts: rs,
          w: rs.reduce((s, r) => s + (r.w || 0), 0), wProf: rs.filter(r => r.kind !== 'plate').reduce((s, r) => s + (r.w || 0), 0),
          wPl: rs.filter(r => r.kind === 'plate').reduce((s, r) => s + (r.w || 0), 0), nPl: rs.filter(r => r.kind === 'plate').length };
        assemblies.push(a);
        const mainTf = S.crit && S.crit.main === 'tf' && rs.length > 1 && a.main.kind !== 'weld';
        for (const r of rs) of.set(r.id, { lav: mainTf && r === a.main ? 'tf' : 'off', asm: a, why: r.kind === 'plate' ? (why.get(r.id) || '') : (mainTf && r === a.main ? 'profilo principale: per i tuoi criteri in officina vanno solo i pezzi saldati' : rs.length > 1 ? (r === a.main ? 'profilo principale con pezzi saldati' : 'profilo saldato al principale') : 'profilo composto saldato') });
      } else for (const r of rs) {
        of.set(r.id, { lav: 'tf', asm: null, why: r.kind === 'plate' ? (why.get(r.id) || (obb(r.id) ? 'piastra sciolta' : 'geometria non disponibile')) : 'profilo senza piastre saldate' });
        if (r.kind !== 'plate') st.isolated++;
      }
    }
    let nMan = 0;
    for (const k in forced) { const o = of.get(+k); if (!o) continue; o.lav = forced[k]; o.manual = true; o.why = 'scelta manuale: ' + (forced[k] === 'off' ? 'officina' : 'taglio e foratura'); nMan++; }
    st.manual = nMan;
    assemblies.sort((a, b) => b.w - a.w); assemblies.forEach((a, i) => a.idx = i + 1);
    const T = { tf: { prof: 0, pl: 0, nProf: 0, nPl: 0, cats: {} }, off: { prof: 0, pl: 0, nProf: 0, nPl: 0, cats: {} } };
    for (const r of R.rows) {
      const t = T[of.get(r.id).lav], w = r.w || 0;
      if (r.kind === 'plate') { t.pl += w; t.nPl++; } else { t.prof += w; t.nProf++; }
      t.cats[r.cat] = (t.cats[r.cat] || 0) + w;
    }
    for (const k of ['tf', 'off']) T[k].w = T[k].prof + T[k].pl;
    st.boltsGeo = boltsGeo; st.boltPairs = boltPairs.size; st.noGeo = R.rows.length - parts.length;
    return { of, assemblies, totals: T, stats: st, types: [...types.values()].sort((a, b) => b.n - a.n) };
  }

  return { Model, extract, checkUnits, compute, analyzeSpecial, analyzeWork, catalogKgm, normName, DEFAULTS, CATS, SPECIAL, EXCLUSIVE, median };
})();



if (typeof module !== 'undefined') module.exports = IFC;
