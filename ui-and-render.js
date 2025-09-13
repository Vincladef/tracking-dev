import {
  apiUrl, user, apiFetch, postWithBackoff, postWithRetry, WORKER_URL,
  showToast, flashSaved, normalizeFRDate, toISODate, toQuestions, isAnswerKey, canonicalizeLikert
} from './core-api-and-utils.js';
import {
  appState, __applySavedOrderToGroups, __persistCurrentDOMOrder,
  queueSoftSave, flushSoftSaveNow, bindFieldAutosave
} from './state-and-persistence.js';
import {
  openConsigneModal, loadConsignes, enableDnD, getAllCategories, deleteConsigne
} from './consignes-and-dnd.js';

export async function initApp() {
  // Validation utilisateur
  if (!user) {
    showToast("❌ Aucun utilisateur indiqué !", "red");
    throw new Error("Utilisateur manquant");
  }

  // Variables pour le pré-fetch
  let _prefetch = null;
  let _prefetchKey = "";

  // ✅ Mémoire des délais sélectionnés (clé -> valeur)
  appState.delayValues = {};

  // états SR en mémoire
  appState.srToggles  = {}; // état courant (on/off) tel que l'UI l'affiche
  appState.srBaseline = {}; // état de référence venu du backend (pour ne POSTer que les différences)

  // Titre dynamique
  document.getElementById("user-title").textContent =
    `📝 Formulaire du jour – ${user.charAt(0).toUpperCase() + user.slice(1)}`;

  // On enlève l'ancien affichage de date (non nécessaire avec le sélecteur)
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

    // Groupe Dates (7j)
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

    // Groupe Mode pratique — catégories (chargé IMMÉDIATEMENT)
    const ogPractice = document.createElement("optgroup");
    ogPractice.label = "Mode pratique — catégories";
    sel.appendChild(ogPractice);

    try {
      const resp = await apiFetch("GET", `?mode=practice`);
      const cats = Array.isArray(resp) ? resp : (resp?.categories || []);
      if (cats.length) {
        const sepGroup = document.createElement("optgroup");
        sepGroup.label = "────────";
        sel.appendChild(sepGroup);

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

    console.log("✅ Sélecteur créé avec succès");
  }

  await buildCombinedSelect();

  // ➡️ Gestionnaire de changement
  async function handleSelectChange() {
    const selected = dateSelect.selectedOptions[0];
    if (!selected || selected.disabled) return;

    const mode = selected.dataset.mode || "daily";
    
    // Mise à jour de l'état global
    appState.mode = mode;
    appState.selectedDate = (mode === "daily") ? selected.dataset.date : null;
    appState.currentCategory = (mode === "practice") ? selected.dataset.category : null;
    appState.currentDate = appState.selectedDate;  // pour compatibilité
    
    // on repart propre à chaque changement
    appState.delayValues = {};
    appState.srToggles = {};
    appState.srBaseline = {};

    if (mode === "daily") {
      console.log(`➡️ Changement de mode : Journalier, date=${selected.dataset.date}`);
      await loadFormForDate(selected.dataset.date);
    } else {
      console.log(`➡️ Changement de mode : Pratique, catégorie=${selected.dataset.category}`);
      await loadPracticeForm(selected.dataset.category);
    }
  }

  dateSelect.addEventListener("change", handleSelectChange);

  // ➡️ Soumission du formulaire principal
  document.getElementById("daily-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
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
    entries._mode = mode;

    if (mode === "daily") {
      entries._date = selected.dataset.date;
    } else {
      entries._category = selected.dataset.category; // nom exact
      
      // Include hidden SR items for practice mode
      if (appState.__hiddenPracticeSr?.length) {
        entries.__srIterDec = JSON.stringify(appState.__hiddenPracticeSr);
        console.log(`[SR] Including ${appState.__hiddenPracticeSr.length} hidden SR items for iteration decrement`);
      }
    }
    entries.apiUrl = apiUrl;
    entries._action = 'save_answers';

    console.log("📤 Soumission :", entries);

    try {
      await flushSoftSaveNow("submit");
      const res = await postWithBackoff(entries);
      if (res.ok) {
        showToast("✅ Enregistré");
        
        // on repart propre
        appState.delayValues = {};
        appState.srToggles   = {};
        appState.srBaseline  = {};

        setTimeout(() => {
          if (mode === "practice") {
            loadPracticeForm(selected.dataset.category, { fresh: true });
          } else {
            loadFormForDate(selected.dataset.date, { fresh: true });
          }
        }, 300);
      } else {
        showToast("❌ Échec de l'enregistrement", "red");
      }
    } catch (e) {
      console.error("Erreur soumission :", e);
      showToast("❌ Erreur réseau", "red");
    }
  });

  // Chargement d'un formulaire pour une date donnée
  async function loadFormForDate(dateISO, opts = {}) {
    if (!dateISO) return;
    console.log(`🔄 Chargement du formulaire pour ${dateISO}...`);
    
    clearFormUI();
    try {
      const resp = await apiFetch("GET", `?_date=${dateISO}`, opts);
      const questions = toQuestions(resp);
      if (!questions) throw new Error("Format de réponse inattendu");
      
      appState.lastQuestions = questions;
      appState.qById = new Map(questions.map(q => [String(q.id), q]));
      
      showFormUI();
      renderQuestions(questions);
      console.log(`✅ ${questions.length} question(s) chargée(s)`);
    } catch (e) {
      console.error("Erreur de chargement :", e);
      showToast("❌ Erreur de chargement", "red");
    }
  }

  // Chargement d'un formulaire de pratique délibérée
  async function loadPracticeForm(category, opts = {}) {
    if (!category) return;
    console.log(`🔄 Chargement du mode pratique pour "${category}"...`);
    
    clearFormUI();
    try {
      const resp = await apiFetch("GET", `?mode=practice&category=${encodeURIComponent(category)}`, opts);
      const questions = toQuestions(resp);
      if (!questions) throw new Error("Format de réponse inattendu");
      
      appState.lastQuestions = questions;
      appState.qById = new Map(questions.map(q => [String(q.id), q]));
      
      showFormUI();
      renderQuestions(questions);
      console.log(`✅ ${questions.length} question(s) de pratique chargée(s)`);
    } catch (e) {
      console.error("Erreur de chargement :", e);
      showToast("❌ Erreur de chargement", "red");
    }
  }

  function clearFormUI() {
    const container = document.getElementById("questions-container");
    if (container) container.innerHTML = "";
    const submitBtn = document.getElementById("submit-btn");
    if (submitBtn) submitBtn.classList.add("hidden");
  }

  function showFormUI() {
    const submitBtn = document.getElementById("submit-btn");
    if (submitBtn) submitBtn.classList.remove("hidden");
  }

  function refreshCurrentView(fresh = false) {
    const selected = dateSelect.selectedOptions[0];
    if (!selected) return;
    
    const mode = selected.dataset.mode || "daily";
    if (mode === "daily") {
      loadFormForDate(selected.dataset.date, fresh ? { fresh: true } : {});
    } else {
      loadPracticeForm(selected.dataset.category, fresh ? { fresh: true } : {});
    }
  }

  // Rendu des questions
  function renderQuestions(questions) {
    const container = document.getElementById("questions-container");
    if (!container) return;
    
    container.innerHTML = "";
    
    if (!questions || !questions.length) {
      container.innerHTML = '<div class="text-gray-500 text-center py-8">Aucune question pour cette sélection.</div>';
      return;
    }

    // Grouper par priorité
    const groups = { 1: [], 2: [], 3: [] };
    questions.forEach(q => {
      const p = Number(q?.priority ?? 2);
      (p === 1 || p === 2 || p === 3 ? groups[p] : groups[2]).push(q);
    });

    // Appliquer l'ordre sauvegardé
    __applySavedOrderToGroups(groups);

    // Créer les conteneurs pour chaque priorité
    appState.__lists = {};
    
    [1, 2, 3].forEach(priority => {
      if (!groups[priority].length) return;
      
      const section = document.createElement("div");
      section.className = "mb-6";
      
      const title = document.createElement("h3");
      const colors = { 1: "text-red-700 border-red-500", 2: "text-yellow-700 border-yellow-500", 3: "text-gray-600 border-gray-400" };
      const labels = { 1: "Priorité Haute", 2: "Priorité Moyenne", 3: "Priorité Faible" };
      title.className = `text-lg font-medium mb-3 border-l-4 pl-3 ${colors[priority]}`;
      title.textContent = `${labels[priority]} (${groups[priority].length})`;
      section.appendChild(title);
      
      const list = document.createElement("div");
      list.className = "space-y-4";
      list.dataset.priority = priority;
      appState.__lists[priority] = list;
      
      groups[priority].forEach(q => {
        const card = renderQuestion(q, list);
        list.appendChild(card);
      });
      
      section.appendChild(list);
      container.appendChild(section);
      
      // Enable drag and drop for this list
      enableDnD(list, priority);
    });
  }

  function renderQuestion(q, container) {
    const wrapper = document.createElement("div");
    wrapper.className = "bg-white border border-gray-200 rounded-lg p-4 shadow-sm";
    wrapper.dataset.qid = q.id;

    // Label de la question
    const label = document.createElement("h4");
    label.className = "font-medium text-gray-900 mb-3";
    label.textContent = q.label || `Question ${q.id}`;
    wrapper.appendChild(label);

    // Champ de réponse selon le type
    const inputWrapper = document.createElement("div");
    inputWrapper.className = "mb-3";

    if (q.type === "Oui/Non") {
      const select = document.createElement("select");
      select.name = q.id;
      select.className = "w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
      
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "Choisir...";
      select.appendChild(defaultOpt);
      
      const yesOpt = document.createElement("option");
      yesOpt.value = "Oui";
      yesOpt.textContent = "Oui";
      select.appendChild(yesOpt);
      
      const noOpt = document.createElement("option");
      noOpt.value = "Non";
      noOpt.textContent = "Non";
      select.appendChild(noOpt);
      
      if (q.value) select.value = q.value;
      bindFieldAutosave(select, q.id);
      inputWrapper.appendChild(select);
      
    } else if (/likert/i.test(q.type || "")) {
      const select = document.createElement("select");
      select.name = q.id;
      select.className = "w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
      
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "Évaluer...";
      select.appendChild(defaultOpt);
      
      for (let i = 1; i <= 10; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = i;
        select.appendChild(opt);
      }
      
      if (q.value) select.value = q.value;
      bindFieldAutosave(select, q.id);
      inputWrapper.appendChild(select);
      
    } else {
      const textarea = document.createElement("textarea");
      textarea.name = q.id;
      textarea.className = "w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
      textarea.rows = 3;
      textarea.placeholder = "Votre réponse...";
      if (q.value) textarea.value = q.value;
      bindFieldAutosave(textarea, q.id);
      inputWrapper.appendChild(textarea);
    }

    wrapper.appendChild(inputWrapper);

    // SR Toggle inline
    addInlineSRToggle(wrapper, q);

    // Barre d'actions sous la question
    const actions = document.createElement('div');
    actions.className = 'mt-2 flex items-center gap-3 text-sm';

    // Historique (ouvre une nouvelle fenêtre ; adapte l'URL à ton endpoint réel)
    const btnHist = document.createElement('button');
    btnHist.type = 'button';
    btnHist.className = 'underline text-gray-600 hover:text-gray-800';
    btnHist.textContent = 'Voir l\'historique';
    btnHist.onclick = () => {
      // Si ton Apps Script expose un mode ?mode=history&id=..., adapte ici :
      const query = `?mode=history&id=${encodeURIComponent(q.id)}&user=${encodeURIComponent(user)}`;
      const u = new URL(WORKER_URL);
      u.searchParams.set('apiUrl', apiUrl);
      u.searchParams.set('query', query);
      window.open(u.toString(), '_blank');
    };
    actions.appendChild(btnHist);

    // Modifier
    const btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.className = 'underline text-blue-700 hover:text-blue-900';
    btnEdit.textContent = 'Modifier';
    btnEdit.onclick = () => openConsigneModal(q);
    actions.appendChild(btnEdit);

    // Supprimer
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'underline text-red-700 hover:text-red-900';
    btnDel.textContent = 'Supprimer';
    btnDel.onclick = async () => {
      if (!confirm('Supprimer définitivement cette consigne ?')) return;
      await deleteConsigne(q.id);          // côté backend
      showToast('🗑️ Supprimée');
      // Recharge la vue actuelle
      const sel = document.getElementById('date-select')?.selectedOptions[0];
      if (sel?.dataset.mode === 'practice') {
        loadPracticeForm(sel.dataset.category, { fresh: true });
      } else {
        loadFormForDate(sel.dataset.date, { fresh: true });
      }
    };
    actions.appendChild(btnDel);

    wrapper.appendChild(actions);

    return wrapper;
  }

  function addInlineSRToggle(wrapper, q) {
    const srFromBack = q?.scheduleInfo?.sr;
    const hasBackValue = !!(srFromBack && typeof srFromBack.on === 'boolean');

    // Initialize appState if needed
    if (!appState.__srHardOff) appState.__srHardOff = new Set();

    // état affiché = ce que dit le back si présent, sinon OFF par défaut
    const currentOn = hasBackValue
      ? !!srFromBack.on
      : (appState.srToggles[q.id] === "on" ? true : false);

    if (!(q.id in appState.srBaseline)) appState.srBaseline[q.id] = currentOn ? "on" : "off";
    if (!(q.id in appState.srToggles)) appState.srToggles[q.id] = currentOn ? "on" : "off";

    console.log(`[SR] UI toggle id=${q.id} "${q.label || ''}" → ${appState.srToggles[q.id]} (baseline=${appState.srBaseline[q.id]})`);

    const row = document.createElement("div");
    row.className = "flex items-center gap-2";
    wrapper.appendChild(row);

    const srLabel = document.createElement("span");
    srLabel.className = "text-sm text-gray-600";
    srLabel.textContent = "Répétition espacée :";
    row.appendChild(srLabel);

    const btn = document.createElement("button");
    btn.type = "button";

    const paint = () => {
      const on = appState.srToggles[q.id] === "on";
      btn.textContent = on ? "ON" : "OFF";
      btn.className = "px-2 py-1 rounded border text-sm " + (on
        ? "bg-green-50 text-green-700 border-green-200"
        : "bg-gray-50 text-gray-700 border-gray-200");
    };

    btn.onclick = () => {
      const now = (appState.srToggles[q.id] === "on") ? "off" : "on";
      
      // Update local state
      appState.srToggles[q.id] = now;
      
      // Track hard-off state for auditing
      if (now === "off") {
        appState.__srHardOff.add(String(q.id));
      } else {
        appState.__srHardOff.delete(String(q.id));
      }
      
      console.log(`[SR-AUDIT] TOGGLE UI id=${q.id} "${q.label}" now=${now} | hardOffSet=${JSON.stringify(Array.from(appState.__srHardOff))}`);
      
      // Send update with clear flag when turning off
      const update = { ["__srToggle__" + q.id]: now };
      if (now === "off") {
        update["__srClear__" + q.id] = "1";
      }
      
      queueSoftSave(update, btn);
      paint();
    };

    // Prevent form submission on button click
    btn.onclick.onChange = null;

    // Initialize hard-off tracking if needed
    if (appState.srToggles[q.id] === "off") {
      appState.__srHardOff.add(String(q.id));
    }

    paint();
    row.appendChild(btn);
  }

  function addDelayUI(wrapper, q) {
    const mode = document.getElementById("date-select").selectedOptions[0]?.dataset.mode || "daily";
    const key = (mode === "daily" ? `__delayDays__` : `__delayIter__`) + q.id;

    const row = document.createElement("div");
    row.className = "mt-2 flex items-center gap-3 relative";
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
    const rawNext = q?.scheduleInfo?.nextDate || q?.scheduleInfo?.sr?.due || null;
    const prettyNext = normalizeFRDate(rawNext);
    if (prettyNext) infos.push(`Prochaine : ${prettyNext}`);
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

    // Simple delay implementation (detailed popover would be more complex)
    btn.onclick = () => {
      const delay = prompt(mode === "daily" ? "Délai en jours (-1 pour annuler) :" : "Délai en itérations (-1 pour annuler) :");
      if (delay !== null) {
        const n = parseInt(delay, 10);
        if (!isNaN(n)) {
          appState.delayValues[key] = String(n);
          queueSoftSave({ [key]: String(n) }, row);
          
          // Update info display
          const infos = [];
          if (prettyNext) infos.push(`Prochaine : ${prettyNext}`);
          if (q.scheduleInfo?.remaining > 0) {
            infos.push(`Revient dans ${q.scheduleInfo.remaining} itération(s)`);
          }
          if (n === -1) {
            infos.push("Délai : annulé");
          } else {
            infos.push(mode === "daily" ? `Délai choisi : ${n} j` : `Délai choisi : ${n} itérations`);
          }
          info.textContent = infos.join(" — ") || "";
        }
      }
    };
  }

  // Bouton nouvelle consigne
  const newBtn = document.getElementById("new-consigne-btn");
  if (newBtn) newBtn.addEventListener("click", () => openConsigneModal());
  const cancelBtn = document.getElementById("consigne-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", () => {
    const modal = document.getElementById("consigne-modal");
    if (modal) modal.classList.add("hidden");
  });

  // Load consignes manager
  // loadConsignes().catch(console.error);
}
