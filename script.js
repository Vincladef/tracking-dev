// 📁 App Script – Finalisé pour les suivis quotidiens et les pratiques délibérées
const CONFIG_SHEET_ID = '1D9M3IEPtD7Vbdt7THBvNm8CiQ3qdrelyR-EdgNmd6go';
const ANSWER_VALUES = {
  "oui": 1,
  "plutôt oui": 0.75,
  "moyen": 0.25,
  "non": -1,
  "plutôt non": 0,
  "pas de reponse": 0
};
const DELAYS = [0, 1, 2, 3, 5, 8, 13];
const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

function clean(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\u00A0\u202F\u200B]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function getUserConfig(user) {
  const sheet = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase());
  for (let i = 1; i < data.length; i++) {
    const rowUser = (data[i][0] || "").toString().toLowerCase();
    if (rowUser === user.toLowerCase()) {
      const result = {};
      headers.forEach((h, j) => result[h] = data[i][j]);
      return result;
    }
  }
  return null;
}

function sendTelegramMessage(chatId, message, botToken) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: message })
  };
  try {
    UrlFetchApp.fetch(url, options);
    Logger.log(`✅ Message Telegram envoyé à ${chatId}`);
  } catch (e) {
    Logger.log(`❌ Erreur lors de l'envoi du message Telegram à ${chatId} : ${e}`);
  }
}

function sendAllTelegramReminders() {
  Logger.log("-----------------------------------------");
  Logger.log("⏰ Lancement de sendAllTelegramReminders.");
  Logger.log("-----------------------------------------");

  const configSheet = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheets()[0];
  const configData = configSheet.getDataRange().getValues();
  const headers = configData[0].map(h => h.toString().toLowerCase());
  const today = new Date();
  const refDayName = today.toLocaleDateString("fr-FR", { weekday: "long" }).toLowerCase();
  const formattedDate = Utilities.formatDate(today, "GMT+1", "dd/MM/yyyy");

  configData.slice(1).forEach(row => {
    const user = (row[0] || "").toString().toLowerCase();
    const chatId = row[headers.indexOf("chatid")];
    const botApi = row[headers.indexOf("api telegram")];
    const sheetUrl = row[headers.indexOf("sheet url")];
    const trackingUrl = row[headers.indexOf("url tracking")];

    Logger.log(`-- Traitement de l'utilisateur : ${user}`);

    if (!user || !chatId || !botApi || !sheetUrl || !trackingUrl) {
      Logger.log(`   ❌ Données de configuration manquantes pour ${user}.`);
      return;
    }

    try {
      const ssId = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      if (!ssId) {
        Logger.log(`   ❌ Impossible de trouver l'ID du Google Sheet pour ${user}.`);
        return;
      }

      const trackingSheet = SpreadsheetApp.openById(ssId).getSheetByName("Tracking");
      const headersTracking = trackingSheet.getRange(1, 1, 1, trackingSheet.getLastColumn()).getValues()[0];
      const data = trackingSheet.getRange(2, 1, trackingSheet.getLastRow() - 1, trackingSheet.getLastColumn()).getValues();

      let count = 0;
      data.forEach(row => {
        const freq = clean(row[3]);
        const isSpaced = freq.includes("repetition espacee") || freq.includes("répétition espacée");
        const isQuotidien = freq.includes("quotidien");
        const isMatchingDay = JOURS.some(j => freq.includes(j) && j === refDayName);

        let include = false;

        if (isSpaced) {
          let score = 0;
          let lastDate = null;
          for (let col = headersTracking.length - 1; col >= 5; col--) {
            const val = clean(row[col]);
            if (!val) continue;
            score += ANSWER_VALUES[val] ?? 0;

            const [d, m, y] = (headersTracking[col] || "").split("/");
            if (d && m && y) {
              const parsed = new Date(`${y}-${m}-${d}`);
              if (!lastDate || parsed > lastDate) lastDate = parsed;
            }
          }
          score = Math.max(0, Math.min(6, Math.round(score)));
          const delay = DELAYS[score];
          if (lastDate) {
            const next = new Date(lastDate);
            next.setDate(next.getDate() + delay);
            include = today >= next;
          } else {
            include = true; // Si jamais fait, on le propose
          }
          Logger.log(`   - Question en Répétition Espacée. Score: ${score}, Délai: ${delay}. Incluse: ${include}`);
        }

        if (!isSpaced && (isQuotidien || isMatchingDay)) {
          include = true;
          Logger.log(`   - Question en mode Quotidien ou Jour Spécifique. Incluse: ${include}`);
        }

        if (include) count++;
      });

      const botToken = botApi.replace("https://api.telegram.org/bot", "").split("/")[0];
      const message = count === 0
        ? `🎉 Hello ${user}, rien à remplir aujourd’hui !\n👉 ${trackingUrl}`
        : `📋 Hello ${user}, tu as ${count} chose(s) à traquer aujourd’hui (${formattedDate})\n👉 ${trackingUrl}`;

      sendTelegramMessage(chatId, message, botToken);
      Logger.log(`   ✅ Message de rappel préparé pour ${user}.`);
    } catch (e) {
      Logger.log(`   ❌ Erreur critique lors de la génération du rappel pour ${user} : ${e}`);
    }
  });
  Logger.log("✅ Fin de sendAllTelegramReminders.");
}

function doPost(e) {
  Logger.log("-----------------------------------------");
  Logger.log("🚀 [doPost] Requête reçue.");
  Logger.log("-----------------------------------------");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tracking');
  if (!sheet) {
    Logger.log("❌ [doPost] Feuille 'Tracking' introuvable.");
    return ContentService.createTextOutput("❌ Erreur: Feuille 'Tracking' introuvable.").setMimeType(ContentService.MimeType.TEXT);
  }
  
  const postData = e.postData.contents;
  Logger.log(`[doPost] Données brutes reçues : ${postData}`);
  
  const data = JSON.parse(postData);
  Logger.log(`[doPost] Données parsées : ${JSON.stringify(data)}`);
  
  const isPractice = data._date === "__practice__" || data.mode === "__practice__";
  Logger.log(`[doPost] isPractice ? ${isPractice} (data._date=${data._date}, data.mode=${data.mode})`);
  
  let colNameToUse = "";
  let colIndex = -1;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log(`[doPost] En-têtes de colonne actuels : ${headers.join(', ')}`);

  if (isPractice) {
    Logger.log("[doPost] Traitement en mode 'Pratique délibérée'.");
    
    let practiceIndex = 1;
    while (headers.includes(`pratique ${practiceIndex}`)) {
      practiceIndex++;
    }
    colNameToUse = `pratique ${practiceIndex}`;
    Logger.log(`[doPost] Nom de la nouvelle colonne de pratique : ${colNameToUse}`);

    const fixedInsertIndex = 6;
    Logger.log(`[doPost] La nouvelle colonne sera insérée à l'index fixe : ${fixedInsertIndex}.`);
    
    sheet.insertColumnBefore(fixedInsertIndex);
    sheet.getRange(1, fixedInsertIndex).setValue(colNameToUse);
    // ✅ CORRECTION APPORTÉE : Enregistrement de la date dans la deuxième ligne de la colonne de pratique
    const todayStr = Utilities.formatDate(new Date(), "GMT+1", "dd/MM/yyyy");
    sheet.getRange(2, fixedInsertIndex).setValue(todayStr);

    colIndex = fixedInsertIndex;
  } else {
    Logger.log("[doPost] Traitement en mode 'Quotidien'.");
    const selectedDate = data._date;
    if (!selectedDate) {
      Logger.log("❌ [doPost] Erreur: date manquante.");
      return ContentService.createTextOutput("❌ Erreur: Date manquante").setMimeType(ContentService.MimeType.TEXT);
    }
    
    const parsedDate = new Date(selectedDate);
    colNameToUse = Utilities.formatDate(parsedDate, "GMT+1", "dd/MM/yyyy");
    Logger.log(`[doPost] Nom de colonne à utiliser pour la date : ${colNameToUse}`);
    
    colIndex = headers.indexOf(colNameToUse) + 1;
    Logger.log(`[doPost] Index de la colonne de date existante : ${colIndex - 1} (si > 0)`);

    if (colIndex === 0) {
      colIndex = headers.length + 1;
      Logger.log(`[doPost] Colonne de date inexistante. Création à l'index : ${colIndex}`);
      sheet.getRange(1, colIndex).setValue(colNameToUse);
    }
    
    const targetIndex = 6;
    if (colIndex !== targetIndex) {
        Logger.log(`[doPost] Déplacement de la colonne ${colNameToUse} vers l'index ciblé (${targetIndex}).`);
        sheet.insertColumnBefore(targetIndex);
        const lastRow = sheet.getLastRow();
        sheet.getRange(1, colIndex + 1, lastRow).moveTo(sheet.getRange(1, targetIndex, lastRow));
        sheet.deleteColumn(colIndex + 1);
        colIndex = targetIndex;
        Logger.log("[doPost] Déplacement terminé.");
    }
  }

  Logger.log(`[doPost] ✅ Données seront écrites dans la colonne "${colNameToUse}" à l’index ${colIndex}.`);

  const questions = sheet.getRange(2, 5, sheet.getLastRow() - 1).getValues().flat();
  Logger.log(`[doPost] Nombre de questions à traiter : ${questions.length}`);
  for (let i = 0; i < questions.length; i++) {
    const label = questions[i];
    const answer = data[label];
    if (label && answer !== undefined && answer !== "") {
      const cellA1 = sheet.getRange(i + 2, colIndex).getA1Notation();
      Logger.log(`[doPost] ✏️ Cellule ${cellA1} ← "${answer}" pour "${label}"`);
      sheet.getRange(i + 2, colIndex).setValue(answer);
    }
  }
  
  const successMessage = isPractice 
    ? `✅ Données de pratique (${colNameToUse}) enregistrées !` 
    : `✅ Données quotidiennes (${colNameToUse}) enregistrées !`;
    
  Logger.log(`[doPost] ✅ Fin de l’écriture. Toutes les réponses ont été insérées dans la colonne "${colNameToUse}".`);
  Logger.log(`✅ [doPost] Fin de la requête. Message de succès : ${successMessage}`);
  return ContentService.createTextOutput(successMessage).setMimeType(ContentService.MimeType.TEXT);
}

function doGet(e) {
  Logger.log("-----------------------------------------");
  Logger.log("➡️ [doGet] Requête reçue.");
  Logger.log("-----------------------------------------");
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tracking');
  if (!sheet) {
    Logger.log("❌ [doGet] Feuille 'Tracking' introuvable.");
    return ContentService.createTextOutput("❌ Erreur: Feuille 'Tracking' introuvable.").setMimeType(ContentService.MimeType.TEXT);
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  
  const queryDate = e?.parameter?.date;
  const isPracticeMode = e?.parameter?.mode === "practice";
  const categoryFilter = e?.parameter?.cat?.toLowerCase() || null;
  const categoriesOnly = e?.parameter?.categoriesOnly === "true";
  
  Logger.log(`[doGet] Paramètres de la requête : date=${queryDate}, mode=practice=${isPracticeMode}, cat=${categoryFilter}, categoriesOnly=${categoriesOnly}`);

  const referenceDate = queryDate ? new Date(queryDate) : new Date();
  const refDayName = referenceDate.toLocaleDateString("fr-FR", { weekday: "long" }).toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  referenceDate.setHours(0, 0, 0, 0);
  const isToday = referenceDate.getTime() === today.getTime();
  const refDateOnly = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());

  const clean = str => (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\u00A0\u202F\u200B]/g, " ").replace(/\s+/g, " ").toLowerCase().trim();

  function computeScoreAndLastDate(row) {
    let totalScore = 0;
    let lastDate = null;
    for (let col = headers.length - 1; col >= 5; col--) {
      const answer = clean(row[col]);
      if (!answer) continue;
      const score = ANSWER_VALUES[answer] ?? 0;
      totalScore += score;

      const dateStr = headers[col];
      if (dateStr && typeof dateStr === 'string' && dateStr.includes('/')) {
        const [d, m, y] = dateStr.split("/");
        const dObj = new Date(`${y}-${m}-${d}`);
        if (!lastDate || dObj > lastDate) lastDate = dObj;
      }
    }
    totalScore = Math.max(0, Math.min(6, Math.round(totalScore)));
    return { score: totalScore, lastDate };
  }

  if (categoriesOnly) {
    Logger.log("[doGet] Mode 'categoriesOnly' activé.");
    const catSet = new Set();
    for (const row of data) {
      const freq = clean(row[3] || "");
      const cat = clean(row[1] || "");
      const isPractice = freq.includes("pratique deliberee") || freq.includes("pratique délibérée");
      if (isPractice && cat) {
        catSet.add(cat);
        Logger.log(`- Catégorie de pratique trouvée : ${cat}`);
      }
    }
    const categoriesArray = [...catSet];
    Logger.log(`✅ [doGet] Catégories finales : ${categoriesArray.join(', ')}`);
    return ContentService
      .createTextOutput(JSON.stringify(categoriesArray))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const result = [];
  Logger.log(`[doGet] Traitement de ${data.length} questions...`);

  for (const row of data) {
    const freq = clean(row[3] || "");
    const isQuotidien = freq.includes("quotidien");
    const isSpaced = freq.includes("repetition espacee") || freq.includes("répétition espacée");
    const isPractice = freq.includes("pratique deliberee") || freq.includes("pratique délibérée");
    const matchingDays = JOURS.filter(j => freq.includes(j));
    const type = row[2] || "";
    const label = row[4] || "";
    const category = clean(row[1] || "");
    
    let history = []; 

    let shouldInclude = false;

    if (isPracticeMode) {
      shouldInclude = isPractice && (!categoryFilter || category === categoryFilter);
      if (shouldInclude) {
        Logger.log(`- Question "${label}" incluse (mode pratique, catégorie: ${category}).`);
      } else {
        Logger.log(`- Question "${label}" exclue (mode pratique).`);
        continue;
      }
    } else {
      shouldInclude = isQuotidien || matchingDays.includes(refDayName) || isSpaced;
      if (shouldInclude) {
        Logger.log(`- Question "${label}" incluse (mode quotidien).`);
      } else {
        Logger.log(`- Question "${label}" exclue (mode quotidien).`);
        continue;
      }
    }

    let skipped = false;
    let nextDate = null;
    let reason = null;
    let spacedInfo = null;

    if (isSpaced) {
      if (isPracticeMode) {
        const iterationHistory = headers
          .map((h, i) => ({ name: h, index: i }))
          .filter(h => h.name.toLowerCase().startsWith("pratique"))
          .filter(h => row[h.index])
          .sort((a, b) => {
            const aN = parseInt(a.name.split(" ")[1]);
            const bN = parseInt(b.name.split(" ")[1]);
            return bN - aN;
          });
        
        const latestAnswer = iterationHistory.length > 0 ? clean(row[iterationHistory[0].index]) : "pas de reponse";
        const rawScore = ANSWER_VALUES[latestAnswer] ?? 0;
        const score = Math.max(0, Math.min(6, Math.round(rawScore)));
        const delay = DELAYS[score];
        const iterationCount = iterationHistory.length;

        Logger.log(`-- Question "${label}" est de type 'répétition espacée' en mode pratique.`);
        Logger.log(`-- Dernier score: ${score}, Délai requis: ${delay}, Itérations actuelles: ${iterationCount}`);

        if (iterationCount < delay) {
          skipped = true;
          reason = `⏳ Pratique délibérée en cours. Reviens après ${delay - iterationCount} itération(s).`;
        }

        spacedInfo = {
          score,
          lastIteration: iterationCount,
          required: delay
        };

        for (const h of iterationHistory) {
          const val = row[h.index];
          const repetitionNumber = h.name.split(" ")[1];
          const dateStr = sheet.getRange(2, h.index + 1).getValue(); // Récupérer la date de la ligne 2
          history.push({
            value: val,
            repetition: `répétition ${repetitionNumber}`,
            date: dateStr
          });
        }
      } else {
        const { score, lastDate } = computeScoreAndLastDate(row);
        const delay = DELAYS[score];
        Logger.log(`-- Question "${label}" est de type 'répétition espacée'. Score: ${score}, Délai: ${delay} jours.`);

        if (lastDate) {
          const next = new Date(lastDate);
          next.setDate(next.getDate() + delay);
          if (isToday && referenceDate < next) {
            skipped = true;
            nextDate = Utilities.formatDate(next, "GMT+1", "dd/MM/yyyy");
            reason = `✅ Réponse positive enregistrée récemment. Prochaine apparition prévue le ${nextDate}.`;
          }
          spacedInfo = {
            score,
            lastDate: Utilities.formatDate(lastDate, "GMT+1", "dd/MM/yyyy"),
            nextDate: Utilities.formatDate(next, "GMT+1", "dd/MM/yyyy")
          };
        }
        
        for (let col = headers.length - 1; col >= 5; col--) {
          const val = row[col];
          const dateStr = headers[col];
          if (val && dateStr) {
            if (typeof dateStr === 'string' && dateStr.includes('/')) {
              const [d, m, y] = dateStr.split("/");
              const entryDate = new Date(`${y}-${m}-${d}`);
              const entryOnly = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate());
              if (entryOnly <= refDateOnly) {
                history.push({ value: val, date: dateStr });
              }
            }
          }
        }
      }
    }
    
    if (skipped) {
      Logger.log(`-- Question "${label}" est marquée comme sautée. Raison : ${reason}`);
    }

    const base = { id: label, label, type, history, isSpaced, spacedInfo };

    if (skipped) {
      result.push({ ...base, skipped: true, nextDate, reason });
    } else {
      result.push({ ...base, skipped: false });
    }
  }
  Logger.log(`✅ [doGet] Fin du traitement. ${result.length} questions à retourner.`);
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}