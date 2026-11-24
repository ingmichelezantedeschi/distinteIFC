(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const nf = d => { try { return new Intl.NumberFormat('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' }); } catch (e) { return new Intl.NumberFormat('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }); } };
  const F0 = nf(0), F1 = nf(1), F2 = nf(2);
  const f0 = v => v == null || !isFinite(v) ? '–' : F0.format(v);
  const f1 = v => v == null || !isFinite(v) ? '–' : F1.format(v);
  const f2 = v => v == null || !isFinite(v) ? '–' : F2.format(v);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  const CATCOL = { light: '#93AECB', heavy: '#3D6995', vheavy: '#14314E', weld: '#86475A', plate: '#B5862A', nd: '#A3A8A3' };
  const CATLABEL = Object.fromEntries(IFC.CATS.map(c => [c.k, c.label]));
  const CATORDER = ['light', 'heavy', 'vheavy', 'weld', 'plate', 'nd'];
  const GCOL = { A: '#D2552D', S: '#3A87C8', O: '#7E57A8', U: '#AEB4BA' };
  const GLABEL = { A: 'Assemblati', S: 'Sciolti', O: 'Scale/altro', U: 'Da assegnare' };
  const GK = ['A', 'S', 'O', 'U'], GSHORT = { A: 'Assem.', S: 'Sciolti', O: 'Scale/altro', U: 'Da ass.' };
  const totW = T => GK.reduce((s, g) => s + T[g].w, 0);

  let API = null, PROJECT = { id: 'locale', name: '' }, DATA = null, R = null, INDEX = new Map(), W = null;
  let SEL = [], selSeq = 0, colorOn = store.get('tcsteel-color', true), bomView = 'prof', bomQ = '', tab = 'sum';
  let S = { ...IFC.DEFAULTS, excluded: [], unPolicy: 'U', touchTol: 5, ...store.get('tcsteel-settings', {}) };
  let ASSIGN = {}, SAVED_AT = 0, UNDO = [];
  const aKey = () => 'tcsteel-assign|' + PROJECT.id;
  const SAVE = { local: null, localErr: false, proj: null, projErr: '', projBusy: false, projOn: false };
  if (S.hideAfter === undefined) S.hideAfter = true;

  /* ------------------------------------------------------------ stato e avvisi */
  const setStatus = (t, err) => { const s = $('#status'); s.textContent = t || ''; s.classList.toggle('err', !!err); };
  const setProg = v => { const p = $('#prog'); p.style.display = v == null ? 'none' : 'block'; p.firstElementChild.style.width = ((v || 0) * 100).toFixed(1) + '%'; };
  function banner(id, level, html) {
    let b = document.getElementById('bn-' + id);
    if (!html) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'bn-' + id; $('#banners').appendChild(b); }
    b.className = 'banner ' + level; b.innerHTML = html;
  }

  /* ------------------------------------------------------------ collegamento */
  async function init() {
    if (window.parent === window || typeof TrimbleConnectWorkspace === 'undefined') {
      $('#modelInfo').textContent = '';
      $('#notin').classList.remove('hidden');
      if (typeof TrimbleConnectWorkspace === 'undefined') setStatus('La libreria di Trimble Connect non si è caricata.', true);
      return;
    }
    try {
      API = await TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000);
    } catch (e) {
      $('#modelInfo').textContent = '';
      $('#notin').classList.remove('hidden');
      setStatus('Collegamento a Trimble Connect non riuscito: ' + (e && e.message || e), true);
      return;
    }
    try { const p = await API.project.getProject(); if (p && p.id) PROJECT = p; } catch (e) {}
    loadLocal();
    $('#reloadBtn').disabled = false;
    await loadData();
    projConnect(false);
  }
  function onEvent(event, args) {
    if (event === 'viewer.onSelectionChanged') onSelection(args && args.data, !!(args && args.origin && args.origin.isSelf));
    else if (event === 'extension.accessToken') ProjStore.setToken(args && args.data);
    else if (event === 'viewer.onModelStateChanged') banner('stale', 'warn', 'I modelli caricati sono cambiati. <button class="btn sm" id="bnReload">Aggiorna la distinta</button>'), setTimeout(() => { const b = $('#bnReload'); if (b) b.onclick = loadData; });
    else if (event === 'viewer.onModelReset') { if (colorOn) setTimeout(colorAll, 500); }
  }
  $('#reloadBtn').addEventListener('click', () => loadData());

  async function loadData() {
    banner('stale');
    $('#reloadBtn').disabled = true;
    setProg(0); setStatus('Lettura del modello…');
    try {
      const t0 = performance.now();
      const d = await TCData.load(API, (v, msg) => { setProg(v); if (msg) setStatus(msg); });
      setProg(null);
      if (!d.elements.length) {
        $('#main').classList.add('hidden');
        $('#modelInfo').textContent = PROJECT.name || '';
        setStatus('Nessun elemento di carpenteria nei modelli caricati. Carica un modello IFC nel visualizzatore e premi Aggiorna.', true);
        $('#reloadBtn').disabled = false; return;
      }
      IFC.checkUnits(d, S.density);
      DATA = d;
      $('#modelInfo').textContent = (d.modelNames.join(', ') || 'Modello') + (PROJECT.name ? ' · ' + PROJECT.name : '');
      setStatus(`Letti ${f0(d.elements.length)} elementi di carpenteria${d.fasteners.length ? ` e ${f0(d.fasteners.length)} di bulloneria` : ''} in ${F1.format((performance.now() - t0) / 1000)} s.`);
      $('#main').classList.remove('hidden');
      recompute();
      if (colorOn) colorAll();
      try { onSelection(await API.viewer.getSelection()); } catch (e) {}
    } catch (e) {
      console.error(e); setProg(null);
      setStatus('Lettura non riuscita: ' + (e && e.message || e), true);
    }
    $('#reloadBtn').disabled = false;
  }

  /* ------------------------------------------------------------ calcolo */
  const key = r => r.guid || r.id;
  const grpOf = r => ASSIGN[key(r)] || 'U';
  const effOf = r => { const g = grpOf(r); return g === 'U' && S.unPolicy !== 'U' ? S.unPolicy : g; };
  function recompute() {
    R = IFC.compute(DATA, S);
    INDEX = new Map(R.rows.map(r => [r.id, r]));
    computeWork();
    renderAll();
  }
  function computeWork() {
    const z = () => ({ prof: 0, pl: 0, nProf: 0, nPl: 0, w: 0, n: 0, rows: [] });
    const T = { A: z(), S: z(), O: z(), U: z() }, byP = new Map();
    let manual = 0;
    for (const r of R.rows) {
      const g = effOf(r), t = T[g], w = r.w || 0;
      if (grpOf(r) !== 'U') manual++;
      t.rows.push(r); t.n++; t.w += w;
      if (r.kind === 'plate') { t.pl += w; t.nPl++; } else { t.prof += w; t.nProf++; }
      const lbl = r.group ? r.group.label : (r.profile || 'n.d.');
      let p = byP.get(lbl); if (!p) byP.set(lbl, p = { label: lbl, kind: r.kind, A: 0, S: 0, O: 0, U: 0, nA: 0, nS: 0, nO: 0, nU: 0, n: 0, w: 0, group: r.group });
      p[g] += w; p['n' + g]++; p.n++; p.w += w;
    }
    W = { T, byProfile: [...byP.values()].sort((a, b) => b.w - a.w), manual };
  }

  /* ------------------------------------------------------------ rendering */
  const chip = k => `<span class="chip"><i style="background:${CATCOL[k]}"></i>${CATLABEL[k]}</span>`;
  function table(cols, rows, foot, rowAttr) {
    if (!rows.length) return '<div class="empty">Niente da mostrare.</div>';
    return `<table><thead><tr>${cols.map(c => `<th class="${c.r ? 'r' : ''}">${c.h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr ${rowAttr ? rowAttr(r, i) : ''}>${cols.map(c => `<td class="${c.r ? 'r num' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody>
      ${foot ? `<tfoot><tr>${cols.map((c, i) => `<td class="${c.r ? 'r num' : ''}">${foot[i] ?? ''}</td>`).join('')}</tr></tfoot>` : ''}</table>`;
  }
  function renderAll() { renderHead(); renderSum(); renderBom(); renderWork(); renderSel(); renderUndo(); renderSave(); renderKeys(); renderIfcGroups(); }

  function renderHead() {
    $('#totKg').innerHTML = `${f0(R.total)}<small>kg</small>`;
    $('#totT').textContent = `${f2(R.total / 1000)} t`;
    $('#totN').textContent = `${f0(R.rows.length)} elementi`;
    $('#catBar').innerHTML = CATORDER.map(k => R.cats[k].w > 0 ? `<span style="flex:${R.cats[k].w} 1 0;background:${CATCOL[k]}" title="${CATLABEL[k]}"></span>` : '').join('');
    $('#catLeg').innerHTML = CATORDER.filter(k => R.cats[k].n).map(k => `<span><span class="sw" style="background:${CATCOL[k]}"></span>${CATLABEL[k].replace('Profilati ', '').replace('Profili ', '')} ${f1(R.cats[k].w / R.total * 100)} %</span>`).join('');
    const notes = (DATA.unitNotes || []).filter(n => n.level !== 'ok');
    banner('units', notes.some(n => n.level === 'warn') ? 'warn' : 'fix', notes.length ? notes.map(n => `<strong>${n.level === 'fix' ? 'Unità corrette automaticamente.' : 'Da verificare.'}</strong> ${esc(n.text)}`).join('<br>') : '');
  }

  function renderSum() {
    const rows = CATORDER.filter(k => R.cats[k].n);
    $('#catTable').innerHTML = table([
      { h: 'Categoria', f: k => chip(k) },
      { h: 'Elementi', r: 1, f: k => f0(R.cats[k].n) },
      { h: 'Peso (kg)', r: 1, f: k => f0(R.cats[k].w) },
      { h: '%', r: 1, f: k => f1(R.cats[k].w / R.total * 100) }
    ], rows, ['Totale', f0(R.rows.length), f0(R.total), '100,0']);
    const crit = `Leggeri fino a ${f0(R.t1)} kg/m, pesanti fino a ${f0(R.t2)} kg/m, molto pesanti oltre.`;
    const src = Object.entries(R.src).map(([k, n]) => `${f0(n)} con peso da ${esc(k === 'geometria' ? 'sezione × lunghezza' : k)}`).join(', ');
    const noProf = R.rows.filter(r => !r.profile && r.kind !== 'plate').length;
    const dev = R.groups.filter(g => g.dev != null && Math.abs(g.dev) > 0.15).length;
    $('#qa').innerHTML = [crit, src ? src + '.' : '', R.missing ? `<span style="color:var(--warn)">${f0(R.missing)} elementi senza peso: esclusi dal totale.</span>` : 'Tutti gli elementi hanno un peso.',
      noProf ? `${f0(noProf)} elementi senza un nome di profilo riconoscibile.` : '',
      dev ? `${f0(dev)} profili con peso/m diverso di oltre il 15 % dal catalogo.` : '',
      R.boltsN ? `Bulloneria esclusa dal totale: ${f0(R.boltsN)} pezzi${R.boltsW ? `, ${f0(R.boltsW)} kg` : ''}.` : ''].filter(Boolean).map(x => `<div>${x}</div>`).join('');
    if (tab === 'sum') drawCharts(false);
  }

  function renderBom() {
    const q = bomQ.trim().toUpperCase(), d = S.density || 7850;
    let html = '';
    if (bomView === 'prof') {
      const rows = R.groups.filter(g => g.kind !== 'plate' && (!q || g.label.includes(q) || g.family.includes(q))).sort((a, b) => b.w - a.w);
      html = table([
        { h: 'Profilo', f: g => `<strong>${esc(g.label)}</strong><br><span class="hint">${CATLABEL[g.cat].replace('Profilati ', '').replace('Profili ', '')}${g.material ? ' · ' + esc(g.material) : ''}</span>` },
        { h: 'N.', r: 1, f: g => f0(g.n) }, { h: 'kg/m', r: 1, f: g => g.kgm ? f1(g.kgm) : '–' },
        { h: 'm', r: 1, f: g => g.L ? f1(g.L) : '–' }, { h: 'kg', r: 1, f: g => f0(g.w) }
      ], rows, ['Totale', f0(sum(rows, g => g.n)), '', f1(sum(rows, g => g.L)), f0(sum(rows, g => g.w))], (g, i) => `class="click" data-g="${i}"`);
      bindRows(rows);
    } else if (bomView === 'plate') {
      const rows = R.groups.filter(g => g.kind === 'plate' && (!q || g.label.toUpperCase().includes(q))).sort((a, b) => (a.th ?? 1e9) - (b.th ?? 1e9));
      html = table([
        { h: 'Spessore', f: g => `<strong>${esc(g.label)}</strong>${g.material ? `<br><span class="hint">${esc(g.material)}</span>` : ''}` },
        { h: 'N.', r: 1, f: g => f0(g.n) }, { h: 'm²', r: 1, f: g => g.th ? f1(g.w / d / (g.th / 1000)) : '–' }, { h: 'kg', r: 1, f: g => f0(g.w) }
      ], rows, ['Totale', f0(sum(rows, g => g.n)), '', f0(sum(rows, g => g.w))], (g, i) => `class="click" data-g="${i}"`);
      bindRows(rows);
    } else if (bomView === 'fam') {
      const rows = R.families.filter(f => !q || f.family.includes(q));
      html = table([
        { h: 'Famiglia', f: f => `<strong>${esc(f.family)}</strong>${f.kind === 'weld' ? ' <span class="hint">saldati</span>' : ''}` },
        { h: 'Profili', r: 1, f: f => f0(f.p) }, { h: 'N.', r: 1, f: f => f0(f.n) }, { h: 'm', r: 1, f: f => f1(f.L) }, { h: 'kg', r: 1, f: f => f0(f.w) }
      ], rows, ['Totale', f0(sum(rows, f => f.p)), f0(sum(rows, f => f.n)), f1(sum(rows, f => f.L)), f0(sum(rows, f => f.w))]);
    } else {
      html = R.bolts.length ? table([{ h: 'Tipo', f: b => esc(b.label) }, { h: 'Pezzi', r: 1, f: b => f0(b.n) }, { h: 'kg', r: 1, f: b => b.wn ? f1(b.w) : '–' }],
        R.bolts.filter(b => !q || b.label.toUpperCase().includes(q)), ['Totale', f0(R.boltsN), R.boltsW ? f1(R.boltsW) : '–']) + '<p class="hint">La bulloneria non entra nel peso della carpenteria.</p>'
        : '<div class="empty">Nel modello non c’è bulloneria.</div>';
    }
    $('#bomTable').innerHTML = html;
    function bindRows(rows) { setTimeout(() => $('#bomTable').querySelectorAll('tr[data-g]').forEach(tr => tr.addEventListener('click', () => {
      $('#bomTable').querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel')); tr.classList.add('sel');
      selectInModel(rows[+tr.dataset.g].rows, true);
    }))); }
  }
  document.querySelectorAll('#bomSeg button').forEach(b => b.addEventListener('click', () => {
    bomView = b.dataset.v; document.querySelectorAll('#bomSeg button').forEach(x => x.setAttribute('aria-pressed', x === b)); renderBom();
  }));
  $('#bomQ').addEventListener('input', e => { bomQ = e.target.value; renderBom(); });

  function renderWork() {
    try { renderIfcGroups(); } catch (e) {}
    const T = W.T, tot = totW(T) || 1;
    const card = (g, cls) => `<div class="grp ${cls}"><div class="k">${GLABEL[g]}</div><div class="v num">${f0(T[g].w)} kg</div>
      <div class="s num">${f1(T[g].w / tot * 100)} % · ${f0(T[g].n)} el.<br><span class="nb">· </span>profili ${f0(T[g].prof)} kg<br><span class="nb">· </span>piastre ${f0(T[g].pl)} kg</div>
      <div class="acts"><button class="btn" data-gsel="${g}" ${T[g].n ? '' : 'disabled'}>Seleziona</button><button class="btn" data-gonly="${g}" ${T[g].n ? '' : 'disabled'}>Solo questi</button></div></div>`;
    const showU = S.unPolicy === 'U' || T.U.n;
    const shown = GK.filter(g => g !== 'U' || showU);
    $('#groups').style.gridTemplateColumns = `repeat(${shown.length}, 1fr)`;
    $('#groups').innerHTML = shown.map(g => card(g, g.toLowerCase())).join('');
    $('#groups').querySelectorAll('[data-gsel]').forEach(b => b.addEventListener('click', () => selectInModel(T[b.dataset.gsel].rows, false)));
    $('#groups').querySelectorAll('[data-gonly]').forEach(b => b.addEventListener('click', () => showOnly(T[b.dataset.gonly].rows)));
    const rows = W.byProfile;
    $('#workTable').innerHTML = table([
      { h: 'Profilo', f: p => `<strong>${esc(p.label)}</strong>` },
      ...shown.map(g => ({ h: `<span class="sw" style="background:${GCOL[g]}"></span>${GSHORT[g]}`, r: 1, f: p => p[g] ? f0(p[g]) : '–' }))
    ], rows, ['Totale', ...shown.map(g => f0(T[g].w))], (p, i) => `class="click" data-p="${i}"`);
    $('#workTable').insertAdjacentHTML('afterbegin', '<div class="hint" style="margin-bottom:4px">Pesi in kg. Clic su una riga per selezionare il profilo nel modello.</div>');
    $('#workTable').querySelectorAll('tr[data-p]').forEach(tr => tr.addEventListener('click', () => { const p = rows[+tr.dataset.p]; if (p.group) selectInModel(p.group.rows, true); }));
    $('#colorBtn').setAttribute('aria-pressed', colorOn);
    $('#assignInfo').textContent = `${f0(Object.keys(ASSIGN).length)} assegnazioni memorizzate per questo progetto, in questo browser. ${W.manual} riguardano gli elementi caricati.`;
  }

  /* ------------------------------------------------------------ selezione */
  /* selezione multipla: ogni clic nel modello aggiunge (o toglie) l'oggetto */
  let MULTI = false, ownSelUntil = 0;
  const ACC = new Map();
  async function setSel(rows, mode = 'set') {
    ownSelUntil = Date.now() + 900;
    try { await API.viewer.setSelection(TCData.selector(rows), mode); } catch (e) { console.warn(e); }
  }
  async function onSelection(sel, self) {
    const seq = ++selSeq;
    if (!INDEX.size) return;
    const own = self || Date.now() < ownSelUntil;
    const recs = await TCData.expandSelection(API, sel || [], INDEX);
    if (seq !== selSeq) return;
    if (MULTI && !own) {
      if (recs.length) {
        if (recs.length === 1 && ACC.has(recs[0].id)) ACC.delete(recs[0].id); else recs.forEach(r => ACC.set(r.id, r));
      }
      SEL = [...ACC.values()];
      if (SEL.length) setSel(SEL); else if (recs.length) setSel(recs, 'remove');
    } else if (!MULTI) SEL = recs;
    else if (!ACC.size && recs.length) { recs.forEach(r => ACC.set(r.id, r)); SEL = recs; }
    renderSel();
    if (!own) grabKeys();
  }
  $('#multiBtn').addEventListener('click', () => {
    MULTI = !MULTI; $('#multiBtn').setAttribute('aria-pressed', MULTI);
    ACC.clear(); if (MULTI) SEL.forEach(r => ACC.set(r.id, r));
    $('#selMsg').textContent = MULTI ? 'Selezione multipla attiva: ogni clic nel modello aggiunge l’oggetto, un secondo clic sullo stesso lo toglie. «Deseleziona» o Esc per ricominciare.' : 'Selezione multipla disattivata.';
  });
  async function clearSel() {
    const rows = SEL.slice(); ACC.clear(); SEL = []; renderSel();
    if (rows.length) await setSel(rows, 'remove');
  }
  $('#clrSel').addEventListener('click', clearSel);
  $('#showAll2').addEventListener('click', async () => { try { await API.viewer.setObjectState(undefined, { visible: 'reset' }); $('#selMsg').textContent = 'Tutti gli oggetti sono di nuovo visibili.'; } catch (e) {} });

  /* tasti rapidi: dopo un clic nel modello il pannello prende la tastiera */
  if (S.keysOn === undefined) S.keysOn = true;
  $('#keysOn').checked = !!S.keysOn;
  $('#keysOn').addEventListener('change', e => { S.keysOn = e.target.checked; store.set('tcsteel-settings', S); renderKeys(); });
  function grabKeys() {
    if (!S.keysOn) return;
    const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    setTimeout(() => { try { window.focus(); $('#keyTrap').focus({ preventScroll: true }); } catch (e) {} renderKeys(); }, 0);
  }
  function renderKeys() {
    const k = $('#keyState'), on = S.keysOn && document.hasFocus();
    k.classList.toggle('on', on);
    k.textContent = !S.keysOn ? '' : on ? 'Tasti attivi: A S D · Ctrl+Z · Esc' : 'Tasti in attesa: clicca un oggetto nel modello';
    k.classList.toggle('hidden', !S.keysOn);
  }
  addEventListener('focus', renderKeys); addEventListener('blur', renderKeys);
  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || !S.keysOn) return;
    const g = { a: 'A', s: 'S', d: 'O' }[e.key.toLowerCase()];
    if (g) { e.preventDefault(); if (!SEL.length) { $('#selMsg').textContent = 'Seleziona prima un oggetto nel modello.'; return; } assign(g); }
    else if (e.key === 'Escape') { e.preventDefault(); clearSel(); }
  });
  function renderSel() {
    const n = SEL.length, w = sum(SEL, r => r.w);
    ['#toA', '#toS', '#toO', '#toU', '#addTouch', '#addSame'].forEach(id => $(id).disabled = !n);
    if (!n) { $('#selWhat').innerHTML = '<span class="hint">Seleziona nel modello una trave, delle piastre o un intero assieme, poi scegli il gruppo.</span>'; return; }
    const c = { A: 0, S: 0, O: 0, U: 0 }; SEL.forEach(r => c[grpOf(r)]++);
    const pl = SEL.filter(r => r.kind === 'plate').length;
    const what = n === 1 ? `${esc(SEL[0].profile || SEL[0].name || 'Elemento')}${SEL[0].tag ? ' · ' + esc(SEL[0].tag) : ''}` : `${f0(n)} elementi`;
    $('#selWhat').innerHTML = `<strong>${what}</strong>, ${f0(w)} kg<br><span class="hint">${n > 1 ? `${f0(n - pl)} profili, ${f0(pl)} piastre · ` : ''}${GK.filter(g => c[g]).map(g => `${GLABEL[g].toLowerCase()} ${f0(c[g])}`).join(', ')}</span>`;
  }
  async function assign(g) {
    if (!SEL.length) return;
    const rows = SEL.slice(), hide = S.hideAfter && g !== 'U';
    UNDO.push({ g, hide, items: rows.map(r => ({ r, prev: ASSIGN[key(r)] || null })) });
    if (UNDO.length > 100) UNDO.shift();
    for (const r of rows) { if (g === 'U') delete ASSIGN[key(r)]; else ASSIGN[key(r)] = g; }
    changed();
    computeWork(); renderWork(); renderSel(); renderUndo();
    $('#selMsg').textContent = g === 'U' ? `Tolta l’assegnazione a ${f0(SEL.length)} elementi.` : `${f0(SEL.length)} ${SEL.length === 1 ? 'elemento assegnato' : 'elementi assegnati'} al gruppo «${GLABEL[g]}».`;
    if (colorOn) await colorGroups(rows);
    if (hide || MULTI) { ACC.clear(); }
    if (hide) {
      const sel = TCData.selector(rows);
      ownSelUntil = Date.now() + 900;
      try { await API.viewer.setObjectState(sel, { visible: false }); await API.viewer.setSelection(sel, 'remove'); } catch (e) { console.warn(e); }
      SEL = []; renderSel();
      $('#selMsg').textContent += ' Nascosti nel modello: «Mostra tutto» li fa ricomparire, «Annulla» li riporta com’erano.';
    }
  }
  async function undo() {
    const u = UNDO.pop(); if (!u) return;
    for (const it of u.items) { if (it.prev) ASSIGN[key(it.r)] = it.prev; else delete ASSIGN[key(it.r)]; }
    changed();
    computeWork(); renderWork(); renderUndo();
    const rows = u.items.map(it => it.r), sel = TCData.selector(rows);
    try {
      if (u.hide) await API.viewer.setObjectState(sel, { visible: true });
      if (colorOn) await colorGroups(rows); else await API.viewer.setObjectState(sel, { color: 'reset' });
      ownSelUntil = Date.now() + 900;
      await API.viewer.setSelection(sel, 'set');
      SEL = rows.slice(); ACC.clear(); if (MULTI) rows.forEach(r => ACC.set(r.id, r)); renderSel();
    } catch (e) { console.warn(e); }
    $('#selMsg').textContent = `Annullata l’assegnazione di ${f0(rows.length)} ${rows.length === 1 ? 'elemento' : 'elementi'}: sono di nuovo selezionati nel modello.`;
  }
  function renderUndo() {
    const b = $('#undoBtn'); b.disabled = !UNDO.length;
    b.textContent = UNDO.length ? `↶ Annulla (${UNDO.length})` : '↶ Annulla';
  }
  $('#undoBtn').addEventListener('click', undo);
  $('#hideAfter').checked = !!S.hideAfter;
  $('#hideAfter').addEventListener('change', e => { S.hideAfter = e.target.checked; store.set('tcsteel-settings', S); });
  $('#hideAssigned').addEventListener('click', async () => {
    const rows = R.rows.filter(r => grpOf(r) !== 'U'); if (!rows.length) return;
    try { await API.viewer.setObjectState(TCData.selector(rows), { visible: false }); } catch (e) {}
    $('#selMsg').textContent = `Nascosti ${f0(rows.length)} elementi già assegnati.`;
  });

  /* ------------------------------------------------------------ salvataggio */
  function loadLocal() {
    const v = store.get(aKey(), {});
    if (v && v.v === 2) { ASSIGN = v.assign || {}; SAVED_AT = v.savedAt || 0; } else { ASSIGN = v || {}; SAVED_AT = 0; }
  }
  const payload = () => ({ v: 2, app: 'Distinta acciaio', project: PROJECT.name || PROJECT.id, projectId: PROJECT.id, savedAt: SAVED_AT, assign: ASSIGN });
  let projTimer = null;
  function changed() {
    SAVED_AT = Date.now();
    try { localStorage.setItem(aKey(), JSON.stringify(payload())); SAVE.local = new Date(); SAVE.localErr = false; } catch (e) { SAVE.localErr = true; }
    if (SAVE.projOn) { clearTimeout(projTimer); projTimer = setTimeout(projSave, 8000); SAVE.projPending = true; }
    renderSave();
  }
  async function projSave() {
    if (!SAVE.projOn || SAVE.projBusy) { if (SAVE.projBusy) { clearTimeout(projTimer); projTimer = setTimeout(projSave, 3000); } return; }
    SAVE.projBusy = true; renderSave();
    try { await ProjStore.save(payload()); SAVE.proj = new Date(); SAVE.projErr = ''; SAVE.projPending = false; }
    catch (e) { SAVE.projErr = e.message || String(e); console.warn(e); }
    SAVE.projBusy = false; renderSave();
  }
  async function projConnect(manual) {
    SAVE.projBusy = true; SAVE.projErr = ''; SAVE.projFail = false; renderSave();
    try {
      await ProjStore.connect(API, PROJECT);
      const remote = await ProjStore.load();
      SAVE.projOn = true; store.set('tcsteel-proj|' + PROJECT.id, true);
      const rAt = remote && remote.savedAt || 0;
      if (remote && remote.assign && rAt > SAVED_AT) {
        ASSIGN = remote.assign; SAVED_AT = rAt;
        try { localStorage.setItem(aKey(), JSON.stringify(payload())); } catch (e) {}
        UNDO = []; renderUndo();
        if (R) { computeWork(); renderWork(); renderSel(); if (colorOn) colorAll(); }
        $('#selMsg').textContent = `Caricate dal progetto ${f0(Object.keys(ASSIGN).length)} assegnazioni (salvate il ${new Date(rAt).toLocaleString('it-IT')}).`;
        SAVE.proj = new Date(rAt);
      } else if (!remote || rAt < SAVED_AT) {
        SAVE.projBusy = false; await projSave();
      } else SAVE.proj = new Date(rAt);
    } catch (e) {
      SAVE.projErr = e.message || String(e); SAVE.projOn = false; SAVE.projFail = true; console.warn(e);
      if (manual) $('#projInfo').textContent = 'Non è stato possibile collegarsi al progetto: ' + SAVE.projErr + '. Le assegnazioni restano salvate in questo browser; per condividerle usa «Esporta assegnazioni».';
    }
    SAVE.projBusy = false; renderSave();
  }
  function renderSave() {
    const t = d => d ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const n = Object.keys(ASSIGN).length;
    const loc = SAVE.localErr ? '<span class="err">nel browser: non riuscito (archiviazione bloccata)</span>' : `nel browser <span class="ok">✓</span>${SAVE.local ? ' ' + t(SAVE.local) : ''}`;
    let pr = '';
    if (SAVE.projBusy) pr = ' · nel progetto: salvataggio…';
    else if (SAVE.projOn && SAVE.projErr) pr = ` · <span class="err">nel progetto: non riuscito (${esc(SAVE.projErr)})</span> <button class="btn sm" id="projRetry">Riprova</button>`;
    else if (!SAVE.projOn && SAVE.projFail) pr = ` · <span class="err">nel progetto: non disponibile (${esc(SAVE.projErr)})</span> <button class="btn sm" id="projRetry2">Riprova</button>`;
    else if (SAVE.projOn) pr = SAVE.projPending ? ' · nel progetto: tra pochi secondi' : ` · nel progetto <span class="ok">✓</span>${SAVE.proj ? ' ' + t(SAVE.proj) : ''}`;
    $('#saveInfo').innerHTML = `${f0(n)} assegnazioni salvate: ${loc}${pr}`;
    const rb = $('#projRetry'); if (rb) rb.onclick = () => projSave();
    const rb2 = $('#projRetry2'); if (rb2) rb2.onclick = () => projConnect(true);
    const pb = $('#projBtn');
    pb.textContent = SAVE.projOn ? 'Salva ora nel progetto' : 'Salva anche nel progetto';
    if (SAVE.projOn) $('#projInfo').textContent = `Salvate nel progetto, cartella principale, file «${ProjStore.FILE}». Si aggiorna da solo pochi secondi dopo ogni modifica.`;
  }
  $('#projBtn').addEventListener('click', () => SAVE.projOn ? projSave() : projConnect(true));
  $('#toA').addEventListener('click', () => assign('A'));
  $('#toS').addEventListener('click', () => assign('S'));
  $('#toO').addEventListener('click', () => assign('O'));
  $('#toU').addEventListener('click', () => assign('U'));
  $('#addSame').addEventListener('click', async () => {
    const add = []; for (const r of SEL) if (r.group) add.push(...r.group.rows);
    await API.viewer.setSelection(TCData.selector([...new Map(add.map(r => [r.id, r])).values()]), 'add');
  });
  $('#addTouch').addEventListener('click', async () => {
    const tol = (S.touchTol || 0) / 1000, sel = new Set(SEL.map(r => r.id)), add = [];
    const hit = (a, b) => a[0] <= b[3] + tol && a[3] >= b[0] - tol && a[1] <= b[4] + tol && a[4] >= b[1] - tol && a[2] <= b[5] + tol && a[5] >= b[2] - tol;
    const plates = R.rows.filter(r => r.kind === 'plate' && r.bbox && !sel.has(r.id));
    for (const s of SEL) { if (!s.bbox) continue; for (const p of plates) if (hit(s.bbox, p.bbox)) add.push(p); }
    const uniq = [...new Map(add.map(r => [r.id, r])).values()];
    if (!uniq.length) { $('#selMsg').textContent = 'Nessuna piastra a contatto con la selezione.'; return; }
    await API.viewer.setSelection(TCData.selector(uniq), 'add');
    $('#selMsg').textContent = `Aggiunte ${f0(uniq.length)} piastre a contatto (in base all’ingombro: controlla prima di assegnare).`;
  });

  /* ------------------------------------------------------------ azioni sul modello */
  async function selectInModel(rows, zoom) {
    if (!API || !rows.length) return;
    const sel = TCData.selector(rows);
    try { await API.viewer.setSelection(sel, 'set'); if (zoom) await API.viewer.setCamera(sel, { animationTime: 400 }); } catch (e) { console.warn(e); }
  }
  async function showOnly(rows) {
    try { await API.viewer.setObjectState(undefined, { visible: false }); await API.viewer.setObjectState(TCData.selector(rows), { visible: true }); } catch (e) { console.warn(e); }
  }
  $('#showAll').addEventListener('click', async () => { try { await API.viewer.setObjectState(undefined, { visible: 'reset' }); } catch (e) {} });
  async function paintBy(fn) {
    const by = new Map();
    for (const r of R.rows) { const c = fn(r); if (!c) continue; let a = by.get(c); if (!a) by.set(c, a = []); a.push(r); }
    for (const [c, rows] of by) await API.viewer.setObjectState(TCData.selector(rows), { color: c });
  }
  async function colorAll() {
    if (!API || !R) return;
    try { await API.viewer.setObjectState(undefined, { color: 'reset' }); if (colorOn) await paintBy(r => GCOL[effOf(r)]); } catch (e) { console.warn(e); }
  }
  async function colorGroups(rows) {
    const by = { A: [], S: [], O: [], U: [] }; rows.forEach(r => by[effOf(r)].push(r));
    for (const g in by) if (by[g].length) try { await API.viewer.setObjectState(TCData.selector(by[g]), { color: GCOL[g] }); } catch (e) {}
  }
  $('#colorBtn').addEventListener('click', () => { colorOn = !colorOn; store.set('tcsteel-color', colorOn); $('#colorBtn').setAttribute('aria-pressed', colorOn); colorAll(); });

  /* ------------------------------------------------------------ assegnazioni: esporta / importa */
  $('#expAssign').addEventListener('click', () => {
    const data = { ...payload(), date: new Date().toISOString(), assignments: ASSIGN };
    save(`Assegnazioni ${PROJECT.name || 'progetto'}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  });
  $('#impAssign').addEventListener('click', () => $('#impFile').click());
  $('#impFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const j = JSON.parse(await f.text()); const a = j.assignments || j.assign || j; let n = 0;
      for (const k in a) if (a[k] === 'A' || a[k] === 'S' || a[k] === 'O') { ASSIGN[k] = a[k]; n++; }
      changed(); UNDO = []; renderUndo(); computeWork(); renderWork(); renderSel(); if (colorOn) colorAll();
      $('#assignInfo').textContent = `Importate ${f0(n)} assegnazioni.`;
    } catch (err) { $('#assignInfo').textContent = 'File non valido: ' + err.message; }
  });
  let clrArm = null;
  $('#clrAssign').addEventListener('click', () => {
    const b = $('#clrAssign');
    if (!Object.keys(ASSIGN).length) return;
    if (!clrArm) { b.textContent = 'Conferma: cancella tutte'; clrArm = setTimeout(() => { clrArm = null; b.textContent = 'Cancella tutte'; }, 4000); return; }
    clearTimeout(clrArm); clrArm = null; b.textContent = 'Cancella tutte';
    ASSIGN = {}; UNDO = []; renderUndo(); changed(); computeWork(); renderWork(); renderSel(); if (colorOn) colorAll();
  });

  /* ------------------------------------------------------------ impostazioni */
  const NUMK = ['t1', 't2', 'density', 'touchTol'];
  let deb = null;
  ['t1', 't2', 'density', 'plateRe', 'weldRe', 'touchTol', 'unPolicy'].forEach(k => {
    const el = $('#' + k); el.value = S[k];
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      S[k] = NUMK.includes(k) ? (parseFloat(el.value) || 0) : el.value; store.set('tcsteel-settings', S);
      clearTimeout(deb); deb = setTimeout(() => { if (!DATA) return; recompute(); if (k === 'unPolicy' && colorOn) colorAll(); }, 250);
    });
  });

  /* ------------------------------------------------------------ schede */
  function setTab(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + t));
    if (t === 'sum') drawCharts(false);
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

  /* ------------------------------------------------------------ grafici */
  const charts = {};
  function mk(id, cfg) {
    if (typeof Chart === 'undefined') return;
    if (charts[id]) charts[id].destroy();
    if (id[0] === 'x') { cfg.options.responsive = false; cfg.options.devicePixelRatio = 3; cfg.options.animation = false;
      cfg.plugins = [{ id: 'bg', beforeDraw: c => { const x = c.ctx; x.save(); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.restore(); } }]; }
    charts[id] = new Chart(document.getElementById(id), cfg);
  }
  function drawCharts(exp) {
    if (!R || typeof Chart === 'undefined') return;
    const P = exp ? 'x' : 'ch';
    Chart.defaults.font.family = '"Open Sans","Segoe UI",system-ui,sans-serif'; Chart.defaults.color = '#6A6E79';
    const kg = v => F0.format(v);
    const base = { responsive: true, maintainAspectRatio: false, animation: { duration: 200 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${kg(c.raw)} kg` } } } };
    const cats = CATORDER.filter(k => R.cats[k].w > 0);
    mk(P + 'Cat', { type: 'doughnut', data: { labels: cats.map(k => CATLABEL[k]), datasets: [{ data: cats.map(k => R.cats[k].w), backgroundColor: cats.map(k => CATCOL[k]), borderColor: '#fff', borderWidth: 2 }] },
      options: { ...base, cutout: '58%', plugins: { ...base.plugins, legend: { display: true, position: 'right', labels: { boxWidth: 10, color: '#252A2E', generateLabels: () => cats.map((k, i) => ({ text: `${CATLABEL[k]} ${F1.format(R.cats[k].w / R.total * 100)} %`, fillStyle: CATCOL[k], strokeStyle: CATCOL[k], index: i })) } } } } });
    const fams = R.families.slice(0, 12), kinds = ['light', 'heavy', 'vheavy', 'weld', 'nd'];
    mk(P + 'Fam', { type: 'bar', data: { labels: fams.map(f => f.family + (f.kind === 'weld' ? ' (sald.)' : '')), datasets: kinds.map(k => ({ label: CATLABEL[k], data: fams.map(f => f.cats[k] || 0), backgroundColor: CATCOL[k], stack: 's' })) },
      options: { ...base, indexAxis: 'y', scales: { x: { stacked: true, ticks: { callback: kg } }, y: { stacked: true, grid: { display: false }, ticks: { color: '#252A2E' } } } } });
    if (!exp) return;
    const top = R.groups.filter(g => g.kind !== 'plate').sort((a, b) => b.w - a.w).slice(0, 15);
    mk('xTop', { type: 'bar', data: { labels: top.map(g => g.label + (g.kgm ? `  (${F1.format(g.kgm)} kg/m)` : '')), datasets: [{ data: top.map(g => g.w), backgroundColor: top.map(g => CATCOL[g.cat]) }] },
      options: { ...base, indexAxis: 'y', scales: { x: { ticks: { callback: kg } }, y: { grid: { display: false }, ticks: { color: '#252A2E', font: { size: 11 } } } } } });
    const gs = GK.filter(g => W.T[g].n);
    mk('xWork', { type: 'bar', data: { labels: gs.map(g => GLABEL[g]), datasets: [{ label: 'Profili', data: gs.map(g => W.T[g].prof), backgroundColor: gs.map(g => GCOL[g]), stack: 's' }, { label: 'Piastre', data: gs.map(g => W.T[g].pl), backgroundColor: gs.map(g => GCOL[g] + '99'), stack: 's' }] },
      options: { ...base, indexAxis: 'y', plugins: { ...base.plugins, legend: { display: true, labels: { color: '#252A2E', boxWidth: 10 } } }, scales: { x: { stacked: true, ticks: { callback: kg } }, y: { stacked: true, grid: { display: false }, ticks: { color: '#252A2E' } } } } });
  }

  /* ------------------------------------------------------------ salvataggio file */
  function save(filename, blob) {
    const url = URL.createObjectURL(blob);
    try { const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
    $('#dlFallback').innerHTML = `Se il download non parte, <a href="${url}" target="_blank" rel="noopener" download="${esc(filename)}">apri ${esc(filename)}</a>.`;
  }
  const base = () => (DATA.modelNames[0] || 'modello').replace(/\.ifc$/i, '');
  const r1 = v => v == null ? null : Math.round(v * 10) / 10, r2 = v => v == null ? null : Math.round(v * 100) / 100;

  function sheets() {
    const cat = CATORDER.filter(k => R.cats[k].n).map(k => ({ Categoria: CATLABEL[k], Profili: R.cats[k].profiles, Elementi: R.cats[k].n, 'Lunghezza (m)': r2(R.cats[k].L), 'Peso (kg)': r1(R.cats[k].w), '% sul totale': r1(R.cats[k].w / R.total * 100) }));
    cat.push({ Categoria: 'TOTALE CARPENTERIA', Elementi: R.rows.length, 'Peso (kg)': r1(R.total), '% sul totale': 100 });
    if (R.boltsN) cat.push({ Categoria: 'Bulloneria (esclusa)', Elementi: R.boltsN, 'Peso (kg)': R.boltsW ? r1(R.boltsW) : null });
    const T = W.T, lav = GK.filter(g => T[g].n).map(g => ({ Gruppo: GLABEL[g], 'Profili (kg)': r1(T[g].prof), 'Pezzi profili': T[g].nProf, 'Piastre (kg)': r1(T[g].pl), 'Pezzi piastre': T[g].nPl, 'Totale (kg)': r1(T[g].w), '%': r1(T[g].w / (totW(T) || 1) * 100) }));
    lav.push({}); W.byProfile.forEach(p => lav.push({ Gruppo: p.label, 'Assemblati (kg)': r1(p.A), 'Sciolti (kg)': r1(p.S), 'Scale/altro (kg)': r1(p.O), 'Da assegnare (kg)': r1(p.U) }));
    const prof = R.groups.filter(g => g.kind !== 'plate').sort((a, b) => a.family.localeCompare(b.family) || a.label.localeCompare(b.label, 'it', { numeric: true }))
      .map(g => ({ Profilo: g.label, Famiglia: g.family, Categoria: CATLABEL[g.cat], Materiale: g.material, 'N.': g.n, 'kg/m': r2(g.kgm), 'Origine kg/m': g.kgmSrc, 'Lunghezza (m)': r2(g.L), 'Peso (kg)': r1(g.w) }));
    const pl = R.groups.filter(g => g.kind === 'plate').sort((a, b) => (a.th ?? 1e9) - (b.th ?? 1e9)).map(g => ({ Spessore: g.label, 'Spessore (mm)': g.th, Materiale: g.material, 'N.': g.n, 'Peso (kg)': r1(g.w) }));
    const fam = R.families.map(f => ({ Famiglia: f.family, Tipo: f.kind === 'weld' ? 'saldato' : 'laminato', Profili: f.p, Elementi: f.n, 'Lunghezza (m)': r2(f.L), 'Peso (kg)': r1(f.w) }));
    const bolts = R.bolts.map(b => ({ Tipo: b.label, Pezzi: b.n, 'Peso (kg)': b.wn ? r1(b.w) : null }));
    const els = R.rows.map(r => ({ GUID: r.guid, 'Tipo IFC': 'Ifc' + r.ifcType.charAt(0) + r.ifcType.slice(1).toLowerCase(), Nome: r.name, Marca: r.tag, Assieme: r.assembly, Profilo: r.profile, Categoria: CATLABEL[r.cat], Materiale: r.material, 'Lunghezza (m)': r2(r.lengthM), 'Spessore (mm)': r.kind === 'plate' ? r.thicknessMm : null, 'Peso (kg)': r2(r.w), 'Origine peso': r.wsrc || 'mancante', Gruppo: GLABEL[grpOf(r)] }));
    return { Riepilogo: cat, 'Assemblati e sciolti': lav, Profili: prof, Piatti: pl, Famiglie: fam, Bulloneria: bolts, Elementi: els };
  }
  $('#xlsBtn').addEventListener('click', () => {
    if (typeof XLSX === 'undefined' || !R) return;
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets())) {
      const data = rows.length ? rows : [{ Nota: 'Nessun dato' }];
      const ws = XLSX.utils.json_to_sheet(data);
      const keys = [...new Set(data.flatMap(r => Object.keys(r)))];
      ws['!cols'] = keys.map(k => ({ wch: Math.min(60, Math.max(10, k.length + 2, ...data.slice(0, 300).map(r => String(r[k] ?? '').length + 1))) }));
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    }
    save(`Distinta acciaio - ${base()}.xlsx`, new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  });
  $('#csvBtn').addEventListener('click', () => {
    if (!R) return; const rows = sheets().Profili; if (!rows.length) return;
    const keys = Object.keys(rows[0]), cell = v => v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`;
    save(`Profili - ${base()}.csv`, new Blob(['﻿' + [keys.join(';'), ...rows.map(r => keys.map(k => cell(r[k])).join(';'))].join('\r\n')], { type: 'text/csv' }));
  });

  /* ------------------------------------------------------------ report PDF */
  async function toJpeg(dataUrl) {
    return new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0); res({ url: c.toDataURL('image/jpeg', 0.9), w: im.width, h: im.height }); }; im.onerror = () => res(null); im.src = dataUrl; });
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function snap(paint) {
    try { await API.viewer.setObjectState(undefined, { color: 'reset' }); await paintBy(paint); await wait(700); const s = await API.viewer.getSnapshot(); return s ? await toJpeg(s) : null; }
    catch (e) { console.warn(e); return null; }
  }
  $('#pdfBtn').addEventListener('click', async () => {
    if (!window.jspdf || !R) return;
    const b = $('#pdfBtn'); b.disabled = true; $('#repMsg').textContent = 'Preparazione del report…';
    try { await buildPdf(); $('#repMsg').textContent = 'Report creato.'; } catch (e) { console.error(e); $('#repMsg').textContent = 'Report non riuscito: ' + e.message; }
    b.disabled = false;
  });
  async function buildPdf() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const Wd = 297, H = 210, M = 12, INK = [37, 42, 46], MUT = [106, 110, 121];
    const T = s => String(s ?? '').replace(/≤/g, 'fino a').replace(/[^\x00-\xFF’‘“”–—…€]/g, '');
    const head = (t, sub) => { doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(T(t), M, M + 6);
      if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUT); doc.text(T(sub), M, M + 12); } };
    const tbl = o => doc.autoTable({ theme: 'plain', margin: { left: M, right: M }, styles: { fontSize: 8.5, cellPadding: 1.4, textColor: INK, lineColor: [215, 217, 224], lineWidth: { bottom: 0.15 } },
      headStyles: { fillColor: INK, textColor: 255, fontStyle: 'bold' }, footStyles: { fontStyle: 'bold', fillColor: [241, 241, 246] }, ...o,
      body: o.body.map(r => r.map(T)), head: o.head && o.head.map(r => r.map(T)), foot: o.foot && o.foot.map(r => r.map(T)) });
    const right = c => Object.fromEntries(c.map(i => [i, { halign: 'right' }]));
    const sub = `${DATA.modelNames.join(', ')}${PROJECT.name ? '  |  ' + PROJECT.name : ''}  |  ${new Date().toLocaleDateString('it-IT')}`;
    drawCharts(true); await wait(30);
    const img = id => charts[id] ? charts[id].toBase64Image('image/jpeg', 0.92) : null;
    const add = (id, x, y, w, h) => { const u = img(id); if (u) doc.addImage(u, 'JPEG', x, y, w, h); };

    // 1. riepilogo
    head('Distinta acciaio', sub);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUT); doc.text('Peso totale carpenteria', M, M + 24);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(...INK); doc.text(`${f0(R.total)} kg`, M, M + 36);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.text(T(`${f2(R.total / 1000)} t, ${f0(R.rows.length)} elementi${R.boltsN ? `, bulloneria esclusa: ${f0(R.boltsN)} pz` : ''}`), M, M + 44);
    tbl({ startY: M + 52, tableWidth: 150, head: [['Categoria', 'Elementi', 'Lungh. (m)', 'Peso (kg)', '%']],
      body: CATORDER.filter(k => R.cats[k].n).map(k => [CATLABEL[k], f0(R.cats[k].n), k === 'plate' ? '–' : f1(R.cats[k].L), f0(R.cats[k].w), f1(R.cats[k].w / R.total * 100)]),
      foot: [['Totale', f0(R.rows.length), '', f0(R.total), '100,0']], columnStyles: right([1, 2, 3, 4]) });
    const Tt = W.T, tot = totW(Tt) || 1;
    tbl({ startY: doc.lastAutoTable.finalY + 6, tableWidth: 150, head: [['Gruppo', 'Profili (kg)', 'Piastre (kg)', 'Totale (kg)', '%']],
      body: GK.filter(g => Tt[g].n).map(g => [GLABEL[g], f0(Tt[g].prof), f0(Tt[g].pl), f0(Tt[g].w), f1(Tt[g].w / tot * 100)]), columnStyles: right([1, 2, 3, 4]) });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text('Peso per categoria', 172, M + 24); add('xCat', 170, M + 28, 115, 61);
    doc.text('Peso per famiglia di profilo', 172, M + 100); add('xFam', 170, M + 104, 115, 78);

    // 2. grafici
    doc.addPage(); head('Profili e lavorazioni', sub);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text('Profili con peso maggiore', M, M + 20); add('xTop', M, M + 24, 150, 100);
    doc.text('Assemblati e sciolti', 170, M + 20); add('xWork', 168, M + 24, 117, 62);

    // 3. immagini del modello
    if ($('#repImg').checked && API) {
      $('#repMsg').textContent = 'Immagini del modello…';
      let prevSel = null;
      try { prevSel = await API.viewer.getSelection(); if (prevSel && prevSel.length) await API.viewer.setSelection({ modelObjectIds: prevSel }, 'remove'); } catch (e) {}
      const s1 = await snap(r => CATCOL[r.cat]);
      const s2 = await snap(r => GCOL[effOf(r)]);
      await colorAll();
      try { if (prevSel && prevSel.length) await API.viewer.setSelection({ modelObjectIds: prevSel }, 'add'); } catch (e) {}
      if (s1 || s2) {
        doc.addPage(); head('Viste del modello', 'Inquadratura attuale del visualizzatore');
        const box = (s, x, y, w, h, cap) => { if (!s) return; const k = Math.min(w / s.w, h / s.h), iw = s.w * k, ih = s.h * k; doc.addImage(s.url, 'JPEG', x + (w - iw) / 2, y, iw, ih);
          doc.setFontSize(9); doc.setTextColor(...MUT); doc.text(T(cap), x, y + ih + 5); };
        box(s1, M, M + 18, 132, 140, 'Colori per categoria di peso');
        box(s2, M + 141, M + 18, 132, 140, 'Colori per gruppo: assemblati / sciolti');
        let lx = M; const ly = H - M - 4; doc.setFontSize(8);
        for (const [c, l] of [...CATORDER.filter(k => R.cats[k].n).map(k => [CATCOL[k], CATLABEL[k]]), ...GK.filter(g => Tt[g].n).map(g => [GCOL[g], GLABEL[g]])]) {
          doc.setFillColor(c); doc.rect(lx, ly - 2.6, 3.4, 3.4, 'F'); doc.setTextColor(...INK); doc.text(T(l), lx + 5, ly); lx += doc.getTextWidth(T(l)) + 11; }
      }
    }

    // 4. assemblati / sciolti per profilo
    doc.addPage(); head('Assemblati e sciolti per profilo', `${f0(W.manual)} elementi assegnati${Tt.U.n && S.unPolicy === 'U' ? `, ${f0(Tt.U.n)} da assegnare` : ''}`);
    const showU = S.unPolicy === 'U' || Tt.U.n;
    const gsP = GK.filter(g => (g !== 'U' || showU) && (g !== 'O' || Tt.O.n));
    tbl({ startY: M + 18, head: [['Profilo', ...gsP.map(g => GLABEL[g] + ' (kg)'), 'Totale (kg)']],
      body: W.byProfile.map(p => [p.label, ...gsP.map(g => p[g] ? f0(p[g]) : '–'), f0(p.w)]),
      foot: [['Totale', ...gsP.map(g => f0(Tt[g].w)), f0(tot)]], columnStyles: right(gsP.map((g, i) => i + 1).concat([gsP.length + 1])) });

    // 5. distinta per profilo
    doc.addPage(); head('Distinta per profilo', sub);
    const prof = R.groups.filter(g => g.kind !== 'plate').sort((a, b) => a.family.localeCompare(b.family) || a.label.localeCompare(b.label, 'it', { numeric: true }));
    tbl({ startY: M + 18, head: [['Profilo', 'Famiglia', 'Categoria', 'Materiale', 'N.', 'kg/m', 'Lunghezza (m)', 'Peso (kg)']],
      body: prof.map(g => [g.label, g.family, CATLABEL[g.cat], g.material || '–', f0(g.n), g.kgm ? f1(g.kgm) : '–', f2(g.L), f0(g.w)]),
      foot: [['Totale', '', '', '', f0(sum(prof, g => g.n)), '', f2(sum(prof, g => g.L)), f0(sum(prof, g => g.w))]], columnStyles: right([4, 5, 6, 7]) });
    const pl = R.groups.filter(g => g.kind === 'plate').sort((a, b) => (a.th ?? 1e9) - (b.th ?? 1e9));
    if (pl.length) { doc.addPage(); head('Piatti e lamiere per spessore', sub);
      tbl({ startY: M + 18, tableWidth: 160, head: [['Spessore', 'Materiale', 'N.', 'Peso (kg)']], body: pl.map(g => [g.label, g.material || '–', f0(g.n), f0(g.w)]),
        foot: [['Totale', '', f0(sum(pl, g => g.n)), f0(sum(pl, g => g.w))]], columnStyles: right([2, 3]) }); }
    if (R.bolts.length) { const y0 = pl.length ? doc.lastAutoTable.finalY + 10 : (doc.addPage(), M + 12);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK); doc.text('Bulloneria (esclusa dal totale)', M, y0);
      tbl({ startY: y0 + 3, tableWidth: 160, head: [['Tipo', 'Pezzi', 'Peso (kg)']], body: R.bolts.map(b => [b.label, f0(b.n), b.wn ? f1(b.w) : '–']), columnStyles: right([1, 2]) }); }
    const np = doc.getNumberOfPages();
    for (let i = 1; i <= np; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...MUT); doc.text(T(`${DATA.modelNames.join(', ')}  |  pagina ${i} di ${np}`), Wd - M, H - 6, { align: 'right' }); }
    save(`Report acciaio - ${base()}.pdf`, doc.output('blob'));
  }

  /* ------------------------------------------------------------ IFC per gruppo */
  const IFCSEL = new Set(store.get('tcsteel-ifcsel', ['A', 'S', 'O']));
  function renderIfcGroups() {
    if (!W) return;
    $('#ifcGroups').innerHTML = GK.filter(g => W.T[g].n).map(g => `<label class="hint" style="display:inline-flex;gap:5px;align-items:center;color:var(--ink)"><input type="checkbox" data-ig="${g}" ${IFCSEL.has(g) ? 'checked' : ''}><span class="sw" style="background:${GCOL[g]}"></span>${GLABEL[g]} <span class="hint">(${f0(W.T[g].n)})</span></label>`).join('');
    $('#ifcGroups').querySelectorAll('[data-ig]').forEach(c => c.addEventListener('change', () => { c.checked ? IFCSEL.add(c.dataset.ig) : IFCSEL.delete(c.dataset.ig); store.set('tcsteel-ifcsel', [...IFCSEL]); }));
  }
  async function modelBytes(modelId) {
    const spec = (DATA.models || []).find(m => m.id === modelId) || (DATA.models || []).find(m => m.versionId === modelId) || { id: modelId };
    let parentId = null, name = spec.name || '', seen = [];
    const ok = async u8 => {
      const k = IfcSplit.kind(u8); seen.push(k);
      if (k === 'ifc') return u8;
      if (k === 'zip') { try { const x = await IfcSplit.unzipIfc(u8); if (IfcSplit.kind(x) === 'ifc') return x; } catch (e) { seen.push(e.message); } }
      return null;
    };
    // 1) file già caricato nel visualizzatore (spesso è il formato interno di Trimble, non l'IFC)
    try {
      const f = await API.viewer.getLoadedModel(modelId);
      if (f) { parentId = (f.file && f.file.parentId) || f.parentId || null; name = f.name || name;
        if (f.blob instanceof Blob) { const r = await ok(new Uint8Array(await f.blob.arrayBuffer())); if (r) return { bytes: r, parentId, name }; } }
    } catch (e) {}
    // 2) file originale scaricato dal progetto
    await ProjStore.connect(API, PROJECT);
    const ids = [...new Set([spec.id, modelId].filter(Boolean))];
    let last = null;
    for (const id of ids) {
      try { const r = await ok(await ProjStore.fileBytes(id, id === spec.id ? spec.versionId : undefined)); if (r) return { bytes: r, parentId, name }; }
      catch (e) { last = e; }
    }
    throw new Error(`non riesco ad avere il file IFC originale di «${name || modelId}»` + (last ? ` (${last.message})` : '') + (seen.length ? ` [${seen.join(', ')}]` : ''));
  }
  async function makeGroupIfcs(dest) {
    const groups = GK.filter(g => IFCSEL.has(g) && W.T[g].n);
    const msg = t => $('#ifcMsg').innerHTML = t;
    if (!groups.length) { msg('Scegli almeno un gruppo.'); return; }
    ['#ifcProj', '#ifcZip'].forEach(b => $(b).disabled = true);
    const files = [], warn = [];
    try {
      for (let mi = 0; mi < DATA.modelIds.length; mi++) {
        const modelId = DATA.modelIds[mi];
        msg(`Scarico il modello ${mi + 1} di ${DATA.modelIds.length}…`);
        const { bytes, parentId, name } = await modelBytes(modelId);
        const label = (name || DATA.modelNames[mi] || 'modello').replace(/\.ifc$/i, '');
        msg(`Analisi di ${esc(label)} (${f0(bytes.length / 1048576)} MB)…`);
        const P = await IfcSplit.prepare(IfcSplit.bytesToText(bytes), v => msg(`Analisi di ${esc(label)}… ${Math.round(v * 100)} %`));
        for (const g of groups) {
          const rows = R.rows.filter(r => r.modelId === modelId && effOf(r) === g && r.guid);
          if (!rows.length) continue;
          const keep = new Set(rows.map(r => IfcSplit.normGuid(r.guid)));
          if ($('#ifcBolts').checked) DATA.fasteners.filter(f => f.modelId === modelId && f.guid).forEach(f => keep.add(IfcSplit.normGuid(f.guid)));
          msg(`Creo ${esc(label)} – ${GLABEL[g]}…`);
          const res = await IfcSplit.subset(P, keep);
          if (res.matched < rows.length * 0.9) warn.push(`${label} – ${GLABEL[g]}: trovati nel file ${f0(res.matched)} elementi su ${f0(rows.length)}.`);
          const fname = `${label} - ${GLABEL[g].replace('/', '-')}.ifc`;
          if (dest === 'proj') { msg(`Salvo ${esc(fname)} nel progetto…`); await ProjStore.upload(parentId, fname, res.blob); }
          files.push({ name: fname, blob: res.blob, n: res.matched, size: res.blob.size });
        }
      }
      if (!files.length) { msg('Nessun elemento da esportare nei gruppi scelti.'); return; }
      if (dest === 'zip') { msg('Preparo lo zip…'); save(`IFC per gruppo - ${base()}.zip`, await IfcSplit.zip(files)); }
      msg(`<strong>${files.length} file ${dest === 'proj' ? 'salvati nel progetto, nella cartella del modello' : 'creati'}:</strong><br>` + files.map(f => `${esc(f.name)} · ${f0(f.n)} ${f.n === 1 ? 'elemento' : 'elementi'} · ${f1(f.size / 1048576)} MB`).join('<br>') +
        (warn.length ? `<br><span style="color:var(--warn)">${warn.map(esc).join('<br>')}</span>` : ''));
    } catch (e) {
      console.error(e); msg(`<span style="color:var(--warn)">Non riuscito: ${esc(e.message || e)}</span>`);
    } finally { ['#ifcProj', '#ifcZip'].forEach(b => $(b).disabled = false); }
  }
  $('#ifcProj').addEventListener('click', () => makeGroupIfcs('proj'));
  $('#ifcZip').addEventListener('click', () => makeGroupIfcs('zip'));

  window.__tcsteel = { get R() { return R; }, get W() { return W; }, get SEL() { return SEL; }, get ASSIGN() { return ASSIGN; } };
  init();
})();
