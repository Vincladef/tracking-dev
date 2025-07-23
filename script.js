// 🧑 Identifier l’utilisateur depuis l’URL
const urlParams = new URLSearchParams(location.search);
const user = urlParams.get("user")?.toLowerCase();

const urls = {
  modele: "https://script.google.com/macros/s/AKfycbx4CidfcjtIRV114PdCOUEUCuY1KKi9z8XwNfK26fvU56vNk-15uvAjdFip8iv2RkWOTg/exec",
  bob: "https://script.google.com/macros/s/AKfycbysHbRAFRlJBkY09oo6RnGsBnhNGsGSYVGiL4A7EFx1ip1FF0b7vwWqQJgCSdQPL0J8rw/exec",
  jeremy: "https://script.google.com/macros/s/URL_DE_LA_WEBAPP_JEREMY/exec",
  julien: "https://script.google.com/macros/s/URL_DE_LA_WEBAPP_JULIEN/exec",
  vincent: "https://script.google.com/macros/s/URL_DE_LA_WEBAPP_VINCENT/exec",
};

if (!user || !urls[user]) {
  alert("❌ Utilisateur inconnu ou non configuré !");
  throw new Error("Utilisateur inconnu");
}

const apiUrl = urls[user];

// 🎨 Met à jour le titre
document.getElementById("user-title").textContent =
  `📝 Formulaire du jour – ${user.charAt(0).toUpperCase() + user.slice(1)}`;

// 🗓️ Affiche la date du jour
const today = new Date();
const options = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
const formattedDate = today.toLocaleDateString("fr-FR", options);
document.getElementById("date-display").textContent =
  `📅 ${formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)}`;

// 🧭 Génère les 7 derniers jours
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

// 🧾 Charge les questions pour une date donnée
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
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[\u00A0\u202F\u200B]/g, " ")
          .replace(/\s+/g, " ")
          .toLowerCase()
          .trim();

      const valenceColors = {
        "oui": "text-green-700 font-semibold",
        "plutot oui": "text-green-600",
        "moyen": "text-yellow-600",
        "plutot non": "text-red-400",
        "non": "text-red-600 font-semibold",
        "pas de reponse": "text-gray-500 italic"
      };

      questions.forEach(q => {
        const wrapper = document.createElement("div");
        wrapper.className = "mb-8 p-4 rounded-lg shadow-sm";

        const label = document.createElement("label");
        label.className = "block text-lg font-semibold mb-2";
        label.textContent = q.skipped ? `🎉 ${q.label}` : q.label;
        wrapper.appendChild(label);

        if (q.skipped) {
          wrapper.classList.add("bg-green-50", "border", "border-green-200", "opacity-70");

          const reason = document.createElement("p");
          reason.className = "text-sm italic text-green-700 mb-2";
          reason.textContent = q.reason || "✔️ Question temporairement masquée.";
          wrapper.appendChild(reason);
        } else {
          let input;
          const type = q.type.toLowerCase();

          if (type.includes("oui")) {
            input = document.createElement("div");
            input.className = "space-x-6 text-gray-700";
            input.innerHTML = `
              <label><input type="radio" name="${q.id}" value="Oui" class="mr-1">Oui</label>
              <label><input type="radio" name="${q.id}" value="Non" class="mr-1">Non</label>
            `;
          } else if (type.includes("menu") || type.includes("likert")) {
            input = document.createElement("select");
            input.name = q.id;
            input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
            ["", "Oui", "Plutôt oui", "Moyen", "Plutôt non", "Non", "Pas de réponse"].forEach(opt => {
              const option = document.createElement("option");
              option.value = opt;
              option.textContent = opt;
              input.appendChild(option);
            });
          } else if (type.includes("plus long")) {
            input = document.createElement("textarea");
            input.name = q.id;
            input.rows = 4;
            input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
          } else {
            input = document.createElement("input");
            input.name = q.id;
            input.type = "text";
            input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
          }

          // Ajout historique en autocomplete si applicable
          if (q.history && q.history.length > 0 && (input.tagName === "TEXTAREA" || input.tagName === "INPUT")) {
            const datalist = document.createElement("datalist");
            datalist.id = `hist-${q.id}`;
            datalist.innerHTML = q.history.map(val => `<option value="${val.value}">`).join("");
            document.body.appendChild(datalist);
            input.setAttribute("list", `hist-${q.id}`);
          }

          wrapper.appendChild(input);
        }

        // 🔁 Historique
        if (q.history && q.history.length > 0) {
          const historyBlock = document.createElement("div");
          historyBlock.className = "text-sm mt-3";
          const historyList = document.createElement("ul");
          historyList.className = "space-y-1";

          q.history.forEach(entry => {
            const li = document.createElement("li");
            const color = valenceColors[normalize(entry.value)] || "text-gray-700";

            const dateSpan = document.createElement("span");
            dateSpan.className = "text-gray-400 mr-2";
            dateSpan.textContent = `📅 ${entry.date}`;

            const valueSpan = document.createElement("span");
            valueSpan.className = color;
            valueSpan.textContent = entry.value;

            li.appendChild(dateSpan);
            li.appendChild(valueSpan);
            historyList.appendChild(li);
          });

          historyBlock.appendChild(historyList);
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

// 🌀 Premier chargement = aujourd’hui
loadFormForDate(pastDates[0].value);

// 🔁 Mise à jour quand on change la date
dateSelect.addEventListener("change", () => {
  loadFormForDate(dateSelect.value);
});

// ✅ Envoi des réponses
document.getElementById("submitBtn").addEventListener("click", (e) => {
  e.preventDefault();

  const form = document.getElementById("daily-form");
  const formData = new FormData(form);
  const entries = Object.fromEntries(formData.entries());

  entries._date = dateSelect.value;

  fetch(apiUrl, {
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
