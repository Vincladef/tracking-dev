// 🧑 Identifier l’utilisateur depuis l’URL
const urlParams = new URLSearchParams(location.search);
const user = urlParams.get("user")?.toLowerCase();

if (!user) {
  showToast("❌ Aucun utilisateur indiqué !", "red");
  throw new Error("Utilisateur manquant");
}

// 🌐 Récupération automatique de l’apiUrl depuis le Google Sheet central
const CONFIG_URL = "https://script.google.com/macros/s/AKfycbyF2k4XNW6rqvME1WnPlpTFljgUJaX58x0jwQINd6XPyRVP3FkDOeEwtuierf_CcCI5hQ/exec";

let apiUrl = null;

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

async function initApp() {
  // ✅ Mémoire des délais sélectionnés (clé -> valeur)
  window.__delayValues = window.__delayValues || {};

  // états SR en mémoire
  window.__srToggles  = window.__srToggles || {}; // état courant (on/off) tel que l’UI l’affiche
  window.__srBaseline = window.__srBaseline || {}; // état de référence venu du backend (pour ne POSTer que les différences)

  // Titre dynamique
  document.getElementById("user-title").textContent =
    `📝 Formulaire du jour – ${user.charAt(0).toUpperCase() + user.slice(1)}`;
  // --- Navigation Accueil / Formulaires
  const homeView = document.getElementById("home-view");
  const formsView = document.getElementById("forms-view");
  if (document.getElementById("btn-home")) {
    document.getElementById("btn-home").addEventListener("click", () => {
      homeView.classList.remove("hidden");
      formsView.classList.add("hidden");
      loadOverview();
    });
  }

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

    // Groupe Mode pratique (si dispo)
    try {
      const res = await fetch(`${apiUrl}?mode=practice`);
      const cats = await res.json();
      if (Array.isArray(cats) && cats.length) {
        // Séparateur visuel (dans un optgroup valide)
        const sepGroup = document.createElement("optgroup");
        sepGroup.label = "────────";
        sel.appendChild(sepGroup);

        const ogPractice = document.createElement("optgroup");
        ogPractice.label = "Mode pratique — catégories";
        cats.forEach(cat => {
          const o = document.createElement("option");
          o.textContent = `Mode pratique — ${cat}`;
          o.dataset.mode = "practice";
          o.dataset.category = cat;
          ogPractice.appendChild(o);
        });
        sel.appendChild(ogPractice);
      }
    } catch (e) {
      console.warn("Impossible de charger les catégories de pratique", e);
    }

    // Sélectionner automatiquement la première date
    const firstDate = ogDates.querySelector("option");
    if (firstDate) {
      ph.selected = false;
      firstDate.selected = true;
    }
    console.log("✅ Sélecteur de mode et de date prêt.");
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
    if (window.__delayValues) window.__delayValues = {};
    if (window.__srToggles)   window.__srToggles   = {};
    if (window.__srBaseline)  window.__srBaseline  = {};

    const sel = document.getElementById("date-select");
    if (!sel || !sel.selectedOptions.length) return;
    const selected = sel.selectedOptions[0];
    const mode = selected.dataset.mode || "daily";
    if (mode === "daily") {
      console.log(`➡️ Changement de mode : Journalier, date=${selected.dataset.date}`);
      // afficher la vue formulaires si on était sur Accueil
      const hv = document.getElementById("home-view"); const fv = document.getElementById("forms-view");
      if (hv && fv) { hv.classList.add("hidden"); fv.classList.remove("hidden"); }
      loadFormForDate(selected.dataset.date);
    } else {
      console.log(`➡️ Changement de mode : Pratique, catégorie=${selected.dataset.category}`);
      const hv = document.getElementById("home-view"); const fv = document.getElementById("forms-view");
      if (hv && fv) { hv.classList.add("hidden"); fv.classList.remove("hidden"); }
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
    Object.assign(entries, window.__delayValues || {});
    
    // embarquer l'état SR pour TOUTES les questions (visibles + masquées),
    // mais seulement si l'utilisateur a modifié l'état par rapport au backend
    if (window.__srToggles && window.__srBaseline) {
      for (const [id, onOff] of Object.entries(window.__srToggles)) {
        if (window.__srBaseline[id] !== onOff) {
          entries["__srToggle__" + id] = onOff; // "on" | "off"
        }
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
      body: JSON.stringify(entries),
      headers: { "Content-Type": "application/json" }
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

        // on peut vider les délais mémorisés pour repartir propre
        if (window.__delayValues) window.__delayValues = {};
        // on repart propre aussi pour SR
        window.__srToggles  = {};
        window.__srBaseline = {};

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
  // --- Modal Consignes
  const modal = document.getElementById("consignes-modal");
  const btnManage = document.getElementById("btn-manage");
  const btnCloseM = document.getElementById("close-consignes");
  const btnAdd = document.getElementById("add-consigne");
  if (btnManage && modal) btnManage.addEventListener("click", () => { modal.classList.remove("hidden"); loadConsignes(); });
  if (btnCloseM && modal) btnCloseM.addEventListener("click", () => modal.classList.add("hidden"));
  if (btnAdd) btnAdd.addEventListener("click", (e) => { e.preventDefault(); renderConsigneEditor(); });

  async function loadConsignes() {
    const list = document.getElementById("consignes-list");
    list.innerHTML = `<div class="py-6 text-center text-gray-500">Chargement…</div>`;
    try {
      const res = await fetch(`${apiUrl}?mode=consignes`);
      const consignes = await res.json();
      list.innerHTML = consignes.map(c => consigneRow(c)).join("");
      attachConsigneRowEvents(consignes);
    } catch(e) {
      list.innerHTML = `<div class="py-6 text-center text-red-600">Erreur de chargement</div>`;
    }
  }
  function consigneRow(c){
    const badge = c.priority===1 ? 'bg-green-100 text-green-800' : c.priority===2 ? 'bg-gray-100 text-gray-800' : 'bg-yellow-100 text-yellow-800';
    return `
      <div class="py-3 flex items-center justify-between">
        <div class="min-w-0">
          <div class="font-medium truncate">${c.label}</div>
          <div class="text-sm text-gray-500 truncate">${c.category} • ${c.type} • ${c.frequency}</div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs px-2 py-0.5 rounded ${badge}">P${c.priority||2}</span>
          <button class="edit px-2 py-1 text-sm rounded bg-blue-600 text-white" data-id="${c.id}">Éditer</button>
          <button class="del px-2 py-1 text-sm rounded bg-red-600 text-white" data-id="${c.id}">Suppr.</button>
        </div>
      </div>`;
  }
  function attachConsigneRowEvents(all){
    const byId = Object.fromEntries(all.map(x=>[x.id,x]));
    document.querySelectorAll("#consignes-list .edit").forEach(b=>{
      b.addEventListener("click", ()=> renderConsigneEditor(byId[b.dataset.id]));
    });
    document.querySelectorAll("#consignes-list .del").forEach(b=>{
      b.addEventListener("click", async ()=>{
        if (!confirm("Supprimer cette consigne ?")) return;
        await fetch(`${apiUrl}`, { method:"POST", headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ _action:"consigne_delete", id: b.dataset.id }) });
        loadConsignes();
      });
    });
  }
  function renderConsigneEditor(item){
    const list = document.getElementById("consignes-list");
    const c = item || { category:"", type:"", frequency:"", label:"", priority:2 };
    const html = `
      <div class="border rounded p-3 mb-3">
        <div class="grid md:grid-cols-2 gap-2">
          <input id="ce-cat" class="border rounded px-2 py-1" placeholder="Catégorie" value="${c.category||""}">
          <input id="ce-type" class="border rounded px-2 py-1" placeholder="Type (Oui/Non, Likert, Texte…)" value="${c.type||""}">
          <input id="ce-freq" class="border rounded px-2 py-1" placeholder="Fréquence (quotidien, mardi, repetition espacée, pratique délibérée…)" value="${c.frequency||""}">
          <select id="ce-pri" class="border rounded px-2 py-1">
            <option value="1" ${c.priority===1?"selected":""}>Prioritaire (P1)</option>
            <option value="2" ${!c.priority||c.priority===2?"selected":""}>Normale (P2)</option>
            <option value="3" ${c.priority===3?"selected":""}>Secondaire (P3)</option>
          </select>
        </div>
        <input id="ce-label" class="border rounded px-2 py-1 w-full mt-2" placeholder="Intitulé" value="${c.label||""}">
        <div class="mt-2 flex gap-2">
          <button id="ce-save" class="px-3 py-1 rounded bg-green-600 text-white">Enregistrer</button>
          <button id="ce-cancel" class="px-3 py-1 rounded bg-gray-100">Annuler</button>
        </div>
      </div>`;
    list.insertAdjacentHTML("afterbegin", html);
    document.getElementById("ce-cancel").addEventListener("click", loadConsignes);
    document.getElementById("ce-save").addEventListener("click", async ()=>{
      const payload = {
        _action: item ? "consigne_update" : "consigne_create",
        id: item?.id,
        category: document.getElementById("ce-cat").value,
        type: document.getElementById("ce-type").value,
        frequency: document.getElementById("ce-freq").value,
        priority: parseInt(document.getElementById("ce-pri").value,10),
        label: item ? undefined : document.getElementById("ce-label").value,
        newLabel: item ? document.getElementById("ce-label").value : undefined
      };
      await fetch(`${apiUrl}`, { method:"POST", headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      loadConsignes();
      buildCombinedSelect().catch(()=>{});
    });
  }

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

  function loadFormForDate(dateISO) {
    clearFormUI();
    const loader = document.getElementById("loader");
    if (loader) loader.classList.remove("hidden");
    console.log(`📡 Chargement des questions pour la date : ${dateISO}`);

    fetch(`${apiUrl}?date=${encodeURIComponent(dateISO)}`)
      .then(res => res.json())
      .then(questions => {
        console.log(`✅ ${questions.length} question(s) chargée(s).`);
        renderQuestions(questions);
      })
      .catch(err => {
        document.getElementById("loader")?.classList.add("hidden");
        console.error(err);
        showToast("❌ Erreur de chargement du formulaire", "red");
      });
  }

  async function loadPracticeForm(category) {
    clearFormUI();
    const loader = document.getElementById("loader");
    if (loader) loader.classList.remove("hidden");
    console.log(`📡 Chargement des questions pour la catégorie : ${category}`);

    try {
      const res = await fetch(`${apiUrl}?mode=practice&category=${encodeURIComponent(category)}`);
      const questions = await res.json();
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
    if (window.__delayValues[key] != null) {
      const n = parseInt(window.__delayValues[key], 10);
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
      window.__delayValues[key] = String(n);
      if (n === -1) {
        info.textContent = "Délai : annulé";
      } else {
        info.textContent = mode === "daily"
          ? `Délai choisi : ${n} j`
          : `Délai choisi : ${n} itérations`;
      }
      pop.classList.add("hidden");
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
    window.__srToggles = window.__srToggles || {}; // clé: q.id -> "on"|"off"
    // Affichage de l'état SR actuel (v. API doGet ci-dessous)
    const srCurrent = q.scheduleInfo?.sr || { on:false };
    if (!(q.id in window.__srBaseline)) {
      window.__srBaseline[q.id] = srCurrent.on ? "on" : "off";
    }
    if (!(q.id in window.__srToggles)) {
      window.__srToggles[q.id] = srCurrent.on ? "on" : "off";
    }
    // Ligne SR
    const srRow = document.createElement("div");
    srRow.className = "border-t border-gray-100 p-2 flex items-center justify-between";
    pop.appendChild(srRow);
    const srLabel = document.createElement("span");
    srLabel.className = "text-xs text-gray-700";
    srLabel.innerHTML = `Répétition espacée : <strong>${window.__srToggles[q.id] === "on" ? "ON" : "OFF"}</strong>` +
      (srCurrent.on && srCurrent.interval ? ` <span class="text-gray-500">(${srCurrent.unit==="iters" ? srCurrent.interval+" itér." : srCurrent.due ? "due "+srCurrent.due : srCurrent.interval+" j"})</span>` : "");
    srRow.appendChild(srLabel);
    const srBtn = document.createElement("button");
    srBtn.type = "button";
    srBtn.className = "text-xs text-blue-600 hover:underline";
    srBtn.textContent = window.__srToggles[q.id] === "on" ? "Désactiver SR" : "Activer SR";
    srBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      window.__srToggles[q.id] = window.__srToggles[q.id] === "on" ? "off" : "on";
      srBtn.textContent = window.__srToggles[q.id] === "on" ? "Désactiver SR" : "Activer SR";
      srLabel.innerHTML = `Répétition espacée : <strong>${window.__srToggles[q.id] === "on" ? "ON" : "OFF"}</strong>`;
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

  // Renderer commun (journalier & pratique)
  function renderQuestions(questions) {
    const container = document.getElementById("daily-form");
    container.innerHTML = "";
    console.log(`✍️ Rendu de ${questions.length} question(s)`);

    const visible = [], hiddenSR = [];
    (questions||[]).forEach(q => (q.skipped ? hiddenSR : visible).push(q));

    // TRI : P1 -> P2 -> P3
    visible.sort((a,b)=> (a.priority||2)-(b.priority||2));

    // Groupes
    const p1 = visible.filter(q => (q.priority||2) === 1);
    const p2 = visible.filter(q => (q.priority||2) === 2);
    const p3 = visible.filter(q => (q.priority||2) === 3);

    const renderGroup = (arr, {title, style, collapsed}) => {
      if (!arr.length) return;
      const block = document.createElement("div");
      block.className = "mb-6";
      const header = document.createElement("div");
      header.className = "mb-3 flex items-center gap-2";
      header.innerHTML = `<span class="text-sm font-semibold ${style.badge} px-2 py-0.5 rounded">${title}</span>`;
      block.appendChild(header);

      const body = document.createElement(collapsed ? "details" : "div");
      if (collapsed) {
        body.className = "rounded border";
        const sum = document.createElement("summary");
        sum.className = "cursor-pointer select-none px-3 py-2 text-gray-800";
        sum.textContent = "Afficher les consignes secondaires";
        body.appendChild(sum);
      }

      arr.forEach(q => {
        const wrap = document.createElement("div");
        wrap.className = `mb-4 p-4 rounded-lg shadow-sm ${style.card}`;

      const label = document.createElement("label");
      label.className = "block text-lg font-semibold mb-2";
      label.textContent = q.label;
        wrap.appendChild(label);

        // Réutilise la logique de rendu existante pour les champs + délai + historique
        // Pré-remplissage (journalier)
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
        input.className = "mt-1 p-2 border rounded w-full bg-white text-gray-800 text-sm md:text-base leading-tight";
        input.value = referenceAnswer;
      } else {
        input = document.createElement("input");
        input.name = q.id;
        input.type = "text";
        input.className = "mt-1 p-2 border rounded w-full bg-white text-gray-800 text-sm md:text-base leading-tight";
        input.value = referenceAnswer;
      }
        wrap.appendChild(input);
        addDelayUI(wrap, q);

        // Historique
      if (q.history && q.history.length > 0) {
          const normalize = (str) =>
            (str || "")
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[\u00A0\u202F\u200B]/g, " ")
            .replace(/\s+/g, " ")
            .toLowerCase()
            .trim();
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "mt-3 text-sm text-blue-600 hover:underline";
        toggleBtn.textContent = "📓 Voir l’historique des réponses";
        const historyBlock = document.createElement("div");
        historyBlock.className = "mt-3 p-3 rounded bg-gray-50 border text-sm text-gray-700 hidden";
        renderLikertChart(historyBlock, q.history, normalize);
        const orderedForStats = orderForHistory(q.history);
        const LIMIT = 10;
        const WINDOW = 30;
        const badge = (title, value, tone="blue") => {
          const div = document.createElement("div");
            const tones = { blue:"bg-blue-50 text-blue-700 border-blue-200", green:"bg-green-50 text-green-700 border-green-200", yellow:"bg-yellow-50 text-yellow-700 border-yellow-200", red:"bg-red-50 text-red-900 border-red-200", gray:"bg-gray-50 text-gray-700 border-gray-200", purple:"bg-purple-50 text-purple-700 border-purple-200" };
          div.className = `px-2.5 py-1 rounded-full border text-xs font-medium ${tones[tone]||tones.gray}`;
          div.innerHTML = `<span class="opacity-70">${title}:</span> <span class="font-semibold">${value}</span>`;
          return div;
        };
        const POSITIVE = new Set(["oui","plutot oui"]);
        const windowHist = orderedForStats.slice(0, WINDOW);
        let currentStreak = 0;
          for (const e of windowHist) { if (POSITIVE.has(normalize(e.value))) currentStreak++; else break; }
          const counts = {}; const order = ["non","plutot non","moyen","plutot oui","oui"];
          for (const e of windowHist) { const v = normalize(e.value); counts[v] = (counts[v] || 0) + 1; }
          let best = null, bestCount = -1; for (const k of order) { const c = counts[k] || 0; if (c > bestCount) { best = k; bestCount = c; } }
        const pretty = { "non":"Non","plutot non":"Plutôt non","moyen":"Moyen","plutot oui":"Plutôt oui","oui":"Oui" };
          const statsWrap = document.createElement("div"); statsWrap.className = "mb-3 flex flex-wrap gap-2 items-center";
        statsWrap.appendChild(badge("Série actuelle (positifs)", currentStreak, currentStreak>0 ? "green":"gray"));
        if (best) statsWrap.appendChild(badge("Réponse la plus fréquente", pretty[best] || best, "purple"));
        historyBlock.appendChild(statsWrap);
          const colorMap = { "oui": "bg-green-100 text-green-800", "plutot oui": "bg-green-50 text-green-700", "moyen": "bg-yellow-100 text-yellow-800", "plutot non": "bg-red-100 text-red-900", "non": "bg-red-200 text-red-900", "pas de reponse": "bg-gray-200 text-gray-700 italic" };
        orderedForStats.forEach((entry, idx) => {
          const keyPretty = prettyKeyWithDate(entry);
          const val = entry.value;
          const normalized = normalize(val);
          const entryDiv = document.createElement("div");
            entryDiv.className = `mb-2 px-3 py-2 rounded ${colorMap[normalized] || "bg-gray-100 text-gray-700"}`;
          if (idx >= LIMIT) entryDiv.classList.add("hidden", "extra-history");
          entryDiv.innerHTML = `<strong>${keyPretty}</strong> – ${val}`;
          historyBlock.appendChild(entryDiv);
        });
        if (orderedForStats.length > LIMIT) {
            const moreBtn = document.createElement("button"); moreBtn.type = "button"; moreBtn.className = "mt-2 text-xs text-blue-600 hover:underline";
            let expanded = false; const rest = orderedForStats.length - LIMIT; const setLabel = () => moreBtn.textContent = expanded ? "Réduire" : `Afficher plus (${rest} de plus)`; setLabel();
            moreBtn.addEventListener("click", () => { expanded = !expanded; historyBlock.querySelectorAll(".extra-history").forEach(el => el.classList.toggle("hidden", !expanded)); setLabel(); });
          historyBlock.appendChild(moreBtn);
        }
          toggleBtn.addEventListener("click", () => { const wasHidden = historyBlock.classList.contains("hidden"); historyBlock.classList.toggle("hidden"); if (wasHidden) scrollToRight(historyBlock._likertScroller); });
          wrap.appendChild(toggleBtn);
          wrap.appendChild(historyBlock);
        }
        body.appendChild(wrap);
      });

      block.appendChild(body);
      container.appendChild(block);
    };

    renderGroup(p1, { title:"Prioritaires (P1)", style:{ badge:"bg-green-100 text-green-800", card:"ring-1 ring-green-100" }});
    renderGroup(p2, { title:"Normales (P2)",     style:{ badge:"bg-gray-100 text-gray-800",  card:"" }});
  renderGroup(p3, { title:"Secondaires (P3)",  style:{ badge:"bg-yellow-100 text-yellow-800", card:"bg-yellow-50 bg-opacity-40" }, collapsed:true });

    // === Panneau "Questions masquées (SR)" ===
    if (hiddenSR.length) {
      const panel = document.createElement("div");
      panel.className = "mt-6";
      const details = document.createElement("details");
      details.className = "bg-gray-50 border border-gray-200 rounded-lg";
      details.open = false;
      const summary = document.createElement("summary");
      summary.className = "cursor-pointer select-none px-4 py-2 font-medium text-gray-800 flex items-center justify-between";
      summary.innerHTML = `
        <span>🔕 ${hiddenSR.length} question(s) masquée(s) — répétition espacée</span>
        <span class="text-sm text-gray-500">voir</span>
      `;
      details.appendChild(summary);
      const list = document.createElement("div");
      list.className = "px-4 pt-2 pb-3";
      const normalize = (str) => (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\u00A0\u202F\u200B]/g, " ").replace(/\s+/g, " ").toLowerCase().trim();
      hiddenSR.forEach(item => {
        const row = document.createElement("div"); row.className = "mb-2 rounded bg-white border border-gray-200";
        const head = document.createElement("div"); head.className = "px-3 py-2 flex items-center justify-between";
        const title = document.createElement("div"); title.innerHTML = `<strong>${item.label}</strong>`; head.appendChild(title);
        head.classList.add("cursor-pointer");
        head.addEventListener("click", () => { const wasHidden = content.classList.contains("hidden"); content.classList.toggle("hidden"); if (wasHidden) { const sc = content.querySelector('[data-autoscroll="right"]'); scrollToRight(sc); } });
        const sub = document.createElement("div"); sub.className = "px-3 pb-2 text-sm text-gray-700 flex items-center gap-2";
        const extras = []; if (item.scheduleInfo?.nextDate) extras.push(`Prochaine : ${item.scheduleInfo.nextDate}`); if (Number(item.scheduleInfo?.remaining) > 0) extras.push(`Restant : ${item.scheduleInfo.remaining} itér.`);
        const tail = extras.length ? ` (${extras.join(" — ")})` : ""; const reason = item.reason || "Répétition espacée"; sub.innerHTML = `⏱️ ${reason.replace(/^✅\s*/, '')}${tail}`;
        const content = document.createElement("div"); content.className = "px-3 pb-3 hidden";
        const delayWrap = document.createElement("div"); addDelayUI(delayWrap, item); content.appendChild(delayWrap);
        if (item.history && item.history.length > 0) {
          const toggleBtn = document.createElement("button"); toggleBtn.type = "button"; toggleBtn.className = "mt-3 text-sm text-blue-600 hover:underline"; toggleBtn.textContent = "📓 Voir l’historique des réponses";
          const historyBlock = document.createElement("div"); historyBlock.className = "mt-3 p-3 rounded bg-gray-50 border text-sm text-gray-700 hidden";
          renderLikertChart(historyBlock, item.history, normalize);
          const ordered = orderForHistory(item.history);
          const colorMap = { "oui": "bg-green-100 text-green-800", "plutot oui": "bg-green-50 text-green-700", "moyen": "bg-yellow-100 text-yellow-800", "plutot non": "bg-red-100 text-red-900", "non": "bg-red-200 text-red-900", "pas de reponse": "bg-gray-200 text-gray-700 italic" };
          const LIMIT = 10;
          ordered.forEach((entry, idx) => {
            const keyPretty = prettyKeyWithDate(entry); const val = entry.value; const normalized = normalize(val);
            const div = document.createElement("div"); div.className = `mb-2 px-3 py-2 rounded ${colorMap[normalized] || "bg-gray-100 text-gray-700"}`;
            if (idx >= LIMIT) div.classList.add("hidden", "extra-history"); div.innerHTML = `<strong>${keyPretty}</strong> – ${val}`; historyBlock.appendChild(div);
          });
          if (ordered.length > LIMIT) {
            const moreBtn = document.createElement("button"); moreBtn.type = "button"; moreBtn.className = "mt-2 text-xs text-blue-600 hover:underline";
            let expanded = false; const rest = ordered.length - LIMIT; const setLabel = () => moreBtn.textContent = expanded ? "Réduire" : `Afficher plus (${rest} de plus)`; setLabel();
            moreBtn.addEventListener("click", () => { expanded = !expanded; historyBlock.querySelectorAll(".extra-history").forEach(el => el.classList.toggle("hidden", !expanded)); setLabel(); });
            historyBlock.appendChild(moreBtn);
          }
          toggleBtn.addEventListener("click", () => { const wasHidden = historyBlock.classList.contains("hidden"); historyBlock.classList.toggle("hidden"); if (wasHidden) scrollToRight(historyBlock._likertScroller); });
          content.appendChild(toggleBtn); content.appendChild(historyBlock);
        }
        row.appendChild(head); row.appendChild(sub); row.appendChild(content); list.appendChild(row);
      });
      const note = document.createElement("p"); note.className = "mt-2 text-xs text-gray-500"; note.textContent = "Ces items sont masqués automatiquement suite à vos réponses positives. Ils réapparaîtront à l’échéance."; list.appendChild(note);
      details.appendChild(list); panel.appendChild(details); container.appendChild(panel);
    }
    showFormUI(); console.log("✅ Rendu des questions terminé.");
  }
}

async function loadOverview() {
  try {
    const res = await fetch(`${apiUrl}?mode=overview`);
    const { toDo, topStreaks } = await res.json();
    const ov = document.getElementById("overview");
    ov.innerHTML = `
      <div class="rounded border p-4">
        <div class="text-sm text-gray-500">À faire aujourd’hui</div>
        <div class="mt-1 text-3xl font-bold">${toDo.total}</div>
      </div>
      <div class="rounded border p-4">
        <div class="text-sm text-gray-500">Prioritaires (P1)</div>
        <div class="mt-1 text-3xl font-bold">${toDo.p1}</div>
      </div>
      <div class="rounded border p-4">
        <div class="text-sm text-gray-500">Normales (P2) / Secondaires (P3)</div>
        <div class="mt-1 text-3xl font-bold">${toDo.p2} / ${toDo.p3}</div>
      </div>
    `;
    const top = document.getElementById("top-streaks");
    top.innerHTML = `<div class="font-medium mb-2">🔥 Meilleures séries (positifs consécutifs)</div>` +
      (topStreaks.length ? topStreaks.map(s =>
        `<div class="flex items-center justify-between py-1">
          <div class="truncate">${s.label}</div>
          <span class="text-sm px-2 py-0.5 rounded bg-gray-200">${s.streak}</span>
        </div>`).join("") : `<div class="text-gray-500">Aucune série</div>`);
  } catch(e) {
    console.error(e);
  }
}
