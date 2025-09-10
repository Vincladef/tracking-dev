/** metaTags.gs — helpers légers pour ID & priorité (compatibles avec les nouveaux tags) **/

function _mt_getNote(range){ return (range.getNote() || "").toString(); }
function _mt_setNote(range, s){ range.setNote(String(s || "")); }
function _mt_putTag(note, key, rawVal){
  // remplace ou ajoute un tag [key:...]
  var re = new RegExp("\\[" + key + ":[^\\]]*\\]");
  return re.test(note)
    ? note.replace(re, "[" + key + ":" + rawVal + "]")
    : (note ? note + " " : "") + "[" + key + ":" + rawVal + "]";
}
function _mt_findTag(note, key){
  var re = new RegExp("\\[" + key + ":([^\\]]*)\\]");
  var m = note.match(re);
  return m ? m[1] : null;
}

/** ---- ID ligne stable ---- **/
function getRowId(anchorRange){
  return _mt_findTag(_mt_getNote(anchorRange), "id");
}
function ensureRowId(anchorRange){
  var id = getRowId(anchorRange);
  if (id) return id;
  id = Utilities.getUuid();
  var note = _mt_getNote(anchorRange);
  note = _mt_putTag(note, "id", id);
  _mt_setNote(anchorRange, note);
  return id;
}

/** ---- Priorité (1..3) ---- **/
function getPriority(anchorRange){
  var v = _mt_findTag(_mt_getNote(anchorRange), "pri");
  var n = v ? parseInt(v, 10) : NaN;
  return (n === 1 || n === 2 || n === 3) ? n : 2; // défaut P2
}
function setPriority(anchorRange, n){
  n = (n === 1 || n === 2 || n === 3) ? n : 2;
  var note = _mt_getNote(anchorRange);
  note = _mt_putTag(note, "pri", String(n));
  _mt_setNote(anchorRange, note);
}
