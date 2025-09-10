// ============================
//  Code.gs - Constantes & utilitaires
// ============================
const CONFIG_SHEET_ID = '1D9M3IEPtD7Vbdt7THBvNm8CiQ3qdrelyR-EdgNmd6go';

const ANSWER_VALUES = {
  "oui": 1,
  "plutot oui": 0.75,
  "moyen": 0.25,
  "plutot non": 0,
  "non": -1,
  "pas de reponse": 0
};
const DELAYS = [0, 1, 2, 3, 5, 8, 13];
const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
function withLock(fn){
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function clean(str) {
  return (str || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\u00A0\u202F\u200B]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function _cors(out) {
  // Apps Script TextOutput ne supporte pas setHeader; les CORS sont gérés par le Worker
  return out;
}
function json(o) { return _cors(ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)); }
function text(s) { return _cors(ContentService.createTextOutput(String(s)).setMimeType(ContentService.MimeType.TEXT)); }

// Évite l'interprétation UTC de "YYYY-MM-DD"
function parseISODateLocal(s) {
  var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // minuit local
}

// ============================
//  doGet — lecture
// ============================
function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tracking');
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const data = sheet.getRange(2, 1, Math.max(0, lastRow - 1), lastCol).getValues();

  // ---------- MODE CONSIGNES (liste & recherche) ----------
  if (clean(e?.parameter?.mode) === "consignes") {
    const out = [];
    data.forEach((row, i) => {
      const rowIndex = i + 2;
      const anchor = sheet.getRange(rowIndex, 1);
      const id = ensureRowId(anchor);
      const priority = getPriority(anchor);
      const cat = (row[1] || "").toString().trim();   // B
      const type = (row[2] || "").toString().trim();  // C
      const freq = (row[3] || "").toString().trim();  // D
      const label = (row[4] || "").toString().trim(); // E
      if (!label) return;
      out.push({ id, category: cat, type, frequency: freq, label, priority, rowIndex });
    });
    return json(out);
  }

  // ---------- MODE OVERVIEW (vue globale) ----------
  if (clean(e?.parameter?.mode) === "overview") {
    const today = new Date();
    today.setHours(0,0,0,0);
    const refDayName = today.toLocaleDateString("fr-FR", { weekday: "long" }).toLowerCase();

    // Construire dailyResp localement à partir de headers/data
    const result = [];
    for (let idx = 0; idx < data.length; idx++) {
      const row = data[idx];
      const type = row[2] || "";   // C
      const freqRaw = row[3] || ""; // D
      const label = row[4] || "";  // E
      const cat = row[1] || "";    // B

      const freq = clean(freqRaw);
      if (freq.includes("archiv")) continue; // ignorer les consignes archivées
      if (freq.includes("pratique deliberee") || freq.includes("pratique délibérée")) continue; // exclure pratique

      const isQuotidien = freq.includes("quotidien");
      const matchingDays = JOURS.filter(j => freq.includes(j));
      let include = isQuotidien || matchingDays.includes(refDayName);

      // SR pour overview: ne pas masquer, juste priorité et label suffisent
      const rowIndex = idx + 2;
      const anchor = sheet.getRange(rowIndex, 1);
      const priority = getPriority(anchor);
      const qid = ensureRowId(anchor);

      // Historique pour streaks
      const history = [];
      for (let col = headers.length - 1; col >= 5; col--) {
        const dateStr = headers[col];
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(dateStr))) continue;
        const val = row[col];
        if (val !== "" && val !== null && val !== undefined) {
          history.push({ value: val, date: dateStr, colIndex: col });
        }
      }

      if (include && label) {
        result.push({ id: qid, label, priority, history });
      }
    }

    const toDo = { p1:0, p2:0, p3:0, total:0 };
    result.forEach(q => {
      const p = q.priority || 2;
      if (p === 1) toDo.p1++; else if (p === 2) toDo.p2++; else toDo.p3++;
      toDo.total++;
    });

    function norm(v){ return clean(v); }
    const POS = new Set(["oui","plutot oui"]);
    const dateRe = /(\d{2})\/(\d{2})\/(\d{4})/;
    const dateOf = (h) => {
      const s = String(h?.date || h?.key || "");
      const m = s.match(dateRe);
      return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : null;
    };
    const streaks = result.map(q => {
      const ord = (q.history || [])
        .map(h => ({ h, d: dateOf(h) }))
        .filter(x => x.d)
        .sort((a,b) => b.d - a.d)
        .map(x => x.h);
      let s = 0; for (const e2 of ord) { if (POS.has(norm(e2.value))) s++; else break; }
      return { id: q.id, label: q.label, priority: q.priority || 2, streak: s };
    }).sort((a,b) => b.streak - a.streak).slice(0, 5);

    return json({ toDo, topStreaks: streaks });
  }

  // ---------- MODE PRATIQUE (itérations) ----------
  if (clean(e?.parameter?.mode) === "practice") {
    const CAT_COL = 1;  // B (0-index)
    const TYPE_COL = 2; // C
    const FREQ_COL = 3; // D
    const LABEL_COL = 4;// E

    // a) Liste des catégories
    if (!e?.parameter?.category) {
      const categoriesSet = {};
      data.forEach(row => {
        const freq = clean(row[FREQ_COL]);
        const cat = (row[CAT_COL] || "").toString().trim();
        if (!cat) return;
        if (freq.includes("archiv")) return; // exclure archivées
        if (freq.includes("pratique deliberee") || freq.includes("pratique délibérée")) {
          categoriesSet[cat] = true;
        }
      });
      const categories = Object.keys(categoriesSet);
      return json(categories);
    }

    // b) Questions d'une catégorie
    const selectedCat = (e.parameter.category || "").toString().trim();

    const out = [];
    data.forEach((row, idx) => {
      const freq = clean(row[FREQ_COL]);
      const cat = (row[CAT_COL] || "").toString().trim();
      if (!cat || cat !== selectedCat) return;
      if (freq.includes("archiv")) return; // exclure archivées
      if (!(freq.includes("pratique deliberee") || freq.includes("pratique délibérée"))) return;

      const type = row[TYPE_COL] || "";
      const label = row[LABEL_COL] || "";
      if (!label) return;

      // Historique "Catégorie N"
      const history = [];
      for (let c = 5; c < headers.length; c++) { // à partir de F
        const key = (headers[c] || "").toString();
        if (key.startsWith(selectedCat + " ")) {
          const val = row[c];
          if (val !== "" && val !== null && val !== undefined) {
            history.push({ key, value: val, colIndex: c });
          }
        }
      }

      // Lire tags / SR / remain depuis la note de l'ancre (col A)
      const rowIndex = idx + 2; // data commence ligne 2
      const anchor = sheet.getRange(rowIndex, 1);
      const remain = getPracticeRemaining(anchor, selectedCat); // { remain, human } | null
      const srInfo = getSRInfo(anchor); // { on, unit, n, interval, ... } | { on:false }
      const skipped = shouldSkipPracticeRemaining(anchor, selectedCat);
      const priority = getPriority(anchor);
      const qid = ensureRowId(anchor);

      out.push({
        id: qid,
        label,
        type,
        history,
        skipped,
        category: selectedCat,
        frequency: row[FREQ_COL] || "",
        scheduleInfo: remain
          ? { unit: "iters", remaining: remain.remain, nextDate: null, sr: srInfo }
          : { unit: "iters", remaining: 0,        nextDate: null, sr: srInfo },
        priority
      });
    });

    return json(out);
  }

  // ---------- MODE JOURNALIER (inchangé) ----------
  const queryDate = e?.parameter?.date;
  let referenceDate = queryDate ? parseISODateLocal(queryDate) : new Date();
  if (!referenceDate) referenceDate = new Date();
  const refDayName = referenceDate.toLocaleDateString("fr-FR", { weekday: "long" }).toLowerCase();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  referenceDate.setHours(0, 0, 0, 0);
  const isToday = referenceDate.getTime() === today.getTime();
  const refDateOnly = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());

  function computeScoreAndLastDate(row) {
    let totalScore = 0;
    let lastDate = null;
    for (let col = headers.length - 1; col >= 5; col--) {
      const header = String(headers[col] || "");
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(header)) continue; // <- ignorer non-dates

      const answer = clean(row[col]);
      if (!answer) continue;
      totalScore += (ANSWER_VALUES[answer] ?? 0);

      const [d, m, y] = header.split("/");
      const dObj = new Date(`${y}-${m}-${d}`);
      if (!lastDate || dObj > lastDate) lastDate = dObj;
    }
    totalScore = Math.max(0, Math.min(6, Math.round(totalScore)));
    return { score: totalScore, lastDate };
  }

  const result = [];
  for (let idx = 0; idx < data.length; idx++) {
    const row = data[idx];
    const type = row[2] || "";   // C
    const freqRaw = row[3] || ""; // D
    const label = row[4] || "";  // E
    const cat = row[1] || "";    // B

    const freq = clean(freqRaw);
    if (freq.includes("archiv")) continue; // exclure archivées
    const isQuotidien = freq.includes("quotidien");
    const isSpaced = freq.includes("repetition espacee") || freq.includes("répétition espacée");

    // Exclure pratique délibérée
    if (freq.includes("pratique deliberee") || freq.includes("pratique délibérée")) continue;

    // Préparer ancre (A) tôt pour lire tags
    const rowIndex = idx + 2;
    const anchor = sheet.getRange(rowIndex, 1);

    // Historique (inchangé)
    const history = [];
    for (let col = headers.length - 1; col >= 5; col--) {
      const val = row[col];
      const dateStr = headers[col];
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(dateStr))) continue;
      if (val !== "" && val !== null && val !== undefined) {
        const [d, m, y] = dateStr.split("/");
        const entryDate = new Date(`${y}-${m}-${d}`);
        const entryOnly = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate());
        if (entryOnly <= refDateOnly) history.push({ value: val, date: dateStr, colIndex: col });
      }
    }

    let include = false;
    let skipped = false;
    let nextDate = null;
    let reason = null;
    let spacedInfo = null;

    // 1) Règle de base : quotidien / jour correspondant
    if (isQuotidien || JOURS.filter(j => freq.includes(j)).includes(refDayName)) include = true;

    // 2) SR manuel [delay:daily]
    const selISO = Utilities.formatDate(refDateOnly, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const manual = getDailyDue(anchor); // { dueISO, human } | null
    if (manual) {
      const dueISO = manual.dueISO;
      if (selISO < dueISO) {
        include = false;
        skipped = true;
        const manualNextFR = Utilities.formatDate(_parseISO(dueISO), Session.getScriptTimeZone(), "dd/MM/yyyy");
        nextDate = manualNextFR;
        reason = `⏱️ Répétition espacée — revient le ${manualNextFR}.`;
      }
    }

    // 3) SR automatique (score -> DELAYS)
    if (isSpaced) {
      const { score, lastDate } = computeScoreAndLastDate(row);
      const delay = DELAYS[score];
      let next = null;
      if (lastDate) {
        next = new Date(lastDate);
        next.setHours(0,0,0,0);
        next.setDate(next.getDate() + delay);
      }
      const nextFR = next ? Utilities.formatDate(next, Session.getScriptTimeZone(), "dd/MM/yyyy") : null;
      spacedInfo = {
        score,
        lastDate: lastDate ? Utilities.formatDate(lastDate, Session.getScriptTimeZone(), "dd/MM/yyyy") : null,
        nextDate: nextFR
      };
      if (!next || referenceDate >= next) include = true;
      else if (isToday && referenceDate < next) {
        include = false; skipped = true; nextDate = nextFR;
        reason = `✅ Réponse positive enregistrée récemment. Prochaine apparition prévue le ${nextFR}.`;
      }
    }

    // Priority & Row ID
    const priority = getPriority(anchor);
    const qid = ensureRowId(anchor);
    const srInfo = getSRInfo(anchor);

    if (skipped) {
      result.push({
        id: qid, label, type, history,
        isSpaced, spacedInfo, priority,
        category: cat, frequency: freqRaw,
        scheduleInfo: { unit: "days", nextDate: nextDate || spacedInfo?.nextDate || null, sr: srInfo },
        skipped: true, nextDate, reason
      });
    } else if (include && label) {
      result.push({
        id: qid, label, type, history,
        isSpaced, spacedInfo, priority,
        category: cat, frequency: freqRaw,
        scheduleInfo: { unit: "days", nextDate: nextDate || spacedInfo?.nextDate || null, sr: srInfo },
        skipped: false
      });
    }
  }

  return json(result);
}

// ============================
//  doPost — écriture
// ============================
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tracking');
  let data = {};
  try {
    data = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
  } catch (err) {
    return text("❌ JSON invalide");
  }

  // --- Proxy GET depuis le Worker: router vers doGet ---
  function _parseQueryParams(q) {
    var params = {};
    q = String(q || "");
    if (q.startsWith("?")) q = q.slice(1);
    if (!q) return params;
    q.split("&").forEach(function (pair) {
      if (!pair) return;
      var kv = pair.split("=");
      var k = decodeURIComponent(kv[0] || "");
      var v = decodeURIComponent(kv[1] || "");
      if (!k) return;
      if (params[k] !== undefined) {
        if (Array.isArray(params[k])) params[k].push(v);
        else params[k] = [params[k], v];
      } else {
        params[k] = v;
      }
    });
    return params;
  }
  if (data && data._proxy === true && String(data.method).toUpperCase() === "GET") {
    var params = _parseQueryParams(data.query || "");
    return doGet({ parameter: params });
  }

  // ---------- CONSIGNES: create/update/delete ----------
  if (clean(data._action) === "consigne_create" ||
      clean(data._action) === "consigne_update" ||
      clean(data._action) === "consigne_delete") {

    const labelsRange = sheet.getRange(2, 5, Math.max(0, sheet.getLastRow()-1), 1); // col E
    const labels = labelsRange.getValues().flat();

    if (clean(data._action) === "consigne_create") {
      const lastRow = sheet.getLastRow()+1;
      const defaultFreq = data.frequency || "pratique délibérée";
      sheet.getRange(lastRow, 1).setValue(""); // ancre
      sheet.getRange(lastRow, 2).setValue(data.category || "");
      sheet.getRange(lastRow, 3).setValue(data.type || "");
      sheet.getRange(lastRow, 4).setValue(defaultFreq);
      sheet.getRange(lastRow, 5).setValue(data.label || "");
      const anchor = sheet.getRange(lastRow, 1);
      ensureRowId(anchor);
      setPriority(anchor, parseInt(data.priority,10)||2);
      // SR ON par défaut : en jours pour le quotidien/jours/sr, en itérations pour la pratique délibérée
      const f = clean(defaultFreq);
      const unit = (f.includes("pratique deliberee") || f.includes("pratique délibérée")) ? "iters" : "days";
      setSRToggle(anchor, true, unit);
      return text("✅ consigne créée");
    }

    let rowIndex = 0;
    if (data.id) {
      for (let i=0;i<labels.length;i++){
        const r = i+2;
        const anchor = sheet.getRange(r,1);
        if (getRowId(anchor) === data.id) { rowIndex = r; break; }
      }
    }
    if (!rowIndex && data.label){
      const idx = labels.indexOf(data.label);
      if (idx >= 0) rowIndex = idx + 2;
    }
    if (!rowIndex) {
      return text("❌ consigne introuvable");
    }

    if (clean(data._action) === "consigne_delete") {
      sheet.deleteRow(rowIndex);
      return text("✅ consigne supprimée");
    }

    if (data.category != null) sheet.getRange(rowIndex,2).setValue(data.category);
    if (data.type != null)     sheet.getRange(rowIndex,3).setValue(data.type);
    if (data.frequency != null)sheet.getRange(rowIndex,4).setValue(data.frequency);
    if (data.newLabel != null) sheet.getRange(rowIndex,5).setValue(data.newLabel);
    if (data.priority != null) setPriority(sheet.getRange(rowIndex,1), parseInt(data.priority,10)||2);
    // Adapter l'unité SR si la fréquence a changé
    if (data.frequency != null) {
      const f = clean(data.frequency || "");
      const unit = (f.includes("pratique deliberee") || f.includes("pratique délibérée")) ? "iters" : "days";
      const anchor = sheet.getRange(rowIndex, 1);
      const prev = getSRInfo(anchor);
      setSRToggle(anchor, !!prev.on, unit);
    }

    return text("✅ consigne mise à jour");
  }

  // ---------- MODE PRATIQUE ----------
  if (clean(data._mode) === "practice") {
    const category = (data._category || "").toString().trim();
    if (!category) {
      return text("❌ Catégorie manquante");
    }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    // Trouver le prochain n pour "Catégorie n"
    let maxN = 0;
    headers.forEach(h => {
      const s = (h || "").toString();
      if (s.startsWith(category + " ")) {
        const n = parseInt(s.slice((category + " ").length), 10);
        if (!isNaN(n)) maxN = Math.max(maxN, n);
      }
    });
    const nextN = maxN + 1;
    const newHeader = `${category} ${nextN}`;

    // Insérer la nouvelle colonne à l’index cible (F = 6)
    const targetIndex = 6;
    withLock(function(){
      sheet.insertColumnBefore(targetIndex);
      sheet.getRange(1, targetIndex).setValue(newHeader);
    });

    // ⬇️ NOUVEAU : décrémenter le remain pour toute la catégorie
    const lastRow = sheet.getLastRow();
    decrementPracticeRemainForCategory(sheet, category, 2, Math.max(0, lastRow - 1), 1);

    // Patch : Parcours des lignes -> par ID
    for (let rowIdx = 2; rowIdx <= lastRow; rowIdx++) {
      const anchor = sheet.getRange(rowIdx, 1);
      const qid = ensureRowId(anchor);       // <-- ID stable
      const rCell = sheet.getRange(rowIdx, targetIndex);

      // 1) Toggle SR (par ID)
      const tKey = "__srToggle__" + qid;
      if (data[tKey] === "on" || data[tKey] === "off") {
        setSRToggle(anchor, data[tKey] === "on", "iters");
      }

      // 2) Écriture réponse (clé = ID)
      if (qid && data[qid] !== undefined && data[qid] !== "") {
        rCell.setValue(data[qid]);

        // 3) SR après réponse (streak demi-point)
        applySRAfterAnswer(rCell, 1, category, "practice", data[qid]);
      }

  // ...délai manuel supprimé : SR-only
    }

    return text("✅ Itération enregistrée !");
  }

  // ---------- MODE JOURNALIER (inchangé) ----------
  // ---------- MODE JOURNALIER ----------
  const selectedDate = data._date;
  if (!selectedDate) {
    return text("❌ Date manquante");
  }

  const parsedDate = new Date(selectedDate);
  const dateStr = Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), "dd/MM/yyyy");

  // 1) S'assurer que l'en-tête existe à F (targetIndex)
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const targetIndex = 6; // F
  let dateColIndex = headers.indexOf(dateStr) + 1; // 1-based

  if (dateColIndex === 0) {
    // nouvelle colonne à F
    withLock(function(){
      sheet.insertColumnBefore(targetIndex);
      sheet.getRange(1, targetIndex).setValue(dateStr);
    });
    dateColIndex = targetIndex;
  } else if (dateColIndex !== targetIndex) {
    // Calculer la source AVANT insertion, puis effectuer l'opération sous verrou
    const headers0 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let srcIdx = headers0.indexOf(dateStr) + 1; // 1-based (0 => introuvable)

    withLock(function(){
      if (srcIdx === 0) {
        sheet.insertColumnBefore(targetIndex);
        sheet.getRange(1, targetIndex).setValue(dateStr);
        return;
      }
      if (srcIdx === targetIndex) return;
      sheet.insertColumnBefore(targetIndex);
      const lastRowNow = sheet.getLastRow();
      if (srcIdx >= targetIndex) srcIdx += 1; // la source a glissé d'une colonne
      sheet.getRange(1, srcIdx, lastRowNow).moveTo(sheet.getRange(1, targetIndex, lastRowNow));
      sheet.deleteColumn(srcIdx + (srcIdx > targetIndex ? 0 : 1));
    });
    dateColIndex = targetIndex;
  }

  // 2) Parcours des lignes -> par ID
  const lastRow = sheet.getLastRow();
  for (let rowIdx = 2; rowIdx <= lastRow; rowIdx++) {
    const anchor = sheet.getRange(rowIdx, 1);
    const qid = ensureRowId(anchor);
    const rCell = sheet.getRange(rowIdx, targetIndex);

    // a) Toggle SR (jours)
    const tKey = "__srToggle__" + qid;
    if (data[tKey] === "on" || data[tKey] === "off") {
      setSRToggle(anchor, data[tKey] === "on", "days");
    }

    // b) Réponse du jour (clé = ID)
    if (qid && data[qid] !== undefined && data[qid] !== "") {
      rCell.setValue(data[qid]);
      // c) SR demi-point -> pose le délai auto s'il faut
      applySRAfterAnswer(rCell, 1, selectedDate, "daily", data[qid]);
    }
  }

  return text("✅ Données enregistrées !");
}

// ============================
//  (Optionnel) Rappels Telegram
//  — on EXCLUT la “pratique délibérée”
// ============================
function sendTelegramMessage(chatId, message, botToken) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: message })
  };
  UrlFetchApp.fetch(url, options);
}

function sendAllTelegramReminders() {
  const configSheet = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheets()[0];
  const configData = configSheet.getDataRange().getValues();
  const cfgHeaders = configData[0].map(h => h.toString().toLowerCase());
  const today = new Date();
  const refDayName = today.toLocaleDateString("fr-FR", { weekday: "long" }).toLowerCase();
  const formattedDate = Utilities.formatDate(today, Session.getScriptTimeZone(), "dd/MM/yyyy");

  configData.slice(1).forEach(row => {
    const user = (row[0] || "").toString().toLowerCase();
  const chatId = row[cfgHeaders.indexOf("chatid")];
  const botApi = row[cfgHeaders.indexOf("api telegram")];
  const sheetUrl = row[cfgHeaders.indexOf("sheet url")];
  const trackingUrl = row[cfgHeaders.indexOf("url tracking")];
    if (!user || !chatId || !botApi || !sheetUrl || !trackingUrl) return;

    try {
      const ssId = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      const trackingSheet = SpreadsheetApp.openById(ssId).getSheetByName("Tracking");

      const lr = trackingSheet.getLastRow();
      const lc = trackingSheet.getLastColumn();
      const headersTracking = trackingSheet.getRange(1, 1, 1, lc).getValues()[0];
      const data  = lr > 1 ? trackingSheet.getRange(2, 1, lr - 1, lc).getValues() : [];
      const notes = lr > 1 ? trackingSheet.getRange(2, 1, lr - 1, 1).getNotes().map(r => r[0] || "") : [];

      let count = 0;
      if (data.length > 0) {
        data.forEach((r, i) => {
          const freq = clean(r[3]);
          if (freq.includes("archiv")) return; // exclure archivées

          // ❌ Exclure la pratique délibérée des rappels quotidiens
          if (freq.includes("pratique deliberee") || freq.includes("pratique délibérée")) return;

          const isSpaced = freq.includes("repetition espacee") || freq.includes("répétition espacée");
          const isQuotidien = freq.includes("quotidien");
          const isMatchingDay = JOURS.some(j => freq.includes(j) && j === refDayName);

          let include = false;
          if (isSpaced) {
            let score = 0;
            let lastDate = null;
            for (let col = headersTracking.length - 1; col >= 5; col--) {
              const header = String(headersTracking[col] || "");
              if (!/^\d{2}\/\d{2}\/\d{4}$/.test(header)) continue; // ignorer non-dates
              const val = clean(r[col]);
              if (!val) continue;
              score += ANSWER_VALUES[val] ?? 0;
              const [d, m, y] = header.split("/");
              const parsed = new Date(`${y}-${m}-${d}`);
              if (!lastDate || parsed > lastDate) lastDate = parsed;
            }
            score = Math.max(0, Math.min(6, Math.round(score)));
            const delay = DELAYS[score];
            if (lastDate) {
              const next = new Date(lastDate);
              next.setHours(0,0,0,0);
              next.setDate(next.getDate() + delay);
              include = today >= next;
            } else include = true;
          }

          if (!isSpaced && (isQuotidien || isMatchingDay)) {
            include = true;
          }

          // Ignorer si délai manuel daily en cours
          const dueISO = notes[i] ? (notes[i].match(/\[delay:daily\|[^]]*due=(\d{4}-\d{2}-\d{2})/)?.[1] || null) : null;
          if (dueISO) {
            include = include && (Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd") >= dueISO);
          }

          if (include) count++;
        });
      }
  // Après le calcul de `count`…
  const botToken = botApi.replace("https://api.telegram.org/bot", "").split("/")[0];
  const displayUser = user.charAt(0).toUpperCase() + user.slice(1);
  const message = count === 0
    ? `🎉 Hello ${displayUser}, rien à remplir aujourd’hui !\n👉 ${trackingUrl}`
    : `📋 Hello ${displayUser}, tu as ${count} chose(s) à traquer aujourd’hui (${formattedDate})\n👉 ${trackingUrl}`;

  sendTelegramMessage(chatId, message, botToken);
    } catch (e) {
      Logger.log(`Erreur pour ${user} : ${e}`);
    }
  });
}

// ============================
//  Migration optionnelle
// ============================
function migrateAllToPracticeDeliberee() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Tracking');
  const lr = sh.getLastRow();
  if (lr < 2) return;
  const values = sh.getRange(2,1,lr-1,5).getValues(); // A..E
  for (let i=0;i<values.length;i++){
    const row = 2+i;
    const freqCell = sh.getRange(row,4);
    const label = values[i][4];
    const freq = (values[i][3]||"").toString().toLowerCase();
    if (!label) continue;
    if (freq.includes("archiv")) continue; // ne pas toucher aux archivées
    // forcer pratique délibérée + SR iters ON
    freqCell.setValue("pratique délibérée");
    const anchor = sh.getRange(row,1);
    setSRToggle(anchor, true, "iters");
  }
}
