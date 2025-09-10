/** ===========================
 * Helpers.gs — tags dans la note de la col A
 * =========================== */

// -- Utilitaires communs --
function _getNote(range){ return (range.getNote() || "").toString(); }
function _setNote(range, s){ range.setNote(String(s || "")); }
function _putTag(note, key, rawVal){
  // remplace ou ajoute un tag [key:...]
  var re = new RegExp("\\["+key+":"+"[^\\]]*"+"\\]");
  if (re.test(note)) return note.replace(re, "["+key+":"+rawVal+"]");
  return (note ? note + " " : "") + "["+key+":"+rawVal+"]";
}
function _delTag(note, key){
  var re = new RegExp("\\s*\\["+key+":"+"[^\\]]*"+"\\]");
  return note.replace(re, "").trim();
}
function _findTag(note, key){
  var re = new RegExp("\\["+key+":"+"([^\\]]*)"+"\\]");
  var m = note.match(re);
  return m ? m[1] : null;
}

// ID ligne stable -------------------------------------------------
function getRowId(anchorRange){
  var id = _findTag(_getNote(anchorRange), "id");
  return id || null;
}
function ensureRowId(anchorRange){
  var id = getRowId(anchorRange);
  if (id) return id;
  id = Utilities.getUuid(); // UUID
  var note = _getNote(anchorRange);
  note = _putTag(note, "id", id);
  _setNote(anchorRange, note);
  return id;
}

// Priorité (1..3) -------------------------------------------------
function getPriority(anchorRange){
  var v = _findTag(_getNote(anchorRange), "pri");
  var n = v ? parseInt(v,10) : NaN;
  return (n === 1 || n === 2 || n === 3) ? n : 2; // défaut P2
}
function setPriority(anchorRange, n){
  n = (n===1||n===2||n===3) ? n : 2;
  var note = _getNote(anchorRange);
  note = _putTag(note, "pri", String(n));
  _setNote(anchorRange, note);
}

// SR (spaced repetition) on/off + unité ---------------------------
function getSRInfo(anchorRange){
  var raw = _findTag(_getNote(anchorRange), "sr"); // ex: "on;unit=days"
  if (!raw){
    return { on:false, unit:"days" };
  }
  var on = /(^|;)on($|;)/.test(raw);
  var unit = (raw.match(/unit=(days|iters)/)?.[1]) || "days";
  return { on:on, unit:unit };
}
function setSRToggle(anchorRange, on, unit){
  unit = (unit==="iters" ? "iters" : "days");
  var val = (on ? "on" : "off") + ";unit=" + unit;
  var note = _getNote(anchorRange);
  note = _putTag(note, "sr", val);
  _setNote(anchorRange, note);
}

// Délai manuel “daily” --------------------------------------------
function getDailyDue(anchorRange){
  var m = (_getNote(anchorRange).match(/\[delay:daily\|[^]]*due=(\d{4}-\d{2}-\d{2})[^]]*\]/));
  if (!m) return null;
  var dueISO = m[1];
  return { dueISO: dueISO, human: dueISO.split("-").reverse().join("/") };
}
function setDailyDue(anchorRange, dueISO){
  // dueISO: "YYYY-MM-DD"; passer null pour retirer
  var note = _getNote(anchorRange);
  note = _delTag(note, "delay:daily");
  if (dueISO){
    note = note + " " + "[delay:daily|due="+dueISO+"]";
  }
  _setNote(anchorRange, note.trim());
}

// Pratique — remain par catégorie --------------------------------
function getPracticeRemaining(anchorRange, category){
  category = String(category || "");
  if (!category) return null;
  var note = _getNote(anchorRange);
  var re = new RegExp("\\[remain:"+_escapeRegExp(category)+"=(\\d+)\\]");
  var m = note.match(re);
  if (!m) return null;
  var remain = parseInt(m[1],10) || 0;
  return { remain: remain, human: remain+" itération(s)" };
}
function setPracticeRemaining(anchorRange, category, remain){
  category = String(category || "");
  var note = _getNote(anchorRange);
  // supprime précédent
  note = note.replace(new RegExp("\\s*\\[remain:"+_escapeRegExp(category)+"=\\d+\\]"), "").trim();
  // ajoute si > 0
  if (remain > 0){
    note = (note ? note+" " : "") + "[remain:"+category+"="+remain+"]";
  }
  _setNote(anchorRange, note);
}
function shouldSkipPracticeRemaining(anchorRange, category){
  var info = getPracticeRemaining(anchorRange, category);
  return info ? info.remain > 0 : false;
}
function decrementPracticeRemainForCategory(sheet, category, startRow, numRows, anchorCol){
  // Parcourt les lignes et décrémente [remain:Category] si > 0
  var rng = sheet.getRange(startRow, 1, numRows, Math.max(5, sheet.getLastColumn()));
  var values = rng.getValues();
  for (var i=0;i<values.length;i++){
    var row = startRow + i;
    var rowCat = (values[i][1] || "").toString().trim(); // col B (index 1)
    if (rowCat !== category) continue;
    var anchor = sheet.getRange(row, anchorCol || 1);
    var info = getPracticeRemaining(anchor, category);
    if (info && info.remain > 0){
      setPracticeRemaining(anchor, category, info.remain - 1);
    }
  }
}

// Après réponse — hook neutre & sûr -------------------------------
function applySRAfterAnswer(cell, halfPoint, contextKey, mode, value){
  // Hook minimal : ta logique principale gère déjà la SR
  return;
}

// Petits utilitaires ----------------------------------------------
function _escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'); }
function _parseISO(s){
  s = String(s || "");
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
}


