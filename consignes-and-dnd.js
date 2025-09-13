import { WORKER_URL, apiUrl, user, showToast, flashSaved, apiFetch } from './core-api-and-utils.js';
import { appState, __persistCurrentDOMOrder, queueSoftSave } from './state-and-persistence.js';

// Fréquences / catégories
const WEEKDAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const FREQ_SPECIAL = ["Quotidien"];

function parseFreqString(s) {
  if (!s || typeof s !== "string") return new Set();
  const parts = s.split(",").map(x => x.trim()).filter(Boolean);
  return new Set(parts);
}

function freqSetToString(set) {
  if (!set || set.size === 0) return "";
  return Array.from(set).join(", ");
}

export async function getAllCategories() {
  try {
    const respCats = await apiFetch("GET", `?mode=practice`);
    const set = new Set(Array.isArray(respCats) ? respCats : (respCats.categories || []));

    try {
      const respAll = await apiFetch("GET", `?mode=consignes`, { fresh: true });
      const all = Array.isArray(respAll) ? respAll : (respAll.consignes || []);
      all.forEach(x => { if (x?.category) set.add(x.category); });
    } catch {}
    return Array.from(set).filter(Boolean).sort((a,b)=>a.localeCompare(b,'fr'));
  } catch {
    return [];
  }
}

export function buildFreqMulti(container, currentString) {
  if (!container) return;
  container.innerHTML = "";
  
  const current = parseFreqString(currentString || "");
  
  // Quotidien checkbox
  const quotDiv = document.createElement("div");
  quotDiv.className = "flex items-center gap-2";
  const quotCheck = document.createElement("input");
  quotCheck.type = "checkbox";
  quotCheck.id = "freq-quotidien";
  quotCheck.checked = current.has("Quotidien");
  const quotLabel = document.createElement("label");
  quotLabel.htmlFor = "freq-quotidien";
  quotLabel.textContent = "Quotidien";
  quotDiv.appendChild(quotCheck);
  quotDiv.appendChild(quotLabel);
  container.appendChild(quotDiv);
  
  // Weekdays
  const weekDiv = document.createElement("div");
  weekDiv.className = "grid grid-cols-2 gap-2 mt-2";
  WEEKDAYS.forEach(day => {
    const dayDiv = document.createElement("div");
    dayDiv.className = "flex items-center gap-2";
    const dayCheck = document.createElement("input");
    dayCheck.type = "checkbox";
    dayCheck.id = `freq-${day.toLowerCase()}`;
    dayCheck.checked = current.has(day);
    const dayLabel = document.createElement("label");
    dayLabel.htmlFor = `freq-${day.toLowerCase()}`;
    dayLabel.textContent = day;
    dayDiv.appendChild(dayCheck);
    dayDiv.appendChild(dayLabel);
    weekDiv.appendChild(dayDiv);
  });
  container.appendChild(weekDiv);
}

export function readFreqMulti(container) {
  if (!container) return "";
  const selected = new Set();
  
  // Check quotidien
  const quotCheck = container.querySelector("#freq-quotidien");
  if (quotCheck?.checked) selected.add("Quotidien");
  
  // Check weekdays
  WEEKDAYS.forEach(day => {
    const dayCheck = container.querySelector(`#freq-${day.toLowerCase()}`);
    if (dayCheck?.checked) selected.add(day);
  });
  
  return freqSetToString(selected);
}

// SR toggle (UI du modal)
export function setupSRToggle(btn, initialOn) {
  if (!btn) return () => false;
  
  let isOn = !!initialOn;
  
  const paint = () => {
    btn.textContent = isOn ? "ON" : "OFF";
    btn.className = "px-3 py-1 rounded border text-sm " + (isOn
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-gray-50 text-gray-700 border-gray-200");
  };
  
  btn.onclick = () => {
    isOn = !isOn;
    paint();
  };
  
  paint();
  return () => isOn;
}

// CRUD consignes
export async function createConsigne(payload) {
  const body = {
    _action: "consigne_create",
    user,
    category: payload.category,
    type: payload.type,
    frequency: payload.frequency || "pratique délibérée",
    label: payload.label,
    priority: payload.priority,
    apiUrl
  };
  const res = await fetch(WORKER_URL, { method: "POST", body: JSON.stringify(body) });
  const ct = res.headers.get("content-type") || "";
  let newId = null;
  if (ct.includes("application/json")) {
    try {
      const j = await res.json();
      newId = j?.id || j?.newId || j?.consigne?.id || null;
    } catch {}
  } else {
    await res.text().catch(()=>{});
  }
  return { ok: res.ok, newId };
}

export async function updateConsigne(payload) {
  const body = {
    _action: "consigne_update",
    user,
    id: payload.id,
    category: payload.category,
    type: payload.type,
    frequency: payload.frequency,
    label: payload.label,
    priority: payload.priority,
    apiUrl
  };
  await fetch(WORKER_URL, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function deleteConsigne(id) {
  const body = { _action: "consigne_delete", user, id, apiUrl };
  await fetch(WORKER_URL, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function loadConsignes() {
  const resp = await apiFetch("GET", `?mode=consignes`, { fresh: true });
  const list = Array.isArray(resp) ? resp : (resp?.consignes || []);
  renderConsignesManager(list);
}

function renderConsignesManager(consignes) {
  const wrap = document.getElementById("consignes-list");
  if (!wrap) return;
  wrap.innerHTML = "";

  // Grouper 1=Haute, 2=Moyenne, 3=Faible
  const groups = { 1: [], 2: [], 3: [] };
  (Array.isArray(consignes) ? consignes : []).forEach(c => {
    const p = Number(c?.priority ?? 2);
    (p === 1 || p === 2 || p === 3 ? groups[p] : groups[2]).push(c);
  });

  // Tri alphabétique par label dans chaque groupe
  Object.values(groups).forEach(g => g.sort((a,b) => (a.label||"").localeCompare(b.label||"", "fr")));

  // Priorité 1 (Haute) - Rouge
  if (groups[1].length) {
    const section = document.createElement("div");
    section.className = "mb-4";
    const title = document.createElement("h4");
    title.className = "text-sm font-medium text-red-700 mb-2 border-l-4 border-red-500 pl-2";
    title.textContent = `Priorité Haute (${groups[1].length})`;
    section.appendChild(title);
    
    groups[1].forEach(c => {
      const row = createConsigneRow(c, "border-red-200");
      section.appendChild(row);
    });
    wrap.appendChild(section);
  }

  // Priorité 2 (Moyenne) - Jaune
  if (groups[2].length) {
    const section = document.createElement("div");
    section.className = "mb-4";
    const title = document.createElement("h4");
    title.className = "text-sm font-medium text-yellow-700 mb-2 border-l-4 border-yellow-500 pl-2";
    title.textContent = `Priorité Moyenne (${groups[2].length})`;
    section.appendChild(title);
    
    groups[2].forEach(c => {
      const row = createConsigneRow(c, "border-yellow-200");
      section.appendChild(row);
    });
    wrap.appendChild(section);
  }

  // Priorité 3 (Faible) - Gris, dans un <details> replié
  if (groups[3].length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.className = "text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-800 border-l-4 border-gray-400 pl-2 mb-2";
    summary.textContent = `Priorité Faible (${groups[3].length})`;
    details.appendChild(summary);
    
    const section = document.createElement("div");
    section.className = "ml-4";
    groups[3].forEach(c => {
      const row = createConsigneRow(c, "border-gray-200");
      section.appendChild(row);
    });
    details.appendChild(section);
    wrap.appendChild(details);
  }

  if (!groups[1].length && !groups[2].length && !groups[3].length) {
    wrap.innerHTML = `<div class="text-sm text-gray-500 px-2 py-3">Aucune consigne pour le moment.</div>`;
  }
}

function createConsigneRow(c, borderClass) {
  const row = document.createElement("div");
  row.className = `flex items-center justify-between p-2 border ${borderClass} rounded mb-1 bg-white`;
  
  const info = document.createElement("div");
  info.className = "flex-1";
  
  const label = document.createElement("span");
  label.className = "font-medium";
  label.textContent = c.label || "";
  info.appendChild(label);
  
  if (c.category) {
    const cat = document.createElement("span");
    cat.className = "ml-2 text-xs text-gray-500";
    cat.textContent = `(${c.category})`;
    info.appendChild(cat);
  }
  
  const freq = document.createElement("div");
  freq.className = "text-xs text-gray-600";
  freq.textContent = c.frequency || "";
  info.appendChild(freq);
  
  row.appendChild(info);
  
  const actions = document.createElement("div");
  actions.className = "flex gap-2";
  
  const edit = document.createElement("button");
  edit.className = "px-2 py-1 text-sm border rounded hover:bg-blue-50 text-blue-700 border-blue-200";
  edit.textContent = "Modifier";
  edit.onclick = () => openConsigneModal(c);
  actions.appendChild(edit);
  
  const del = document.createElement("button");
  del.className = "px-2 py-1 text-sm border rounded hover:bg-red-50 text-red-700 border-red-200";
  del.textContent = "Supprimer";
  del.onclick = async () => {
    if (!confirm("Supprimer définitivement cette consigne ?")) return;
    const rowEl = row, parent = rowEl.parentElement;
    rowEl.remove();
    try {
      await deleteConsigne(c.id);
      showToast("🗑️ Supprimée");
      // Refresh with fresh data
      loadConsignes();
    } catch (e) {
      if (parent) parent.appendChild(rowEl);
      showToast("❌ Erreur de suppression", "red");
      console.error(e);
    }
  };
  actions.appendChild(del);
  
  row.appendChild(actions);
  return row;
}

export async function openConsigneModal(c = null) {
  const modal = document.getElementById("consigne-modal");
  if (!modal) return;
  const form = document.getElementById("consigne-form");
  let isSubmitting = false;
  
  document.getElementById("consigne-modal-title").textContent = c ? "Modifier la consigne" : "Nouvelle consigne";

  form.reset();
  form.elements.id.value = c?.id || "";
  form.elements.label.value = c?.label || "";
  form.elements.type.value = c?.type || "Oui/Non";
  form.elements.priority.value = String(c?.priority || 2);

  const dl = document.getElementById("categories-datalist");
  if (dl) {
    dl.innerHTML = "";
    getAllCategories().then(list => { 
      list.forEach(cat => { 
        const opt = document.createElement("option"); 
        opt.value = cat; 
        dl.appendChild(opt); 
      }); 
    });
  }
  const catInput = document.getElementById("consigne-category");
  if (catInput) catInput.value = c?.category || "";

  const freqBox = document.getElementById("freq-multi");
  const isPractice = /pratique\s*d[ée]lib[ée]r[ée]e/i.test(c?.frequency || "");
  if (freqBox) buildFreqMulti(freqBox, isPractice ? "" : (c ? (c.frequency || "") : "Quotidien"));

  // More robust SR state calculation with fallbacks
  const initialSrOn = 
    (c?.scheduleInfo?.sr?.on) ?? 
    (c?.sr === "on") ?? 
    (appState.srToggles?.[c?.id] === "on") ?? 
    true;  // Default to ON if unknown
  const getSR = setupSRToggle(document.getElementById("sr-toggle"), initialSrOn);

  // Mode (daily vs practice)
  const modeDaily = form.querySelector('[name="modeConsigne"][value="daily"]');
  const modePractice = form.querySelector('[name="modeConsigne"][value="practice"]');
  const freqBlock = document.getElementById("freq-block");
  if (modeDaily && modePractice) {
    modePractice.checked = isPractice;
    modeDaily.checked = !isPractice;
    buildFreqMulti(freqBox, isPractice ? "" : (c?.frequency || ""));
    if (freqBlock) freqBlock.classList.toggle("hidden", isPractice);
    form.querySelectorAll('[name="modeConsigne"]').forEach(r=>{
      r.addEventListener("change", ()=>{
        const daily = modeDaily.checked;
        if (freqBlock) freqBlock.classList.toggle("hidden", !daily);
      });
    });
  }

  // Focus + raccourci Ctrl/Cmd+Enter
  form.querySelector('[name="label"]')?.focus();
  form.addEventListener('keydown', (e)=>{ if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') form.requestSubmit(); });

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    isSubmitting = true;
    
    const daily = form.querySelector('[name="modeConsigne"][value="daily"]')?.checked !== false;
    const payload = {
      id: form.elements.id.value || null,
      label: form.elements.label.value.trim(),
      category: (document.getElementById("consigne-category")?.value || "").trim(),
      type: form.elements.type.value,
      priority: parseInt(form.elements.priority.value || "2", 10),
      frequency: daily ? (readFreqMulti(document.getElementById("freq-multi")) || "Quotidien") : "pratique délibérée",
      sr: getSR() // Include SR state in payload
    };
    if (!payload.label) { showToast("❌ Label requis", "red"); isSubmitting = false; return; }

    const submitBtn = document.querySelector('#consigne-modal button[type="submit"]');
    const restore = () => { submitBtn.disabled = false; submitBtn.textContent = "Enregistrer"; isSubmitting = false; };

    submitBtn.disabled = true;
    submitBtn.textContent = "Enregistrement…";

    try {
      if (payload.id) {
        // UPDATE
        await updateConsigne(payload);
        showToast("✅ Consigne mise à jour");
        closeConsigneModal();
        restore();
        loadConsignes();
      } else {
        // CREATE
        const { ok, newId } = await createConsigne(payload);
        if (!ok) throw new Error("Création échouée");
        showToast("✅ Consigne créée");
        closeConsigneModal();
        restore();
        loadConsignes();
      }
    } catch (err) {
      console.error(err);
      showToast("❌ Échec de l'enregistrement", "red");
      restore();
    }
  };

  modal.classList.remove("hidden");
  // Fermeture (ESC, X, backdrop, bouton Annuler)
  const cancelBtn = document.getElementById("consigne-cancel");
  if (cancelBtn) cancelBtn.onclick = closeConsigneModal;
  const closeX = document.getElementById("consigne-close-x");
  if (closeX) closeX.onclick = closeConsigneModal;
  const backdrop = modal.querySelector('[data-close="backdrop"]');
  if (backdrop) backdrop.onclick = closeConsigneModal;
  document.addEventListener("keydown", _onEsc);
}

function closeConsigneModal(){
  const modal = document.getElementById("consigne-modal");
  if (modal) modal.classList.add("hidden");
  document.removeEventListener("keydown", _onEsc);
}

function _onEsc(e){ if (e.key === "Escape") closeConsigneModal(); }

// DnD - Simple placeholder implementation
export function enableDnD(listEl, targetPriority) {
  // This is a simplified version - the full drag and drop implementation
  // would be more complex and require the full dragState management
  if (!listEl) return;
  
  console.log(`DnD enabled for priority ${targetPriority}`);
  // The full implementation would include drag handlers, auto-scroll, etc.
  // For now, this is a placeholder that can be expanded later
}
