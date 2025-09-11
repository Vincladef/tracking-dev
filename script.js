// SCRIPT.JS : 🧑 Identifier l’utilisateur depuis l’URL
const WORKER_URL = "https://tight-snowflake-cdad.como-denizot.workers.dev/";

async function apiFetch(method, pathOrParams, opts = {}) {
  if (method !== "GET") throw new Error("apiFetch() n'est utilisé ici que pour GET");
  let query = pathOrParams || "";
  if (opts.fresh) {
    query += (query.includes("?") ? "&" : "?") + "nocache=1&_=" + Date.now();
  }
  const u = new URL(WORKER_URL);
  u.searchParams.set("apiUrl", apiUrl);
  u.searchParams.set("query", query);
  if (opts.fresh) u.searchParams.set("nocache", "1"); // hint pour le Worker
  const res = await fetch(u.toString());
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

function toQuestions(raw) {
  console.log("↩︎ Réponse brute:", { type: typeof raw, raw });
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.questions)) return raw.questions;
  if (Array.isArray(raw?.data))      return raw.data;
  if (Array.isArray(raw?.items))     return raw.items;
  if (typeof raw === "string") {
    const txt = raw.trim();
    if (txt.startsWith("<!DOCTYPE") || txt.startsWith("<html")) {
      console.error("⚠️ Le backend renvoie du HTML (probable erreur Apps Script).");
      return null;
    }
    try { const j = JSON.parse(txt); return toQuestions(j); } catch { return null; }
  }
  return null;
}
const urlParams = new URLSearchParams(location.search);
const user = urlParams.get("user")?.toLowerCase();

if (!user) {
  showToast("❌ Aucun utilisateur indiqué !", "red");
  throw new Error("Utilisateur manquant");
}

// 🌐 Récupération automatique de l’apiUrl depuis le Google Sheet central
const CONFIG_URL = "https://script.google.com/macros/s/AKfycbyF2k4XNW6rqvME1WnPlpTFljgUJaX58x0jwQINd6XPyRVP3FkDOeEwtuierf_CcCI5hQ/exec";

let apiUrl = null;

// ✨ Centralisation de l'état de l'application
const appState = {
  delayValues: {},
  srToggles: {},
  srBaseline: {},
  __srAutoPushed: {}, // évite les double-envois
};

fetch(`${CONFIG_URL}?user=${encodeURIComponent(user)}`)
  .then(async res => {
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Erreur HTTP lors de la récupération de la config : ${res.status} — ${txt.slice(0, 200)}`);
    }
    return res.json();
  })
  .then(config => {
    if (config.error) {
      showToast(`❌ ${config.error}`, "red");
      throw new Error(config.error);
    }

    apiUrl = config.apiurl;
    console.log("✅ API URL récupérée :", apiUrl);

    if (!apiUrl) {
      showToast("❌ Aucune URL WebApp trouvée pour l’utilisateur.", "red");
      throw new Error("API URL introuvable");
    }

    initApp();
  })
  .catch(err => {
    showToast("❌ Erreur lors du chargement de la configuration.", "red");
    console.error("Erreur attrapée :", err);
  });

// ---- Toast minimal (non bloquant) ----
function ensureToast() {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "fixed top-4 right-4 hidden z-50";
    document.body.appendChild(t);
  }
  return t;
}

function showToast(message, tone = "green") {
  const t = ensureToast();
  const bg = tone === "red" ? "bg-red-600" : tone === "blue" ? "bg-blue-600" : "bg-green-600";
  t.className = `fixed top-4 right-4 ${bg} text-white px-4 py-2 rounded shadow z-50`;
  t.textContent = message;
  t.classList.remove("hidden");
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.add("hidden"), 2400);
}

function flashSaved(anchorEl) {
  try {
    const target = anchorEl || document.body;
    const rect = target.getBoundingClientRect();
    const dot = document.createElement("div");
    dot.style.cssText = `
      position: fixed;
      left: ${Math.round(rect.right) - 6}px;
      top: ${Math.round(rect.top) - 6}px;
      width: 18px; height: 18px;
      background:#10b981; color:#fff; border-radius:9999px;
      display:flex; align-items:center; justify-content:center;
      font-size:12px; box-shadow:0 1px 4px rgba(0,0,0,.15);
      opacity:0; transform:scale(.6); transition:opacity .15s, transform .2s;
      z-index: 9999; pointer-events:none;
    `;
    dot.textContent = "✔";
    document.body.appendChild(dot);
    requestAnimationFrame(() => { dot.style.opacity = "1"; dot.style.transform = "scale(1)"; });
    setTimeout(() => { dot.style.opacity = "0"; }, 800);
    setTimeout(() => { dot.remove(); }, 1100);
  } catch {}
}

function canonicalizeLikert(v) {
  const s = String(v || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[\u00A0\u202F\u200B]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

function bindFieldAutosave(inputEl, qid) {
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

async function initApp() {
  // ✅ Mémoire des délais sélectionnés (clé -> valeur)
  appState.delayValues = {};

  // états SR en mémoire
  appState.srToggles  = {}; // état courant (on/off) tel que l’UI l’affiche
  appState.srBaseline = {}; // état de référence venu du backend (pour ne POSTer que les différences)

  // Titre dynamique
  document.getElementById("user-title").textContent =
    `📝 Formulaire du jour – ${user.charAt(0).toUpperCase() + user.slice(1)}`;

  // On enlève l’ancien affichage de date (non nécessaire avec le sélecteur)
  const dateDisplay = document.getElementById("date-display");
  if (dateDisplay) dateDisplay.remove();

  // Références éléments existants
  const dateSelect = document.getElementById("date-select");
  dateSelect.classList.add("mb-4");

  // ➡️ Remplir le select avec : Dates (7j) + (optionnel) Mode pratique — catégories
  async function buildCombinedSelect() {
    console.log("🛠️ Création du sélecteur de date et de mode...");
    const sel = document.getElementById("date-select");
    sel.innerHTML = "";

    // Placeholder
    const ph = document.createElement("option");
    ph.disabled = true; ph.hidden = true; ph.selected = true;
    ph.textContent = "Choisis une date ou un mode pratique…";
    sel.appendChild(ph);

    // Groupe Dates
    const ogDates = document.createElement("optgroup");
    ogDates.label = "Dates (7 derniers jours)";
    const pastDates = [...Array(7)].map((_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i);
      return {
        value: d.toISOString().split("T")[0],
        label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
      };
    });
    pastDates.forEach(opt => {
      const o = document.createElement("option");
      o.textContent = opt.label.charAt(0).toUpperCase() + opt.label.slice(1);
      o.dataset.mode = "daily";
      o.dataset.date = opt.value; // YYYY-MM-DD
      ogDates.appendChild(o);
    });
    sel.appendChild(ogDates);

    // Lazy-load Mode pratique — catégories
    const ogPractice = document.createElement("optgroup");
    ogPractice.label = "Mode pratique — catégories (charger…)";
    sel.appendChild(ogPractice);

    let _catsLoaded = false;
    async function loadPracticeCatsOnce() {
      if (_catsLoaded) return; _catsLoaded = true;
      try {
        const cats = await apiFetch("GET", `?mode=practice`);
        if (Array.isArray(cats) && cats.length) {
          // insère un séparateur visuel au moment du chargement
          const sepGroup = document.createElement("optgroup");
          sepGroup.label = "────────";
          sel.appendChild(sepGroup);

          ogPractice.label = "Mode pratique — catégories";
          cats.forEach(cat => {
            const o = document.createElement("option");
            o.textContent = `Mode pratique — ${cat}`;
            o.dataset.mode = "practice";
            o.dataset.category = cat;
            ogPractice.appendChild(o);
          });
        } else {
          ogPractice.label = "Mode pratique — (aucune catégorie)";
        }
      } catch (e) {
        console.warn("Impossible de charger les catégories de pratique", e);
        ogPractice.label = "Mode pratique — (erreur)";
      }
    }
    // charge à la première interaction seulement
    sel.addEventListener("mousedown", loadPracticeCatsOnce, { once: true });
    sel.addEventListener("focus",     loadPracticeCatsOnce, { once: true });

    // Sélectionner automatiquement la première date
    const firstDate = ogDates.querySelector("option");
    if (firstDate) {
      ph.selected = false;
      firstDate.selected = true;
    }
    console.log("✅ Sélecteur de mode et de date prêt.");
  }

  // ====== Fréquences et catégories (helpers modal) ======
  const WEEKDAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
  const FREQ_SPECIAL = ["Quotidien"]; // archivé retiré
  function parseFreqString(s) {
    const out = new Set();
    String(s||"").split(",").map(x=>x.trim()).filter(Boolean).forEach(x => out.add(x));
    return out;
  }
  function freqSetToString(set) { return Array.from(set).join(", "); }
  async function getAllCategories() {
    const cats = await apiFetch("GET", `?mode=practice`, { fresh: true }).catch(()=>[]);
    const set = new Set(Array.isArray(cats)?cats:[]);
    try {
      const all = await apiFetch("GET", `?mode=consignes`, { fresh: true });
      (Array.isArray(all)?all:[]).forEach(x => { if (x.category) set.add(x.category); });
    } catch {}
    return Array.from(set).filter(Boolean).sort((a,b)=>a.localeCompare(b,'fr'));
  }
  function buildFreqMulti(container, currentString) {
    container.innerHTML = "";
    const current = parseFreqString(currentString);
    const mk = (label) => {
      const id = "f_" + label.toLowerCase().replace(/\s+/g,"_");
      const wrap = document.createElement("label");
      wrap.className = "inline-flex items-center gap-2 border rounded px-2 py-1 bg-white";
      wrap.innerHTML = `
        <input type="checkbox" id="${id}">
        <span>${label}</span>
      `;
      const cb = wrap.querySelector("input");
      cb.checked = current.has(label);
      cb.dataset.freqLabel = label;
      container.appendChild(wrap);
    };
    FREQ_SPECIAL.forEach(mk);
    WEEKDAYS.forEach(mk);
  }
  function readFreqMulti(container) {
    const set = new Set();
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => { if (cb.checked) set.add(cb.dataset.freqLabel); });
    return freqSetToString(set);
  }
  function setupSRToggle(btn, initialOn) {
    let on = !!initialOn;
    const paint = () => {
      btn.textContent = on ? "ON" : "OFF";
      btn.className   = "px-2 py-1 rounded border text-sm " + (on ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-700 border-gray-200");
    };
    paint();
    btn.onclick = () => { on = !on; paint(); };
    return () => on;
  }

  function enableDragScroll(scrollEl, handleEl) {
    if (!scrollEl || !handleEl) return;
    let active = false, startY = 0, startTop = 0, pid = null;
    handleEl.style.touchAction = "none";
    handleEl.style.cursor = "ns-resize";
    handleEl.addEventListener("pointerdown", (e) => {
      active = true; pid = e.pointerId; startY = e.clientY; startTop = scrollEl.scrollTop;
      handleEl.setPointerCapture(pid);
      handleEl.classList.add("bg-gray-400");
      e.preventDefault();
    });
    handleEl.addEventListener("pointermove", (e) => {
      if (!active) return;
      const dy = e.clientY - startY;
      scrollEl.scrollTop = startTop - dy * 1.2;
    });
    const stop = () => {
      if (!active) return;
      active = false; handleEl.classList.remove("bg-gray-400");
      try { handleEl.releasePointerCapture(pid); } catch {}
    };
    handleEl.addEventListener("pointerup", stop);
    handleEl.addEventListener("pointercancel", stop);
  }

  function addInlineSRToggle(wrapper, q){
    const srCurrent = q.scheduleInfo?.sr || { on:true }; // ON par défaut (souhaité)
    const hasSrFromBackend = !!(q.scheduleInfo && Object.prototype.hasOwnProperty.call(q.scheduleInfo, "sr"));

    if (!(q.id in appState.srBaseline)) appState.srBaseline[q.id] = srCurrent.on ? "on" : "off";
    if (!(q.id in appState.srToggles))  appState.srToggles[q.id]  = srCurrent.on ? "on" : "off";

    // 🔁 Si le backend n'a pas d'info SR mais l'UI est ON par défaut → on synchronise une fois
    if (!hasSrFromBackend && srCurrent.on && !appState.__srAutoPushed[q.id]) {
      appState.__srAutoPushed[q.id] = true;
      // poste __srToggle__<id> = "on" via autosave (avec le contexte _mode/_date ou _category déjà géré dans queueSoftSave)
      queueSoftSave({ ["__srToggle__" + q.id]: "on" }, wrapper);
      // baseline & toggle à jour pour éviter un 2e post
      appState.srBaseline[q.id] = "on";
      appState.srToggles[q.id]  = "on";
    }
    const row = document.createElement("div");
    row.className = "mt-2 flex items-center gap-3";
    const label = document.createElement("span");
    label.className = "text-sm text-gray-700";
    label.textContent = "Répétition espacée (délai auto) :";
    const btn = document.createElement("button");
    btn.type = "button";
    const paint = ()=>{
      const on = appState.srToggles[q.id] === "on";
      btn.textContent = on ? "ON" : "OFF";
      btn.className = "px-2 py-1 rounded border text-sm " + (on ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-700 border-gray-200");
    };
    btn.onclick = ()=>{
      const now = (appState.srToggles[q.id] === "on") ? "off" : "on";
      appState.srToggles[q.id] = now;
      paint();
      // auto-save doux immédiat
      queueSoftSave({ ["__srToggle__" + q.id]: now }, row);
      flashSaved(row);
    };
    paint();
    row.appendChild(label);
    row.appendChild(btn);
    wrapper.appendChild(row);
  }

  // Ordonne l'historique pour l'affichage en liste: RÉCENT -> ANCIEN
  function orderForHistory(hist) {
    const dateRe = /(\d{2})\/(\d{2})\/(\d{4})/;
    const iterRe = /\b(\d+)\s*\(/;
    const toKey = (e, idx) => {
      if (Number.isFinite(e.colIndex)) return { k:e.colIndex, kind:"col" };
      if (e.date && dateRe.test(e.date)) {
        const [,d,m,y] = e.date.match(dateRe); return { k:new Date(`${y}-${m}-${d}`).getTime(), kind:"time" };
      }
      if (e.key && dateRe.test(e.key)) {
        const [,d,m,y] = e.key.match(dateRe); return { k:new Date(`${y}-${m}-${d}`).getTime(), kind:"time" };
      }
      if (e.key && iterRe.test(e.key)) return { k:parseInt(e.key.match(iterRe)[1],10), kind:"iter" };
      return { k:idx, kind:"idx" };
    };
    return (Array.isArray(hist)?hist:[])
      .map((e,i)=>({e,key:toKey(e,i)}))
      .sort((a,b)=>{
        if (a.key.kind==="col" && b.key.kind==="col") return a.key.k - b.key.k; // plus petit = plus récent
        return b.key.k - a.key.k; // RÉCENT -> ANCIEN pour time/iter
      })
      .map(x=>x.e);
  }

  function scrollToRight(el) {
    if (!el) return;
    requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth; });
  }

  function prettyKeyWithDate(entry) {
    const dateRe = /(\d{2})\/(\d{2})\/(\d{4})/;
    const fullDate = (entry.date && dateRe.test(entry.date))
      ? entry.date
      : (entry.key && dateRe.test(entry.key) ? entry.key.match(dateRe)[0] : "");
    const title = entry.date ? (entry.key || entry.date) : (entry.key || "");
    return fullDate ? `${title} (${fullDate})` : title;
  }

  await buildCombinedSelect();

  // État initial
  handleSelectChange();

  dateSelect.addEventListener("change", handleSelectChange);

  function handleSelectChange() {
    // on repart propre à chaque changement
    appState.delayValues = {};
    appState.srToggles   = {};
    appState.srBaseline  = {};

    const sel = document.getElementById("date-select");
    if (!sel || !sel.selectedOptions.length) return;
    const selected = sel.selectedOptions[0];
    const mode = selected.dataset.mode || "daily";
    if (mode === "daily") {
      console.log(`➡️ Changement de mode : Journalier, date=${selected.dataset.date}`);
      loadFormForDate(selected.dataset.date);
    } else {
      console.log(`➡️ Changement de mode : Pratique, catégorie=${selected.dataset.category}`);
      loadPracticeForm(selected.dataset.category);
    }
  }

  // 📨 Soumission
  document.getElementById("submitBtn").addEventListener("click", (e) => {
    e.preventDefault();

    const form = document.getElementById("daily-form");
    const formData = new FormData(form);
    const entries = Object.fromEntries(formData.entries());

    // ⬅️ ajoute les délais choisis via le menu
    Object.assign(entries, appState.delayValues);
    
    // embarquer l'état SR pour TOUTES les questions (visibles + masquées),
    // mais seulement si l'utilisateur a modifié l'état par rapport au backend
    for (const [id, onOff] of Object.entries(appState.srToggles)) {
      if (appState.srBaseline[id] !== onOff) {
        entries["__srToggle__" + id] = onOff; // "on" | "off"
      }
    }

    const selected = dateSelect.selectedOptions[0];
    const mode = selected?.dataset.mode || "daily";

    if (mode === "daily") {
      entries._mode = "daily";
      entries._date = selected.dataset.date; // YYYY-MM-DD
    } else {
      entries._mode = "practice";
      entries._category = selected.dataset.category; // nom exact
    }
    entries.apiUrl = apiUrl;

    console.log("📦 Envoi des données au Worker...", entries);

    const btn = document.getElementById("submitBtn");
    btn.disabled = true;
    btn.classList.add("opacity-60", "cursor-not-allowed");
    const btnPrev = btn.innerHTML;
    btn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Envoi...
    `;

    fetch("https://tight-snowflake-cdad.como-denizot.workers.dev/", {
      method: "POST",
      body: JSON.stringify(entries)
    })
      .then(async (res) => {
        const text = await res.text().catch(() => "");
        if (!res.ok) throw new Error(text || "HTTP " + res.status);
        // succès
        showToast("✅ Réponses envoyées !");
        console.log("✅ Réponses envoyées avec succès.", { payload: entries });

        // recharge automatiquement la vue pour refléter les délais posés
        const selected = dateSelect.selectedOptions[0];
        const mode = selected?.dataset.mode || "daily";

        // on repart propre
        appState.delayValues = {};
        appState.srToggles   = {};
        appState.srBaseline  = {};

        setTimeout(() => {
          if (mode === "practice") {
            // recharge la même catégorie → le backend calculera l’itération suivante
            loadPracticeForm(selected.dataset.category);
            showToast("➡️ Itération suivante chargée", "blue");
          } else {
            // recharge la même date → masquera les questions avec un délai > 0
            loadFormForDate(selected.dataset.date);
          }
        }, 250);
      })
      .catch(err => {
        console.error("❌ Erreur lors de l’envoi des données :", err);
        showToast("❌ Erreur d’envoi", "red");
      })
      .finally(() => {
        btn.disabled = false;
        btn.classList.remove("opacity-60", "cursor-not-allowed");
        btn.innerHTML = btnPrev;
      });
  });

  // =========================
  //   Chargements / Renders
  // =========================

  function clearFormUI() {
    document.getElementById("daily-form").innerHTML = "";
    document.getElementById("submit-section").classList.add("hidden");
  }

  function showFormUI() {
    document.getElementById("daily-form").classList.remove("hidden");
    document.getElementById("submit-section").classList.remove("hidden");
    const loader = document.getElementById("loader");
    if (loader) loader.classList.add("hidden");
  }

  function loadFormForDate(dateISO, opts = {}) {
    clearFormUI();
    const loader = document.getElementById("loader");
    if (loader) loader.classList.remove("hidden");
    console.log(`📡 Chargement des questions pour la date : ${dateISO}`);

    apiFetch("GET", `?date=${encodeURIComponent(dateISO)}`, opts)
      .then(raw => {
        const questions = toQuestions(raw);
        if (!Array.isArray(questions)) {
          console.error("Réponse inattendue (pas un tableau) :", raw);
          showToast("❌ Format de données inattendu", "red");
          document.getElementById("loader")?.classList.add("hidden");
          return;
        }
        console.log(`✅ ${questions.length} question(s) chargée(s).`);
        renderQuestions(questions);
      })
      .catch(err => {
        document.getElementById("loader")?.classList.add("hidden");
        console.error(err);
        showToast("❌ Erreur de chargement du formulaire", "red");
      });
  }

  async function loadPracticeForm(category, opts = {}) {
    clearFormUI();
    const loader = document.getElementById("loader");
    if (loader) loader.classList.remove("hidden");
    console.log(`📡 Chargement des questions pour la catégorie : ${category}`);

    try {
      const raw = await apiFetch("GET", `?mode=practice&category=${encodeURIComponent(category)}`, opts);
      const questions = toQuestions(raw);
      if (!Array.isArray(questions)) {
        console.error("Réponse inattendue (pas un tableau) :", raw);
        showToast("❌ Format de données inattendu", "red");
        document.getElementById("loader")?.classList.add("hidden");
        return;
      }
      console.log(`✅ ${questions.length} question(s) de pratique chargée(s).`);
      renderQuestions(questions);
    } catch (e) {
      document.getElementById("loader")?.classList.add("hidden");
      console.error(e);
      showToast("❌ Erreur de chargement du formulaire", "red");
    }
  }

  // ⬇️ Version avec labels à chaque point et largeur dynamique
  function renderLikertChart(parentEl, history, normalize) {
    const hist = Array.isArray(history) ? history.slice() : [];
    if (!hist.length) return;

    // ---- Ordonnancement: ANCIEN -> RÉCENT (récent à DROITE)
    const dateRe = /(\d{2})\/(\d{2})\/(\d{4})/;
    const iterRe = /\b(\d+)\s*\(/; // "Catégorie 12 (...)"
    const toKey = (e, idx) => {
      if (Number.isFinite(e.colIndex)) return { k: e.colIndex, kind: "col" }; // plus petit = plus récent dans ta feuille
      if (e.date && dateRe.test(e.date)) {
        const [, d, m, y] = e.date.match(dateRe);
        return { k: new Date(`${y}-${m}-${d}`).getTime(), kind: "time" };
      }
      if (e.key && dateRe.test(e.key)) {
        const [, d, m, y] = e.key.match(dateRe);
        return { k: new Date(`${y}-${m}-${d}`).getTime(), kind: "time" };
      }
      if (e.key && iterRe.test(e.key)) return { k: parseInt(e.key.match(iterRe)[1], 10), kind: "iter" };
      return { k: idx, kind: "idx" };
    };
    const ordered = hist
      .map((e,i)=>({e, key:toKey(e,i)}))
      .sort((a,b) => {
        if (a.key.kind === "col" && b.key.kind === "col") return b.key.k - a.key.k; // DESC -> ancien à gauche
        return a.key.k - b.key.k; // ASC  -> ancien à gauche
      })
      .map(x=>x.e);

    // --- Mapping Likert
    const levels = ["non","plutot non","moyen","plutot oui","oui"];
    const pretty  = { "non":"Non","plutot non":"Plutôt non","moyen":"Moyen","plutot oui":"Plutôt oui","oui":"Oui" };
    const pickDate = (e) => {
      const dateRe = /(\d{2})\/(\d{2})\/(\d{4})/;
      if (e.date && dateRe.test(e.date)) return e.date;
      if (e.key  && dateRe.test(e.key))  return e.key.match(dateRe)[0];
      return "";
    };
    const points = ordered.map(e => {
      const v = normalize(e.value);
      const idx = levels.indexOf(v);
      if (idx === -1) return null;
      const fullDate = pickDate(e);
      const shortDate = fullDate ? fullDate.slice(0,5) : "";
      const fallback = e.date || e.key || "";
      return { idx, v, label: shortDate || fallback.slice(0,5), fullLabel: fullDate || fallback, raw: e };
    }).filter(Boolean);
    if (points.length < 2) return;

    // ---- Mesurer la largeur des labels pour espacement sans chevauchement
    const measCanvas = document.createElement("canvas");
    const mctx = measCanvas.getContext("2d");
    mctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial";
    let maxLabelW = 0;
    for (const p of points) maxLabelW = Math.max(maxLabelW, Math.ceil(mctx.measureText(p.label).width));
    const stepPx = Math.max(28, maxLabelW + 12);

    // ---- Layout
    const pad = { l: 16, r: 86, t: 14, b: 30 }; // légende à droite
    const parentW = Math.max(300, Math.floor(parentEl.getBoundingClientRect().width || 300));
    const neededPlotW = (points.length - 1) * stepPx + pad.l + pad.r;
    const plotW = Math.max(parentW, neededPlotW);
    const plotH = 176;

    // conteneur scrollable (mobile-friendly)
    const scroller = document.createElement("div");
    scroller.style.cssText = "width:100%;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-x;";
    scroller.dataset.autoscroll = "right";
    parentEl._likertScroller = scroller;
    parentEl.appendChild(scroller);

    const canvas = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(plotW * dpr);
    canvas.height = Math.round(plotH * dpr);
    canvas.style.width  = plotW + "px";
    canvas.style.height = plotH + "px";
    canvas.style.display = "block";
    canvas.style.borderRadius = "10px";
    scroller.appendChild(canvas);
    // scroll au plus récent (droite) avec double rAF
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scroller.scrollLeft = scroller.scrollWidth;
      });
    });

    // petit tooltip
    const tip = document.createElement("div");
    tip.style.cssText = "position:absolute;padding:6px 8px;background:#111827;color:#fff;border-radius:6px;font-size:12px;pointer-events:none;opacity:0;transform:translate(-50%,-120%);white-space:nowrap;transition:opacity .12s;";
    scroller.style.position = "relative";
    scroller.appendChild(tip);

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const w = plotW - pad.l - pad.r;
    const h = plotH - pad.t - pad.b;

    // --- fond arrondi
    const r = 10;
    ctx.save();
    const rr = (x,y,w,h,r) => { ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); };
    rr(4,4,plotW-8,plotH-8,r);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0,0,plotW,plotH);
    ctx.restore();

    // --- grille douce
    ctx.strokeStyle = "#eaecef";
    ctx.lineWidth = 1;
    for (let i = 0; i < levels.length; i++) {
      const y = pad.t + (h / (levels.length - 1)) * (levels.length - 1 - i);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
    }

    // --- repères X et labels à chaque point
    const n = points.length;
    const step = n > 1 ? w / (n - 1) : w;
    ctx.fillStyle = "#6b7280";
    ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial";
    ctx.textAlign = "center";

    // --- légende à DROITE (Oui en haut, Non en bas)
    ctx.textAlign = "left";
    ctx.fillStyle = "#374151";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial";
    for (let i = 0; i < levels.length; i++) {
      const y = pad.t + (h / (levels.length - 1)) * (levels.length - 1 - i);
      ctx.fillText(pretty[levels[i]] || levels[i], pad.l + w + 10, y + 4);
    }

    // --- ligne avec dégradé
    const grad = ctx.createLinearGradient(pad.l, 0, pad.l + w, 0);
    grad.addColorStop(0,  "#60a5fa"); // bleu clair
    grad.addColorStop(1,  "#7c3aed"); // violet
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad.l + i * step;
      const y = pad.t + (h / (levels.length - 1)) * (levels.length - 1 - p.idx);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // --- points
    ctx.fillStyle = "#111827";
    const dotRadius = 2.8;
    const dotXY = [];
    points.forEach((p, i) => {
      const x = pad.l + i * step;
      const y = pad.t + (h / (levels.length - 1)) * (levels.length - 1 - p.idx);
      ctx.beginPath(); ctx.arc(x, y, dotRadius, 0, Math.PI*2); ctx.fill();
      dotXY.push({x,y, p});
      // label sous chaque point
      ctx.fillStyle = "#6b7280";
      ctx.fillText(p.label, x, pad.t + h + 18);
      ctx.fillStyle = "#111827";
    });

    // --- axe X
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t + h); ctx.lineTo(pad.l + w, pad.t + h); ctx.stroke();

    // --- scroll au plus récent (droite) si overflow (conservé)
    requestAnimationFrame(() => { scroller.scrollLeft = scroller.scrollWidth; });

    // --- tooltip simple
    canvas.addEventListener("mousemove", (ev) => {
      const rect = canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left);
      const y = (ev.clientY - rect.top);
      // cherche le point le plus proche
      let best = null, bestD = 99999;
      for (const d of dotXY) {
        const dx = x - d.x, dy = y - d.y;
        const dist = Math.hypot(dx, dy);
        if (dist < bestD) { bestD = dist; best = d; }
      }
      if (best && bestD < 18) {
        tip.style.left = Math.round(best.x) + "px";
        tip.style.top  = Math.round(best.y) + "px";
        tip.innerHTML = `${best.p.fullLabel || ""} · <b>${pretty[best.p.v] || best.p.v}</b>`;
        tip.style.opacity = "1";
      } else {
        tip.style.opacity = "0";
      }
    });
    canvas.addEventListener("mouseleave", () => { tip.style.opacity = "0"; });
  }

  function refreshCurrentView(fresh = false) {
    const sel = document.getElementById("date-select");
    if (!sel || !sel.selectedOptions.length) return;
    const opt = sel.selectedOptions[0];
    if ((opt.dataset.mode || "daily") === "practice") {
      loadPracticeForm(opt.dataset.category, { fresh });
    } else {
      loadFormForDate(opt.dataset.date, { fresh });
    }
  }

  // ----- AUTO-SAVE DOUX -----
  const _softBuffer = {};
  let _softTimer = null;
  let _softAnchors = new Set();
  function queueSoftSave(patchObj, anchorEl) {
    console.log("queueSoftSave reçu:", patchObj);
    Object.assign(_softBuffer, patchObj || {});
    if (anchorEl) _softAnchors.add(anchorEl);

    const savingBadge = document.getElementById("__saving_badge__") || (() => {
      const b = document.createElement("div");
      b.id = "__saving_badge__";
      b.textContent = "Enregistrement…";
      b.className = "fixed bottom-4 right-4 bg-gray-800 text-white text-xs px-3 py-1.5 rounded shadow";
      b.style.opacity = "0"; b.style.transition = "opacity .15s";
      document.body.appendChild(b);
      return b;
    })();
    savingBadge.style.opacity = "1";

    if (_softTimer) clearTimeout(_softTimer);
    _softTimer = setTimeout(async () => {
      const keys = Object.keys(_softBuffer);
      if (!keys.length) return;

      const selected = document.getElementById("date-select")?.selectedOptions[0];
      const mode = selected?.dataset.mode || "daily";
      const body = { apiUrl, ..._softBuffer };
      if (mode === "daily") { body._mode = "daily"; body._date = selected.dataset.date; }
      else { body._mode = "practice"; body._category = selected.dataset.category; }

      const postOnce = () => fetch(WORKER_URL, {
        method: "POST",
        body: JSON.stringify(body)
      });

      let ok = false;
      try {
        let res = await postOnce();
        if (!res.ok) { await new Promise(r=>setTimeout(r,300)); res = await postOnce(); }
        ok = res.ok;
      } catch (e) {
        ok = false;
      } finally {
        for (const k of keys) delete _softBuffer[k];
        const b = document.getElementById("__saving_badge__");
        if (b) setTimeout(()=>{ b.style.opacity = "0"; }, 80);
        if (ok) { _softAnchors.forEach(a => flashSaved(a)); }
        else { showToast("❌ Échec de l’enregistrement auto", "red"); }
        _softAnchors.clear();
      }
    }, 1500);
  }

  // ⬅️ Expose queueSoftSave au global pour que bindFieldAutosave puisse l'appeler
  window.queueSoftSave = queueSoftSave;

  // Flush auto-save best-effort au déchargement
  window.addEventListener("beforeunload", () => {
    if (_softTimer) {
      clearTimeout(_softTimer);
      _softTimer = null;
      const selected = document.getElementById("date-select")?.selectedOptions[0];
      if (!selected) return;
      const mode = selected.dataset.mode || "daily";
      const body = { apiUrl, ..._softBuffer };
      if (mode === "daily") { body._mode = "daily"; body._date = selected.dataset.date; }
      else { body._mode = "practice"; body._category = selected.dataset.category; }
      navigator.sendBeacon(WORKER_URL, JSON.stringify(body));
    }
  });

  // ====== GESTION CONSIGNES (UI) ======
  async function loadConsignes() {
    const list = await apiFetch("GET", `?mode=consignes`, { fresh: true });
    renderConsignesManager(Array.isArray(list) ? list : []);
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
    const byLabel = (a,b) => (a.label||"").localeCompare(b.label||"", "fr", {sensitivity:"base"});
    groups[1].sort(byLabel); groups[2].sort(byLabel); groups[3].sort(byLabel);

    const renderRow = (c) => {
      const p = Number(c?.priority ?? 2);
      // contraste (haute très visible)
      const tone =
        p === 1 ? "bg-red-50 border-red-500 border-l-8"
      : p === 2 ? "bg-yellow-50 border-yellow-400 border-l-6"
                : "bg-gray-50 border-gray-300 border-l-4";
      const priLabel = p === 1 ? "⚡️ Haute" : (p === 2 ? "🎯 Moyenne" : "🌿 Faible");

      const row = document.createElement("div");
      row.className = `px-4 py-3 mb-2 flex items-center gap-3 border rounded ${tone}`;

      const left = document.createElement("div");
      left.className = "flex-1 min-w-0";
      left.innerHTML = `
        <div class="font-semibold ${p===1 ? 'text-red-800' : p===2 ? 'text-yellow-900' : 'text-gray-800'}">
          ${c.label}
        </div>
        <div class="text-xs text-gray-600 mt-0.5">
          <span class="inline-flex items-center px-1.5 py-0.5 border rounded mr-2 bg-white/70">${priLabel}</span>
          Cat: <b>${c.category || "-"}</b> · Type: <b>${c.type || "-"}</b> · Fréq: <b>${c.frequency || "-"}</b>
        </div>`;
      row.appendChild(left);

      const btns = document.createElement("div");
      btns.className = "flex items-center gap-2";

      const edit = document.createElement("button");
      edit.className = "px-2 py-1 text-sm border rounded hover:bg-gray-50";
      edit.textContent = "Modifier";
      edit.onclick = () => openConsigneModal(c);
      btns.appendChild(edit);

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
          await loadConsignes();      // fresh
          refreshCurrentView(true);   // fresh
        } catch (e) {
          if (parent) parent.appendChild(rowEl);
          showToast("❌ Erreur de suppression", "red"); console.error(e);
        }
      };
      btns.appendChild(del);

      row.appendChild(btns);
      return row;
    };

    const addHeader = (title, count, cls="") => {
      const h = document.createElement("div");
      h.className = `px-2 py-2 text-sm font-semibold ${cls}`;
      h.textContent = `${title} (${count})`;
      wrap.appendChild(h);
    };

    if (groups[1].length) {
      addHeader("Priorité haute", groups[1].length, "text-red-700");
      groups[1].forEach(c => wrap.appendChild(renderRow(c)));
    }
    if (groups[2].length) {
      addHeader("Priorité moyenne", groups[2].length, "text-yellow-700 mt-3");
      groups[2].forEach(c => wrap.appendChild(renderRow(c)));
    }
    if (groups[3].length) {
      const det = document.createElement("details");
      det.className = "mt-3";
      // fermé par défaut
      det.open = false;
      const sum = document.createElement("summary");
      sum.className = "cursor-pointer select-none px-2 py-2 text-sm font-semibold text-gray-700 rounded hover:bg-gray-50";
      sum.textContent = `Priorité faible (${groups[3].length})`;
      det.appendChild(sum);
      const box = document.createElement("div");
      box.className = "mt-2";
      groups[3].forEach(c => box.appendChild(renderRow(c)));
      det.appendChild(box);
      wrap.appendChild(det);
    }

    if (!groups[1].length && !groups[2].length && !groups[3].length) {
      wrap.innerHTML = `<div class="text-sm text-gray-500 px-2 py-3">Aucune consigne pour le moment.</div>`;
    }
  }

  async function openConsigneModal(c = null) {
    const modal = document.getElementById("consigne-modal");
    if (!modal) return;
    const form  = document.getElementById("consigne-form");
    let isSubmitting = false; // ⬅️ verrou anti double-submit
    
    document.getElementById("consigne-modal-title").textContent = c ? "Modifier la consigne" : "Nouvelle consigne";

    form.reset();
    form.elements.id.value       = c?.id || "";
    form.elements.label.value    = c?.label || "";
    form.elements.type.value     = c?.type  || "Oui/Non";
    form.elements.priority.value = String(c?.priority || 2);

    const dl = document.getElementById("categories-datalist");
    if (dl) {
      dl.innerHTML = "";
      getAllCategories().then(list => { list.forEach(cat => { const opt = document.createElement("option"); opt.value = cat; dl.appendChild(opt); }); });
    }
    const catInput = document.getElementById("consigne-category");
    if (catInput) catInput.value = c?.category || "";

    const freqBox = document.getElementById("freq-multi");
    const isPractice = /pratique\s*d[ée]lib[ée]r[ée]e/i.test(c?.frequency || "");
    if (freqBox) buildFreqMulti(freqBox, isPractice ? "" : (c ? (c.frequency || "") : "Quotidien"));

    const initialSrOn = c ? (c.sr === "on" || !!(c.scheduleInfo && c.scheduleInfo.sr && c.scheduleInfo.sr.on)) : true;
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

    // Drag-scroll (désactivé)
    // enableDragScroll(document.getElementById("consigne-body"), document.getElementById("drag-handle"));

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
        frequency: daily ? (readFreqMulti(document.getElementById("freq-multi")) || "Quotidien") : "pratique délibérée"
      };
      if (!payload.label) { showToast("❌ Label requis", "red"); isSubmitting = false; return; }

      const submitBtn = document.querySelector('#consigne-modal button[type="submit"]');
      const restore = () => { submitBtn.disabled = false; submitBtn.textContent = "Enregistrer"; isSubmitting = false; };

      submitBtn.disabled = true;
      submitBtn.textContent = "Enregistrement…";

      try {
        if (payload.id) {
          // UPDATE — appel principal court
          await updateConsigne(payload);
          showToast("✅ Consigne mise à jour");
          closeConsigneModal();              // ⬅️ ferme tout de suite
          restore();

          // tâches secondaires en arrière-plan
          queueMicrotask(async () => {
            try {
              // SR toggle éventuel
              const tKey = "__srToggle__" + payload.id;
              const selected = document.getElementById("date-select")?.selectedOptions[0];
              const mode = selected?.dataset.mode || "daily";
              const body = { apiUrl, [tKey]: getSR() ? "on" : "off" };
              if (mode === "daily") { body._mode = "daily"; body._date = selected.dataset.date; }
              else { body._mode = "practice"; body._category = selected.dataset.category; }
              fetch(WORKER_URL, { method: "POST", body: JSON.stringify(body) }).catch(()=>{});
            } catch {}
            loadConsignes().catch(()=>{});
            refreshCurrentView(true);
          });

        } else {
          // CREATE — appel principal court
          const { ok, newId } = await createConsigne(payload);
          if (!ok) throw new Error("Création échouée");
          showToast("✅ Consigne créée");
          closeConsigneModal();              // ⬅️ ferme tout de suite
          restore();

          // tâches secondaires en arrière-plan
          queueMicrotask(async () => {
            try {
              if (getSR() && newId) {
                // SR auto-ON si ID retourné
                const selected = document.getElementById("date-select")?.selectedOptions[0];
                const mode = selected?.dataset.mode || "daily";
                const body = { apiUrl, ["__srToggle__"+newId]: "on" };
                if (mode === "daily") { body._mode = "daily"; body._date = selected.dataset.date; }
                else { body._mode = "practice"; body._category = selected.dataset.category; }
                fetch(WORKER_URL, { method: "POST", body: JSON.stringify(body) }).catch(()=>{});
              }
            } catch {}
            loadConsignes().catch(()=>{});
            refreshCurrentView(true);
          });
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

  async function createConsigne(payload) {
    const body = {
      _action: "consigne_create",
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

  async function updateConsigne(payload) {
    const body = {
      _action: "consigne_update",
      id: payload.id,
      category: payload.category,
      type: payload.type,
      frequency: payload.frequency,
      newLabel: payload.label,
      priority: payload.priority,
      apiUrl
    };
    await fetch(WORKER_URL, {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  async function deleteConsigne(id) {
    const body = { _action: "consigne_delete", id, apiUrl };
    await fetch(WORKER_URL, {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  function addDelayUI(wrapper, q) {
    const mode = document.getElementById("date-select").selectedOptions[0]?.dataset.mode || "daily";
    const key = (mode === "daily" ? `__delayDays__` : `__delayIter__`) + q.id;

    const row = document.createElement("div");
    row.className = "mt-2 flex items-center gap-3 relative"; // relative pour ancrer le popover
    wrapper.appendChild(row);

    // Bouton
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "text-sm text-blue-600 hover:underline";
    btn.textContent = "⏱️ Délai";
    row.appendChild(btn);

    // Info (prochaine échéance / délai choisi)
    const info = document.createElement("span");
    info.className = "text-xs text-gray-500";
    const infos = [];
    if (q.scheduleInfo?.nextDate) infos.push(`Prochaine : ${q.scheduleInfo.nextDate}`);
    if (q.scheduleInfo?.remaining > 0) {
      infos.push(`Revient dans ${q.scheduleInfo.remaining} itération(s)`);
    }

    // réaffiche la valeur déjà choisie si existante
    if (appState.delayValues[key] != null) {
      const n = parseInt(appState.delayValues[key], 10);
      if (!Number.isNaN(n)) {
        if (n === -1) {
          infos.push("Délai : annulé");
        } else {
          infos.push(mode === "daily" ? `Délai choisi : ${n} j` : `Délai choisi : ${n} itérations`);
        }
      }
    }
    info.textContent = infos.join(" — ") || "";
    row.appendChild(info);

    // Popover (caché par défaut)
    const pop = document.createElement("div");
    pop.className = "absolute right-0 top-8 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 hidden";
    pop.setAttribute("role", "menu");
    // marquer le popover pour pouvoir fermer les autres
    pop.setAttribute("data-pop", "delay");
    row.appendChild(pop);

    // Options rapides
    const options = mode === "daily"
      ? [
          { label: "Aujourd’hui (0 j)", value: 0 },
          { label: "+1 j", value: 1 },
          { label: "+2 j", value: 2 },
          { label: "+3 j", value: 3 },
          { label: "1 semaine", value: 7 },
          { label: "2 semaines", value: 14 },
          { label: "1 mois (~30 j)", value: 30 }
        ]
      : [
          { label: "1", value: 1 },
          { label: "2", value: 2 },
          { label: "3", value: 3 },
          { label: "5", value: 5 },
          { label: "8", value: 8 },
          { label: "13", value: 13 },
          { label: "21", value: 21 }
        ];

    const grid = document.createElement("div");
    grid.className = "p-2 grid grid-cols-2 gap-2";
    pop.appendChild(grid);

    const setValue = (n) => {
      appState.delayValues[key] = String(n);
      // auto-save doux immédiat avec ancre
      queueSoftSave({ [key]: String(n) }, row);
      if (n === -1) {
        info.textContent = "Délai : annulé";
      } else {
        info.textContent = mode === "daily"
          ? `Délai choisi : ${n} j`
          : `Délai choisi : ${n} itérations`;
      }
      pop.classList.add("hidden");
      flashSaved(row);
    };

    options.forEach(opt => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "px-2 py-1 text-sm border border-gray-200 rounded hover:bg-gray-50";
      b.textContent = opt.label;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setValue(opt.value);
      });
      grid.appendChild(b);
    });

    // Ligne d’actions
    const actions = document.createElement("div");
    actions.className = "border-t border-gray-100 p-2 flex items-center justify-between";
    pop.appendChild(actions);

    // Effacer (n=-1 => le backend effacera la note)
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "text-xs text-red-600 hover:underline";
    clearBtn.textContent = "Retirer le délai";
    clearBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setValue(-1);
    });
    actions.appendChild(clearBtn);

    // Fermer
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "text-xs text-gray-600 hover:underline";
    closeBtn.textContent = "Fermer";
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      pop.classList.add("hidden");
    });
    actions.appendChild(closeBtn);

    // --- ÉTAT SR côté front (mémoire volatile) ---
    // Affichage de l'état SR actuel (v. API doGet ci-dessous)
    const srCurrent = q.scheduleInfo?.sr || { on:false };
    if (!(q.id in appState.srBaseline)) {
      appState.srBaseline[q.id] = srCurrent.on ? "on" : "off";
    }
    if (!(q.id in appState.srToggles)) {
      appState.srToggles[q.id] = srCurrent.on ? "on" : "off";
    }
    // Ligne SR
    const srRow = document.createElement("div");
    srRow.className = "border-t border-gray-100 p-2 flex items-center justify-between";
    pop.appendChild(srRow);
    const srLabel = document.createElement("span");
    srLabel.className = "text-xs text-gray-700";
    srLabel.innerHTML = `Répétition espacée : <strong>${appState.srToggles[q.id] === "on" ? "ON" : "OFF"}</strong>` +
      (srCurrent.on && srCurrent.interval ? ` <span class="text-gray-500">(${srCurrent.unit==="iters" ? srCurrent.interval+" itér." : srCurrent.due ? "due "+srCurrent.due : srCurrent.interval+" j"})</span>` : "");
    srRow.appendChild(srLabel);
    const srBtn = document.createElement("button");
    srBtn.type = "button";
    srBtn.className = "text-xs text-blue-600 hover:underline";
    srBtn.textContent = appState.srToggles[q.id] === "on" ? "Désactiver SR" : "Activer SR";
    srBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      appState.srToggles[q.id] = appState.srToggles[q.id] === "on" ? "off" : "on";
      srBtn.textContent = appState.srToggles[q.id] === "on" ? "Désactiver SR" : "Activer SR";
      srLabel.innerHTML = `Répétition espacée : <strong>${appState.srToggles[q.id] === "on" ? "ON" : "OFF"}</strong>`;
    });
    srRow.appendChild(srBtn);

    // Toggle popover + gestion du click outside (attaché à l'ouverture)
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();

      // Ferme les autres popovers
      document.querySelectorAll('[data-pop="delay"]').forEach(el => {
        if (el !== pop) {
          el.classList.add("hidden");
          if (el._onOutside) {
            document.removeEventListener("click", el._onOutside);
            el._onOutside = null;
          }
        }
      });

      const wasHidden = pop.classList.contains("hidden");
      pop.classList.toggle("hidden");

      // si on vient d'ouvrir → poser l'écouteur; si on vient de fermer → l'enlever
      if (wasHidden) {
        pop._onOutside = (e) => {
          if (!pop.contains(e.target) && e.target !== btn) {
            pop.classList.add("hidden");
            document.removeEventListener("click", pop._onOutside);
            pop._onOutside = null;
          }
        };
        setTimeout(() => document.addEventListener("click", pop._onOutside), 0);
      } else if (pop._onOutside) {
        document.removeEventListener("click", pop._onOutside);
        pop._onOutside = null;
      }
    });
  }

  // ✨ Fonction dédiée au rendu d'une seule question
  function renderQuestion(q, container, normalize, colorMap) {
    const p = Number(q?.priority ?? 2);
    // Styles sobres et élégants
    const toneWrapper =
      p === 1 ? "bg-red-50 border border-red-300 border-l-8"
    : p === 2 ? "bg-white border border-gray-200 border-l-4"
              : "bg-gray-50 border border-gray-200 border-l-4";

    const wrapper = document.createElement("div");
    wrapper.className = `mb-8 p-4 rounded-xl shadow-sm ${toneWrapper}`;

    // header = titre + actions (plus de badge)
    const header = document.createElement("div");
    header.className = "flex items-start justify-between mb-2";

    const title = document.createElement("span");
    title.className = "text-lg font-semibold";
    title.textContent = q.label;
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "mt-1 flex items-center gap-3 text-sm";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "text-blue-600 hover:underline";
    editBtn.textContent = "Modifier";
    editBtn.onclick = () => openConsigneModal({
      id: q.id, label: q.label, category: q.category,
      type: q.type || "Oui/Non", priority: q.priority ?? 2,
      frequency: q.frequency || "",
      sr: (q.scheduleInfo?.sr?.on ? "on" : "off")
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "text-red-600 hover:underline";
    delBtn.textContent = "Supprimer";
    delBtn.onclick = async () => {
      if (!confirm("Supprimer définitivement cette consigne ?")) return;
      const card = wrapper, parent = card.parentElement; card.remove();
      try {
        await deleteConsigne(q.id);
        showToast("🗑️ Supprimée");
        refreshCurrentView(true);
      } catch (e) {
        if (parent) parent.appendChild(card);
        showToast("❌ Erreur de suppression", "red"); console.error(e);
      }
    };
    actions.appendChild(delBtn);

    header.appendChild(actions);
    wrapper.appendChild(header);

    // Pré-remplissage en mode journalier (si history contient la date sélectionnée)
    let referenceAnswer = "";
    if (q.history && Array.isArray(q.history)) {
      const dateISO = document.getElementById("date-select").selectedOptions[0]?.dataset.date;
      if (dateISO) {
        const entry = q.history.find(entry => {
          if (entry?.date) {
            const [dd, mm, yyyy] = entry.date.split("/");
            const entryDateISO = `${yyyy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
            return entryDateISO === dateISO;
          }
          return false;
        });
        referenceAnswer = entry?.value || "";
      }
    }
    let input;
    const type = (q.type || "").toLowerCase();

    if (type.includes("oui")) {
      input = document.createElement("div");
      input.className = "space-x-6 text-gray-700";
      input.innerHTML = `<label><input type="radio" name="${q.id}" value="Oui" class="mr-1" ${referenceAnswer === "Oui" ? "checked" : ""}>Oui</label>
        <label><input type="radio" name="${q.id}" value="Non" class="mr-1" ${referenceAnswer === "Non" ? "checked" : ""}>Non</label>`;
    } else if (type.includes("menu") || type.includes("likert")) {
      input = document.createElement("select");
      input.name = q.id;
      input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
      ["", "Oui", "Plutôt oui", "Moyen", "Plutôt non", "Non", "Pas de réponse"].forEach(opt => {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        if (opt === referenceAnswer) option.selected = true;
        input.appendChild(option);
      });
    } else if (type.includes("plus long")) {
      input = document.createElement("textarea");
      input.name = q.id;
      input.rows = 4;
      // sm = mobile ; md = ≥768px
      input.className = "mt-1 p-2 border rounded w-full bg-white text-gray-800 text-sm md:text-base leading-tight";
      input.value = referenceAnswer;
    } else {
      input = document.createElement("input");
      input.name = q.id;
      input.type = "text";
      input.className = "mt-1 p-2 border rounded w-full bg-white text-gray-800 text-sm md:text-base leading-tight";
      input.value = referenceAnswer;
    }

    wrapper.appendChild(input);
    // Auto-save doux + mini anim
    if (input.tagName === "SELECT" || input.tagName === "TEXTAREA" || input.type === "text") {
      bindFieldAutosave(input, q.id);
    } else {
      input.querySelectorAll('input[type="radio"]').forEach(r => {
        r.addEventListener("change", () => {
          const val = input.querySelector('input[type="radio"]:checked')?.value || "";
          queueSoftSave({ [q.id]: val }, wrapper);
          flashSaved(wrapper);
        });
      });
    }
    addInlineSRToggle(wrapper, q);
  
    // 📓 Historique (compatible daily et practice)
    if (q.history && q.history.length > 0) {
      console.log(`📖 Affichage de l'historique pour "${q.label}" (${q.history.length} entrées)`);
      const historyContainer = document.createElement('div');
      renderHistory(q.history, historyContainer, normalize, colorMap);
      wrapper.appendChild(historyContainer);
    }

    container.appendChild(wrapper);
  }

  function renderHistory(history, container, normalize, colorMap) {
    if (!Array.isArray(history) || history.length === 0) return;

    // Bouton d'ouverture
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "mt-3 text-sm text-blue-600 hover:underline";
    toggleBtn.textContent = "📓 Voir l'historique des réponses";

    // Bloc contenu (replié par défaut)
    const historyBlock = document.createElement("div");
    historyBlock.className = "mt-3 p-3 rounded bg-gray-50 border text-sm text-gray-700 hidden";

    // === Graphe Likert ===
    const chartWrap = document.createElement("div");
    renderLikertChart(chartWrap, history, normalize); // utilisera le scroller interne si assez de points
    historyBlock.appendChild(chartWrap);

    // === Stats rapides (facultatif mais utile) ===
    const counts = { "oui":0, "plutot oui":0, "moyen":0, "plutot non":0, "non":0 };
    history.forEach(e => {
      const n = normalize(e.value);
      if (counts[n] != null) counts[n] += 1;
    });
    const stats = document.createElement("div");
    stats.className = "mt-2 text-xs text-gray-600";
    stats.innerHTML = [
      `Oui: ${counts["oui"]}`,
      `Plutôt oui: ${counts["plutot oui"]}`,
      `Moyen: ${counts["moyen"]}`,
      `Plutôt non: ${counts["plutot non"]}`,
      `Non: ${counts["non"]}`
    ].join(" · ");
    historyBlock.appendChild(stats);

    // === Liste (RÉCENTS -> ANCIENS) ===
    const ordered = orderForHistory(history);
    const LIMIT = 10;
    ordered.forEach((entry, idx) => {
      const keyPretty = prettyKeyWithDate(entry);
      const val = entry.value;
      const n = normalize(val);
      const line = document.createElement("div");
      line.className = `mb-2 px-3 py-2 rounded ${colorMap[n] || "bg-gray-100 text-gray-700"}`;
      if (idx >= LIMIT) line.classList.add("hidden", "extra-history");
      line.innerHTML = `<strong>${keyPretty}</strong> – ${val}`;
      historyBlock.appendChild(line);
    });

    if (ordered.length > LIMIT) {
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "mt-2 text-xs text-blue-600 hover:underline";
      let expanded = false;
      const rest = ordered.length - LIMIT;
      const setLabel = () => { moreBtn.textContent = expanded ? "Réduire" : `Afficher plus (${rest} de plus)`; };
      setLabel();
      moreBtn.addEventListener("click", () => {
        expanded = !expanded;
        historyBlock.querySelectorAll(".extra-history").forEach(el => el.classList.toggle("hidden", !expanded));
        setLabel();
      });
      historyBlock.appendChild(moreBtn);
    }

    // Toggle ouverture/fermeture
    toggleBtn.addEventListener("click", () => {
      const wasHidden = historyBlock.classList.contains("hidden");
      historyBlock.classList.toggle("hidden");
      if (wasHidden) {
        // auto-scroll vers la droite du graphe (si overflow)
        const sc = chartWrap._likertScroller;
        if (sc) requestAnimationFrame(() => { sc.scrollLeft = sc.scrollWidth; });
      }
    });

    // ⬅️ IMPORTANT : on ajoute au DOM !
    container.appendChild(toggleBtn);
    container.appendChild(historyBlock);
  }

  // Renderer commun (journalier & pratique)
  function renderQuestions(questions) {
    const container = document.getElementById("daily-form");
    container.innerHTML = "";
    console.log(`✍️ Rendu de ${questions.length} question(s)`);

    // 1) Séparer visibles / masquées (SR)
    const hiddenSR = [];
    const visibles  = [];
    (questions || []).forEach(q => q.skipped ? hiddenSR.push(q) : visibles.push(q));

    // 2) Grouper les visibles par priorité
    const groups = { 1: [], 2: [], 3: [] }; // 1=haute,2=moyenne,3=basse
    visibles.forEach(q => {
      const p = Number(q?.priority ?? 2);
      (p === 1 || p === 2 || p === 3 ? groups[p] : groups[2]).push(q);
    });
    const byLabel = (a,b)=> (a.label||"").localeCompare(b.label||"", "fr", {sensitivity:"base"});
    groups[1].sort(byLabel); groups[2].sort(byLabel); groups[3].sort(byLabel);

    // utilitaires existants (pour renderQuestion)
    const normalize = (str) =>
      (str || "").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[\u00A0\u202F\u200B]/g," ")
        .replace(/\s+/g," ").toLowerCase().trim();
    const colorMap = {
      "oui":"bg-green-100 text-green-800","plutot oui":"bg-green-50 text-green-700","moyen":"bg-yellow-100 text-yellow-800",
      "plutot non":"bg-red-100 text-red-900","non":"bg-red-200 text-red-900","pas de reponse":"bg-gray-200 text-gray-700 italic"
    };

    const addHeader = (txt, cls="") => {
      const h = document.createElement("div");
      h.className = `mb-2 mt-4 text-sm font-semibold ${cls}`;
      h.textContent = txt;
      container.appendChild(h);
    };

    // 3) Afficher: HAUTE (contrastée) → MOYENNE (normale) → BASSE (repliées)
    if (groups[1].length) {
      addHeader(`Priorité haute (${groups[1].length})`, "text-red-700");
      groups[1].forEach(q => renderQuestion(q, container, normalize, colorMap));
    }
    if (groups[2].length) {
      addHeader(`Priorité moyenne (${groups[2].length})`, "text-gray-700");
      groups[2].forEach(q => renderQuestion(q, container, normalize, colorMap));
    }
    if (groups[3].length) {
      const det = document.createElement("details");
      det.className = "mt-4";
      det.open = false; // ⬅️ replié par défaut
      const sum = document.createElement("summary");
      sum.className = "cursor-pointer select-none px-2 py-2 text-sm font-semibold text-gray-700 rounded hover:bg-gray-50";
      sum.textContent = `Priorité basse (${groups[3].length})`;
      det.appendChild(sum);
      const box = document.createElement("div");
      box.className = "mt-2";
      groups[3].forEach(q => renderQuestion(q, box, normalize, colorMap));
      det.appendChild(box);
      container.appendChild(det);
    }

    // 4) Panneau « Questions masquées (SR) » — inchangé
    if (hiddenSR.length) {
      const panel = document.createElement("div");
      panel.className = "mt-6";
      const details = document.createElement("details");
      details.className = "bg-gray-50 border border-gray-200 rounded-lg";
      details.open = false;
      const sum = document.createElement("summary");
      sum.className = "cursor-pointer select-none px-3 py-2 font-medium text-gray-700";
      sum.textContent = `Questions masquées (SR) — ${hiddenSR.length}`;
      details.appendChild(sum);
      const inner = document.createElement("div");
      inner.className = "p-3";
      hiddenSR.forEach(q => {
        const wrap = document.createElement("div");
        wrap.className = "mb-3 p-3 rounded border border-dashed border-gray-200 bg-white";
        // on affiche au moins le label + infos de délai
        const t = document.createElement("div");
        t.className = "text-sm font-medium text-gray-800";
        t.textContent = q.label;
        wrap.appendChild(t);
        addDelayUI(wrap, q);
        inner.appendChild(wrap);
      });
      details.appendChild(inner);
      panel.appendChild(details);
      container.appendChild(panel);
    }

    showFormUI();
  }

  // Bouton nouvelle consigne
  const newBtn = document.getElementById("new-consigne-btn");
  if (newBtn) newBtn.addEventListener("click", () => openConsigneModal());
  const cancelBtn = document.getElementById("consigne-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", closeConsigneModal);
  // onsubmit du modal est désormais défini dans openConsigneModal()
}
