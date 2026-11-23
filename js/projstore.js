/* ======================================================================
   Salvataggio delle assegnazioni come file JSON nel progetto Trimble Connect
   (Core API 2.0: projects, folders/items, files/fs/initiate|commit|downloadurl).
   Richiede il permesso «accesstoken» concesso dall'utente.
   ====================================================================== */
const ProjStore = (() => {
  'use strict';
  const FILE = 'Distinta acciaio - assegnazioni.json';
  const HOSTS = ['app21.connect.trimble.com', 'app.connect.trimble.com', 'app31.connect.trimble.com', 'app32.connect.trimble.com'];
  let token = null, waiters = [], origin = null, rootId = null, fileId = null;

  function setToken(t) {
    if (typeof t === 'string' && t.length > 40 && !/^(pending|denied)$/i.test(t)) { token = t; waiters.splice(0).forEach(f => f(t)); }
  }
  async function getToken(api, timeout = 90000) {
    if (token) return token;
    const r = await api.extension.requestPermission('accesstoken');
    if (/denied/i.test(String(r))) throw new Error('accesso non concesso');
    setToken(r); if (token) return token;
    return new Promise((res, rej) => { waiters.push(res); setTimeout(() => rej(new Error('nessuna risposta alla richiesta di accesso')), timeout); });
  }
  async function req(path, opt = {}, host = origin) {
    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
    if (opt.body) headers['Content-Type'] = 'application/json';
    const r = await fetch('https://' + host + '/tc/api/2.0/' + path, { ...opt, headers });
    if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error(`errore ${r.status}${t ? ': ' + t.slice(0, 140) : ''}`); e.status = r.status; throw e; }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : r.text();
  }
  async function locate(project) {
    const loc = String(project.location || '').toLowerCase();
    const pref = /eur/.test(loc) ? HOSTS[0] : /asia/.test(loc) ? HOSTS[2] : /austral/.test(loc) ? HOSTS[3] : /america|us/.test(loc) ? HOSTS[1] : null;
    let ref = ''; try { ref = new URL(document.referrer).searchParams.get('origin') || ''; } catch (e) {}
    const order = [...new Set([ref, pref, ...HOSTS].filter(Boolean))];
    let last = null;
    for (const h of order) {
      try { const p = await req('projects/' + project.id, {}, h); origin = h; rootId = p.rootId; return; }
      catch (e) { last = e; if (e.status === 401) throw new Error('accesso rifiutato dal server (401)'); }
    }
    throw last || new Error('progetto non trovato');
  }
  async function connect(api, project) { await getToken(api); if (!origin) await locate(project); }
  async function findFile() {
    const items = await req('folders/' + rootId + '/items');
    const list = Array.isArray(items) ? items : (items && items.items) || [];
    const f = list.find(i => (i.type === 'FILE' || !i.type) && i.name === FILE);
    fileId = f ? f.id : null;
    return f || null;
  }
  async function load() {
    const f = await findFile(); if (!f) return null;
    const d = await req('files/fs/' + f.id + '/downloadurl');
    const url = d && (d.url || d.downloadUrl || d.downloadURL);
    if (!url) throw new Error('indirizzo di download mancante');
    const r = await fetch(url); if (!r.ok) throw new Error('download non riuscito (' + r.status + ')');
    return JSON.parse(await r.text());
  }
  async function save(obj) {
    if (fileId === null) await findFile();
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const body = { parentId: rootId, parentType: 'FOLDER', name: FILE };
    let ini;
    try { ini = await req('files/fs/initiate', { method: 'POST', body: JSON.stringify(body) }); }
    catch (e) { if (!fileId) throw e; ini = await req('files/fs/initiate', { method: 'POST', body: JSON.stringify({ ...body, fileId }) }); }
    const put = await fetch(ini.uploadURL || ini.uploadUrl, { method: 'PUT', body: blob });
    if (!put.ok) throw new Error('caricamento non riuscito (' + put.status + ')');
    const res = await req('files/fs/commit', { method: 'POST', body: JSON.stringify({ uploadId: ini.uploadId }) });
    if (res && res.id) fileId = res.id;
    return res;
  }
  return { setToken, connect, load, save, FILE, get ready() { return !!(token && origin && rootId); } };
})();
