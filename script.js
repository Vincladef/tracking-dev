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

  await buildCombinedSelect();

  // État initial
  handleSelectChange();

  dateSelect.addEventListener("change", handleSelectChange);

  function handleSelectChange() {
    // on repart propre à chaque changement
    if (window.__delayValues) window.__delayValues = {};

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
    Object.assign(entries, window.__delayValues || {});
    
    // embarquer l'état SR par item
    document.querySelectorAll("#daily-form [name]").forEach(inp => {
      const id = inp.name;
      if (window.__srToggles && window.__srToggles[id]) {
        entries["__srToggle__" + id] = window.__srToggles[id]; // "on" | "off"
      }
    });

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

  // Remplace TOUTE ta fonction renderLikertChart par celle-ci
  function renderLikertChart(parentEl, history, normalize) {
    const hist = Array.isArray(history) ? history.slice() : [];
    if (!hist.length) return;

    // ---- Ordonner ancien -> récent (récent à DROITE)
    const dateRe = /(\d{2})\/(\d{2})\/(\d{4})/;
    const iterRe = /\b(\d+)\s*\(/; // ex: "Badminton 12 (..)"
    const toKey = (e, idx) => {
      if (e.date && dateRe.test(e.date)) {
        const [, d, m, y] = e.date.match(dateRe);
        return new Date(`${y}-${m}-${d}`).getTime();
      }
      if (e.key && dateRe.test(e.key)) {
        const [, d, m, y] = e.key.match(dateRe);
        return new Date(`${y}-${m}-${d}`).getTime();
      }
      if (e.key && iterRe.test(e.key)) return parseInt(e.key.match(iterRe)[1], 10);
      return idx; // fallback: ordre fourni
    };
    const ordered = hist.map((e,i)=>({e,k:toKey(e,i)})).sort((a,b)=>a.k-b.k).map(x=>x.e);

    // ---- Points Likert
    const levels = ["non","plutot non","moyen","plutot oui","oui"];
    const labelByNorm = { "non":"Non","plutot non":"Plutôt non","moyen":"Moyen","plutot oui":"Plutôt oui","oui":"Oui" };
    const points = ordered.map(e => {
      const v = normalize(e.value);
      const idx = levels.indexOf(v);
      return (idx === -1) ? null : { v, idx, raw:e };
    }).filter(Boolean);
    if (points.length < 2) return;

    // ---- Layout responsive + scrollable (mobile)
    const pad = { l: 70, r: 16, t: 10, b: 28 };
    const stepPx = 28;             // espacement horizontal par point
    const parentW = Math.max(280, Math.floor(parentEl.getBoundingClientRect().width || 280));
    const neededPlotW = (points.length - 1) * stepPx + pad.l + pad.r;
    const plotW = Math.max(parentW, neededPlotW);   // si plus grand -> overflow horizontal
    const plotH = 160;

    const scroller = document.createElement("div");
    // styles inline pour garantir le scroll sur mobile
    scroller.style.width = "100%";
    scroller.style.maxWidth = "100%";
    scroller.style.display = "block";
    scroller.style.overflowX = "auto";
    scroller.style.overflowY = "hidden";
    scroller.style.WebkitOverflowScrolling = "touch";
    scroller.style.touchAction = "pan-x";
    parentEl.appendChild(scroller);

    const canvas = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(plotW * dpr);
    canvas.height = Math.round(plotH * dpr);
    canvas.style.width  = plotW + "px";
    canvas.style.height = plotH + "px";
    canvas.style.display = "block";
    canvas.style.maxWidth = "none";  // IMPORTANT: ne pas se rétrécir
    canvas.className = "mb-3 rounded";
    scroller.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const w = plotW - pad.l - pad.r;
    const h = plotH - pad.t - pad.b;

    // fond
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, plotW, plotH);

    // grille + labels Y
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial";
    ctx.fillStyle = "#374151";
    for (let i = 0; i < levels.length; i++) {
      const y = pad.t + (h / (levels.length - 1)) * (levels.length - 1 - i);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
      ctx.fillText(labelByNorm[levels[i]] || levels[i], 8, y + 4);
    }

    // ticks X
    const n = points.length;
    const step = n > 1 ? w / (n - 1) : w;
    const xTickEvery = Math.max(1, Math.floor(n / 10));
    ctx.strokeStyle = "#f3f4f6";
    for (let i = 0; i < n; i += xTickEvery) {
      const x = pad.l + i * step;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + h); ctx.stroke();
    }

    // labels X (dates / itérations)
    ctx.font = "10px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial";
    ctx.fillStyle = "#6b7280";
    for (let i = 0; i < n; i += xTickEvery) {
      const x = pad.l + i * step;
      const e = points[i].raw;
      let label = "";
      if (e.date && dateRe.test(e.date)) label = e.date.slice(0,5);
      else if (e.key && dateRe.test(e.key)) label = e.key.match(dateRe)[0].slice(0,5);
      else if (e.key && iterRe.test(e.key)) label = "N=" + e.key.match(iterRe)[1];
      ctx.fillText(label, x - 16, pad.t + h + 16);
    }

    // courbe
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad.l + i * step;
      const y = pad.t + (h / (levels.length - 1)) * (levels.length - 1 - p.idx);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // points
    ctx.fillStyle = "#1f2937";
    points.forEach((p, i) => {
      const x = pad.l + i * step;
      const y = pad.t + (h / (levels.length - 1)) * (levels.length - 1 - p.idx);
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    });

    // axe X
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t + h); ctx.lineTo(pad.l + w, pad.t + h); ctx.stroke();

    // se placer tout à droite (le plus récent) s'il y a overflow
    requestAnimationFrame(() => { scroller.scrollLeft = scroller.scrollWidth; });
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
          { label: "0", value: 0 },
          { label: "1", value: 1 },
          { label: "2", value: 2 },
          { label: "3", value: 3 },
          { label: "5", value: 5 },
          { label: "8", value: 8 },
          { label: "13", value: 13 }
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

      // Ferme les autres popovers ouverts
      document.querySelectorAll('[data-pop="delay"]').forEach(el => {
        if (el !== pop) el.classList.add("hidden");
      });

      pop.classList.toggle("hidden");

      const onOutside = (e) => {
        if (!pop.contains(e.target) && e.target !== btn) {
          pop.classList.add("hidden");
          document.removeEventListener("click", onOutside);
        }
      };

      // n'attache le listener global que si on vient d'ouvrir
      if (!pop.classList.contains("hidden")) {
        setTimeout(() => document.addEventListener("click", onOutside), 0);
      }
    });
  }

  // Renderer commun (journalier & pratique)
  function renderQuestions(questions) {
    const container = document.getElementById("daily-form");
    container.innerHTML = "";
    console.log(`✍️ Rendu de ${questions.length} question(s)`);

    const hiddenSR = []; // questions masquées par SR/delay
    const normalize = (str) =>
      (str || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[\u00A0\u202F\u200B]/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();

    const colorMap = {
      "oui": "bg-green-100 text-green-800",
      "plutot oui": "bg-green-50 text-green-700",
      "moyen": "bg-yellow-100 text-yellow-800",
      "plutot non": "bg-red-100 text-red-900",
      "non": "bg-red-200 text-red-900",
      "pas de reponse": "bg-gray-200 text-gray-700 italic"
    };

    (questions || []).forEach(q => {
      // Log détaillé pour chaque question
      console.groupCollapsed(`[Question] Traitement de "${q.label}"`);
      console.log("-> Type de question :", q.type);
      console.log("-> Est-elle affichée ? :", !q.skipped);
      if (q.skipped) {
        console.log("-> Raison du masquage :", q.reason);
      }
      console.groupEnd();
      
      if (q.skipped) {
        // on garde tout (history, scheduleInfo…) pour pouvoir afficher délai + historique
        hiddenSR.push(q);
        return;
      }
      
      const wrapper = document.createElement("div");
      wrapper.className = "mb-8 p-4 rounded-lg shadow-sm";

      const label = document.createElement("label");
      label.className = "block text-lg font-semibold mb-2";
      label.textContent = q.label;
      wrapper.appendChild(label);

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
        input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
        input.value = referenceAnswer;
      } else {
        input = document.createElement("input");
        input.name = q.id;
        input.type = "text";
        input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
        input.value = referenceAnswer;
      }

      wrapper.appendChild(input);
      addDelayUI(wrapper, q); // Appel du nouveau helper ici
    
      // 📓 Historique (compatible daily et practice)
      if (q.history && q.history.length > 0) {
        console.log(`📖 Affichage de l'historique pour "${q.label}" (${q.history.length} entrées)`);
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "mt-3 text-sm text-blue-600 hover:underline";
        toggleBtn.textContent = "📓 Voir l’historique des réponses";

        const historyBlock = document.createElement("div");
        historyBlock.className = "mt-3 p-3 rounded bg-gray-50 border text-sm text-gray-700 hidden";

        // Graphe Likert + 2 stats compactes (sur 30 dernières)
        renderLikertChart(historyBlock, q.history, normalize);

        // --- Tri commun pour stats & liste : RÉCENT -> ANCIEN ---
        const orderedForStats = (() => {
          const hist = Array.isArray(q.history) ? q.history.slice() : [];
          const dateRe = /(\d{2})\/(\d{2})\/(\d{4})/;
          const iterRe = /\b(\d+)\s*\(/; // ex: "Badminton 12 (..)"
          const toKey = (e, idx) => {
            if (e.date && dateRe.test(e.date)) {
              const [, d, m, y] = e.date.match(dateRe);
              return new Date(`${y}-${m}-${d}`).getTime();
            }
            if (e.key && dateRe.test(e.key)) {
              const [, d, m, y] = e.key.match(dateRe);
              return new Date(`${y}-${m}-${d}`).getTime();
            }
            if (e.key && iterRe.test(e.key)) return parseInt(e.key.match(iterRe)[1], 10);
            return idx; // fallback
          };
          // tri croissant puis on inverse pour avoir récent -> ancien
          return hist.map((e,i)=>({e,k:toKey(e,i)})).sort((a,b)=>a.k-b.k).map(x=>x.e).reverse();
        })();

        // --- Stats compactes sur fenêtre récente ---
        const LIMIT = 10;
        const WINDOW = 30;
        const badge = (title, value, tone="blue") => {
          const div = document.createElement("div");
          const tones = {
            blue:"bg-blue-50 text-blue-700 border-blue-200",
            green:"bg-green-50 text-green-700 border-green-200",
            yellow:"bg-yellow-50 text-yellow-700 border-yellow-200",
            red:"bg-red-50 text-red-900 border-red-200",
            gray:"bg-gray-50 text-gray-700 border-gray-200",
            purple:"bg-purple-50 text-purple-700 border-purple-200"
          };
          div.className = `px-2.5 py-1 rounded-full border text-xs font-medium ${tones[tone]||tones.gray}`;
          div.innerHTML = `<span class="opacity-70">${title}:</span> <span class="font-semibold">${value}</span>`;
          return div;
        };
        const POSITIVE = new Set(["oui","plutot oui"]);

        // Fenêtre des N plus récents
        const windowHist = orderedForStats.slice(0, WINDOW);

        // Série courante (positifs consécutifs depuis le plus récent)
        let currentStreak = 0;
        for (const e of windowHist) {
          if (POSITIVE.has(normalize(e.value))) currentStreak++;
          else break;
        }

        // Réponse la plus fréquente (dans la fenêtre)
        const counts = {};
        const order = ["non","plutot non","moyen","plutot oui","oui"];
        for (const e of windowHist) {
          const v = normalize(e.value);
          counts[v] = (counts[v] || 0) + 1;
        }
        let best = null, bestCount = -1;
        for (const k of order) {
          const c = counts[k] || 0;
          if (c > bestCount) { best = k; bestCount = c; }
        }
        const pretty = { "non":"Non","plutot non":"Plutôt non","moyen":"Moyen","plutot oui":"Plutôt oui","oui":"Oui" };
        const statsWrap = document.createElement("div");
        statsWrap.className = "mb-3 flex flex-wrap gap-2 items-center";
        statsWrap.appendChild(badge("Série actuelle (positifs)", currentStreak, currentStreak>0 ? "green":"gray"));
        if (best) statsWrap.appendChild(badge("Réponse la plus fréquente", pretty[best] || best, "purple"));
        historyBlock.appendChild(statsWrap);

        // --- Liste : utilise le même ordre trié (récent -> ancien) ---
        orderedForStats.forEach((entry, idx) => {
          const key = entry.date || entry.key || "";
          const val = entry.value;
          const normalized = normalize(val);
          const colorClass = colorMap[normalized] || "bg-gray-100 text-gray-700";

          const entryDiv = document.createElement("div");
          entryDiv.className = `mb-2 px-3 py-2 rounded ${colorClass}`;
          if (idx >= LIMIT) entryDiv.classList.add("hidden", "extra-history");
          entryDiv.innerHTML = `<strong>${key}</strong> – ${val}`;
          historyBlock.appendChild(entryDiv);
        });

        if (orderedForStats.length > LIMIT) {
          const moreBtn = document.createElement("button");
          moreBtn.type = "button";
          moreBtn.className = "mt-2 text-xs text-blue-600 hover:underline";
          let expanded = false; const rest = orderedForStats.length - LIMIT;
          const setLabel = () => moreBtn.textContent = expanded ? "Réduire" : `Afficher plus (${rest} de plus)`;
          setLabel();
          moreBtn.addEventListener("click", () => {
            expanded = !expanded;
            historyBlock.querySelectorAll(".extra-history").forEach(el => el.classList.toggle("hidden", !expanded));
            setLabel();
          });
          historyBlock.appendChild(moreBtn);
        }

        toggleBtn.addEventListener("click", () => {
          historyBlock.classList.toggle("hidden");
        });

        wrapper.appendChild(toggleBtn);
        wrapper.appendChild(historyBlock);
      }

      container.appendChild(wrapper);
    });

    // === Panneau "Questions masquées (SR)" ===
    if (hiddenSR.length) {
      const panel = document.createElement("div");
      panel.className = "mt-6";

      const details = document.createElement("details");
      details.className = "bg-gray-50 border border-gray-200 rounded-lg";
      details.open = false; // toujours replié par défaut

      const summary = document.createElement("summary");
      summary.className = "cursor-pointer select-none px-4 py-2 font-medium text-gray-800 flex items-center justify-between";
      summary.innerHTML = `
        <span>🔕 ${hiddenSR.length} question(s) masquée(s) — répétition espacée</span>
        <span class="text-sm text-gray-500">voir</span>
      `;
      details.appendChild(summary);

      const list = document.createElement("div");
      list.className = "px-4 pt-2 pb-3";

      const normalize = (str) =>
        (str || "")
          .normalize("NFD").replace(/[̀-ͯ]/g, "")
          .replace(/[\u00A0\u202F\u200B]/g, " ")
          .replace(/\s+/g, " ")
          .toLowerCase()
          .trim();

      hiddenSR.forEach(item => {
        const row = document.createElement("div");
        row.className = "mb-2 rounded bg-white border border-gray-200";

        // en-tête de l'item
        const head = document.createElement("div");
        head.className = "px-3 py-2 flex items-center justify-between";
        const title = document.createElement("div");
        title.innerHTML = `<strong>${item.label}</strong>`;
        const seeBtn = document.createElement("button");
        seeBtn.type = "button";
        seeBtn.className = "text-sm text-blue-600 hover:underline";
        seeBtn.textContent = "voir";
        head.appendChild(title);
        head.appendChild(seeBtn);

        // infos "prochaine échéance"
        const sub = document.createElement("div");
        sub.className = "px-3 pb-2 text-sm text-gray-700 flex items-center gap-2";
        const extras = [];
        if (item.scheduleInfo?.nextDate) extras.push(`Prochaine : ${item.scheduleInfo.nextDate}`);
        if (Number(item.scheduleInfo?.remaining) > 0) extras.push(`Restant : ${item.scheduleInfo.remaining} itér.`);
        const tail = extras.length ? ` (${extras.join(" — ")})` : "";
        sub.innerHTML = `⏱️ ${
          item.reason || "Répétition espacée"
        }${tail}`;

        // contenu détaillé replié
        const content = document.createElement("div");
        content.className = "px-3 pb-3 hidden";

        // 1) UI Délai (mêmes options que pour les visibles)
        const delayWrap = document.createElement("div");
        addDelayUI(delayWrap, item);
        content.appendChild(delayWrap);

        // 2) Historique (même principe : bouton + bloc avec graphe + liste)
        if (item.history && item.history.length > 0) {
          const toggleBtn = document.createElement("button");
          toggleBtn.type = "button";
          toggleBtn.className = "mt-3 text-sm text-blue-600 hover:underline";
          toggleBtn.textContent = "📓 Voir l’historique des réponses";

          const historyBlock = document.createElement("div");
          historyBlock.className = "mt-3 p-3 rounded bg-gray-50 border text-sm text-gray-700 hidden";

          // graphe likert
          renderLikertChart(historyBlock, item.history, normalize);

          // liste (récents -> anciens)
          const ordered = (() => {
            const hist = Array.isArray(item.history) ? item.history.slice() : [];
            const dateRe = /(\d{2})\/(\d{2})\/(\d{4})/;
            const iterRe = /\b(\d+)\s*\(/;
            const toKey = (e, idx) => {
              if (e.date && dateRe.test(e.date)) {
                const [, d, m, y] = e.date.match(dateRe);
                return new Date(`${y}-${m}-${d}`).getTime();
              }
              if (e.key && dateRe.test(e.key)) {
                const [, d, m, y] = e.key.match(dateRe);
                return new Date(`${y}-${m}-${d}`).getTime();
              }
              if (e.key && iterRe.test(e.key)) return parseInt(e.key.match(iterRe)[1], 10);
              return idx;
            };
            return hist.map((e,i)=>({e,k:toKey(e,i)})).sort((a,b)=>a.k-b.k).map(x=>x.e).reverse();
          })();

          const colorMap = {
            "oui": "bg-green-100 text-green-800",
            "plutot oui": "bg-green-50 text-green-700",
            "moyen": "bg-yellow-100 text-yellow-800",
            "plutot non": "bg-red-100 text-red-900",
            "non": "bg-red-200 text-red-900",
            "pas de reponse": "bg-gray-200 text-gray-700 italic"
          };

          const LIMIT = 10;
          ordered.forEach((entry, idx) => {
            const key = entry.date || entry.key || "";
            const val = entry.value;
            const normalized = normalize(val);
            const div = document.createElement("div");
            div.className = `mb-2 px-3 py-2 rounded ${colorMap[normalized] || "bg-gray-100 text-gray-700"}`;
            if (idx >= LIMIT) div.classList.add("hidden", "extra-history");
            div.innerHTML = `<strong>${key}</strong> – ${val}`;
            historyBlock.appendChild(div);
          });

          if (ordered.length > LIMIT) {
            const moreBtn = document.createElement("button");
            moreBtn.type = "button";
            moreBtn.className = "mt-2 text-xs text-blue-600 hover:underline";
            let expanded = false; const rest = ordered.length - LIMIT;
            const setLabel = () => moreBtn.textContent = expanded ? "Réduire" : `Afficher plus (${rest} de plus)`;
            setLabel();
            moreBtn.addEventListener("click", () => {
              expanded = !expanded;
              historyBlock.querySelectorAll(".extra-history").forEach(el => el.classList.toggle("hidden", !expanded));
              setLabel();
            });
            historyBlock.appendChild(moreBtn);
          }

          toggleBtn.addEventListener("click", () => {
            historyBlock.classList.toggle("hidden");
          });

          content.appendChild(toggleBtn);
          content.appendChild(historyBlock);
        }

        // toggle du volet de l'item
        seeBtn.addEventListener("click", () => {
          content.classList.toggle("hidden");
        });

        row.appendChild(head);
        row.appendChild(sub);
        row.appendChild(content);
        list.appendChild(row);
      });

      const note = document.createElement("p");
      note.className = "mt-2 text-xs text-gray-500";
      note.textContent = "Ces items sont masqués automatiquement suite à vos réponses positives. Ils réapparaîtront à l’échéance.";
      list.appendChild(note);

      details.appendChild(list);
      panel.appendChild(details);
      container.appendChild(panel);
    }
    showFormUI();
    console.log("✅ Rendu des questions terminé.");
  }
}
