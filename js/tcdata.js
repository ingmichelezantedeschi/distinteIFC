/* ======================================================================
   Lettura degli oggetti dal visualizzatore 3D di Trimble Connect
   (Workspace API: getObjects, getObjectProperties, getObjectBoundingBoxes,
   convertToObjectIds) e preparazione dei record per il calcolo.
   ====================================================================== */
const TCData = (() => {
  'use strict';
  const KEEP = new Set(['BEAM', 'COLUMN', 'MEMBER', 'PLATE', 'BUILDINGELEMENTPART', 'DISCRETEACCESSORY', 'BUILDINGELEMENTPROXY',
    'RAILING', 'STAIR', 'STAIRFLIGHT', 'RAMP', 'RAMPFLIGHT', 'MECHANICALFASTENER', 'FASTENER']);
  const FAST_RE = /\b(ECROU|ÉCROU|RONDELLE|BOULON|VIS|NUT|NUTS|WASHER|BOLT|BOLTS|DADO|ROSETTA|BULLON[EI]|GOUJON|STUD|SCREW|CONTRE-?ECROU)\b/i;
  const PT = { LEN: 0, AREA: 1, VOL: 2, MASS: 3 };
  const norm = s => String(s ?? '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
  const KEYS = {
    profile: ['profile', 'profilo', 'profil', 'profile name', 'profilename', 'nome profilo', 'section', 'section name', 'sectionname', 'sezione', 'cross section', 'crosssection'],
    weight: ['net weight', 'netweight', 'weight', 'peso netto', 'peso', 'poids net', 'poids', 'net mass', 'mass', 'massa', 'masse', 'gross weight', 'grossweight', 'peso lordo', 'poids brut'],
    volume: ['net volume', 'netvolume', 'volume', 'volume netto', 'gross volume', 'grossvolume'],
    length: ['length', 'lunghezza', 'longueur', 'net length', 'netlength', 'cut length', 'cutlength'],
    material: ['material', 'materiale', 'matériau', 'materiau', 'grade', 'steel grade', 'nuance', 'material name'],
    tag: ['part mark', 'partmark', 'part pos', 'piece mark', 'tag', 'position', 'marca', 'repère', 'repere'],
    asm: ['assembly mark', 'assemblymark', 'assembly pos', 'assembly/cast unit mark', 'cast unit mark', 'marca assieme', 'repère assemblage'],
    thick: ['thickness', 'spessore', 'épaisseur', 'epaisseur', 'plate thickness'],
    count: ['number of bolts', 'bolt count', 'numero bulloni', 'nombre', 'quantity', 'count'],
  };
  const tick = () => new Promise(r => setTimeout(r, 0));

  function normType(cls) {
    return String(cls || '').toUpperCase().replace(/^IFC/, '').replace(/STANDARDCASE$/, '');
  }
  function flatten(op) {
    const out = [];
    for (const ps of op.properties || []) for (const p of ps.properties || []) out.push({ ps: String(ps.name || ''), name: norm(p.name), v: p.value, t: p.type });
    return out;
  }
  function pick(props, keys, pred) {
    for (const k of keys) { const p = props.find(x => x.name === k && x.v !== null && x.v !== undefined && x.v !== '' && (!pred || pred(x))); if (p) return p; }
    return null;
  }
  const isNum = p => typeof p.v === 'number' ? p.v > 0 : (typeof p.v === 'string' && /^\s*[\d.,]+\s*$/.test(p.v) && parseFloat(p.v.replace(',', '.')) > 0);
  const numOf = p => typeof p.v === 'number' ? p.v : parseFloat(String(p.v).replace(',', '.'));
  const isTxt = p => typeof p.v === 'string' && p.v.trim() !== '';

  // dimensioni della sezione dai gruppi di proprietà "…Profile…" (valori in mm se di tipo lunghezza)
  function profileDims(props) {
    const pp = props.filter(p => /profile/i.test(p.ps) && typeof p.v === 'number');
    if (!pp.length) return null;
    const g = {}; for (const p of pp) if (!(p.name in g)) g[p.name] = p.v;
    const psName = (pp[0].ps || '').toUpperCase();
    const n = k => g[k] || null;
    let area = null, type = '', cls = '', dims = {};
    if (n('overallwidth') && n('overalldepth') && n('webthickness') && n('flangethickness')) {
      const b = n('overallwidth'), h = n('overalldepth'), tw = n('webthickness'), tf = n('flangethickness'), r = n('filletradius') || 0;
      area = 2 * b * tf + (h - 2 * tf) * tw + (4 - Math.PI) * r * r; type = /ASYMMETRIC/.test(psName) ? 'IFCASYMMETRICISHAPEPROFILEDEF' : 'IFCISHAPEPROFILEDEF'; cls = 'I'; dims = { h, b, tw, tf };
    } else if (n('xdim') && n('ydim')) {
      const x = n('xdim'), y = n('ydim'), t = n('wallthickness');
      if (t) { area = 2 * t * (x + y - 2 * t); type = 'IFCRECTANGLEHOLLOWPROFILEDEF'; cls = 'RHS'; dims = { x, y, t }; }
      else { area = x * y; type = 'IFCRECTANGLEPROFILEDEF'; cls = 'RECT'; dims = { x, y }; }
    } else if (n('radius')) {
      const r = n('radius'), t = n('wallthickness');
      if (t) { area = Math.PI * (r * r - (r - t) * (r - t)); type = 'IFCCIRCLEHOLLOWPROFILEDEF'; cls = 'CHS'; dims = { d: 2 * r, t }; }
      else { area = Math.PI * r * r; type = 'IFCCIRCLEPROFILEDEF'; cls = 'ROUND'; dims = { d: 2 * r }; }
    } else if (n('depth') && n('flangewidth') && n('webthickness') && n('flangethickness')) {
      const h = n('depth'), b = n('flangewidth'), tw = n('webthickness'), tf = n('flangethickness');
      if (/T ?SHAPE/.test(psName)) { area = b * tf + (h - tf) * tw; type = 'IFCTSHAPEPROFILEDEF'; cls = 'T'; }
      else { area = 2 * b * tf + (h - 2 * tf) * tw; type = 'IFCUSHAPEPROFILEDEF'; cls = 'U'; }
      dims = { h, b, tw };
    } else if (n('depth') && n('thickness')) {
      const d = n('depth'), w = n('width') || d, t = n('thickness'); area = t * (d + w - t); type = 'IFCLSHAPEPROFILEDEF'; cls = 'L'; dims = { h: d, b: w, t };
    }
    return area ? { areaM2: area / 1e6, type, cls, dims } : null;
  }

  function lengthM(p) { const v = numOf(p); return p.t === PT.LEN ? v / 1000 : (v > 50 ? v / 1000 : v); }
  function volM3(p) { const v = numOf(p); return p.t === PT.VOL ? v : (v > 100 ? v / 1e9 : v); }

  function record(modelId, op) {
    const props = flatten(op), prod = op.product || {};
    const ifcType = normType(op.class) || 'OBJECT';
    const rec = {
      id: modelId + ':' + op.id, rid: op.id, modelId, guid: '', ifcType,
      name: String(prod.name || ''), objectType: String(prod.objectType || ''), description: String(prod.description || ''),
      ancTypes: [], ancNames: [], parentId: null, curved: false, tapered: false, incl: null, azim: null,
    };
    const tg = pick(props, KEYS.tag, isTxt), am = pick(props, KEYS.asm, isTxt);
    rec.tag = tg ? String(tg.v) : ''; rec.assembly = am ? String(am.v) : ''; rec.asmName = rec.assembly; rec.asmId = rec.assembly || null;
    // profilo
    const cands = [];
    const pp = pick(props, KEYS.profile, isTxt); if (pp) cands.push([pp.v, 'proprietà ' + pp.ps]);
    if (rec.objectType) cands.push([rec.objectType.split(':').pop(), 'ObjectType']);
    if (rec.name) cands.push([rec.name, 'nome']);
    let pname = '', psrc = '';
    for (const [c, s] of cands) if (/\d/.test(c) && String(c).trim().length <= 60) { pname = String(c); psrc = s; break; }
    rec.profile = pname ? IFC.normName(pname) : ''; rec.profileSrc = psrc;
    const pd = profileDims(props);
    rec.areaM2 = pd ? pd.areaM2 : null; rec.profType = pd ? pd.type : ''; rec.profCls = pd ? pd.cls : '';
    const mp = pick(props, KEYS.material, isTxt); rec.material = mp ? String(mp.v).trim() : '';
    const lp = pick(props, KEYS.length, isNum); rec.lengthProp = lp ? lengthM(lp) : null; rec.lengthGeo = null;
    const wp = pick(props, KEYS.weight, isNum); rec.weightDecl = wp ? numOf(wp) : null; rec.weightKey = wp ? wp.ps + '.' + wp.name : '';
    const vp = pick(props, KEYS.volume, isNum); rec.volDecl = vp ? volM3(vp) : null; rec.volGeo = null;
    // spessore piatti
    let th = null;
    const m1 = /^(?:PLT?|FLT?|BPL|BL|PIATTO|LAMIERA|PLATE|FLAT|TOLE|TÔLE|PLAT|PL\.)\s*-?\s*(\d+(?:[.,]\d+)?)/i.exec(rec.profile);
    if (m1) th = parseFloat(m1[1].replace(',', '.'));
    else { const tp = pick(props, KEYS.thick, isNum); if (tp) th = tp.t === PT.LEN || numOf(tp) > 1 ? numOf(tp) : numOf(tp) * 1000; }
    rec.thicknessMm = th;
    const cp = pick(props, KEYS.count, isNum); rec.countProp = cp ? Math.round(numOf(cp)) : null;
    rec.isFastener = ifcType === 'MECHANICALFASTENER' || ifcType === 'FASTENER' ||
      ((ifcType === 'DISCRETEACCESSORY' || ifcType === 'BUILDINGELEMENTPROXY') && FAST_RE.test([rec.name, rec.objectType, rec.profile, rec.description].join(' ')));
    return rec;
  }

  async function batched(list, size, fn, onStep) {
    const out = [];
    for (let i = 0; i < list.length; i += size) { out.push(...(await fn(list.slice(i, i + size)) || [])); onStep && onStep(Math.min(1, (i + size) / list.length)); await tick(); }
    return out;
  }
  async function guidsFor(api, modelId, rids) {
    const res = new Array(rids.length).fill('');
    const go = async (lo, hi) => {
      try { const g = await api.viewer.convertToObjectIds(modelId, rids.slice(lo, hi)); for (let i = 0; i < g.length; i++) res[lo + i] = g[i] || ''; }
      catch (e) { if (hi - lo <= 1) return; const mid = (lo + hi) >> 1; await go(lo, mid); await go(mid, hi); }
    };
    for (let i = 0; i < rids.length; i += 2000) await go(i, Math.min(rids.length, i + 2000));
    return res;
  }

  /** Carica tutti gli oggetti di carpenteria dei modelli caricati. */
  async function load(api, onProgress) {
    const P = (v, msg) => onProgress && onProgress(v, msg);
    P(0, 'Elenco dei modelli…');
    let models = [];
    try { models = await api.viewer.getModels('loaded'); } catch (e) {}
    const objs = await api.viewer.getObjects();
    const work = (objs || []).filter(m => m.objects && m.objects.length);
    const total = work.reduce((s, m) => s + m.objects.length, 0);
    if (!total) return { elements: [], fasteners: [], meshes: new Map(), units: { labels: {} }, models, schema: '', modelIds: [] };
    const elements = [], fasteners = [];
    let done = 0;
    for (const m of work) {
      const pre = m.objects.filter(o => !o.class || KEEP.has(normType(o.class)));
      const ids = pre.map(o => o.id);
      const props = await batched(ids, 400, b => api.viewer.getObjectProperties(m.modelId, b), f => P(0.05 + 0.7 * (done + f * ids.length) / total, `Lettura delle proprietà: ${Math.round((done + f * ids.length))} di ${total} oggetti…`));
      done += m.objects.length;
      const recs = [];
      for (const op of props) {
        if (!op) continue;
        const t = normType(op.class);
        if (t && !KEEP.has(t)) continue;
        const r = record(m.modelId, op);
        if (!t && !r.profile && !r.weightDecl) continue;
        recs.push(r);
      }
      // riquadri (metri): spessore e lunghezza di riserva, contatti
      P(0.78, 'Lettura degli ingombri…');
      try {
        const bbs = await batched(recs.map(r => r.rid), 1000, b => api.viewer.getObjectBoundingBoxes(m.modelId, b));
        const byRid = new Map(bbs.map(b => [b.id, b.boundingBox]));
        for (const r of recs) { const b = byRid.get(r.rid); if (!b) continue;
          r.bbox = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
          const ext = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].sort((a, c) => c - a);
          r.lengthGeo = ext[0];
          if (r.thicknessMm == null && (r.ifcType === 'PLATE' || /^PL/i.test(r.profile)) && ext[2] > 0) r.thicknessMm = Math.round(ext[2] * 10000) / 10;
        }
      } catch (e) { console.warn('Ingombri non disponibili', e); }
      P(0.88, 'Lettura degli identificativi IFC…');
      const g = await guidsFor(api, m.modelId, recs.map(r => r.rid));
      recs.forEach((r, i) => r.guid = g[i]);
      for (const r of recs) {
        if (r.thicknessMm != null) r.thicknessMm = Math.round(r.thicknessMm * 10) / 10;
        if (r.isFastener) {
          let label = r.name || r.objectType || 'Bulloneria';
          if (r.profile && r.profile !== IFC.normName(label)) label += ' ' + r.profile;
          r.fastLabel = label.trim(); r.fastCount = r.countProp || 1; fasteners.push(r);
        } else elements.push(r);
      }
    }
    // stima del peso dove mancano peso e volume: sezione (o catalogo) × lunghezza
    for (const r of elements) {
      if (r.weightDecl || r.volDecl) continue;
      const L = r.lengthProp || r.lengthGeo; if (!L) continue;
      const c = IFC.catalogKgm(r.profile);
      const a = r.areaM2 || (c ? c.kgm / 7850 : null);
      if (a && r.ifcType !== 'PLATE') r.volGeo = a * L;
    }
    P(1, '');
    const names = new Map(models.map(m => [m.id, m.name]).concat(models.map(m => [m.versionId, m.name])));
    return { elements, fasteners, meshes: new Map(), units: { labels: {} }, models, modelNames: work.map(m => names.get(m.modelId) || m.modelId), modelIds: work.map(m => m.modelId), schema: '' };
  }

  /** Espande la selezione: se sono selezionati degli assiemi, prende le parti. */
  async function expandSelection(api, selection, index) {
    const out = [];
    for (const s of selection || []) {
      const rids = s.objectRuntimeIds || [];
      const missing = [];
      for (const rid of rids) { const r = index.get(s.modelId + ':' + rid); if (r) out.push(r); else missing.push(rid); }
      if (missing.length && api.viewer.getHierarchyChildren) {
        for (const type of [4, undefined]) {
          try {
            const ch = await api.viewer.getHierarchyChildren(s.modelId, missing, type, true);
            const found = (ch || []).map(c => index.get(s.modelId + ':' + c.id)).filter(Boolean);
            if (found.length) { out.push(...found); break; }
          } catch (e) {}
        }
      }
    }
    return [...new Map(out.map(r => [r.id, r])).values()];
  }

  /** Raggruppa i record per modello nel formato ObjectSelector della Workspace API. */
  function selector(recs) {
    const by = new Map();
    for (const r of recs) { let a = by.get(r.modelId); if (!a) by.set(r.modelId, a = []); a.push(r.rid); }
    return { modelObjectIds: [...by].map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) };
  }

  return { load, expandSelection, selector, normType };
})();
