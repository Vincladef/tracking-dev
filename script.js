// ============================================================================
// GOOGLE APPS SCRIPT – Backend WebApp de suivi (Tracking)
// Endpoints :
//   - doGet  : lecture (mode "daily" par date, ou "practice" par catégorie)
//   - doPost : écriture (enregistre daily/practice et gère les colonnes)
// ============================================================================

// ============================
//   Constantes & utilitaires
// ============================

/** Feuille de conf (rappels Telegram, mapping utilisateurs, etc.) */
const CONFIG_SHEET_ID = '1D9M3IEPtD7Vbdt7THBvNm8CiQ3qdrelyR-EdgNmd6go';

/** Barème Likert -> valeur numérique (les clés sont normalisées par clean()) */
const ANSWER_VALUES = {
  "oui": 1,
  "plutot oui": 0.75,
  "moyen": 0.25,
  "plutot non": 0,
  "non": -1,
  "pas de reponse": 0
};

/** Délais SR (jours en mode daily / itérations en mode practice) */
const DELAYS = [0, 1, 2, 3, 5, 8, 13];

/** Jours FR pour le filtrage périodique */
const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Regex (utiliser sur chaînes déjà clean() ) */
const PRACTICE_REGEX = /\bpratique\s+deliberee\b/;
const SR_REGEX       = /\b(repetition\s*espacee|spaced)\b/;

/** Normalisation : minuscules, accents retirés, espaces clean */
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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Streak positif (depuis le plus récent) **pour une catégorie de practice**.
 * Parcourt les colonnes de gauche à droite (F -> ...), mais ne compte
 * que celles dont l'entête matche `catRegex`. S’arrête au premier non-positif.
 */
function positiveStreakByCategory(row, headers, catRegex) {
  const POS = new Set(["oui", "plutot oui"]);
  let streak = 0;
  for (let c = 5; c < headers.length; c++) {                // F -> ...
    const h = String(headers[c] || "");
    if (!catRegex.test(h)) continue;                        // seulement cette catégorie
    const v = clean(row[c]);
    if (!v) continue;                                       // ignore cellule vide
    if (POS.has(v)) streak++;
    else break;
  }
  return streak;
}

/**
 * Score cumulé (pour SR daily) + dernière date vue (entêtes "dd/mm/yyyy" ou "...(dd/mm/yyyy)")
 */
function computeScoreAndLastDate(row, headers) {
  let totalScore = 0;
  let lastDate   = null;

  for (let col = 5; col < headers.length; col++) {
    const ans = clean(row[col]);
    if (!ans || ans === "pas de reponse") continue;

    totalScore += (ANSWER_VALUES[ans] ?? 0);

    const h = String(headers[col] || "");
    let dmy = null;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(h)) {
      dmy = h;
    } else {
      const m = h.match(/\((\d{2}\/\d{2}\/\d{4})\)/);
      if (m) dmy = m[1];
    }
    if (dmy) {
      const [d, m, y] = dmy.split("/");
      const dObj = new Date(`${y}-${m}-${d}`);
      if (!lastDate || dObj > lastDate) lastDate = dObj;
    }
  }

  const score06 = Math.max(0, Math.min(6, Math.round(totalScore)));
  return { score: score06, lastDate };
}

// ============================
//   doGet — lecture
// ============================

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss && ss.getSheetByName('Tracking');
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "Feuille 'Tracking' introuvable" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const data    = sheet.getRange(2, 1, Math.max(0, lastRow - 1), lastCol).getValues();

  const mode     = clean(e?.parameter?.mode);
  const queryISO = e?.parameter?.date;
  const category = (e?.parameter?.category || "").toString().trim();

  // ---------- MODE PRATIQUE ----------
  if (mode === "practice") {
    // a) liste des catégories
    if (!category) {
      const categoriesSet = {};
      data.forEach(row => {
        const freq = clean(String(row[3] || ""));
        const cat  = (row[1] || "").toString().trim();
        if (cat && PRACTICE_REGEX.test(freq)) categoriesSet[cat] = true;
      });
      return ContentService
        .createTextOutput(JSON.stringify(Object.keys(categoriesSet)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // b) questions d'une catégorie
    const catRegex = new RegExp(`^${escapeRegExp(category)}\\s+(\\d+)\\s*\\(`, 'i');

    let maxN = 0;
    headers.forEach(h => {
      const m = String(h || "").trim().match(catRegex);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) maxN = Math.max(maxN, n);
      }
    });
    const currentIter = maxN + 1;

    const out = [];
    data.forEach(row => {
      const freqRaw = String(row[3] || "");
      const freq    = clean(freqRaw);
      const cat     = (row[1] || "").toString().trim();
      const label   = row[4] || "";

      const isPractice = PRACTICE_REGEX.test(freq);
      const isSpaced   = SR_REGEX.test(freq);

      if (!label || cat !== category || !isPractice) return;

      const type = row[2] || "";

      // Historique (toutes colonnes non vides), récent -> ancien (F est la plus récente)
      const historyRaw = [];
      let lastIter = null;
      for (let c = 5; c < headers.length; c++) {
        const rawHeader = String(headers[c] || "").trim();
        const val = row[c];
        if (val === "" || val === null || val === undefined) continue;

        historyRaw.push({ key: rawHeader, value: val, colIndex: c });

        const m = rawHeader.match(catRegex);
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n)) lastIter = Math.max(lastIter ?? 0, n);
        }
      }
      historyRaw.sort((a, b) => a.colIndex - b.colIndex);
      const history = historyRaw.map(({ key, value }) => ({ key, value }));

      let skipped = false, reason = null, spacedInfo = null;
      if (isSpaced) {
        const streak        = positiveStreakByCategory(row, headers, catRegex);
        const delayIter     = DELAYS[Math.min(streak, DELAYS.length - 1)];
        const nextAllowed   = (lastIter ?? 0) + delayIter;
        const remaining     = Math.max(0, nextAllowed - currentIter);

        if (lastIter !== null && currentIter < nextAllowed) {
          skipped = true;
          reason  = `⏳ SR – réapparition dans ${remaining} itération(s).`;
        }

        spacedInfo = {
          streak,
          delayIter,
          lastIter,
          currentIter,
          nextAllowedIter: nextAllowed,
          remaining
        };
      }

      out.push({ id: label, label, type, history, isSpaced, spacedInfo, skipped, reason });
    });

    return ContentService
      .createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ---------- MODE JOURNALIER ----------
  const referenceDate = queryISO ? new Date(queryISO) : new Date();
  const refDayName    = referenceDate.toLocaleDateString("fr-FR", { weekday: "long" }).toLowerCase();
  const refDateOnly   = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());

  const result = [];
  for (const row of data) {
    const type   = row[2] || "";
    const freq   = clean(String(row[3] || ""));
    const label  = row[4] || "";

    const isPractice = PRACTICE_REGEX.test(freq);
    const isSpaced   = SR_REGEX.test(freq);
    const isQuotidien = /\bquotidien(ne)?\b/.test(freq);
    const runsToday   = new RegExp(`\\b${refDayName}\\b`).test(freq);

    if (isPractice && !isSpaced) continue;

    // Historique (dates <= ref), récent -> ancien (F en premier)
    const rawHist = [];
    for (let col = 5; col < headers.length; col++) {
      const val = row[col];
      if (val === "" || val === null || val === undefined) continue;

      const h = String(headers[col] || "");
      let dmy = null;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(h)) dmy = h;
      else {
        const m = h.match(/\((\d{2}\/\d{2}\/\d{4})\)/);
        if (m) dmy = m[1];
      }
      if (!dmy) continue;

      const [d, m, y] = dmy.split("/");
      const entryDate = new Date(`${y}-${m}-${d}`);
      entryDate.setHours(0,0,0,0);
      if (entryDate <= refDateOnly) rawHist.push({ value: val, date: dmy, colIndex: col });
    }
    rawHist.sort((a,b) => a.colIndex - b.colIndex);
    const history = rawHist.map(({ value, date }) => ({ value, date }));

    let include = false;
    let skipped = false;
    let nextDate = null;
    let reason = null;
    let spacedInfo = null;

    if (isSpaced) {
      const { score, lastDate } = computeScoreAndLastDate(row, headers);
      const delay = DELAYS[score];

      if (lastDate) {
        const next = new Date(lastDate);
        next.setDate(next.getDate() + delay);
        if (refDateOnly < next) {
          skipped  = true;
          const tz = Session.getScriptTimeZone();
          nextDate = Utilities.formatDate(next, tz, "dd/MM/yyyy");
          reason   = `✅ Réponse positive récente. Prochaine apparition le ${nextDate}.`;
        } else {
          include = true;
        }
      } else {
        include = true;
      }

      const tz = Session.getScriptTimeZone();
      spacedInfo = {
        score,
        lastDate: lastDate ? Utilities.formatDate(lastDate, tz, "dd/MM/yyyy") : null,
        nextDate
      };
    } else {
      if (isQuotidien || runsToday) include = true;
    }

    if (skipped) result.push({ id: label, label, type, skipped: true, nextDate, reason, history, isSpaced, spacedInfo });
    else if (include) result.push({ id: label, label, type, history, isSpaced, spacedInfo });
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================
//   doPost — écriture
// ============================

function doPost(e) {
  // Verrou anti-race
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);
  if (!lock.hasLock()) {
    return ContentService.createTextOutput("❌ Occupé, réessaie dans quelques secondes.")
      .setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss && ss.getSheetByName('Tracking');
    if (!sheet) {
      return ContentService.createTextOutput("❌ Feuille 'Tracking' introuvable").setMimeType(ContentService.MimeType.TEXT);
    }

    const data  = JSON.parse(e.postData.contents || "{}");
    const _mode = clean(data._mode);

    // ---------- PRACTICE ----------
    if (_mode === "practice") {
      const category = (data._category || "").toString().trim();
      if (!category) {
        return ContentService.createTextOutput("❌ Catégorie manquante").setMimeType(ContentService.MimeType.TEXT);
      }

      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const catRegex = new RegExp(`^${escapeRegExp(category)}\\s+(\\d+)\\s*\\(`, 'i');
      let maxN = 0;
      headers.forEach(h => {
        const m = String(h || "").trim().match(catRegex);
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n)) maxN = Math.max(maxN, n);
        }
      });

      const nextN  = maxN + 1;
      const tz     = Session.getScriptTimeZone();
      const nowStr = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy");
      const newHeader   = `${category} ${nextN} (${nowStr})`;
      const targetIndex = 6;

      let newColIndex = headers.indexOf(newHeader) + 1;
      if (newColIndex === 0) {
        sheet.insertColumnBefore(targetIndex);
        sheet.getRange(1, targetIndex).setValue(newHeader);
        newColIndex = targetIndex;
      }

      const lastRow    = sheet.getLastRow();
      const headersNow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const labels     = sheet.getRange(2, 5, lastRow - 1).getValues().flat();
      let written = 0;

      for (let i = 0; i < labels.length; i++) {
        const label  = labels[i];
        const rowVals = sheet.getRange(i + 2, 1, 1, sheet.getLastColumn()).getValues()[0];

        // 1) valeur envoyée -> on écrit
        if (label && data[label] !== undefined && data[label] !== "") {
          sheet.getRange(i + 2, newColIndex).setValue(data[label]);
          sheet.getRange(i + 2, newColIndex).setNote("");
          written++;
          continue;
        }

        // 2) pas de valeur -> vérifier s'il s'agissait d'une question SR de la catégorie
        const freq = clean(String(rowVals[3] || ""));
        const catRow = (rowVals[1] || "").toString().trim();
        const isPractice = PRACTICE_REGEX.test(freq);
        const isSpaced   = SR_REGEX.test(freq);
        if (!isPractice || !isSpaced || catRow !== category) continue;

        const streak    = positiveStreakByCategory(rowVals, headersNow, catRegex);
        const delayIter = DELAYS[Math.min(streak, DELAYS.length - 1)];

        let lastIter = null;
        for (let c = 5; c < headersNow.length; c++) {
          const h = String(headersNow[c] || "").trim();
          const m = h.match(catRegex);
          if (m) {
            const n = parseInt(m[1], 10);
            if (!isNaN(n)) lastIter = Math.max(lastIter ?? 0, n);
          }
        }

        const currentIter    = nextN;
        const nextAllowed    = (lastIter ?? 0) + delayIter;
        const remaining      = Math.max(0, nextAllowed - currentIter);

        if (lastIter !== null && currentIter < nextAllowed) {
          sheet.getRange(i + 2, newColIndex).setValue("");
          sheet.getRange(i + 2, newColIndex).setNote(`⏳ SR – ${remaining} itération(s) restante(s)`);
        } else {
          sheet.getRange(i + 2, newColIndex).setValue("");
          sheet.getRange(i + 2, newColIndex).setNote("— non répondu");
        }
      }

      return ContentService.createTextOutput("✅ Itération enregistrée !").setMimeType(ContentService.MimeType.TEXT);
    }

    // ---------- DAILY ----------
    const selectedDate = data._date;
    if (!selectedDate) {
      return ContentService.createTextOutput("❌ Date manquante").setMimeType(ContentService.MimeType.TEXT);
    }

    const tz      = Session.getScriptTimeZone();
    const dateStr = Utilities.formatDate(new Date(selectedDate), tz, "dd/MM/yyyy");
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const targetIndex = 6;

    let dateColIndex = headers.indexOf(dateStr) + 1;

    if (dateColIndex === 0) {
      // Crée la colonne du jour à F
      sheet.insertColumnBefore(targetIndex);
      sheet.getRange(1, targetIndex).setValue(dateStr);
      dateColIndex = targetIndex;
    } else if (dateColIndex !== targetIndex) {
      // Déplace la colonne existante vers F
      const lastRow = sheet.getLastRow();
      sheet.insertColumnBefore(targetIndex);
      const source = dateColIndex + (dateColIndex >= targetIndex ? 1 : 0);
      sheet.getRange(1, source, lastRow).moveTo(sheet.getRange(1, targetIndex, lastRow));
      sheet.deleteColumn(source);
    }

    const questions = sheet.getRange(2, 5, sheet.getLastRow() - 1).getValues().flat();
    for (let i = 0; i < questions.length; i++) {
      const label = questions[i];
      if (label && data[label] !== undefined && data[label] !== "") {
        sheet.getRange(i + 2, targetIndex).setValue(data[label]);
      }
    }

    return ContentService.createTextOutput("✅ Données enregistrées !").setMimeType(ContentService.MimeType.TEXT);

  } finally {
    lock.releaseLock();
  }
}

// ============================
//   (Optionnel) Rappels Telegram
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
  const configData  = configSheet.getDataRange().getValues();
  const headers     = configData[0].map(h => clean(h.toString()));

  const today    = new Date();
  today.setHours(0,0,0,0);
  const refDay   = today.toLocaleDateString("fr-FR", { weekday: "long" }).toLowerCase();
  const tz       = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(today, tz, "dd/MM/yyyy");

  const hChatId   = headers.indexOf("chatid");
  const hApi      = headers.indexOf("api telegram");
  const hSheetUrl = headers.indexOf("sheet url");
  const hTrackUrl = headers.indexOf("url tracking");

  configData.slice(1).forEach(row => {
    const user        = clean(row[0] || "");
    const chatId      = row[hChatId];
    const botApi      = row[hApi];
    const sheetUrl    = row[hSheetUrl];
    const trackingUrl = row[hTrackUrl];
    if (!user || !chatId || !botApi || !sheetUrl || !trackingUrl) return;

    try {
      const ssId = (sheetUrl || "").match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      if (!ssId) return;

      const trackingSheet  = SpreadsheetApp.openById(ssId).getSheetByName("Tracking");
      const headersTracking = trackingSheet.getRange(1, 1, 1, trackingSheet.getLastColumn()).getValues()[0];
      const data            = trackingSheet.getRange(2, 1, trackingSheet.getLastRow() - 1, trackingSheet.getLastColumn()).getValues();

      let count = 0;
      data.forEach(r => {
        const freq = clean(String(r[3] || ""));
        const isPractice = PRACTICE_REGEX.test(freq);
        const isSpaced   = SR_REGEX.test(freq);

        if (isPractice && !isSpaced) return;

        let include = false;
        if (isSpaced) {
          const { score, lastDate } = computeScoreAndLastDate(r, headersTracking);
          const delay = DELAYS[score];
          if (lastDate) {
            const next = new Date(lastDate);
            next.setDate(next.getDate() + delay);
            // Notifier seulement si dû **aujourd'hui**
            include = today.getFullYear() === next.getFullYear()
                   && today.getMonth()    === next.getMonth()
                   && today.getDate()     === next.getDate();
          } else {
            include = true;
          }
        } else {
          const isQuotidien  = /\bquotidien(ne)?\b/.test(freq);
          const isMatching   = JOURS.some(j => freq.includes(j) && j === refDay);
          include = isQuotidien || isMatching;
        }

        if (include) count++;
      });

      const botToken = String(botApi).replace("https://api.telegram.org/bot", "").split("/")[0];
      const message = count === 0
        ? `🎉 Hello ${user}, rien à remplir aujourd’hui !\n👉 ${trackingUrl}`
        : `📋 Hello ${user}, tu as ${count} chose(s) à traquer aujourd’hui (${todayStr})\n👉 ${trackingUrl}`;

      sendTelegramMessage(chatId, message, botToken);
    } catch (e) {
      Logger.log(`Erreur rappel pour ${user} : ${e}`);
    }
  });
}
