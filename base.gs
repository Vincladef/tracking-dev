/***********************
 * Google Sheets HUB
 ***********************/
function SS() {
  // Si le projet EST lié au classeur hub -> getActive()
  return SpreadsheetApp.getActive();
  // Sinon, commente la ligne au-dessus et décommente ceci :
  // return SpreadsheetApp.openById("PASTE_YOUR_HUB_SPREADSHEET_ID");
}

// Onglets (exactement ceux de ton classeur)
const T_USERS     = 'USERS';
const T_CONSIGNES = 'CONSIGNES';
const T_ANSWERS   = 'ANSWERS';

/***********************
 * Helpers génériques
 ***********************/
function sh_(name){ const s = SS().getSheetByName(name); if(!s) throw new Error('Sheet manquant: '+name); return s; }

function readRaw_(name){
  const s = sh_(name), vals = s.getDataRange().getValues();
  const header = vals.shift() || [];
  return { header, rows: vals };
}
function readRows_(name){
  const {header, rows} = readRaw_(name);
  const H = header.map(h => String(h||'').trim());
  const out = [];
  for (const r of rows) {
    if (String(r.join('')).trim()==='') continue;
    const o={}; H.forEach((h,i)=> o[h] = r[i]); out.push(o);
  }
  return out;
}
function append_(name, rows){
  if(!rows?.length) return;
  const s = sh_(name);
  s.getRange(s.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);
}
function writeAll_(name, header, rows){
  const s = sh_(name);
  s.clearContents();
  if (header?.length) s.getRange(1,1,1,header.length).setValues([header]);
  if (rows?.length)   s.getRange(2,1,rows.length,header.length).setValues(rows);
}
function json_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function now_(){ return new Date(); }
function todayYMD_(){ return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/***********************
 * doGet — lecture
 * - ?mode=consignes&user=...
 * - ?mode=practice&user=... [&category=...]
 * - ?date=YYYY-MM-DD&user=...
 ***********************/
function doGet(e){
  const p = e?.parameter || {};
  const user = String(p.user||'').trim().toLowerCase();
  if (!user) return json_({ error:'missing user' });

  // CONSIGNES du user
  if (p.mode === 'consignes') {
    const rows = readRows_(T_CONSIGNES)
      .filter(r => String(r.user||'').toLowerCase() === user)
      .filter(r => String(r.status||'active') === 'active');
    return json_({ consignes: rows });
  }

  // PRACTICE: catégories OU consignes d'une catégorie
  if (p.mode === 'practice') {
    const rows = readRows_(T_CONSIGNES)
      .filter(r => String(r.user||'').toLowerCase() === user)
      .filter(r => String(r.status||'active') === 'active');

    if (p.category) {
      const cons = rows.filter(r => String(r.category||'') === String(p.category||''));
      return json_({ consignes: cons });
    } else {
      const cats = [...new Set(rows.map(r => r.category).filter(Boolean))];
      return json_({ categories: cats });
    }
  }

  // JOURNALIER: consignes + réponses existantes pour une date
  if (p.date) {
    const date = String(p.date);
    const cons = readRows_(T_CONSIGNES)
      .filter(r => String(r.user||'').toLowerCase() === user)
      .filter(r => String(r.status||'active') === 'active');
    const ans  = readRows_(T_ANSWERS)
      .filter(r => String(r.user||'').toLowerCase() === user && String(r.date) === date);
    return json_({ consignes: cons, answers: ans });
  }

  return json_({ ok:true });
}

/***********************
 * doPost — écriture
 * - autosave/soumission (_mode, _date|_category, qid:value...)
 * - CRUD consignes (_action: consigne_create|update|delete)
 * - user_create (facultatif)
 ***********************/
function doPost(e){
  const body = e?.postData?.contents ? JSON.parse(e.postData.contents) : {};
  const user = String(body.user||'').trim().toLowerCase();
  if (!user) return json_({ error:'missing user' });

  // 1) Réponses (autosave / submit)
  if (body._mode) {
    const date = body._date || todayYMD_();

    // On collecte toutes les paires {qid:value}
    const entries = [];
    for (const [k,v] of Object.entries(body)) {
      if (/^[a-zA-Z0-9_-]+$/.test(k)) { // id plausible
        entries.push([user, date, String(k), String(v ?? ''), JSON.stringify({ _mode: body._mode, _category: body._category || null }), now_()]);
      }
    }
    if (entries.length) append_(T_ANSWERS, entries);

    // 2) ✅ Appliquer les toggles SR à CONSIGNES (ON/OFF)
    //    Les clés sont du type "__srToggle__<id>" avec valeur "on" | "off"
    const srToggles = Object.keys(body).filter(k => k.startsWith("__srToggle__"));
    if (srToggles.length) {
      const data = readRaw_(T_CONSIGNES);
      const H = data.header.map(h => String(h||'').trim());
      const iU = H.indexOf('user');
      const iId = H.indexOf('id');
      const iSr = H.indexOf('sr');
      const iUpd = H.indexOf('updatedAt');

      const mapToggle = new Map();
      for (const k of srToggles) {
        const id = k.replace("__srToggle__", "");
        const val = (String(body[k]||'').toLowerCase() === 'on') ? 'on' : 'off';
        mapToggle.set(String(id), val);
      }

      for (let i = 0; i < data.rows.length; i++) {
        const r = data.rows[i];
        const rUser = String(r[iU]||'').toLowerCase();
        const rId   = String(r[iId]||'');
        if (rUser === user && mapToggle.has(rId)) {
          if (iSr >= 0)  r[iSr] = mapToggle.get(rId);   // maj sr
          if (iUpd >= 0) r[iUpd] = now_();              // maj updatedAt
          data.rows[i] = r;
        }
      }
      writeAll_(T_CONSIGNES, data.header, data.rows);
    }

    return json_({ saved: entries.length, srToggled: srToggles.length });
  }

  // 2) CRUD consignes
  if (body._action === 'consigne_create') {
    const id = body.id || ('c_' + Utilities.getUuid().slice(0,8));
    const row = [
      user,
      id,
      body.label || '',
      body.category || '',
      body.type || 'text',
      Number(body.priority || 2),
      body.frequency || '',
      (body.sr ? 'on' : (body.sr === false ? 'off' : '')),             // sr (texte)
      body.extra ? (typeof body.extra === 'string' ? body.extra : JSON.stringify(body.extra)) : '',
      now_(), now_(),
      'active'
    ];
    append_(T_CONSIGNES, [row]);
    return json_({ ok:true, id });
  }

  if (body._action === 'consigne_update') {
    const data = readRaw_(T_CONSIGNES);
    const H = data.header.map(h=>String(h||'').trim());
    const iU=H.indexOf('user'), iId=H.indexOf('id'), iUpd=H.indexOf('updatedAt');
    const upKeys = ['label','category','type','priority','frequency','sr','extra','status'];

    for (let i=0;i<data.rows.length;i++){
      const r = data.rows[i];
      if (String(r[iU]||'').toLowerCase()===user && String(r[iId])===String(body.id)){
        for (const k of upKeys){
          const idx = H.indexOf(k); if (idx<0 || body[k]===undefined) continue;
          r[idx] = (k==='extra' && typeof body[k]!=='string') ? JSON.stringify(body[k]) : body[k];
        }
        if (iUpd>=0) r[iUpd]=now_();
        data.rows[i]=r; break;
      }
    }
    writeAll_(T_CONSIGNES, data.header, data.rows);
    return json_({ ok:true });
  }

  if (body._action === 'consigne_delete') {
    const data = readRaw_(T_CONSIGNES);
    const H = data.header.map(h=>String(h||'').trim());
    const iU=H.indexOf('user'), iId=H.indexOf('id'), iSt=H.indexOf('status'), iUpd=H.indexOf('updatedAt');

    for (let i=0;i<data.rows.length;i++){
      const r = data.rows[i];
      if (String(r[iU]||'').toLowerCase()===user && String(r[iId])===String(body.id)){
        if (iSt>=0) r[iSt] = 'deleted';
        if (iUpd>=0) r[iUpd]=now_();
        data.rows[i]=r; break;
      }
    }
    writeAll_(T_CONSIGNES, data.header, data.rows);
    return json_({ ok:true });
  }

  // 3) Création user (facultatif)
  if (body._action === 'user_create') {
    const data = readRaw_(T_USERS);
    const H = data.header.map(h=>String(h||'').trim());
    const iUser = H.indexOf('user');
    const exists = data.rows.some(r => String(r[iUser]||'').toLowerCase() === user);
    if (!exists) {
      // on insère en respectant les colonnes existantes (apiUrl, chatId, etc. si présentes)
      const row = new Array(H.length).fill('');
      if (iUser>=0) row[iUser] = user;
      const iStatus = H.indexOf('status');       if (iStatus>=0) row[iStatus] = 'active';
      const iCreated= H.indexOf('createdAt');    if (iCreated>=0) row[iCreated]= now_();
      const iUpdated= H.indexOf('updatedAt');    if (iUpdated>=0) row[iUpdated]= now_();
      append_(T_USERS, [row]);
    }
    return json_({ ok:true });
  }

  return json_({ ok:true });
}
