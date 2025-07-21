// 🔗 Mets ici le lien de ton Apps Script déployé
const apiUrl = "https://script.google.com/macros/s/AKfycbymCSR4qb7r8f4gbXtOY_A3YpIDKFgBF-_kb8m4KzQO4DW84YJzKvm7E4BILRVbuyanYQ/exec";

// 🔽 Partie 1 – Charger les questions depuis Google Sheets
fetch(apiUrl)
  .then(res => res.json())
  .then(questions => {
    const container = document.getElementById("daily-form");

    questions.forEach(q => {
      const wrapper = document.createElement("div");
      wrapper.className = "mb-6";

      const label = document.createElement("label");
      label.className = "block font-medium mb-1";
      label.textContent = q.label;
      wrapper.appendChild(label);

      const input = document.createElement("input");
      input.name = q.id;
      input.type = "text";
      input.className = "mt-1 p-2 border rounded w-full";
      wrapper.appendChild(input);

      container.appendChild(wrapper);
    });
  });

// 🔽 Partie 2 – Envoyer les réponses vers Google Sheets
document.getElementById("submitBtn").addEventListener("click", (e) => {
  e.preventDefault(); // pour ne pas recharger la page

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
