const questions = [
  { id: "q1", label: "As-tu bien dormi cette nuit ?", type: "yesno" },
  { id: "q2", label: "Comment te sens-tu aujourd’hui ?", type: "likert" },
  { id: "q3", label: "Quel a été ton principal objectif ?", type: "text" },
  { id: "q4", label: "Ton niveau de productivité ?", type: "likert" }
];

function renderForm() {
  const form = document.getElementById("daily-form");

  questions.forEach(q => {
    const wrapper = document.createElement("div");

    const label = document.createElement("label");
    label.className = "block font-medium mb-1";
    label.textContent = q.label;
    wrapper.appendChild(label);

    let input;
    switch (q.type) {
      case "yesno":
        input = document.createElement("div");
        input.innerHTML = `
          <label class="mr-4"><input type="radio" name="${q.id}" value="Oui" /> Oui</label>
          <label><input type="radio" name="${q.id}" value="Non" /> Non</label>
        `;
        break;
      case "likert":
        input = document.createElement("select");
        input.name = q.id;
        input.className = "mt-1 p-2 border rounded w-full";
        ["-- Choisir --", "Oui", "Plutôt oui", "Moyen", "Plutôt non", "Non", "Pas de réponse"]
          .forEach(opt => {
            const option = document.createElement("option");
            option.textContent = opt;
            input.appendChild(option);
          });
        break;
      case "text":
        input = document.createElement("input");
        input.type = "text";
        input.name = q.id;
        input.className = "mt-1 p-2 border rounded w-full";
        break;
    }

    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });
}

document.getElementById("submitBtn").addEventListener("click", () => {
  const formData = new FormData(document.getElementById("daily-form"));
  const entries = Object.fromEntries(formData.entries());

  console.log("🟢 Réponses soumises :", entries);
  alert("Merci ! Les réponses ont été soumises (voir console pour test).");

  // À connecter à Google Sheets via Apps Script ou API plus tard
});

renderForm();
