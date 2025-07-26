// 🧑 Identifier l’utilisateur depuis l’URL
const urlParams = new URLSearchParams(location.search);
const user = urlParams.get("user")?.toLowerCase();

if (!user) {
  alert("❌ Aucun utilisateur indiqué !");
  throw new Error("Utilisateur manquant");
}

// 🌐 Récupération automatique de l’apiUrl depuis le Google Sheet central
const CONFIG_URL = "https://script.google.com/macros/s/AKfycbyF2k4XNW6rqvME1WnPlpTFljgUJaX58x0jwQINd6XPyRVP3FkDOeEwtuierf_CcCI5hQ/exec";

let apiUrl = null;

fetch(`${CONFIG_URL}?user=${user}`)
  .then(res => res.json())
  .then(config => {
    if (config.error) {
      alert(`❌ Erreur: ${config.error}`);
      throw new Error(config.error);
    }

    apiUrl = config.apiurl;
    console.log("✅ apiUrl récupérée :", apiUrl);

    if (!apiUrl) {
      alert("❌ Aucune URL WebApp trouvée pour l’utilisateur.");
      throw new Error("apiUrl introuvable");
    }

    initApp(apiUrl);
  })
  .catch(err => {
    alert("❌ Erreur lors du chargement de la configuration.");
    console.error("Erreur attrapée :", err);
  });

function initApp(apiUrl) {
  document.getElementById("user-title").textContent =
    `📋 Formulaire du jour – ${user.charAt(0).toUpperCase() + user.slice(1)}`;

  const today = new Date();
  const options = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  // Supprimé car doublon avec le select
  // document.getElementById("date-display").textContent =
  //   `🗓️ ${today.toLocaleDateString("fr-FR", options)}`;

  const dateSelect = document.getElementById("date-select");
  const pastDates = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return {
      value: d.toISOString().split("T")[0],
      label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    };
  });

  pastDates.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label.charAt(0).toUpperCase() + opt.label.slice(1);
    dateSelect.appendChild(option);
  });

  loadFormForDate(pastDates[0].value);

  dateSelect.addEventListener("change", () => {
    loadFormForDate(dateSelect.value);
  });

  document.getElementById("submitBtn").addEventListener("click", (e) => {
    e.preventDefault();

    const form = document.getElementById("daily-form");
    const formData = new FormData(form);
    const entries = Object.fromEntries(formData.entries());
    entries._date = dateSelect.value;

    entries.apiUrl = apiUrl;

    fetch("https://tight-snowflake-cdad.como-denizot.workers.dev/", {
      method: "POST",
      body: JSON.stringify(entries),
      headers: { "Content-Type": "application/json" }
    })
      .then(res => res.text())
      .then(txt => alert("✅ Réponses envoyées !"))
      .catch(err => {
        alert("❌ Erreur d’envoi");
        console.error(err);
      });
  });

  function loadFormForDate(dateISO) {
    document.getElementById("daily-form").innerHTML = "";
    document.getElementById("submit-section").classList.add("hidden");

    fetch(`${apiUrl}?date=${dateISO}`)
      .then(res => res.json())
      .then(questions => {
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
          const wrapper = document.createElement("div");
          wrapper.className = "mb-8 p-4 rounded-lg shadow-sm";

          const label = document.createElement("label");
          label.className = "block text-lg font-semibold mb-2";
          label.textContent = q.skipped ? `🎉 ${q.label}` : q.label;
          wrapper.appendChild(label);

          if (q.skipped) {
            wrapper.classList.add("bg-green-50", "border", "border-green-200", "opacity-70", "pointer-events-none");

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

            const currentValue = q.history?.find(h => h.date === dateISO.split("-").reverse().join("/"))?.value || "";

            if (type.includes("oui")) {
              input = document.createElement("div");
              input.className = "space-x-6 text-gray-700";
              input.innerHTML = `
                <label><input type="radio" name="${q.id}" value="Oui" class="mr-1" ${currentValue === "Oui" ? "checked" : ""}>Oui</label>
                <label><input type="radio" name="${q.id}" value="Non" class="mr-1" ${currentValue === "Non" ? "checked" : ""}>Non</label>
              `;
            } else if (type.includes("menu") || type.includes("likert")) {
              input = document.createElement("select");
              input.name = q.id;
              input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
              ["", "Oui", "Plutôt oui", "Moyen", "Plutôt non", "Non", "Pas de réponse"].forEach(opt => {
                const option = document.createElement("option");
                option.value = opt;
                option.textContent = opt;
                if (opt === currentValue) option.selected = true;
                input.appendChild(option);
              });
            } else if (type.includes("plus long")) {
              input = document.createElement("textarea");
              input.name = q.id;
              input.rows = 4;
              input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
              input.value = currentValue;
            } else {
              input = document.createElement("input");
              input.name = q.id;
              input.type = "text";
              input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
              input.value = currentValue;
            }

            wrapper.appendChild(input);
          }

          if (q.history && q.history.length > 0) {
            const historyBlock = document.createElement("div");
            historyBlock.className = "mt-6";

            const title = document.createElement("div");
            title.className = "text-gray-500 mb-1 font-medium";
            title.textContent = "📓 Historique récent";
            historyBlock.appendChild(title);

            const todayEntry = q.history.find(h => h.date === dateISO.split("-").reverse().join("/"));
            const currentText = todayEntry ? `Réponse actuelle : ${todayEntry.value}` : "Pas encore répondu aujourd'hui";
            const current = document.createElement("div");
            current.className = "text-sm italic text-gray-600 mb-2";
            current.textContent = currentText;
            historyBlock.appendChild(current);

            const timelineWrapper = document.createElement("div");
            timelineWrapper.className = "overflow-x-auto";

            const timeline = document.createElement("div");
            timeline.className = "flex gap-2 w-max";

            q.history.reverse().forEach(entry => {
              const normalized = normalize(entry.value);
              const colorClass = colorMap[normalized] || "bg-gray-100 text-gray-700";

              const parts = entry.date.split("/");
              const shortDate = `${parts[0]}/${parts[1]}/${parts[2].slice(-2)}`;

              const block = document.createElement("div");
              block.className = `px-3 py-1 rounded-xl text-sm font-medium whitespace-nowrap ${colorClass}`;
              block.textContent = `${shortDate} – ${entry.value}`;

              timeline.appendChild(block);
            });

            timelineWrapper.appendChild(timeline);
            historyBlock.appendChild(timelineWrapper);
            wrapper.appendChild(historyBlock);
          }

          container.appendChild(wrapper);
        });

        document.getElementById("daily-form").classList.remove("hidden");
        document.getElementById("submit-section").classList.remove("hidden");
        const loader = document.getElementById("loader");
        if (loader) loader.remove();
      });
  }
}
