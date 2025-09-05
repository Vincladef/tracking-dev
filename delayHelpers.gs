/**
 * ========= delayHelpers.gs =========
 * Stocke les délais directement dans les notes de cellule.
 * Format machine-lisible (dernière ligne de la note) :
 * [delay:daily|due=YYYY-MM-DD|base=YYYY-MM-DD]
 * [delay:practice|category=...|remain=2]
 *
 * La partie lisible reste libre (ex: "⏱️ Reviens le 12/08/2025").
 */

const DELAY_TAG_PREFIX = '[delay:';
const TZ = Session.getScriptTimeZone() || 'Europe/Paris';

/** ---------- Utils dates ---------- */
function _parseISO(dateISO) {
  // YYYY-MM-DD -> Date en TZ du script, sans décalage heure
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0);
  // normalise dans la TZ pour formatage correct
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
function _addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}
function _toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function _formatFR(d) {
  return Utilities.formatDate(d, TZ, 'dd/MM/yyyy');
}

/** ---------- Utils notes ---------- */
function _stripDelayTags(note) {
  if (!note) return "";
  return note.split('\n')
             .filter(line => !/^\s*\[delay:.*?\]\s*$/.test(line.trim()))
             .join('\n').trim();
}function _stripSRTags(note) {
  if (!note) return "";
  return note.split('\n')
             .filter(line => !/^\s*\[sr:.*?\]\s*$/.test(line.trim()))
             .join('\n').trim();
}
function _readDelayTag(note) {
  if (!note) return null;
  const lines = note.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith(DELAY_TAG_PREFIX) && t.endsWith(']')) {
      // exemple: [delay:daily|due=2025-08-12|base=2025-08-11]
      const inside = t.slice(1, -1); // delay:daily|...
      const [head, ...pairs] = inside.split('|');
      const mode = head.split(':')[1]; // daily / practice
      const obj = { mode };
      pairs.forEach(p => {
        const [k, v] = p.split('=');
        obj[k] = v;
      });
      return obj;
    }
  }
  return null;
}
function _writeNoteWithTag(range, humanText, tagObj) {
  const tagParts = Object.entries(tagObj)
    .map(([k, v]) => `${k}=${v}`);
  const tagLine = `[delay:${tagObj.mode}|${tagParts.filter(s => !s.startsWith('mode=')).join('|')}]`;

  const existing = range.getNote();
  const cleaned = _stripDelayTags(existing);
  const human = humanText ? humanText.trim() : '';
  const finalNote = [human, cleaned, tagLine].filter(Boolean).join('\n');
  range.setNote(finalNote);
}
function _clearDelayFrom(range) {
  const cleaned = _stripDelayTags(range.getNote());
  range.setNote(cleaned);
}

/**
 * Pose un délai JOURNALIER sur la cellule de réponse + ancre en col 1.
 * @param {Range} responseRange  cellule où l'utilisateur a répondu (ex: ligne de la question, colonne du jour)
 * @param {string} baseDateISO   date sélectionnée côté front (YYYY-MM-DD)
 * @param {number} days          n jours à attendre (0 = aujourd'hui). -1 = retirer le délai.
 * @param {number} anchorCol     colonne "Question" (par défaut 1)
 */
function setDailyDelay(responseRange, baseDateISO, days, anchorCol = 1) {
  const sheet = responseRange.getSheet();
  const row = responseRange.getRow();
  const anchor = sheet.getRange(row, anchorCol);

  if (days === -1) { // suppression
    _clearDelayFrom(responseRange);
    _clearDelayFrom(anchor);
    resetSR(anchor, 'days');   // ⬅️ remet n=0, interval=1, garde ON/OFF
    return null;
  }

  const base = _parseISO(baseDateISO);
  const due = _addDays(base, Number(days || 0));
  const dueISO = _toISO(due);
  const human = `⏱️ Reviens le ${_formatFR(due)}`;

  // jolie bulle sur la cellule réponse
  _writeNoteWithTag(responseRange, human, { mode: 'daily', due: dueISO, base: baseDateISO });
  // tag "canonique" sur la cellule question
  _writeNoteWithTag(anchor, human, { mode: 'daily', due: dueISO, base: baseDateISO });

  return { dueISO, human };
}

/**
 * Lit le prochain "due" JOURNALIER depuis la cellule "Question" (col 1 par défaut).
 * @param {Range} rowAnchorRange une cellule de la ligne (ex: getRange(row,1))
 */
function getDailyDue(rowAnchorRange) {
  const tag = _readDelayTag(rowAnchorRange.getNote());
  if (!tag || tag.mode !== 'daily' || !tag.due) return null;
  const d = _parseISO(tag.due);
  return { dueISO: tag.due, human: `⏱️ Reviens le ${_formatFR(d)}` };
}

/**
 * True si, pour une date sélectionnée, la question doit être masquée.
 * @param {Range} rowAnchorRange cellule ancre (col 1)
 * @param {string} selectedDateISO date en cours (YYYY-MM-DD)
 */
function shouldSkipDaily(rowAnchorRange, selectedDateISO) {
  const due = getDailyDue(rowAnchorRange);
  if (!due) return false;
  return selectedDateISO < due.dueISO; // encore en délai → masquer
}

// --- PRACTICE: compte à rebours (remain) par catégorie ---
/**
 * Pose un délai pratique "remain" (nb d’itérations à attendre).
 * Ecrit la note sur la cellule de réponse + sur la cellule ancre (col 1).
 */
function setPracticeDelayRemaining(responseRange, category, remain, anchorCol = 1) {
  const sheet = responseRange.getSheet();
  const row = responseRange.getRow();
  const anchor = sheet.getRange(row, anchorCol);

  if (remain <= 0) {
    _clearDelayFrom(responseRange);
    _clearDelayFrom(anchor);
    resetSR(anchor, 'iters');  // ⬅️ remet n=0, interval=1
    return null;
  }

  const human = `⏱️ Revient dans ${remain} itération(s)`;
  const tag = { mode: 'practice', category: String(category), remain: String(remain) };

  _writeNoteWithTag(responseRange, human, tag);
  _writeNoteWithTag(anchor, human, tag);

  return { remain, human };
}

/** Lit le "remain" pour une catégorie depuis la cellule ancre (col 1). */
function getPracticeRemaining(rowAnchorRange, category) {
  const tag = _readDelayTag(rowAnchorRange.getNote());
  if (!tag || tag.mode !== 'practice') return null;
  if (String(tag.category || '') !== String(category)) return null;
  const remain = Number(tag.remain || 0);
  if (!Number.isFinite(remain) || remain <= 0) return null;
  return { remain, human: `⏱️ Revient dans ${remain} itération(s)` };
}

/** True si, pour une catégorie, la question doit être masquée. */
function shouldSkipPracticeRemaining(rowAnchorRange, category) {
  const info = getPracticeRemaining(rowAnchorRange, category);
  return !!info; // si remain>0, on masque
}

/**
 * A appeler à CHAQUE nouvelle itération de la catégorie :
 * décrémente remain pour toutes les lignes de la catégorie.
 */
function decrementPracticeRemainForCategory(sheet, category, startRow, numRows, anchorCol = 1) {
  const anchors = sheet.getRange(startRow, anchorCol, numRows, 1).getNotes().map(r => r[0] || '');
  for (let i = 0; i < anchors.length; i++) {
    const note = anchors[i];
    const tag = _readDelayTag(note);
    if (!tag || tag.mode !== 'practice' || String(tag.category || '') !== String(category)) continue;

    let remain = Number(tag.remain || 0);
    if (!Number.isFinite(remain) || remain <= 0) continue;

    remain -= 1; // une itération vient d’être créée
    const row = startRow + i;
    const anchor = sheet.getRange(row, anchorCol);

    if (remain <= 0) {
      // délai terminé -> on nettoie
      _clearDelayFrom(anchor);
    } else {
      const human = `⏱️ Revient dans ${remain} itération(s)`;
      _writeNoteWithTag(anchor, human, { mode:'practice', category:String(category), remain:String(remain) });
    }
  }
}
/** ---------- SR tags ---------- 
 * [sr:on|unit=days|ef=2.5|n=3|interval=8|due=2025-09-10]
 * [sr:on|unit=iters|ef=2.5|n=3|interval=5]
 */function _readSRTag(note) {
  if (!note) return null;
  const lines = note.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith('[sr:') && t.endsWith(']')) {
      const inside = t.slice(1, -1); // sr:on|...
      const [head, ...pairs] = inside.split('|');
      const on = head.split(':')[1] === 'on';
      const obj = { on };
      pairs.forEach(p => {
        const [k, v] = p.split('=');
        obj[k] = v;
      });
      if (obj.ef) obj.ef = Number(obj.ef);
      if (obj.n != null) obj.n = parseFloat(String(obj.n));
      if (obj.interval) obj.interval = parseInt(String(obj.interval), 10);
      return obj;
    }
  }
  return null;
}function _writeSRTag(range, info) {
  const onOff = info.on ? 'on' : 'off';
  const parts = [`sr:${onOff}`];
  if (info.unit) parts.push(`unit=${info.unit}`);
  if (Number.isFinite(info.n)) parts.push(`n=${String(info.n)}`);
  if (Number.isFinite(info.interval)) parts.push(`interval=${String(info.interval)}`);
  if (info.due) parts.push(`due=${info.due}`);
  const tag = `[${parts.join('|')}]`;
  const cleaned = _stripSRTags(range.getNote());
  const finalNote = [cleaned, tag].filter(Boolean).join('\n').trim();
  range.setNote(finalNote);
}/** Remet le SR à zéro (streak) en conservant ON/OFF et l’unité si connue. */function resetSR(anchorRange, unitOpt) {
  const prev = _readSRTag(anchorRange.getNote()) || {};
  const info = {
    on: (typeof prev.on === 'boolean') ? prev.on : false, // garde l’état, défaut OFF
    unit: unitOpt || prev.unit || 'days',                // garde l’unité si connue
    n: 0.0,
    interval: 0
  };
  // on purge les champs SM-2 s’ils existaient
  // (ne pas passer ef/due => _writeSRTag ne les écrira pas)
  _writeSRTag(anchorRange, info);
}function setSRToggle(rowAnchorRange, on, unit) {
  const info = _readSRTag(rowAnchorRange.getNote()) || { on:false, n:0, interval:0 };
  info.on = !!on;
  if (unit) info.unit = unit; // "days" | "iters"
  if (!info.n) info.n = 0;
  if (!info.interval) info.interval = 0;
  _writeSRTag(rowAnchorRange, info);
  return info;
}function getSRInfo(rowAnchorRange) {
  const info = _readSRTag(rowAnchorRange.getNote());
  if (!info) return { on:false };
  return info;
}/** Map texte -> Likert 0..4 */function normalizeLikert(value) {
  const v = (value||"").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim();
  // Les valeurs actuelles du projet
  if (["non"].includes(v)) return 0;
  if (["plutot non","plutôt non"].includes(v)) return 1;
  if (["moyen"].includes(v)) return 2;
  if (["plutot oui","plutôt oui"].includes(v)) return 3;
  if (["oui"].includes(v)) return 4;
  // nombres directs "0..4"
  const n = parseInt(v,10);
  if (!isNaN(n) && n>=0 && n<=4) return n;
  return null; // inconnu
}/** Suite de Fibonacci avec Fib(0)=1, Fib(1)=1 */function _fib(n) {
  n = Math.max(0, parseInt(n, 10) || 0);
  if (n <= 1) return 1;
  let a = 1, b = 1;
  for (let i = 2; i <= n; i++) { const t = a + b; a = b; b = t; }
  return b;
}/**
 * Calcule le prochain état "streak Fibonacci".
 * - prevN  : streak actuel (entier >= 0)
 * - success: bool (Oui/Plutôt oui)
 * - cap    : plafond de l’intervalle (ex: 34 jours, 21 itérations)
 * - shift  : 0 => 1,1,2,3,5,... | 1 => 1,2,3,5,8,... (démarrage plus rapide)
 */function _nextFibStreak(prevN, success, cap, shift) {
  const n = success ? (Number(prevN || 0) + 1) : 0;
  let interval = _fib(n + (shift || 0));
  if (Number.isFinite(cap)) interval = Math.min(interval, cap);
  return { n, interval };
}/**
 * SR "demi-point"
 * - Oui           -> +1.0 au streak
 * - Plutôt oui    -> +0.5 au streak
 * - Moyen / Non…  -> reset (streak = 0)
 * Intervalle = floor(streak)
 * - daily    -> due = baseDate + interval jours
 * - practice -> remain = interval itérations
 */function applySRAfterAnswer(responseRange, anchorCol, baseDateISO_or_Category, mode, answerValue) {
  const sheet  = responseRange.getSheet();
  const row    = responseRange.getRow();
  const anchor = sheet.getRange(row, anchorCol);

  const srPrev = getSRInfo(anchor);                  // { on, unit?, n?, interval? ... } | { on:false }
  if (!srPrev.on) return null;                       // SR OFF => ne rien faire

  // Lire la réponse sous forme Likert 0..4
  const likert = normalizeLikert(answerValue);       // 0..4 ou null
  if (likert == null) return null;                   // pas de likert => on touche pas au SR

  // Streak actuel (peut être décimal)
  let streak = Number(srPrev.n || 0);
  if (!Number.isFinite(streak) || streak < 0) streak = 0;

  // Règle demi-point
  let successDelta = 0;
  if (likert >= 4) successDelta = 1.0;              // Oui
  else if (likert === 3) successDelta = 0.5;        // Plutôt oui
  else successDelta = -Infinity;                    // reset

  if (successDelta < 0) {
    // Reset : réapparition immédiate
    streak = 0;
    _clearDelayFrom(responseRange);
    _clearDelayFrom(anchor);
    const sr = { on: true, unit: (mode === "daily" ? "days" : "iters"), n: streak, interval: 0 };
    _writeSRTag(anchor, sr);
    return (mode === "daily")
      ? { unit: "days", dueISO: null, interval: 0, n: streak }
      : { unit: "iters", remain: 0,        interval: 0, n: streak };
  }

  // Succès : on incrémente le streak
  streak += successDelta;

  // Intervalle entier = floor(streak)
  let interval = Math.floor(streak);

  // (Optionnel) plafonds si tu veux en garder un
  const MAX_DAYS  = 34;   // daily
  const MAX_ITERS = 21;   // practice
  if (mode === "daily")   interval = Math.min(interval, MAX_DAYS);
  if (mode === "practice")interval = Math.min(interval, MAX_ITERS);

  // Aucun délai si interval = 0
  if (interval <= 0) {
    _clearDelayFrom(responseRange);
    _clearDelayFrom(anchor);
    const sr = { on: true, unit: (mode === "daily" ? "days" : "iters"), n: streak, interval: 0 };
    _writeSRTag(anchor, sr);
    return (mode === "daily")
      ? { unit: "days", dueISO: null, interval: 0, n: streak }
      : { unit: "iters", remain: 0,        interval: 0, n: streak };
  }

  // Poser le délai selon le mode
  if (mode === "daily") {
    const base   = _parseISO(String(baseDateISO_or_Category)); // YYYY-MM-DD
    const due    = _addDays(base, interval);
    const dueISO = _toISO(due);
    const human  = `⏱️ Reviens le ${_formatFR(due)}`;

    _writeNoteWithTag(responseRange, human, { mode: 'daily', due: dueISO, base: String(baseDateISO_or_Category) });
    _writeNoteWithTag(anchor,       human, { mode: 'daily', due: dueISO, base: String(baseDateISO_or_Category) });

    const sr = { on: true, unit: "days", n: streak, interval: interval, due: dueISO };
    _writeSRTag(anchor, sr);
    return { unit: "days", dueISO, interval, n: streak };
  }

  if (mode === "practice") {
    const category = String(baseDateISO_or_Category);
    const human = `⏱️ Revient dans ${interval} itération(s)`;

    _writeNoteWithTag(responseRange, human, { mode: 'practice', category, remain: String(interval) });
    _writeNoteWithTag(anchor,        human, { mode: 'practice', category, remain: String(interval) });

    const sr = { on: true, unit: "iters", n: streak, interval: interval };
    _writeSRTag(anchor, sr);
    return { unit: "iters", remain: interval, interval, n: streak };
  }

  return null;
}
