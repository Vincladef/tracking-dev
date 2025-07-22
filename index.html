// 🔽 Met à jour dynamiquement la date affichée dans la page
const today = new Date();
const options = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
const formattedDate = today.toLocaleDateString("fr-FR", options);
document.getElementById("date-display").textContent = `📅 ${formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)}`;

// 🔗 Lien vers ton backend
const apiUrl = "https://tight-snowflake-cdad.como-denizot.workers.dev";

// 🔽 Partie 1 – Charger les questions depuis Google Sheets
fetch(apiUrl)
  .then(res => res.json())
  .then(questions => {
    const container = document.getElementById("daily-form");

    questions.forEach(q => {
      const wrapper = document.createElement("div");
      wrapper.className = "mb-8 p-4 bg-gray-50 rounded-lg shadow-sm";

      const label = document.createElement("label");
      label.className = "block text-lg font-semibold mb-2 text-gray-800";
      label.textContent = q.label;
      wrapper.appendChild(label);

      // 🔁 Historique formaté
      if (q.history && q.history.length > 0) {
        const historyBlock = document.createElement("div");
        historyBlock.className = "text-sm mb-3";

        const historyList = document.createElement("ul");
        historyList.className = "space-y-1";

        const valenceColors = {
          "oui": "text-green-700 font-semibold",
          "plutôt oui": "text-green-600",
          "moyen": "text-yellow-600",
          "plutôt non": "text-orange-600",
          "non": "text-red-600",
          "pas de réponse": "text-gray-500 italic"
        };

        q.history.forEach(entry => {
          const li = document.createElement("li");
          const answer = (entry.value || "").toLowerCase().trim();
          const color = valenceColors[answer] || "text-gray-700";

          li.innerHTML = `<span class="text-gray-400 mr-2">📅 ${entry.date}</span> 
                          <span class="${color}">${entry.value}</span>`;
          historyList.appendChild(li);
        });

        historyBlock.appendChild(historyList);
        wrapper.appendChild(historyBlock);
      }

      // 🧩 Input selon type
      let input;

      if (q.type.toLowerCase().includes("oui")) {
        input = document.createElement("div");
        input.className = "space-x-6 text-gray-700";
        input.innerHTML = `
          <label><input type="radio" name="${q.id}" value="Oui" class="mr-1">Oui</label>
          <label><input type="radio" name="${q.id}" value="Non" class="mr-1">Non</label>
        `;
        wrapper.appendChild(input);

      } else if (q.type.toLowerCase().includes("menu") || q.type.toLowerCase().includes("likert")) {
        input = document.createElement("select");
        input.name = q.id;
        input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
        ["", "Oui", "Plutôt oui", "Moyen", "Plutôt non", "Non", "Pas de réponse"].forEach(opt => {
          const option = document.createElement("option");
          option.value = opt;
          option.textContent = opt;
          input.appendChild(option);
        });
        wrapper.appendChild(input);

      } else if (q.type.toLowerCase().includes("plus long")) {
        input = document.createElement("textarea");
        input.name = q.id;
        input.rows = 4;
        input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
        wrapper.appendChild(input);

        if (q.history && q.history.length > 0) {
          const datalist = document.createElement("datalist");
          datalist.id = `hist-${q.id}`;
          datalist.innerHTML = q.history.map(val => `<option value="${val.value}">`).join("");
          document.body.appendChild(datalist);
          input.setAttribute("list", `hist-${q.id}`);
        }

      } else {
        input = document.createElement("input");
        input.name = q.id;
        input.type = "text";
        input.className = "mt-1 p-2 border rounded w-full text-gray-800 bg-white";
        wrapper.appendChild(input);

        if (q.history && q.history.length > 0) {
          const datalist = document.createElement("datalist");
          datalist.id = `hist-${q.id}`;
          datalist.innerHTML = q.history.map(val => `<option value="${val.value}">`).join("");
          document.body.appendChild(datalist);
          input.setAttribute("list", `hist-${q.id}`);
        }
      }

      container.appendChild(wrapper);
    });

    // ✅ Affichage
    document.getElementById("daily-form").classList.remove("hidden");
    document.getElementById("submit-section").classList.remove("hidden");
    const loader = document.getElementById("loader");
    if (loader) loader.remove();
  });

// 🔽 Partie 2 – Envoyer les réponses vers Google Sheets
document.getElementById("submitBtn").addEventListener("click", (e) => {
  e.preventDefault();

  const form = document.getElementById("daily-form");
  const formData = new FormData(form);
  const entries = Object.fromEntries(formData.entries());

  fetch(apiUrl, {
    method: "POST",
    body: JSON.stringify(entries),
    headers: {
      "Content-Type": "application/json"
    }
  })
    .then(res => res.text())
    .then(txt => {
      alert("✅ Réponses envoyées !");
    })
    .catch(err => {
      alert("❌ Erreur d’envoi");
      console.error(err);
    });
});
