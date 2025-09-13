import { WORKER_URL, apiUrl, user, showToast, postWithBackoff, postWithRetry, flashSaved } from './core-api-and-utils.js';

// ✨ Centralisation de l'état de l'application
export const appState = {
  delayValues: {},
  srToggles: {},
  srBaseline: {},
  __srAutoPushed: {}, // évite les double-envois
  __lists: {},
  __hiddenPracticeSr: [],
  __srHardOff: new Set(),
  qById: new Map(),
  lastQuestions: [],
  mode: "daily",
  selectedDate: null,
  currentCategory: null,
  currentDate: null
};

// ====== PERSISTANCE DE L'ORDRE (localStorage) ======
function __ctxKey() {
  const sel = document.getElementById("date-select");
  const opt = sel?.selectedOptions?.[0] || null;
  const mode = opt?.dataset?.mode || "daily";
  if (mode === "practice") return `practice:${opt?.dataset?.category || ""}`;
  return "daily";
}

function __orderStoreKey() {
  // un ordre par utilisateur et par contexte (daily vs par catégorie)
  return `__consigneOrder__:${user}:${__ctxKey()}`;
}

function __loadSavedOrder() {
  try {
    const raw = localStorage.getItem(__orderStoreKey());
    if (!raw) return { 1: [], 2: [], 3: [] };
    const o = JSON.parse(raw);
    return { 1: Array.isArray(o[1])?o[1]:[], 2: Array.isArray(o[2])?o[2]:[], 3: Array.isArray(o[3])?o[3]:[] };
  } catch { return { 1: [], 2: [], 3: [] }; }
}

function __saveOrder(o) {
  try { localStorage.setItem(__orderStoreKey(), JSON.stringify({1:o[1]||[],2:o[2]||[],3:o[3]||[]})); } catch {}
}

export function __applySavedOrderToGroups(groups) {
  // Trie chaque groupe par ordre persistant s'il existe; sinon par label
  const saved = __loadSavedOrder();
  const byLabel = (a,b)=> (a.label||"").localeCompare(b.label||"", "fr", {sensitivity:"base"});
  for (const p of [1,2,3]) {
    const index = new Map((saved[p]||[]).map((id, i)=> [String(id), i]));
    groups[p].sort((a,b)=>{
      const ia = index.has(String(a.id)) ? index.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
      const ib = index.has(String(b.id)) ? index.get(String(b.id)) : Number.MAX_SAFE_INTEGER;
      return ia === ib ? byLabel(a,b) : ia - ib;
    });
  }
}

export function __persistCurrentDOMOrder() {
  // Lit l'ordre actuel dans le DOM et le sauvegarde
  const lists = appState.__lists || {};
  const out = { 1: [], 2: [], 3: [] };
  for (const p of [1,2,3]) {
    const el = lists[p];
    if (!el) continue;
    out[p] = [...el.querySelectorAll('[data-qid]')]
      .map(n => String(n.dataset.qid))
      .filter(Boolean);
  }
  __saveOrder(out);
  try { flashSaved(document.getElementById("daily-form")); } catch {}
}

// ----- AUTO-SAVE DOUX -----
let _softBuffer = {};
let _softTimer = null;
let _softAnchors = [];

// Flush immédiat du _softBuffer (POST "now")
export async function flushSoftSaveNow(reason = "manual", qid = "") {
  const keys = Object.keys(_softBuffer);
  if (!keys.length) return { ok: true, skipped: true };

  const selected = document.getElementById("date-select")?.selectedOptions[0];
  const mode = selected?.dataset.mode || appState.mode || "daily";

  // snapshot pour mise à jour locale de l'historique
  const snapshot = { ..._softBuffer };

  const payload = {
    _action: 'save_answers',
    apiUrl,
    user,
    ..._softBuffer,
    _mode: mode
  };
  
  if (mode === "daily") {
    payload._date = selected?.dataset.date || appState.selectedDate || appState.currentDate;
  } else {
    payload._category = selected?.dataset.category || appState.currentCategory;
  }

  // Ajouter les ancres pour le feedback visuel
  if (qid) {
    const anchor = document.querySelector(`[data-qid="${qid}"]`);
    if (anchor && !_softAnchors.includes(anchor)) {
      _softAnchors.push(anchor);
    }
  }

  try {
    const res = await postWithBackoff(payload);
    if (!res.ok) {
      showToast("❌ Échec de l'enregistrement", "red");
      return { ok: false, status: res.status };
    }

    // feedback visuel
    _softAnchors.forEach(a => flashSaved(a));
    _softAnchors = [];

    // purge du buffer
    _softBuffer = {};
    return { ok: true };
  } catch (e) {
    console.error("Erreur flushSoftSaveNow", e);
    showToast("❌ Erreur réseau", "red");
    return { ok: false, error: e };
  }
}

export function queueSoftSave(patchObj, anchorEl) {
  if (!patchObj || typeof patchObj !== 'object') return;
  
  // Log toggle actions for better debugging
  const toggleKeys = Object.keys(patchObj).filter(k => k.startsWith('__srToggle__'));
  if (toggleKeys.length) {
    console.log('SR Toggle detected in queueSoftSave:', toggleKeys);
  }

  // Add to buffer and schedule save
  const patch = { ...patchObj };  // Create a snapshot of the patch
  Object.assign(_softBuffer, patch);
  if (anchorEl) _softAnchors.push(anchorEl);

  if (_softTimer) clearTimeout(_softTimer);
  _softTimer = setTimeout(async () => {
    const keys = Object.keys(_softBuffer);
    if (!keys.length) return;

    // snapshot pour mise à jour locale
    const snapshot = { ..._softBuffer };

    const selected = document.getElementById("date-select")?.selectedOptions[0];
    const mode = selected?.dataset.mode || "daily";
    const body = {
      apiUrl,
      user,
      ..._softBuffer,
      _mode: mode,
      _action: 'save_answers'
    };
    
    if (mode === "daily") {
      body._date = selected?.dataset.date || appState.selectedDate || appState.currentDate;
    } else {
      body._category = selected?.dataset.category || appState.currentCategory;
    }

    // id transaction pour éviter doublons
    body.__txid = (crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`);

    // Badge "Enregistrement..."
    let b = document.getElementById("__saving_badge__");
    if (!b) {
      b = document.createElement("div");
      b.id = "__saving_badge__";
      b.style = "position:fixed; bottom:20px; right:20px; background:#4CAF50; color:white; padding:8px 16px; border-radius:4px; z-index:9999; opacity:0; transition:opacity 0.3s;";
      document.body.appendChild(b);
    }
    b.textContent = "Enregistrement...";
    b.style.opacity = "1";

    let ok = false;
    try {
      const res = await postWithRetry(WORKER_URL, body);
      ok = res.ok;
    } catch (e) {
      console.error("❌ Envoi impossible :", e);
      showToast("❌ Erreur d'envoi (quota). Réessaie dans un instant.", "red");
    } finally {
      // purge
      for (const k of keys) delete _softBuffer[k];
      const b = document.getElementById("__saving_badge__");
      if (b) setTimeout(()=>{ b.style.opacity = "0"; }, 80);

      if (ok) {
        _softAnchors.forEach(a => flashSaved(a));
        _softAnchors = [];
      } else {
        showToast("❌ Échec de l'enregistrement auto", "red");
      }
    }
  }, 1500);
}

// Exposé global optionnel pour compat (si tu en as besoin)
window.queueSoftSave = queueSoftSave;

// Bind autosave des inputs
export function bindFieldAutosave(inputEl, qid) {
  console.log("bindFieldAutosave appelé pour:", qid, inputEl.tagName);
  
  const push = () => {
    const val = inputEl.value; // on envoie la valeur brute
    console.log("Auto-save déclenché:", qid, "=", val);
    queueSoftSave({ [qid]: val }, inputEl);
  };

  if (inputEl.tagName === "SELECT") {
    let last = inputEl.value;
    const pushIfChanged = () => { if (inputEl.value !== last) { last = inputEl.value; push(); } };
    inputEl.addEventListener("change", pushIfChanged);
    inputEl.addEventListener("input",  pushIfChanged);
    inputEl.addEventListener("blur",   pushIfChanged);
    inputEl.addEventListener("click",  () => setTimeout(pushIfChanged, 0));
    inputEl.addEventListener("keyup",  (e) => {
      if (["Enter"," ","Spacebar","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) {
        setTimeout(pushIfChanged, 0);
      }
    });
    inputEl.addEventListener("touchend", () => setTimeout(pushIfChanged, 0), { passive: true });
  } else if (inputEl.tagName === "TEXTAREA") {
    const push = () => queueSoftSave({ [qid]: inputEl.value }, inputEl);
    inputEl.addEventListener("blur",   push);
    inputEl.addEventListener("change", push);
  } else if (inputEl.type === "text") {
    const push = () => queueSoftSave({ [qid]: inputEl.value }, inputEl);
    inputEl.addEventListener("change", push);
    inputEl.addEventListener("blur",   push);
  }
}

// Flush auto-save best-effort au déchargement
window.addEventListener("beforeunload", () => {
  if (_softTimer) {
    clearTimeout(_softTimer);
    _softTimer = null;
    const selected = document.getElementById("date-select")?.selectedOptions[0];
    if (!selected) return;
    const mode = selected.dataset.mode || "daily";
    const body = { apiUrl, user, ..._softBuffer, _action: 'save_answers' };
    if (mode === "daily") { body._mode = "daily"; body._date = selected.dataset.date; }
    else { body._mode = "practice"; body._category = selected.dataset.category; }
    body.__txid = `beforeunload_${Date.now()}`;
    navigator.sendBeacon?.(WORKER_URL, JSON.stringify(body));
  }
});
