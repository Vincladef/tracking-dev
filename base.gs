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
const T_SCHEDULES = 'SCHEDULES'; // For scheduling and spaced repetition

// Column indices for CONSIGNES sheet (0-based)
const CONSIGNES_COLS = {
  ID: 0,           // A: id
  USER: 1,         // B: user
  CATEGORY: 2,     // C: category
  SR_ON: 3,        // D: sr (on/off)
  SR_UNIT: 4,      // E: sr_unit (iters/days)
  SR_REMAINING: 5, // F: sr_remaining (number of iterations left)
  SKIPPED: 6,      // G: skipped (1/true if hidden, empty otherwise)
  UPDATED_AT: 7    // H: updatedAt (timestamp)
};

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
function fromISO_(iso){ // "YYYY-MM-DD" -> Date (00:00:00)
  const [y,m,d] = String(iso||'').split('-').map(Number);
  return new Date(y, (m||1)-1, d||1, 0,0,0,0);
}

// Helper for retrying Google Sheets operations with exponential backoff
function withBackoff_(fn) {
  var wait = 300, tries = 0;
  while (true) {
    try { 
      return fn(); 
    } catch (e) {
      tries++;
      if (tries >= 5) throw e;
      Utilities.sleep(wait);
      wait = Math.min(wait * 2, 5000);
    }
  }
}

function norm_(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim(); }
function isPractice_(freq){ return /pratique\s*deliberee/.test(norm_(freq)); }
function isArchived_(freq){ return /archiv/.test(norm_(freq)); }
function dayNameFrFromISO_(iso){
  const d = fromISO_(iso);
  const DAYS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  return DAYS[d.getDay()];
}

function now_(){ return new Date(); }
function todayYMD_(){ return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

// ===== Scheduling and Spaced Repetition Helpers =====
function ensureSchedulesHeader_(){
  const s = sh_(T_SCHEDULES);
  const want = ['user','id','unit','n','interval','dueISO','remaining','updatedAt'];
  const firstRow = s.getRange(1,1,1,Math.max(s.getLastColumn(), want.length)).getValues()[0] || [];
  const have = firstRow.map(v=>String(v||'').trim());
  const ok = want.every((h,i)=> String(have[i]||'')===h);
  if (!ok) s.getRange(1,1,1,want.length).setValues([want]);
}

function upsertSchedule_(user, id, patch){
  ensureSchedulesHeader_(); // Ensure header exists before proceeding
  const data = readRaw_(T_SCHEDULES);
  const H = data.header.map(h=>String(h||'').trim());
  const iU=H.indexOf('user'), iId=H.indexOf('id');
  const now = now_();
  let hit = false;

  for (let i=0;i<data.rows.length;i++){
    const r = data.rows[i];
    if (String(r[iU]||'').toLowerCase()===user && String(r[iId])===String(id)){
      const o = Object.fromEntries(H.map((h,j)=>[h,r[j]]));
      Object.assign(o, patch, { user, id, updatedAt: now });
      data.rows[i] = H.map(h=> o[h] ?? '');
      hit = true; break;
    }
  }
  if (!hit){
    const o = Object.assign({ user, id }, patch, { updatedAt: now });
    const row = H.map(h=> o[h] ?? '');
    append_(T_SCHEDULES, [row]);
  } else {
    writeAll_(T_SCHEDULES, data.header, data.rows);
  }
}

function readSchedule_(user){
  const rows = readRows_(T_SCHEDULES);
  const out = new Map();
  rows.filter(r=> String(r.user||'').toLowerCase()===(user||'').toLowerCase())
      .forEach(r => out.set(String(r.id), r));
  return out; // Map id -> row
}

function addDays_(iso, n){
  const d = fromISO_(iso);
  d.setDate(d.getDate()+Number(n||0));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function likert_(val){ // "Oui"=4 ..."Non"=0
  const s = String(val||'').toLowerCase();
  if (/^oui$/.test(s)) return 4;
  if (/plut[oô]t\s*oui/.test(s)) return 3;
  if (/moyen/.test(s)) return 2;
  if (/plut[oô]t\s*non/.test(s)) return 1;
  if (/^non$/.test(s)) return 0;
  return null;
}

function asISO_(d){
  const tz = Session.getScriptTimeZone();
  if (d instanceof Date) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const s = String(d||'');
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s;
}

function formatFr_(iso){ // "YYYY-MM-DD" -> "dd/MM/yyyy"
  if (!iso) return '';
  const d = fromISO_(iso);
  if (!d) return String(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// Parse the __srIterDec JSON array from the request body
function parseSrIterDec_(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (e) {
    console.error('Error parsing __srIterDec:', e);
    return [];
  }
}

// Decrement SR iterations for specific question IDs in practice mode
function srTickIterations_(user, ids) {
  if (!ids?.length) return 0;
  
  const ss = SS();
  const sheet = ss.getSheetByName(T_CONSIGNES);
  const data = sheet.getDataRange().getValues();
  const header = data[0] || [];
  
  // Find column indices if they exist
  const colIdx = {
    id: header.findIndex(h => String(h).toLowerCase() === 'id'),
    user: header.findIndex(h => String(h).toLowerCase() === 'user'),
    sr: header.findIndex(h => String(h).toLowerCase() === 'sr'),
    srUnit: header.findIndex(h => String(h).toLowerCase() === 'sr_unit'),
    srRemaining: header.findIndex(h => String(h).toLowerCase() === 'sr_remaining'),
    skipped: header.findIndex(h => String(h).toLowerCase() === 'skipped'),
    updatedAt: header.findIndex(h => String(h).toLowerCase() === 'updatedat')
  };
  
  // Skip if required columns are missing
  if (Object.values(colIdx).some(idx => idx === -1)) {
    console.error('Missing required columns in CONSIGNES sheet');
    return 0;
  }
  
  const targetIds = new Set(ids.map(String));
  let updatedCount = 0;
  
  // Process each row (skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowUser = String(row[colIdx.user] || '').toLowerCase();
    const rowId = String(row[colIdx.id] || '');
    
    // Skip if not the target user or ID
    if (rowUser !== user || !targetIds.has(rowId)) continue;
    
    const srOn = String(row[colIdx.sr] || '').toLowerCase() === 'on';
    const srUnit = String(row[colIdx.srUnit] || '').toLowerCase();
    let remaining = Number(row[colIdx.srRemaining] || 0);
    
    // Only process if SR is on, unit is 'iters', and there are remaining iterations
    if (srOn && srUnit === 'iters' && remaining > 0) {
      remaining = Math.max(0, remaining - 1); // Decrement but don't go below 0
      row[colIdx.srRemaining] = remaining;
      
      // If remaining reaches 0, clear the skipped flag to make it visible again
      if (remaining <= 0 && colIdx.skipped !== -1) {
        row[colIdx.skipped] = '';
      }
      
      // Update the updatedAt timestamp if the column exists
      if (colIdx.updatedAt !== -1) {
        row[colIdx.updatedAt] = now_();
      }
      
      // Update the row in the sheet
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      updatedCount++;
      
      console.log(`[SR] Decremented iterations for id=${rowId}, remaining=${remaining}`);
    }
  }
  
  return updatedCount;
}

// Fallback function to decrement all skipped items in a category
function srTickAllSkippedInCategory_(user, category) {
  if (!user || !category) return 0;
  
  const ss = SS();
  const sheet = ss.getSheetByName(T_CONSIGNES);
  const data = sheet.getDataRange().getValues();
  const header = data[0] || [];
  
  // Find column indices if they exist
  const colIdx = {
    id: header.findIndex(h => String(h).toLowerCase() === 'id'),
    user: header.findIndex(h => String(h).toLowerCase() === 'user'),
    category: header.findIndex(h => String(h).toLowerCase() === 'category'),
    sr: header.findIndex(h => String(h).toLowerCase() === 'sr'),
    srUnit: header.findIndex(h => String(h).toLowerCase() === 'sr_unit'),
    srRemaining: header.findIndex(h => String(h).toLowerCase() === 'sr_remaining'),
    skipped: header.findIndex(h => String(h).toLowerCase() === 'skipped'),
    updatedAt: header.findIndex(h => String(h).toLowerCase() === 'updatedat')
  };
  
  // Skip if required columns are missing
  if (Object.values(colIdx).some(idx => idx === -1)) {
    console.error('Missing required columns in CONSIGNES sheet');
    return 0;
  }
  
  let updatedCount = 0;
  
  // Process each row (skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowUser = String(row[colIdx.user] || '').toLowerCase();
    const rowCategory = String(row[colIdx.category] || '');
    const isSkipped = String(row[colIdx.skipped] || '').trim() !== '';
    
    // Skip if not the target user, category, or not skipped
    if (rowUser !== user || rowCategory !== category || !isSkipped) continue;
    
    const srOn = String(row[colIdx.sr] || '').toLowerCase() === 'on';
    const srUnit = String(row[colIdx.srUnit] || '').toLowerCase();
    let remaining = Number(row[colIdx.srRemaining] || 0);
    
    // Only process if SR is on, unit is 'iters', and there are remaining iterations
    if (srOn && srUnit === 'iters' && remaining > 0) {
      remaining = Math.max(0, remaining - 1); // Decrement but don't go below 0
      row[colIdx.srRemaining] = remaining;
      
      // If remaining reaches 0, clear the skipped flag to make it visible again
      if (remaining <= 0 && colIdx.skipped !== -1) {
        row[colIdx.skipped] = '';
      }
      
      // Update the updatedAt timestamp if the column exists
      if (colIdx.updatedAt !== -1) {
        row[colIdx.updatedAt] = now_();
      }
      
      // Update the row in the sheet
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      updatedCount++;
      
      console.log(`[SR] Decremented iterations for id=${row[colIdx.id]}, remaining=${remaining}`);
    }
  }
  
  return updatedCount;
}

// Builds the object expected by the frontend
function buildQuestion_(consigne, sch, answersForId, ctx){
  const history = (answersForId||[])
    .map(a => ({ value: a.value, date: asISO_(a.date) }))
    .sort((a,b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : 0));
  const srOn = String(consigne.sr||'')==='on';

  const unit   = (sch?.unit==='iters') ? 'iters' : 'days';
  const dueIso = asISO_(sch?.dueISO); // <-- canonise (gère Date ou string)
  const nextDate = (unit==='days' && dueIso) ? formatFr_(dueIso) : null;
  const remaining = (unit==='iters') ? Number(sch?.remaining||0) : 0;

  let skipped = false;
  if (ctx.mode==='daily' && dueIso) {
    skipped = String(ctx.dateISO) < String(dueIso);
  }
  if (ctx.mode==='practice' && remaining>0) skipped = true;

  return {
    id: String(consigne.id),
    label: consigne.label,
    type: consigne.type || 'text',
    priority: Number(consigne.priority || 2),
    category: consigne.category || '',
    frequency: consigne.frequency || '',
    history,
    scheduleInfo: {
      unit, nextDate, remaining,
      sr: { on: srOn, n: Number(sch?.n||0), interval: Number(sch?.interval||0), due: dueIso||null }
    },
    skipped
  };
}

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
    if (p.category) {
      // Retourne les questions enrichies pour une catégorie spécifique (uniquement pratique délibérée)
      const cons = readRows_(T_CONSIGNES)
        .filter(r => String(r.user||'').toLowerCase() === user)
        .filter(r => String(r.status||'active') === 'active')
        .filter(r => String(r.category||'') === String(p.category||''))
        .filter(r => isPractice_(r.frequency) && !isArchived_(r.frequency));
      
      const schMap = readSchedule_(user);
      const ans = readRows_(T_ANSWERS).filter(a => String(a.user||'').toLowerCase() === user);
      const byId = new Map();
      
      ans.forEach(a => {
        const id = String(a.id || a.qid || '');
        if (!id) return;
        (byId.get(id) || byId.set(id, []).get(id)).push(a);
      });
      
      const out = cons.map(r => buildQuestion_(r, schMap.get(String(r.id)), byId.get(String(r.id)), { mode: 'practice' }));
      return json_({ consignes: out });
    } else {
      // Retourne uniquement la liste des catégories avec des consignes en pratique délibérée
      const rows = readRows_(T_CONSIGNES)
        .filter(r => String(r.user||'').toLowerCase() === user)
        .filter(r => String(r.status||'active') === 'active')
        .filter(r => isPractice_(r.frequency) && !isArchived_(r.frequency));
      
      const cats = [...new Set(
        rows.map(r => String(r.category||'').trim())
            .filter(Boolean)
      )];
      return json_({ categories: cats });
    }
  }

  // JOURNALIER: consignes + réponses existantes pour une date
  if (p.date) {
    const dateISO = String(p.date);
    const dayName = dayNameFrFromISO_(dateISO); // "lundi"..."dimanche"

    const cons = readRows_(T_CONSIGNES)
      .filter(r => String(r.user||'').toLowerCase() === user)
      .filter(r => String(r.status||'active') === 'active')
      // 1) exclure "pratique délibérée" et "archivé"
      .filter(r => !isPractice_(r.frequency) && !isArchived_(r.frequency))
      // 2) garder seulement "Quotidien" OU le jour correspondant
      .filter(r => {
        const f = norm_(r.frequency);
        return f.includes('quotidien') || f.includes(dayName);
      });
    
    const schMap = readSchedule_(user);
    const ans = readRows_(T_ANSWERS)
      .filter(a => String(a.user||'').toLowerCase() === user);
    
    const byId = new Map();
    ans.forEach(a => {
      const id = String(a.id || a.qid || '');
      if (!id) return;
      (byId.get(id) || byId.set(id, []).get(id)).push(a);
    });
    
    const out = cons.map(r => buildQuestion_(r, schMap.get(String(r.id)), byId.get(String(r.id)), { 
      mode: 'daily', 
      dateISO 
    }));
    
    return json_({ consignes: out });
  }

  return json_({ ok:true });
}

/***********************
 * doPost — écriture
 * - autosave/soumission (_mode, _date|_category, qid:value...)
 * - CRUD consignes (_action: consigne_create|update|delete)
 * - user_create (facultatif)
 ***********************/
function doPost(e) {
  const out = { ok: true, srDec: [], daily: [] };
  let body, user, mode;
  
  try {
    // Parse request body
    body = e.postData ? JSON.parse(e.postData.contents) : {};
    user = String(body.user || '').toLowerCase().trim();
    mode = body._mode || 'daily';
    
    if (!user) return json_({ ...out, ok: false, error: 'user_required' });
    
    // 0) Handle SR iteration decrements (practice mode)
    if (body.__srIterDec) {
      try {
        const ids = parseSrIterDec_(body.__srIterDec);
        if (ids.length > 0) {
          const updatedCount = srTickIterations_(user, ids);
          console.log(`[SR] Decremented iterations for ${updatedCount} items`);
          
          // Add to response
          const data = readRaw_(T_CONSIGNES);
          const H = data.header.map(h => String(h || '').trim());
          const iId = H.indexOf('id');
          const iSr = H.indexOf('sr');
          
          if (iId >= 0 && iSr >= 0) {
            for (const id of ids) {
              const row = data.rows.find(r => String(r[iId]) === String(id));
              if (row) {
                try {
                  const sr = JSON.parse(row[iSr] || '{}');
                  out.srDec.push({
                    id,
                    before: sr.remaining + 1, // +1 because we already decremented
                    after: sr.remaining
                  });
                } catch (e) {
                  console.error(`Error processing SR for id=${id}:`, e);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('Error in SR iteration decrement:', e);
      }
    }
    
    // 1) Handle daily SR hits (update next due date)
    if (body.__srDailyHit) {
      try {
        const ids = JSON.parse(body.__srDailyHit || '[]');
        const data = readRaw_(T_CONSIGNES);
        const H = data.header.map(h => String(h || '').trim());
        const iId = H.indexOf('id');
        const iSr = H.indexOf('sr');
        const iUser = H.indexOf('user');
        
        if (iId >= 0 && iSr >= 0 && iUser >= 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          for (const id of ids) {
            const rowIdx = data.rows.findIndex(r => 
              String(r[iId]) === String(id) && 
              String(r[iUser] || '').toLowerCase() === user
            );
            
            if (rowIdx >= 0) {
              try {
                const sr = JSON.parse(data.rows[rowIdx][iSr] || '{}');
                const prevDue = sr.nextDue ? new Date(sr.nextDue) : null;
                
                // Calculate next due date (simplified SR algorithm)
                const nextDue = new Date(today);
                const daysToAdd = sr.interval ? Math.min(sr.interval * 2, 30) : 1;
                nextDue.setDate(nextDue.getDate() + daysToAdd);
                
                // Update SR data
                sr.nextDue = nextDue.toISOString().split('T')[0];
                sr.lastReviewed = today.toISOString().split('T')[0];
                sr.interval = daysToAdd;
                
                // Update the row
                data.rows[rowIdx][iSr] = JSON.stringify(sr);
                
                // Add to response
                out.daily.push({ 
                  id, 
                  prevDue: prevDue ? prevDue.toISOString().split('T')[0] : null, 
                  nextDue: sr.nextDue 
                });
                
                console.log(`[SR][DAILY] id=${id} due:${prevDue}→${sr.nextDue} user=${user}`);
              } catch (e) {
                console.error(`Error processing daily hit for id=${id}:`, e);
              }
            }
          }
          
          // Save all updates
          if (out.daily.length > 0) {
            withBackoff_(() => writeAll_(T_CONSIGNES, data.header, data.rows));
          }
        }
      } catch (e) {
        console.error('Error in daily SR hit processing:', e);
      }
    }
    
    // 2) Save answers if present
    if (body._action === 'save_answers') {
      const entries = [];
      const date = body._date || new Date().toISOString().split('T')[0];
      
      // Add answers in format [user, date, question_id, value, metadata, timestamp]
      for (const [k, v] of Object.entries(body)) {
        if (k.startsWith('c_')) {
          entries.push([
            user,
            date,
            k,
            String(v || ''),
            JSON.stringify({ _mode: mode, _category: body._category || null }),
            now_()
          ]);
        }
      }
      
      if (entries.length) {
        withBackoff_(() => append_(T_ANSWERS, entries));
      }
    }

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

    // === (A) Délais manuels envoyés par le front ===
    //  - __delayDays__<id> = n (journalier)
    //  - __delayIter__<id> = n (pratique)
    //  - n === -1 => annuler le délai manuel
    const baseDateISO = body._date || todayYMD_();
    for (const [k,v] of Object.entries(body)) {
      if (k.startsWith('__delayDays__')) {
        const id = k.replace('__delayDays__','');
        const n = Number(v);
        if (n === -1) {
          upsertSchedule_(user, id, { unit:'days', n:0, interval:0, dueISO:'', remaining:'' });
        } else {
          upsertSchedule_(user, id, { unit:'days', n:0, interval:n, dueISO: addDays_(baseDateISO, n), remaining:'' });
        }
      }
      if (k.startsWith('__delayIter__')) {
        const id = k.replace('__delayIter__','');
        const n = Number(v);
        if (n === -1) {
          upsertSchedule_(user, id, { unit:'iters', n:0, interval:0, remaining:'', dueISO:'' });
        } else {
          upsertSchedule_(user, id, { unit:'iters', n:0, interval:n, remaining:n, dueISO:'' });
        }
      }
    }

    // === (B) SR auto : si la consigne a SR=ON, ajuster la planification selon la réponse ===
    const consById = new Map(
      readRows_(T_CONSIGNES)
        .filter(r=> String(r.user||'').toLowerCase()===user && String(r.status||'active')==='active')
        .map(r => [String(r.id), r])
    );
    const schMap = readSchedule_(user); // Map id -> row

    for (const [k,v] of Object.entries(body)) {
      // Ignore meta/commandes (_... , __...)
      if (k.startsWith('_') || k.startsWith('__')) continue;
      // id de question attendu: commence par lettre/chiffre, puis [A-Za-z0-9_-]
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(k)) continue;

      const cons = consById.get(String(k));
      if (!cons) continue;
      if (String(cons.sr||'')!=='on') continue; // SR désactivé -> on ignore
      const L = likert_(v); // 4..0 ou null
      if (L==null) continue;

      // lire schedule courant
      const sch = schMap.get(String(k)) || {};
      let n = Number(sch.n||0);
      if (!isFinite(n) || n<0) n = 0;

      if (body._mode==='daily'){
        // Oui +1 / Plutôt oui +0.5 / autres -> reset
        if (L>=4) n+=1; else if (L===3) n+=0.5; else n=0;
        const interval = Math.floor(n);
        upsertSchedule_(user, k, {
          unit:'days', n, interval,
          dueISO: addDays_(baseDateISO, interval),
          remaining:''
        });
      } else { // practice
        if (L>=4) n+=1; else if (L===3) n+=0.5; else n=0;
        const interval = Math.floor(n);
        upsertSchedule_(user, k, {
          unit:'iters', n, interval,
          remaining: interval,
          dueISO:''
        });
      }
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
