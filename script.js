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
    `📝 Formulaire du jour – ${user.charAt(0).toUpperCase() + user.slice(1)}`;

  const dateDisplay = document.getElementById("date-display");
  if (dateDisplay) dateDisplay.remove();

  const dateSelect = document.getElementById("date-select");
  dateSelect.classList.add("mb-4");

  // Générer les 7 derniers jours
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

  // ➕ Charger dynamiquement les pratiques délibérées
  fetch(`${apiUrl}?listPractices=true`)
    .then(res => res.json())
    .then(practices => {
      practices.forEach(practice => {
        const option = document.createElement("option");
        const cleanValue = practice.toLowerCase().replace(/ /g, "-");
        option.value = `practice:${cleanValue}`;
        option.textContent = `🌀 Pratique – ${practice}`;
        dateSelect.appendChild(option);
      });
    })
    .catch(err => console.error("Erreur chargement pratiques :", err));

  // Charger le formulaire du premier jour par défaut
  loadFormForDate(pastDates[0].value);

  // Réagir au changement de sélection
  dateSelect.addEventListener("change", () => {
    loadFormForDate(dateSelect.value);
  });

  // Soumettre le formulaire
  document.getElementById("submitBtn").addEventListener("click", (e) => {
    e.preventDefault();

    const formData = new FormData(document.getElementById("daily-form"));
    const entries = Object.fromEntries(formData.entries());

    // Adapter l’envoi pour pratiques vs dates
    if (dateSelect.value.startsWith("practice:")) {
      entries.practice = dateSelect.value.replace("practice:", "").replace(/-/g, " ");
    } else {
      entries._date = dateSelect.value;
    }
    entries.apiUrl = apiUrl;

    fetch("https://tight-snowflake-cdad.como-denizot.workers.dev/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries)
    })
      .then(res => res.text())
      .then(() => alert("✅ Réponses envoyées !"))
      .catch(err => {
        alert("❌ Erreur d’envoi");
        console.error(err);
      });
  });

  // Fonction de chargement du formulaire selon date ou pratique
  function loadFormForDate(dateISO) {
    const formContainer = document.getElementById("daily-form");
    formContainer.innerHTML = "";
    document.getElementById("submit-section").classList.add("hidden");

    const isPractice = dateISO.startsWith("practice:");
    const practiceName = isPractice ? dateISO.replace("practice:", "").replace(/-/g, " ") : null;

    const fetchUrl = isPractice
      ? `${apiUrl}?practice=${practiceName}`
      : `${apiUrl}?date=${dateISO}`;

    fetch(fetchUrl)
      .then(res => res.json())
      .then(questions => {
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

          // Label question
          const labelEl = document.createElement("label");
          labelEl.className = "block text-lg font-semibold mb-2";
          labelEl.textContent = q.skipped ? `🎉 ${q.label}` : q.label;
          wrapper.appendChild(labelEl);

          // Valeur de référence si existante
          const refEntry = q.history?.find(entry => {
            const [dd, mm, yyyy] = entry.date.split("/");
            return `${yyyy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}` === dateISO;
          });
          const referenceAnswer = refEntry?.value || "";

          if (q.skipped) {
            wrapper.classList.add("bg-green-50", "border", "border-green-200", "opacity-70");
            wrapper.style.pointerEvents = "none";
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
                <label><input type="radio" name="${q.id}" value="Oui" ${referenceAnswer==="Oui"?"checked":""}>Oui</label>
                <label><input type="radio" name="${q.id}" value="Non" ${referenceAnswer==="Non"?"checked":""}>Non</label>
              `;
            } else if (type.includes("menu") || type.includes("likert")) {
              input = document.createElement("select");
              input.name = q.id;
              input.className = "mt-1 p-2 border rounded w-full bg-white text-gray-800";
              ["","Oui","Plutôt oui","Moyen","Plutôt non","Non","Pas de réponse"].forEach(opt=>{
                const o=document.createElement("option"); o.value=opt; o.textContent=opt; if(opt===referenceAnswer)o.selected=true; input.appendChild(o);
              });
            } else if (type.includes("plus long")) {
              input = document.createElement("textarea");
              input.name = q.id;
              input.rows = 4;
              input.className = "mt-1 p-2 border rounded w-full bg-white text-gray-800";
              input.value = referenceAnswer;
            } else {
              input = document.createElement("input");
              input.name = q.id;
              input.type = "text";
              input.className = "mt-1 p-2 border rounded w-full bg-white text-gray-800";
              input.value = referenceAnswer;
            }
            wrapper.appendChild(input);
          }

          // Historique
          if (q.history?.length) {
            const isText = q.type.toLowerCase().includes("texte") || q.type.toLowerCase().includes("plus long");
            if (isText) {
              const btn = document.createElement("button");
              btn.type="button"; btn.className="mt-3 text-sm text-blue-600 hover:underline"; btn.textContent="📓 Voir l’historique";
              const block=document.createElement("div"); block.className="mt-3 p-3 bg-gray-50 rounded border text-sm text-gray-700 hidden";
              q.history.slice().reverse().forEach(e=>{ const d=document.createElement("div"); d.innerHTML=`<strong>${e.date}</strong> – ${e.value}`; block.appendChild(d);} );
              btn.addEventListener("click",()=>block.classList.toggle("hidden")); wrapper.appendChild(btn); wrapper.appendChild(block);
            } else {
              const hist=document.createElement("div"); hist.className="mt-6 px-4 py-5 bg-gray-50 rounded-xl";
              const title=document.createElement("div"); title.className="text-gray-500 mb-3 font-medium"; title.textContent="📓 Historique"; hist.appendChild(title);
              const tlw=document.createElement("div"); tlw.className="overflow-x-auto pb-4";
              const tl=document.createElement("div"); tl.className="flex gap-2 w-max";
              q.history.slice().reverse().forEach(e=>{
                const norm=normalize(e.value); const color=colorMap[norm]||"bg-gray-100 text-gray-700";
                const [d,m,y]=e.date.split("/"); const sd=`${d}/${m}/${y.slice(-2)}`;
                const blk=document.createElement("div"); blk.className=`px-3 py-1 rounded-xl text-sm font-medium whitespace-nowrap ${color}`; blk.textContent=`${sd} – ${e.value}`; tl.appendChild(blk);
              });
              tlw.appendChild(tl); hist.appendChild(tlw); wrapper.appendChild(hist);
            }
          }

          formContainer.appendChild(wrapper);
        });

        document.getElementById("daily-form").classList.remove("hidden");
        document.getElementById("submit-section").classList.remove("hidden");
        const ld=document.getElementById("loader"); if(ld) ld.remove();
      });
  }
}
