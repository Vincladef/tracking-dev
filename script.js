// 📁 script.js - Finalisé pour un seul menu déroulant avec un séparateur visuel
// 🧠 Toutes les catégories de pratique intégrées au menu principal

// 🧑 Identifier l’utilisateur depuis l’URL
const urlParams = new URLSearchParams(location.search);
const user = urlParams.get("user")?.toLowerCase();

if (!user) {
  alert("❌ Aucun utilisateur indiqué !");
  console.error("Erreur: Utilisateur manquant dans l'URL.");
  throw new Error("Utilisateur manquant");
}

console.log(`✅ Utilisateur détecté : ${user}`);

// 🌐 Récupération automatique de l’apiUrl depuis le Google Sheet central
const CONFIG_URL = "https://script.google.com/macros/s/AKfycbyF2k4XNW6rqvME1WnPlpTFljgUJaX58x0jwQINd6XPyRVP3FkDOeEwtuierf_CcCI5hQ/exec";

let apiUrl = null;

fetch(`${CONFIG_URL}?user=${user}`)
  .then(res => res.json())
  .then(config => {
    console.log("Données de configuration reçues :", config);
    if (config.error) {
      alert(`❌ Erreur: ${config.error}`);
      console.error("Erreur de configuration:", config.error);
      throw new Error(config.error);
    }

    apiUrl = config.apiurl;
    console.log("✅ apiUrl récupérée :", apiUrl);

    if (!apiUrl) {
      alert("❌ Aucune URL WebApp trouvée pour l’utilisateur.");
      console.error("Erreur: apiUrl introuvable.");
      throw new Error("apiUrl introuvable");
    }

    initApp(apiUrl);
  })
  .catch(err => {
    alert("❌ Erreur lors du chargement de la configuration.");
    console.error("Erreur lors de la récupération de la configuration:", err);
  });

function initApp(apiUrl) {
  console.log("Début de l'initialisation de l'application.");
  document.getElementById("user-title").textContent =
    `📝 Formulaire du jour – ${user.charAt(0).toUpperCase() + user.slice(1)}`;

  const dateDisplay = document.getElementById("date-display");
  if (dateDisplay) dateDisplay.remove();

  const dateSelect = document.getElementById("date-select");
  dateSelect.classList.add("mb-4");

  // ✅ MISE À JOUR : Création du menu déroulant unique
  const pastDates = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return {
      value: d.toISOString().split("T")[0],
      label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    };
  });

  fetch(`${apiUrl}?mode=practice&categoriesOnly=true`)
    .then(res => res.json())
    .then(categories => {
      console.log("✅ Catégories de pratique reçues :", categories);

      // Ajouter un séparateur visuel
      pastDates.push({
        value: "__separator__",
        label: "────────── Pratique délibérée ──────────",
        disabled: true
      });

      // Ajouter chaque catégorie comme option dans le sélecteur principal
      categories.forEach(cat => {
        pastDates.push({
          value: `__practice__::${cat}`,
          label: `🧠 ${cat.charAt(0).toUpperCase() + cat.slice(1)}`
        });
      });

      // Ajouter les options dans le menu déroulant
      pastDates.forEach(opt => {
        const option = document.createElement("option");
        if (opt.disabled) option.disabled = true;
        option.value = opt.value;
        option.textContent = opt.label;
        dateSelect.appendChild(option);
      });

      // Charger par défaut la date du jour
      loadFormForDate(pastDates[0].value);
    });

  // ✅ MISE À JOUR : L'écouteur unique gère la sélection de date ou de catégorie
  dateSelect.addEventListener("change", () => {
    const value = dateSelect.value;
    console.log(`Changement de sélection : ${value}`);

    if (value.startsWith("__practice__::")) {
      const category = value.split("::")[1];
      loadFormForDate("__practice__", category);
    } else {
      loadFormForDate(value);
    }
  });

  document.getElementById("submitBtn").addEventListener("click", (e) => {
    e.preventDefault();
    console.log("Bouton d'envoi cliqué.");

    const form = document.getElementById("daily-form");
    const formData = new FormData(form);
    const entries = Object.fromEntries(formData.entries());
    const selectedValue = dateSelect.value;
    
    // ✅ CORRECTION APPORTÉE ICI
    if (selectedValue.startsWith("__practice__")) {
      entries._date = "__practice__"; 
      entries._category = selectedValue.split("::")[1];
    } else {
      entries._date = selectedValue;
    }
    // ---------------------------

    entries.apiUrl = apiUrl;

    console.log("Données à envoyer au backend:", entries);

    fetch("https://tight-snowflake-cdad.como-denizot.workers.dev/", {
      method: "POST",
      body: JSON.stringify(entries),
      headers: { "Content-Type": "application/json" }
    })
      .then(res => res.text())
      .then(txt => {
        alert("✅ Réponses envoyées !");
        console.log("Réponse du serveur:", txt);
      })
      .catch(err => {
        alert("❌ Erreur d’envoi");
        console.error("Erreur lors de l'envoi des données:", err);
      });
  });

  // La fonction accepte toujours un paramètre de catégorie, mais elle est appelée différemment
  function loadFormForDate(dateISO, practiceCategory = null) {
    console.log(`Chargement du formulaire pour ${dateISO} ${practiceCategory ? `(catégorie : ${practiceCategory})` : ""}`);
    document.getElementById("daily-form").innerHTML = "";
    document.getElementById("submit-section").classList.add("hidden");

    let url = "";
    if (dateISO === "__practice__") {
      url = `${apiUrl}?mode=practice`;
      if (practiceCategory) {
        url += `&cat=${encodeURIComponent(practiceCategory)}`;
      }
    } else {
      url = `${apiUrl}?date=${dateISO}`;
    }

    console.log("URL API construite :", url);

    fetch(url)
      .then(res => {
        console.log("Réponse reçue de l'API.");
        return res.json();
      })
      .then(questions => {
        console.log("Questions reçues du serveur:", questions);
        const container = document.getElementById("daily-form");

        const normalize = str =>
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

        questions.forEach(q => {
          console.log("Création de l'élément pour la question:", q.label, " (type:", q.type, ")");
          const wrapper = document.createElement("div");
          wrapper.className = "mb-8 p-4 rounded-lg shadow-sm";

          const label = document.createElement("label");
          label.className = "block text-lg font-semibold mb-2";
          label.textContent = q.skipped ? `🎉 ${q.label}` : q.label;
          wrapper.appendChild(label);

          const referenceAnswerEntry = q.history?.find(entry => {
            const [dd, mm, yyyy] = entry.date.split("/");
            const entryDateISO = `${yyyy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
            return entryDateISO === dateISO;
          });
          const referenceAnswer = referenceAnswerEntry?.value || "";

          if (q.skipped) {
            wrapper.classList.add("bg-green-50", "border", "border-green-200", "opacity-70");
            wrapper.querySelectorAll("input, select, textarea").forEach(el => el.disabled = true);

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
            const type = q.type.toLowerCase();

            if (type.includes("oui")) {
              input = document.createElement("div");
              input.className = "space-x-6 text-gray-700";
              input.innerHTML = `
                <label><input type="radio" name="${q.id}" value="Oui" class="mr-1" ${referenceAnswer === "Oui" ? "checked" : ""}>Oui</label>
                <label><input type="radio" name="${q.id}" value="Non" class="mr-1" ${referenceAnswer === "Non" ? "checked" : ""}>Non</label>
              `;
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
          }

          if (q.history && q.history.length > 0) {
            const toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.className = "mt-3 text-sm text-blue-600 hover:underline";
            toggleBtn.textContent = "📓 Voir l’historique des réponses";

            const historyBlock = document.createElement("div");
            historyBlock.className = "mt-3 p-3 rounded bg-gray-50 border text-sm text-gray-700 hidden";

            q.history.slice().reverse().forEach(entry => {
              const normalized = normalize(entry.value);
              const colorClass = colorMap[normalized] || "bg-gray-100 text-gray-700";

              const entryDiv = document.createElement("div");
              entryDiv.className = `mb-2 px-3 py-2 rounded ${colorClass}`;
              entryDiv.innerHTML = `<strong>${entry.date}</strong> – ${entry.value}`;
              historyBlock.appendChild(entryDiv);
            });

            toggleBtn.addEventListener("click", () => {
              console.log(`Bouton "Voir l'historique" cliqué pour la question: ${q.label}`);
              historyBlock.classList.toggle("hidden");
            });

            wrapper.appendChild(toggleBtn);
            wrapper.appendChild(historyBlock);
          }

          container.appendChild(wrapper);
        });

        document.getElementById("daily-form").classList.remove("hidden");
        document.getElementById("submit-section").classList.remove("hidden");
        const loader = document.getElementById("loader");
        if (loader) loader.remove();
        console.log("Formulaire chargé et affiché.");
      })
      .catch(err => {
        alert("❌ Erreur lors du chargement du formulaire.");
        console.error("Erreur lors de la récupération des questions:", err);
      });
  }
}