// ============================
//  Constantes & utilitaires
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
    return ContentService.createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ---------- MODE OVERVIEW (vue globale) ----------
  if (clean(e?.parameter?.mode) === "overview") {
  const todayISO = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    const dailyResp = JSON.parse(doGet({ parameter: { date: todayISO } }).getContent());

    // Compteurs P1/P2/P3/total (hors items masqués)
    const toDo = { p1:0, p2:0, p3:0, total:0 };
    dailyResp.forEach(q => {
      const p = q.priority || 2;
      if (!q.skipped) {
        if (p === 1) toDo.p1++;
        else if (p === 2) toDo.p2++;
        else toDo.p3++;
        toDo.total++;
      }
    });

    // Top streaks: tri fiable par date réelle (et pas par colIndex)
    function norm(v){ return clean(v); }
    const POS = new Set(["oui","plutot oui"]);
    const dateRe = /(\d{2})\/(\d{2})\/(\d{4})/;
    const dateOf = (h) => {
      const s = String(h?.date || h?.key || "");
      const m = s.match(dateRe);
      return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : null;
    };

    const streaks = dailyResp.map(q => {
      const ord = (q.history || [])
        .map(h => ({ h, d: dateOf(h) }))
        .filter(x => x.d)                 // garde seulement les entrées datées
        .sort((a,b) => b.d - a.d)         // récent → ancien
        .map(x => x.h);

      let s = 0;
      for (const e of ord) {
        if (POS.has(norm(e.value))) s++; else break;
      }
      return { id: q.id, label: q.label, priority: q.priority || 2, streak: s };
    }).sort((a,b) => b.streak - a.streak).slice(0, 5);

    return ContentService.createTextOutput(JSON.stringify({ toDo, topStreaks: streaks }))
      .setMimeType(ContentService.MimeType.JSON);
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
        if (freq.includes("pratique deliberee") || freq.includes("pratique délibérée")) {
          categoriesSet[cat] = true;
        }
      });
      const categories = Object.keys(categoriesSet);
      return ContentService
        .createTextOutput(JSON.stringify(categories))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // b) Questions d'une catégorie
    const selectedCat = (e.parameter.category || "").toString().trim();

    const out = [];
    data.forEach((row, idx) => {
      const freq = clean(row[FREQ_COL]);
      const cat = (row[CAT_COL] || "").toString().trim();
      if (!cat || cat !== selectedCat) return;
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

    return ContentService
      .createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ---------- MODE JOURNALIER (inchangé) ----------
  const queryDate = e?.parameter?.date;
  const referenceDate = queryDate ? new Date(queryDate) : new Date();
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
    const isQuotidien = freq.includes("quotidien");
    const isSpaced = freq.includes("repetition espacee") || freq.includes("répétition espacée");

    // ⚠️ Exclure le "pratique délibérée" du mode journalier
    if (freq.includes("pratique deliberee") || freq.includes("pratique délibérée")) {
      continue;
    }

    const matchingDays = JOURS.filter(j => freq.includes(j));

    const history = [];
    for (let col = headers.length - 1; col >= 5; col--) {
      const val = row[col];
      const dateStr = headers[col];
      if (!dateStr) continue;

      // Seulement les colonnes qui sont des dates (dd/MM/yyyy)
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(dateStr))) continue;

      if (val !== "" && val !== null && val !== undefined) {
        const [d, m, y] = dateStr.split("/");
        const entryDate = new Date(`${y}-${m}-${d}`);
        const entryOnly = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate());
        if (entryOnly <= refDateOnly) {
          history.push({ value: val, date: dateStr, colIndex: col });
        }
      }
    }

    let include = false;
    let skipped = false;
    let nextDate = null;
    let reason = null;
    let spacedInfo = null;

    if (isQuotidien || matchingDays.includes(refDayName)) include = true;

    if (isSpaced) {
      const { score, lastDate } = computeScoreAndLastDate(row);
      const delay = DELAYS[score];
      let next = null;
      if (lastDate) {
        next = new Date(lastDate);
        next.setHours(0,0,0,0);
        next.setDate(next.getDate() + delay);
      }

      // ✅ due => afficher
      if (!next || referenceDate >= next) {
        include = true;
      }

      // 🔕 masquer aujourd’hui si pas encore dû (et donner la raison)
      if (isToday && next && referenceDate < next) {
        skipped = true;
        include = false;
        nextDate = Utilities.formatDate(next, Session.getScriptTimeZone(), "dd/MM/yyyy");
        reason = `✅ Réponse positive enregistrée récemment. Prochaine apparition prévue le ${nextDate}.`;
      }

      spacedInfo = {
        score,
        lastDate: lastDate ? Utilities.formatDate(lastDate, Session.getScriptTimeZone(), "dd/MM/yyyy") : null,
        nextDate: next ? Utilities.formatDate(next, Session.getScriptTimeZone(), "dd/MM/yyyy") : null
      };
    }

    // Priority & Row ID from anchor
    const rowIndex = idx + 2;
    const anchor = sheet.getRange(rowIndex, 1);
    const priority = getPriority(anchor);
    const qid = ensureRowId(anchor);

    // -- Délai journalier manuel depuis la note (prend le pas sur le reste)
    const manualDue = getDailyDue(anchor); // { dueISO, human } | null
    if (manualDue && queryDate) {
      const selISO = Utilities.formatDate(referenceDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
      if (selISO < manualDue.dueISO) {
        include = false;
        skipped = true;
        // formate une jolie date JJ/MM/AAAA pour l'UI
        const [yy, mm, dd] = manualDue.dueISO.split('-');
        const next = new Date(`${yy}-${mm}-${dd}`);
        nextDate = Utilities.formatDate(next, Session.getScriptTimeZone(), "dd/MM/yyyy");
        reason = `⏱️ Délai manuel jusqu’au ${nextDate}.`;
      }
    }

    const srInfo = getSRInfo(anchor);
    const base = {
      id: qid, label, type, history, isSpaced, spacedInfo, priority,
      category: cat,
      frequency: freqRaw,
      scheduleInfo: {
        unit: "days",
        nextDate: nextDate || spacedInfo?.nextDate || null,
        sr: srInfo
      }
    };
    if (skipped) {
      result.push({ ...base, skipped: true, nextDate, reason });
    } else if (include) {
      result.push({ ...base, skipped: false });
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================
//  doPost — écriture
// ============================
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tracking');
  const data = JSON.parse(e.postData.contents || "{}");

  // ---------- CONSIGNES: create/update/delete ----------
  if (clean(data._action) === "consigne_create" ||
      clean(data._action) === "consigne_update" ||
      clean(data._action) === "consigne_delete") {

    const labelsRange = sheet.getRange(2, 5, Math.max(0, sheet.getLastRow()-1), 1); // col E
    const labels = labelsRange.getValues().flat();

    if (clean(data._action) === "consigne_create") {
      const lastRow = sheet.getLastRow()+1;
      sheet.getRange(lastRow, 1).setValue(""); // ancre
      sheet.getRange(lastRow, 2).setValue(data.category || "");
      sheet.getRange(lastRow, 3).setValue(data.type || "");
      sheet.getRange(lastRow, 4).setValue(data.frequency || "");
      sheet.getRange(lastRow, 5).setValue(data.label || "");
      const anchor = sheet.getRange(lastRow, 1);
      ensureRowId(anchor);
      setPriority(anchor, parseInt(data.priority,10)||2);
      return ContentService.createTextOutput("✅ consigne créée").setMimeType(ContentService.MimeType.TEXT);
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
      return ContentService.createTextOutput("❌ consigne introuvable").setMimeType(ContentService.MimeType.TEXT);
    }

    if (clean(data._action) === "consigne_delete") {
      sheet.deleteRow(rowIndex);
      return ContentService.createTextOutput("✅ consigne supprimée").setMimeType(ContentService.MimeType.TEXT);
    }

    if (data.category != null) sheet.getRange(rowIndex,2).setValue(data.category);
    if (data.type != null)     sheet.getRange(rowIndex,3).setValue(data.type);
    if (data.frequency != null)sheet.getRange(rowIndex,4).setValue(data.frequency);
    if (data.newLabel != null) sheet.getRange(rowIndex,5).setValue(data.newLabel);
    if (data.priority != null) setPriority(sheet.getRange(rowIndex,1), parseInt(data.priority,10)||2);

    return ContentService.createTextOutput("✅ consigne mise à jour").setMimeType(ContentService.MimeType.TEXT);
  }

  // ---------- MODE PRATIQUE ----------
  if (clean(data._mode) === "practice") {
    const category = (data._category || "").toString().trim();
    if (!category) {
      return ContentService.createTextOutput("❌ Catégorie manquante").setMimeType(ContentService.MimeType.TEXT);
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
    sheet.insertColumnBefore(targetIndex);
    sheet.getRange(1, targetIndex).setValue(newHeader);

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

      // 4) Délai manuel (clé = ID)
      const dKey = "__delayIter__" + qid;
      if (dKey in data) {
        const n = parseInt(data[dKey], 10);
        if (Number.isFinite(n)) {
          if (n <= 0) setPracticeDelayRemaining(rCell, category, 0);
          else setPracticeDelayRemaining(rCell, category, n);
        }
      }
    }

    return ContentService.createTextOutput("✅ Itération enregistrée !").setMimeType(ContentService.MimeType.TEXT);
  }

  // ---------- MODE JOURNALIER (inchangé) ----------
  // ---------- MODE JOURNALIER ----------
  const selectedDate = data._date;
  if (!selectedDate) {
    return ContentService.createTextOutput("❌ Date manquante").setMimeType(ContentService.MimeType.TEXT);
  }

  const parsedDate = new Date(selectedDate);
  const dateStr = Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), "dd/MM/yyyy");

  // 1) S'assurer que l'en-tête existe à F (targetIndex)
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const targetIndex = 6; // F
  let dateColIndex = headers.indexOf(dateStr) + 1; // 1-based

  if (dateColIndex === 0) {
    // nouvelle colonne à F
    sheet.insertColumnBefore(targetIndex);
    sheet.getRange(1, targetIndex).setValue(dateStr);
    dateColIndex = targetIndex;
  } else if (dateColIndex !== targetIndex) {
    // déplacer la colonne existante à F, en compensant le décalage après suppression
    sheet.insertColumnBefore(targetIndex);
    const lastRow = sheet.getLastRow();

    // 1-based
    const sourceIndex = (dateColIndex >= targetIndex) ? (dateColIndex + 1) : dateColIndex;
    // si la source est avant F, on vise temporairement G (= F+1), qui deviendra F après suppression
    const destIndex = (dateColIndex < targetIndex) ? (targetIndex + 1) : targetIndex;

    sheet.getRange(1, sourceIndex, lastRow).moveTo(sheet.getRange(1, destIndex, lastRow));
    sheet.deleteColumn(sourceIndex); // après suppression, la date est bien en F
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

    // d) Délai manuel (jours) envoyé depuis le front
    const dKey = "__delayDays__" + qid;
    if (dKey in data) {
      const n = parseInt(data[dKey], 10);
      if (Number.isFinite(n)) {
        if (n === -1) {
          // retirer délai (et reset SR n=0)
          setDailyDelay(rCell, selectedDate, -1);
        } else {
          setDailyDelay(rCell, selectedDate, n);
        }
      }
    }
  }

  return ContentService.createTextOutput("✅ Données enregistrées !").setMimeType(ContentService.MimeType.TEXT);
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
