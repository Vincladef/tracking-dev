// 📁 script.js - Finalisé pour un seul menu déroulant avec un séparateur visuel
// 🧠 Toutes les catégories de pratique intégrées au menu principal

// 🧑 Identifier l’utilisateur depuis l’URL
const urlParams = new URLSearchParams(location.search);
const user = urlParams.get("user")?.toLowerCase();

console.log("-----------------------------------------");
console.log("🚀 Début du script.js");
console.log(`URL actuelle : ${location.href}`);
console.log("-----------------------------------------");

if (!user) {
  alert("❌ Aucun utilisateur indiqué !");
  console.error("Erreur: Utilisateur manquant dans l'URL.");
  throw new Error("Utilisateur manquant");
}

console.log(`✅ Utilisateur détecté dans l'URL : ${user}`);

// 🌐 Récupération automatique de l’apiUrl depuis le Google Sheet central
const CONFIG_URL = "https://script.google.com/macros/s/AKfycbyF2k4XNW6rqvME1WnPlpTFljgUJaX58x0jwQINd6XPyRVP3FkDOeEwtuierf_CcCI5hQ/exec";

let apiUrl = null;
console.log(`Fetching configuration depuis : ${CONFIG_URL}?user=${user}`);

fetch(`${CONFIG_URL}?user=${user}`)
  .then(res => {
    console.log("Réponse de la configuration reçue. Statut:", res.status);
    if (!res.ok) {
      throw new Error(`Erreur réseau : ${res.statusText}`);
    }
    return res.json();
  })
  .then(config => {
    console.log("✅ Données de configuration reçues :", config);
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
    console.error("Erreur critique lors de la récupération de la configuration:", err);
  });

function initApp(apiUrl) {
  console.log("-----------------------------------------");
  console.log("⚙️ Début de l'initialisation de l'application.");
  console.log("-----------------------------------------");

  document.getElementById("user-title").textContent =
    `📝 Formulaire du jour – ${user.charAt(0).toUpperCase() + user.slice(1)}`;

  const dateSelect = document.getElementById("date-select");
  dateSelect.classList.add("mb-4");

  // ✅ Création du menu déroulant unique
  console.log("Création des options de dates passées...");
  const pastDates = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const value = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    console.log(`- Date passée ajoutée : ${label} (${value})`);
    return { value, label };
  });

  console.log("Fetching des catégories de pratique...");
  fetch(`${apiUrl}?mode=practice&categoriesOnly=true`)
    .then(res => {
      console.log("Réponse des catégories reçue. Statut:", res.status);
      return res.json();
    })
    .then(categories => {
      console.log("✅ Catégories de pratique reçues :", categories);

      // Ajouter un séparateur visuel
      pastDates.push({
        value: "__separator__",
        label: "────────── Pratique délibérée ──────────",
        disabled: true
      });
      console.log("- Séparateur de pratique délibérée ajouté.");

      // Ajouter chaque catégorie comme option dans le sélecteur principal
      categories.forEach(cat => {
        const option = {
          value: `__practice__::${cat}`,
          label: `🧠 ${cat.charAt(0).toUpperCase() + cat.slice(1)}`
        };
        pastDates.push(option);
        console.log(`- Catégorie de pratique ajoutée : ${option.label} (${option.value})`);
      });

      // Ajouter les options dans le menu déroulant
      pastDates.forEach(opt => {
        const option = document.createElement("option");
        if (opt.disabled) option.disabled = true;
        option.value = opt.value;
        option.textContent = opt.label;
        dateSelect.appendChild(option);
      });
      console.log("Toutes les options ont été ajoutées au menu déroulant.");

      // Charger par défaut la date du jour
      console.log("Chargement initial du formulaire pour la date par défaut :", pastDates[0].value);
      loadFormForDate(pastDates[0].value);
    });

  // ✅ L'écouteur unique gère la sélection de date ou de catégorie
  dateSelect.addEventListener("change", () => {
    const value = dateSelect.value;
    console.log(`➡️ Changement de sélection détecté dans le menu déroulant : ${value}`);

    if (value.startsWith("__practice__::")) {
      const category = value.split("::")[1];
      console.log(`Mode "pratique délibérée" sélectionné. Catégorie: ${category}`);
      loadFormForDate("__practice__", category);
    } else {
      console.log(`Mode "quotidien" sélectionné. Date: ${value}`);
      loadFormForDate(value);
    }
  });

  document.getElementById("submitBtn").addEventListener("click", (e) => {
    e.preventDefault();
    console.log("-----------------------------------------");
    console.log("📤 Bouton d'envoi cliqué.");
    console.log("-----------------------------------------");

    const form = document.getElementById("daily-form");
    const formData = new FormData(form);
    const entries = Object.fromEntries(formData.entries());
    const selectedValue = dateSelect.value;

    console.log("Valeur sélectionnée dans le menu :", selectedValue);

    // ✅ CORRECTION APPORTÉE : Envoie la bonne clé pour le backend
    if (selectedValue.startsWith("__practice__")) {
      entries._date = "__practice__";
      entries._category = selectedValue.split("::")[1];
      console.log("Soumission en mode 'pratique délibérée' détectée.");
      console.log("Clé '_date' pour le backend définie sur '__practice__'.");
    } else {
      entries._date = selectedValue;
      console.log("Soumission en mode 'quotidien' détectée.");
      console.log("Clé '_date' pour le backend définie sur :", selectedValue);
    }

    entries.apiUrl = apiUrl;

    console.log("Données complètes à envoyer au backend:", entries);

    fetch("https://tight-snowflake-cdad.como-denizot.workers.dev/", {
      method: "POST",
      body: JSON.stringify(entries),
      headers: { "Content-Type": "application/json" }
    })
      .then(res => {
        console.log("Réponse du serveur reçue. Statut:", res.status);
        if (!res.ok) {
          throw new Error(`Erreur réseau : ${res.statusText}`);
        }
        return res.text();
      })
      .then(txt => {
        alert("✅ Réponses envoyées !");
        console.log("✅ Réponse du serveur:", txt);
      })
      .catch(err => {
        alert("❌ Erreur d’envoi");
        console.error("❌ Erreur lors de l'envoi des données:", err);
      });
  });

  function loadFormForDate(dateISO, practiceCategory = null) {
    console.log("-----------------------------------------");
    console.log(`🔄 Chargement du formulaire...`);
    console.log(`- Date sélectionnée (ISO) : ${dateISO}`);
    if (practiceCategory) {
      console.log(`- Catégorie de pratique : ${practiceCategory}`);
    }
    console.log("-----------------------------------------");

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

    console.log("URL de l'API construite pour le chargement:", url);

    fetch(url)
      .then(res => {
        console.log("Réponse de l'API pour les questions reçue. Statut:", res.status);
        if (!res.ok) {
          throw new Error(`Erreur réseau : ${res.statusText}`);
        }
        return res.json();
      })
      .then(questions => {
        console.log("✅ Questions reçues du serveur:", questions);
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
        
        if (questions.length === 0) {
          container.innerHTML = `<p class="text-gray-500 text-center py-8">Aucune question à afficher pour cette sélection.</p>`;
          console.log("Aucune question reçue, affichage d'un message d'information.");
        }

        questions.forEach(q => {
          console.log(`- Traitement de la question : "${q.label}" (ID: ${q.id}, Type: ${q.type}, Skipped: ${q.skipped})`);
          const wrapper = document.createElement("div");
          wrapper.className = "mb-8 p-4 rounded-lg shadow-sm";

          const label = document.createElement("label");
          label.className = "block text-lg font-semibold mb-2";
          label.textContent = q.skipped ? `🎉 ${q.label}` : q.label;
          wrapper.appendChild(label);

          // ✅ CORRECTION APPORTÉE : Sécurisation de la recherche d'entrée
          const referenceAnswerEntry = q.history?.find(entry => {
            if (!entry.date || !entry.value) return false;
            const [dd, mm, yyyy] = entry.date.split("/");
            if (!dd || !mm || !yyyy) return false;
            const entryDateISO = `${yyyy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
            return entryDateISO === dateISO;
          });
          const referenceAnswer = referenceAnswerEntry?.value || "";
          
          if (q.skipped) {
            console.log(`-- Question "${q.label}" est sautée.`);
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
            console.log(`-- Création du champ de saisie pour la question de type : "${type}"`);
            
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
            console.log(`-- Historique trouvé pour la question. Nombre d'entrées : ${q.history.length}`);
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
              console.log(`Bouton "Voir l'historique" cliqué pour la question: ${q.label}. Bascule de visibilité.`);
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
        console.log("✅ Formulaire chargé et affiché avec succès.");
      })
      .catch(err => {
        alert("❌ Erreur lors du chargement du formulaire.");
        console.error("❌ Erreur critique lors de la récupération des questions:", err);
      });
  }
}