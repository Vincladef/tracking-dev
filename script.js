// 🧑 Identifier l’utilisateur et l'ID de déploiement du script WebApp depuis l’URL
const urlParams = new URLSearchParams(location.search);
const user = urlParams.get("user")?.toLowerCase();
const configScriptId = urlParams.get("id"); // Renommé pour plus de clarté

if (!user || !configScriptId) {
  alert("❌ Utilisateur ou ID de script manquant dans l'URL !");
  throw new Error("Utilisateur ou ID de script manquant");
}

// 🌐 Récupération automatique de l’apiUrl depuis le Google Script
const CONFIG_URL = `https://script.google.com/macros/s/${configScriptId}/exec`;

let apiUrl = null;

fetch(`${CONFIG_URL}?user=${encodeURIComponent(user)}`)
  .then(res => res.json())
  .then(config => {
    if (config.error) {
      alert(`❌ Erreur: ${config.error}`);
      throw new Error(config.error);
    }

    apiUrl = config.apiurl;
    console.log("✅ API URL récupérée :", apiUrl);

    if (!apiUrl) {
      alert("❌ Aucune URL WebApp trouvée pour l’utilisateur.");
      throw new Error("API URL introuvable");
    }

    initApp();
  })
  .catch(err => {
    alert("❌ Erreur lors du chargement de la configuration.");
    console.error("Erreur attrapée :", err);
  });

async function initApp() {
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
        // Séparateur visuel
        const sep = document.createElement("option");
        sep.disabled = true; sep.textContent = "────────";
        sel.appendChild(sep);

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
  document.getElementById("submitBtn").addEventListener("click", async (e) => {
    e.preventDefault();

    const btn = document.getElementById("submitBtn");
    btn.disabled = true;

    const form = document.getElementById("daily-form");
    const formData = new FormData(form);
    const entries = Object.fromEntries(formData.entries());

    const selected = dateSelect.selectedOptions[0];
    const mode = selected?.dataset.mode || "daily";

    if (mode === "daily") {
      entries._mode = "daily";
      entries._date = selected.dataset.date; // YYYY-MM-DD
    } else {
      entries._mode = "practice";
      entries._category = selected.dataset.category; // nom exact
    }
    
    // Ajoutez l'URL de l'API ici avant l'envoi
    entries.apiUrl = apiUrl;

    console.log("📦 Envoi des données au Worker...", entries);

    try {
      await fetch("https://tight-snowflake-cdad.como-denizot.workers.dev/", {
        method: "POST",
        body: JSON.stringify(entries),
        headers: { "Content-Type": "application/json" }
      });
      alert("✅ Réponses envoyées !");
      console.log("✅ Réponses envoyées avec succès.");

      // Recharger le formulaire après l'envoi
      if (selected?.dataset.mode === "daily") {
        loadFormForDate(selected.dataset.date);
      } else {
        loadPracticeForm(selected.dataset.category);
      }
    } catch (err) {
      alert("❌ Erreur d’envoi");
      console.error("❌ Erreur lors de l’envoi des données :", err);
    } finally {
      btn.disabled = false;
    }
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
        alert("❌ Erreur de chargement du formulaire journalier.");
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
      alert("❌ Erreur lors du chargement du formulaire de pratique.");
    }
  }

  // Mini chart Likert dans l'historique
  function renderLikertChart(parentEl, history, normalize) {
    const MAX_POINTS = 30;
    const levels = ["non", "plutot non", "moyen", "plutot oui", "oui"];
    const labelByNorm = {
      "non": "Non", "plutot non": "Plutôt non", "moyen": "Moyen",
      "plutot oui": "Plutôt oui", "oui": "Oui"
    };

    // Nouveau : On prépare l'historique une seule fois
    const windowHist = (history || [])
      .slice(0, MAX_POINTS)
      .reverse(); // ancien -> récent

    const points = windowHist
      .map(e => {
        const v = normalize(e.value);
        const idx = levels.indexOf(v);
        return idx === -1 ? null : { v, idx };
      })
      .filter(Boolean);

    if (points.length < 2) return;

    // Canvas retina friendly
    const dpr = window.devicePixelRatio || 1;
    const cssW = 560, cssH = 140;
    const pad = { l: 70, r: 8, t: 10, b: 24 };
    const w = cssW - pad.l - pad.r;
    const h = cssH - pad.t - pad.b;

    const canvas = document.createElement("canvas");
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
    canvas.className = "w-full block mb-3 rounded";
    parentEl.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // fond
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    // grille horizontale + labels Likert
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial";
    ctx.fillStyle = "#374151";

    for (let i = 0; i < levels.length; i++) {
      const y = pad.t + (h / (levels.length - 1)) * (levels.length - 1 - i);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();

      const lab = labelByNorm[levels[i]] || levels[i];
      ctx.fillText(lab, 8, y + 4);
    }

    // grille verticale (ticks x)
    const n = points.length;
    const step = n > 1 ? w / (n - 1) : w;
    const xTickEvery = Math.max(1, Math.floor(n / 6));
    ctx.strokeStyle = "#f3f4f6";
    for (let i = 0; i < n; i += xTickEvery) {
      const x = pad.l + i * step;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + h);
      ctx.stroke();
    }

    // labels de dates sous l'axe X
    ctx.font = "10px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial";
    ctx.fillStyle = "#6b7280";
    for (let i = 0; i < n; i += xTickEvery) {
      const x = pad.l + i * step;
      const raw = windowHist[i]?.date || windowHist[i]?.key || "";
      // Nouvelle logique pour extraire la date
      const m = raw.match(/\((\d{2}\/\d{2}\/\d{4})\)/) || raw.match(/^(\d{2}\/\d{2}\/\d{4})$/);
      const label = m ? m[1].slice(0, 5) : (raw ? `N=${raw}` : "");
      if (label) ctx.fillText(label, x - 16, pad.t + h + 14);
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
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // axe x (nominal)
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + h);
    ctx.lineTo(pad.l + w, pad.t + h);
    ctx.stroke();
  }

  // Renderer commun (journalier & pratique)
  function renderQuestions(questions) {
    const container = document.getElementById("daily-form");
    container.innerHTML = "";
    console.log(`✍️ Rendu de ${questions.length} question(s)`);

    // Sécurité : S'assurer que q.history est toujours un tableau
    questions.forEach(q => {
      if (!Array.isArray(q.history)) q.history = [];
    });

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
      "plutot non": "bg-red-100 text-red-700",
      "non": "bg-red-200 text-red-900",
      "pas de reponse": "bg-gray-200 text-gray-700 italic"
    };

    const DELAYS = [0, 1, 2, 3, 5, 8, 13];

    (questions || []).forEach(q => {
      // Log détaillé pour chaque question
      console.groupCollapsed(`[Question] Traitement de "${q.label}"`);

      const selectedMode = document.getElementById("date-select")
        .selectedOptions[0]?.dataset.mode || "daily";

      console.log("-> Type de question :", q.type);
      console.log("-> Est Répétition Espacée :", q.isSpaced);

      if (q.isSpaced && q.spacedInfo) {
        if (selectedMode === "practice") {
          const s = q.spacedInfo.streak ?? 0;
          const delay = q.spacedInfo.delayIter ?? 0;
          console.log("-> Streak positif (itérations d'affilée):", s);
          console.log(`-> Délai avant réapparition: ${delay} itération(s)`);
        } else {
          const delay = DELAYS[q.spacedInfo.score] ?? "?";
          console.log("-> Score de Répétition :", q.spacedInfo.score);
          console.log(`-> Prochain délai : ${delay} jour(s)`);
          console.log("-> Dernière réponse :", q.spacedInfo.lastDate ?? "—");
          console.log("-> Prochaine date due :", q.spacedInfo.nextDate ?? "—");
        }
      }

      console.log("-> Est-elle affichée ? :", !q.skipped);
      if (q.skipped) {
        console.log("-> Raison du masquage :", q.reason);
      }
      console.groupEnd();

      const wrapper = document.createElement("div");
      wrapper.className = "mb-8 p-4 rounded-lg shadow-sm";

      const label = document.createElement("label");
      label.className = "block text-lg font-semibold mb-2";
      label.textContent = q.skipped ? `🎉 ${q.label}` : q.label;
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

      if (q.skipped) {
        wrapper.classList.add("bg-green-50", "border", "border-green-200", "opacity-70");

        const reason = document.createElement("p");
        reason.className = "text-sm italic text-green-700 mb-2";
        reason.textContent = q.reason || "⏳ Cette question est temporairement masquée.";
        wrapper.appendChild(reason);

        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = q.id;
        hidden.value = "";
        wrapper.appendChild(hidden);
      } else {
        let input;
        const type = (q.type || "").toLowerCase();

        // Ajout de la priorité pour les menus Likert
        if (type.includes("menu") || type.includes("likert")) {
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
        } else if (type.includes("oui")) {
          input = document.createElement("div");
          input.className = "space-x-6 text-gray-700";
          input.innerHTML = `<label><input type="radio" name="${q.id}" value="Oui" class="mr-1" ${referenceAnswer === "Oui" ? "checked" : ""}>Oui</label>
             <label><input type="radio" name="${q.id}" value="Non" class="mr-1" ${referenceAnswer === "Non" ? "checked" : ""}>Non</label>`;
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
      }

      // 📓 Historique (compatible daily et practice)
      if (q.history && q.history.length > 0) {
        console.log(`📖 Affichage de l'historique pour "${q.label}" (${q.history.length} entrées)`);
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "mt-3 text-sm text-blue-600 hover:underline";
        toggleBtn.textContent = "📓 Voir l’historique des réponses";

        const historyBlock = document.createElement("div");
        // Ajout de la classe overflow-x-auto pour le défilement horizontal
        historyBlock.className = "mt-3 p-3 rounded bg-gray-50 border text-sm text-gray-700 hidden overflow-x-auto";

        // Graphe Likert + 2 stats compactes (sur 30 dernières)
        renderLikertChart(historyBlock, q.history, normalize);

        const LIMIT = 10;
        const WINDOW = 30;
        const badge = (title, value, tone="blue") => {
          const div = document.createElement("div");
          const tones = {
            blue:"bg-blue-50 text-blue-700 border-blue-200",
            green:"bg-green-50 text-green-700 border-green-200",
            yellow:"bg-yellow-50 text-yellow-700 border-yellow-200",
            red:"bg-red-50 text-red-700 border-red-200",
            gray:"bg-gray-50 text-gray-700 border-gray-200",
            purple:"bg-purple-50 text-purple-700 border-purple-200"
          };
          div.className = `px-2.5 py-1 rounded-full border text-xs font-medium ${tones[tone]||tones.gray}`;
          div.innerHTML = `<span class="opacity-70">${title}:</span> <span class="font-semibold">${value}</span>`;
          return div;
        };
        const POSITIVE = new Set(["oui","plutot oui"]);
        const windowHist = (q.history || []).slice(0, WINDOW);

        let currentStreak = 0;
        for (const e of windowHist) {
          if (POSITIVE.has(normalize(e.value))) currentStreak++;
          else break;
        }

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

        // Liste (10 visibles) + bouton Afficher plus / Réduire
        (q.history || []).forEach((entry, idx) => {
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

        if (q.history && q.history.length > LIMIT) {
          const moreBtn = document.createElement("button");
          moreBtn.type = "button";
          moreBtn.className = "mt-2 text-xs text-blue-600 hover:underline";
          let expanded = false; const rest = q.history.length - LIMIT;
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

    showFormUI();
    console.log("✅ Rendu des questions terminé.");
  }
}
