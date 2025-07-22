// 🔽 Met à jour dynamiquement la date affichée dans la page
const today = new Date();
const options = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
const formattedDate = today.toLocaleDateString("fr-FR", options);
document.querySelector("p.text-gray-600").textContent = `📅 ${formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)}`;

// 🔗 Lien vers ton backend
const apiUrl = "https://tight-snowflake-cdad.como-denizot.workers.dev";

// 🔽 Partie 1 – Charger les questions depuis Google Sheets
fetch(apiUrl)
  .then(res => res.json())
  .then(questions => {
    console.log("✅ Questions reçues :", questions);
    const container = document.getElementById("daily-form");

    questions.forEach(q => {
      const wrapper = document.createElement("div");
      wrapper.className = "mb-6";

      // 🏷️ Affiche le label de la question
      const label = document.createElement("label");
      label.className = "block font-medium mb-1";
      label.textContent = q.label;
      wrapper.appendChild(label);

      // 🔁 Ajout de l’historique
      if (q.history && q.history.length > 0) {
        const historyBlock = document.createElement("div");
        historyBlock.className = "text-sm text-gray-500 mb-2";

        if (["plus long", "texte"].some(t => q.type.toLowerCase().includes(t))) {
          historyBlock.innerHTML = `<span class="block mb-1">Réponses précédentes :</span>`;
          wrapper.appendChild(historyBlock);
        } else {
          historyBlock.innerHTML = `<span class="block mb-1">Dernières réponses : ${q.history.join(" → ")}</span>`;
          wrapper.appendChild(historyBlock);
        }
      }

      // 🧩 Crée l'input selon le type
      let input;

      if (q.type.toLowerCase().includes("oui")) {
        input = document.createElement("div");
        input.innerHTML = `
          <label class="mr-4"><input type="radio" name="${q.id}" value="Oui"> Oui</label>
          <label><input type="radio" name="${q.id}" value="Non"> Non</label>
        `;
        wrapper.appendChild(input);

      } else if (q.type.toLowerCase().includes("menu") || q.type.toLowerCase().includes("likert")) {
        input = document.createElement("select");
        input.name = q.id;
        input.className = "mt-1 p-2 border rounded w-full";
        ["", "Oui", "Plutôt oui", "Moyen", "Plutôt non", "Non", "Pas de réponse"].forEach(opt => {
          const option = document.createElement("option");
          option.value = opt;
          option.textContent = opt;
          input.appendChild(option);
        });
        wrapper.appendChild(input);

        // Ajout affichage historique
        if (q.history && q.history.length > 0) {
          const historyBlock = document.createElement("div");
          historyBlock.className = "text-sm text-gray-500 mt-1";
          historyBlock.textContent = "Dernières réponses : " + q.history.join(" → ");
          wrapper.appendChild(historyBlock);
        }

      } else if (q.type.toLowerCase().includes("plus long")) {
        input = document.createElement("textarea");
        input.name = q.id;
        input.className = "mt-1 p-2 border rounded w-full";
        input.rows = 4;
        wrapper.appendChild(input);

        if (q.history && q.history.length > 0) {
          const datalist = document.createElement("datalist");
          datalist.id = `hist-${q.id}`;
          datalist.innerHTML = q.history.map(val => `<option value="${val}">`).join("");
          document.body.appendChild(datalist); // attaché au body
          input.setAttribute("list", `hist-${q.id}`);
        }

      } else {
        input = document.createElement("input");
        input.name = q.id;
        input.type = "text";
        input.className = "mt-1 p-2 border rounded w-full";
        wrapper.appendChild(input);

        if (q.history && q.history.length > 0) {
          const datalist = document.createElement("datalist");
          datalist.id = `hist-${q.id}`;
          datalist.innerHTML = q.history.map(val => `<option value="${val}">`).join("");
          document.body.appendChild(datalist);
          input.setAttribute("list", `hist-${q.id}`);
        }
      }

      container.appendChild(wrapper);
    });
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
