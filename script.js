// SCRIPT.JS - 🧑 Identifier l’utilisateur depuis l’URL
const urlParams = new URLSearchParams(location.search);
const user = urlParams.get("user")?.toLowerCase();

if (!user) {
  showToast("❌ Aucun utilisateur indiqué !", "red");
  throw new Error("Utilisateur manquant");
}

// 🌐 Récupération automatique de l’apiUrl depuis le Google Sheet central
const CONFIG_URL = "https://script.google.com/macros/s/AKfycbyF2k4XNW6rqvME1WnPlpTFljgUJaX58x0jwQINd6XPyRVP3FkDOeEwtuierf_CcCI5hQ/exec";

let apiUrl = null;

const cfgAbort = new AbortController();
const cfgTimer = setTimeout(() => cfgAbort.abort(), 10000);
fetch(`${CONFIG_URL}?user=${encodeURIComponent(user)}&ts=${Date.now()}`, { signal: cfgAbort.signal, cache: "no-store" })
  .then(async res => {
    clearTimeout(cfgTimer);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Erreur HTTP lors de la récupération de la config : ${res.status} — ${txt.slice(0, 200)}`);
    }
    return res.json();
  })
  .then(config => {
    if (config.error) {
      showToast(`❌ ${config.error}`, "red");
      throw new Error(config.error);
    }

    apiUrl = config.apiurl;
    console.log("✅ API URL récupérée :", apiUrl);

    if (!apiUrl) {
      showToast("❌ Aucune URL WebApp trouvée pour l’utilisateur.", "red");
      throw new Error("API URL introuvable");
    }

    initApp();
  })
  .catch(err => {
    showToast("❌ Erreur lors du chargement de la configuration.", "red");
    console.error("Erreur attrapée :", err);
  });

// ---- Toast minimal (non bloquant) ----
function ensureToast() {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "fixed top-4 right-4 hidden z-50";
    document.body.appendChild(t);
  }
  return t;
}

function showToast(message, tone = "green") {
  const t = ensureToast();
  const bg = tone === "red" ? "bg-red-600" : tone === "blue" ? "bg-blue-600" : "bg-green-600";
  t.className = `fixed top-4 right-4 ${bg} text-white px-4 py-2 rounded shadow z-50`;
  t.textContent = message;
  t.classList.remove("hidden");
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.add("hidden"), 2400);
}

const PRIO = {
  1: { text: "Haute",   badge: "bg-red-100 text-red-700" },
  2: { text: "Normale", badge: "bg-gray-100 text-gray-800" },
  3: { text: "Basse",   badge: "bg-green-100 text-green-700" }
};
function prioritySelect(value=2){
  const s = document.createElement("select");
  s.className = "text-sm border rounded px-2 py-1 bg-white";
  [["1","Haute"],["2","Normale"],["3","Basse"]].forEach(([v,t])=>{
    const o = document.createElement("option"); o.value=v; o.textContent=t; if (String(value)===v) o.selected=true; s.appendChild(o);
  });
  return s;
}

function addSROnlyUI(wrapper, q) {
  const row = document.createElement("div");
  row.className = "mt-2 flex items-center gap-3";

  window.__srToggles  = window.__srToggles  || {};
  window.__srBaseline = window.__srBaseline || {};
  const srCurrent = q.scheduleInfo?.sr || { on:false };
  if (!(q.id in window.__srBaseline)) window.__srBaseline[q.id] = srCurrent.on ? "on":"off";
  if (!(q.id in window.__srToggles))  window.__srToggles[q.id]  = srCurrent.on ? "on":"off";

  const label = document.createElement("span");
  label.className = "text-sm text-gray-700";
  label.textContent = "⏱️ Répétition espacée";
  row.appendChild(label);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("role", "switch");
  const refresh = () => {
    const on = window.__srToggles[q.id] === "on";
    btn.className = "text-sm px-2 py-1 rounded " + (on ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800");
    btn.textContent = on ? "ON" : "OFF";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  };
  btn.addEventListener("click", () => {
    window.__srToggles[q.id] = (window.__srToggles[q.id] === "on" ? "off" : "on");
    refresh();
  });
  refresh();
  row.appendChild(btn);

  if (q.scheduleInfo?.sr?.interval || q.scheduleInfo?.sr?.due) {
    const meta = document.createElement("span");
    meta.className = "text-xs text-gray-500";
    const sr = q.scheduleInfo.sr;
    meta.textContent = sr.unit==="iters"
      ? `(${sr.interval||0} itérations)`
      : (sr.due ? `(prochaine ${sr.due})` : `(${sr.interval||0} j)`);
    row.appendChild(meta);
  }

  wrapper.appendChild(row);
}

function strongText(txt){
  const s = document.createElement("strong");
  s.textContent = txt ?? "";
  return s;
}

function yesNoGroup(name, current) {
  const wrap = document.createElement("div");
  wrap.className = "space-x-6 text-gray-700";
  [["Oui","Oui"],["Non","Non"]].forEach(([val, txt]) => {
    const lab = document.createElement("label");
    const r = document.createElement("input");
    r.type = "radio"; r.name = name; r.value = val; r.className = "mr-1";
    if (current === val) r.checked = true;
    lab.appendChild(r); lab.append(txt);
    wrap.appendChild(lab);
  });
  return wrap;
}

function moveCardToGroup(cardEl, newP){
  const container = document.getElementById("daily-form");
  if (!container || !cardEl) return;
  const groups = {
    1: container.querySelector('[data-group="p1"]'),
    2: container.querySelector('[data-group="p2"]'),
    3: container.querySelector('[data-group="p3"]')
  };
  if (groups[newP]) groups[newP].appendChild(cardEl);
}

const TYPE_OPTIONS = [
  "Oui/Non",
  "Menu (Likert 5)",
  "Texte court",
  "Texte (plus long)"
];
const FREQ_OPTIONS = [
  "Quotidien",
  "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche",
  "Répétition espacée",
  "Pratique délibérée"
];
async function getAllCategories(){
  if (window.__allCategories) return window.__allCategories;
  try{
    const res = await fetch(`${apiUrl}?mode=consignes`);
    const rows = await res.json();
    const set = new Set(rows.map(r => (r.category || "").trim()).filter(Boolean));
    window.__allCategories = Array.from(set).sort();
  }catch(e){ window.__allCategories = []; }
  return window.__allCategories;
}
function consigneEditorForm(defaults, categories){
  const c = Object.assign({ category:"", type:"", frequency:"", label:"", priority:2 }, defaults||{});
  const cats = Array.isArray(categories) ? categories : [];
  const box = document.createElement("div");
  box.className = "consigne-editor mt-2 p-4 rounded-lg border bg-white shadow";
  box.innerHTML = `
    <div class="grid md:grid-cols-2 gap-3">
      <div>
        <label class="block text-xs text-gray-600 mb-1">Catégorie</label>
        <select class="ce-cat border rounded px-2 py-1 w-full bg-white"></select>
        <input class="ce-cat-other border rounded px-2 py-1 w-full mt-2 hidden" placeholder="Nouvelle catégorie">
      </div>
      <div>
        <label class="block text-xs text-gray-600 mb-1">Type</label>
        <select class="ce-type border rounded px-2 py-1 w-full bg-white"></select>
      </div>
      <div>
        <label class="block text-xs text-gray-600 mb-1">Fréquence</label>
        <select class="ce-freq border rounded px-2 py-1 w-full bg-white"></select>
      </div>
      <div>
        <label class="block text-xs text-gray-600 mb-1">Priorité</label>
        <span class="ce-prio"></span>
      </div>
    </div>
    <label class="block text-xs text-gray-600 mb-1 mt-3">Intitulé</label>
    <input class="ce-label border rounded px-2 py-1 w-full" placeholder="Ex. : As-tu pris 15 minutes pour lire un peu aujourd’hui ?">
    <div class="mt-3 flex gap-2">
      <button class="ce-save px-3 py-1 rounded bg-green-600 text-white">Enregistrer</button>
      <button class="ce-cancel px-3 py-1 rounded bg-gray-100">Annuler</button>
    </div>
  `;
  const prioMount = box.querySelector(".ce-prio");
  const sel = prioritySelect(c.priority||2);
  prioMount.appendChild(sel);
  const ceLabel = box.querySelector(".ce-label");
  const catSel = box.querySelector(".ce-cat");
  const typeSel = box.querySelector(".ce-type");
  const freqSel = box.querySelector(".ce-freq");
  const catOther = box.querySelector(".ce-cat-other");

  ceLabel.value = c.label || "";
  function setOptions(select, opts, selected) {
    select.innerHTML = "";
    select.add(new Option("— Choisir —", ""));
    opts.forEach(v => select.add(new Option(v, v, false, v === selected)));
  }
  setOptions(typeSel, TYPE_OPTIONS, c.type);
  setOptions(freqSel, FREQ_OPTIONS, c.frequency);
  // Catégories + entrée autre
  catSel.innerHTML = "";
  catSel.add(new Option("— Choisir —", ""));
  cats.forEach(k => catSel.add(new Option(k, k, false, k === c.category)));
  catSel.add(new Option("Nouvelle catégorie…", "__other__", false, c.category === "__other__"));
  const syncCatOther = () => {
    const v = catSel.value;
    if (v === "__other__") { catOther.classList.remove("hidden"); catOther.focus(); }
    else { catOther.classList.add("hidden"); }
  };
  catSel.addEventListener("change", syncCatOther);
  syncCatOther();
  box._get = () => {
    const catValue = catSel.value === "__other__"
      ? (catOther.value || "").trim()
      : (catSel.value || "").trim();
    return {
      category: catValue,
      type:     box.querySelector(".ce-type").value,
      frequency:box.querySelector(".ce-freq").value,
      label:    box.querySelector(".ce-label").value,
      priority: parseInt(sel.value,10)
    };
  };
  const onCancel = () => box.remove();
  box.querySelector(".ce-cancel").addEventListener("click", onCancel);
  box.querySelector(".ce-save").addEventListener("click", async ()=>{
    const saveBtn = box.querySelector(".ce-save");
    saveBtn.disabled = true;
    const vals = box._get();
    if (!vals.label.trim() || !vals.type || !vals.frequency) {
      showToast("⚠️ Complète au moins Intitulé, Type et Fréquence", "blue");
      saveBtn.disabled = false;
      return;
    }
    try{
      const payload = defaults?.id
        ? { _action:"consigne_update", id: defaults.id, category: vals.category, type: vals.type, frequency: vals.frequency, newLabel: vals.label, priority: vals.priority }
        : { _action:"consigne_create", category: vals.category, type: vals.type, frequency: vals.frequency, label: vals.label, priority: vals.priority };
      const res = await fetch(`${apiUrl}`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      const txt = await res.text().catch(()=> "");
      if (!res.ok || (txt && txt.startsWith("❌"))) throw new Error(txt || `HTTP ${res.status}`);
      showToast(defaults?.id ? "✅ Consigne mise à jour" : "✅ Consigne créée");
      window.__allCategories = null;
      box.remove();
      window.handleSelectChange?.();
      window.rebuildSelector?.();
    }catch(e){
      showToast("❌ Erreur enregistrement", "red");
      console.error(e);
    }finally{
      saveBtn.disabled = false;
    }
  });
  return box;
}
async function openConsigneEditorInline(mountEl, qOrNull){
  document.querySelectorAll(".consigne-editor").forEach(el => el.remove());
  const cats = await getAllCategories();
  const isUpdate = !!qOrNull?.id;
  const form = consigneEditorForm(
    isUpdate ? {
      category: qOrNull.category, type: qOrNull.type, frequency: qOrNull.frequency,
      label: qOrNull.label, priority: qOrNull.priority
    } : {},
    cats
  );
  mountEl.appendChild(form);
  setTimeout(() => form.querySelector(".ce-label")?.focus(), 0);
}

function consigneRow(c){
  const tag = PRIO[c.priority||2] || PRIO[2];
  return `
    <div class="py-3 flex items-center justify-between">
      <div class="min-w-0">
        <div class="font-medium truncate">${c.label}</div>
        <div class="text-sm text-gray-500 truncate">${c.category} • ${c.type} • ${c.frequency}</div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs px-2 py-0.5 rounded ${tag.badge}">${tag.text}</span>
        <button class="edit px-2 py-1 text-sm rounded bg-blue-600 text-white" data-id="${c.id}">Éditer</button>
        <button class="del px-2 py-1 text-sm rounded bg-red-600 text-white" data-id="${c.id}">Suppr.</button>
      </div>
    </div>`;
}

function renderQuestions(questions) {
  const container = document.getElementById("daily-form");
  container.innerHTML = "";
  console.log(`✍️ Rendu de ${questions.length} question(s)`);
  const addBar = document.createElement("div");
  addBar.className = "mb-4";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "px-3 py-2 rounded bg-green-600 text-white shadow hover:bg-green-700";
  addBtn.textContent = "➕ Ajouter une consigne";
  const addMount = document.createElement("div");
  addMount.id = "add-consigne-mount";
  addMount.className = "mt-3";
  addBar.appendChild(addBtn);
  addBar.appendChild(addMount);
  addBtn.addEventListener("click", () => {
    openConsigneEditorInline(addMount, null);
    addMount.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  container.appendChild(addBar);

  const visible = [], hiddenSR = [];
  (questions||[]).forEach(q => (q.skipped ? hiddenSR : visible).push(q));

  visible.sort((a,b)=> (a.priority||2)-(b.priority||2));

  const p1 = visible.filter(q => (q.priority||2) === 1);
  const p2 = visible.filter(q => (q.priority||2) === 2);
  const p3 = visible.filter(q => (q.priority||2) === 3);

  const renderGroup = (arr, {title, style, collapsed, groupKey}) => {
    if (!arr.length) return;
    const block = document.createElement("div");
    block.className = "mb-6";
    const header = document.createElement("div");
    header.className = "mb-3 flex items-center gap-2";
    const hdrBadge = document.createElement("span");
    hdrBadge.className = `text-sm font-semibold ${style.badge} px-2 py-0.5 rounded`;
    hdrBadge.textContent = title;
    header.appendChild(hdrBadge);
    block.appendChild(header);

    const body = document.createElement(collapsed ? "details" : "div");
    if (groupKey) body.dataset.group = groupKey;
    if (collapsed) {
      body.className = "rounded border";
      const sum = document.createElement("summary");
      sum.className = "cursor-pointer select-none px-3 py-2 text-gray-800";
      sum.textContent = "Afficher les consignes secondaires";
      body.appendChild(sum);
    }

    arr.forEach(q => {
      const wrap = document.createElement("div");
      wrap.className = `mb-4 p-4 rounded-lg shadow-sm ${style.card}`;

      const label = document.createElement("label");
      label.className = "block text-lg font-semibold mb-2";
      label.textContent = q.label;
      wrap.appendChild(label);

      // Barre méta (priorité + actions consigne)
      const meta = document.createElement("div");
      meta.className = "mb-2 flex flex-wrap items-center gap-2";
      const p = q.priority || 2;
      const priLabel = document.createElement("span");
      priLabel.className = "text-xs text-gray-600";
      priLabel.textContent = "Priorité :";
      meta.appendChild(priLabel);
      const badge = document.createElement("span");
      badge.className = `ml-2 text-xs px-2 py-0.5 rounded ${PRIO[p].badge}`;
      badge.textContent = PRIO[p].text;
      meta.appendChild(badge);
      const pSel = prioritySelect(p);
      pSel.addEventListener("change", async () => {
        const newP = parseInt(pSel.value, 10) || 2;
        try {
          const res = await fetch(`${apiUrl}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _action: "consigne_update", id: q.id, priority: newP })
          });
          const txt = await res.text().catch(() => "");
          if (!res.ok || (txt && txt.startsWith("❌"))) throw new Error(txt || `HTTP ${res.status}`);
          // maj visuelle immédiate
          badge.textContent = PRIO[newP].text;
          badge.className = `ml-2 text-xs px-2 py-0.5 rounded ${PRIO[newP].badge}`;
          showToast("✅ Priorité mise à jour");
          // si tu veux éviter de tout recharger, commente la ligne suivante :
          // handleSelectChange();
          moveCardToGroup(wrap, newP);
        } catch (e) {
          console.error(e);
          showToast("❌ Erreur mise à jour priorité", "red");
        }
      });
      meta.appendChild(pSel);
      const editBtn = document.createElement("button");
      editBtn.type="button";
      editBtn.className="text-sm text-blue-600 hover:underline";
      editBtn.textContent="Éditer";
      editBtn.addEventListener("click", () => openConsigneEditorInline(wrap, q));
      const delBtn = document.createElement("button");
      delBtn.type="button";
      delBtn.className="text-sm text-red-600 hover:underline";
      delBtn.textContent="Supprimer";
      delBtn.addEventListener("click", async () => {
        if (!confirm("Supprimer cette consigne ?")) return;
        delBtn.disabled = true;
        try {
          const r = await fetch(`${apiUrl}`, {
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({ _action:"consigne_delete", id: q.id })
          });
          const t = await r.text().catch(()=> "");
          if (!r.ok || (t && t.startsWith("❌"))) throw new Error(t || `HTTP ${r.status}`);
          showToast("🗑️ Consigne supprimée");
          handleSelectChange();
        } catch(e){
          showToast("❌ Erreur suppression", "red");
        } finally {
          delBtn.disabled = false;
        }
      });
      const actions = document.createElement("div");
      actions.className = "ml-auto flex items-center gap-3";
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      meta.appendChild(actions);
      wrap.appendChild(meta);

      // Réutilise la logique de rendu existante pour les champs + SR toggle + historique
      let referenceAnswer = "";
      if (q.history && Array.isArray(q.history)) {
        const dateISO = document.getElementById("date-select")?.value; // "YYYY-MM-DD"
        if (dateISO) {
          const [yyyy, mm, dd] = dateISO.split("-");
          const wanted = `${dd}/${mm}/${yyyy}`; // "dd/MM/yyyy"
          const entry = q.history.find(e => e?.date === wanted);
          referenceAnswer = entry?.value || "";
        }
      }
      let input;
      const type = (q.type || "").toLowerCase();
      if (type.includes("oui")) {
        input = yesNoGroup(q.id, referenceAnswer);
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
        input.className = "mt-1 p-2 border rounded w-full bg-white text-gray-800 text-sm md:text-base leading-tight";
        input.value = referenceAnswer;
      } else {
        input = document.createElement("input");
        input.name = q.id;
        input.type = "text";
        input.className = "mt-1 p-2 border rounded w-full bg-white text-gray-800 text-sm md:text-base leading-tight";
        input.value = referenceAnswer;
      }
      wrap.appendChild(input);
      addSROnlyUI(wrap, q);

      // Historique
      if (q.history && q.history.length > 0) {
        const normalize = (str) =>
          (str || "")
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[\u00A0\u202F\u200B]/g, " ")
          .replace(/\s+/g, " ")
          .toLowerCase()
          .trim();
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "mt-3 text-sm text-blue-600 hover:underline";
        toggleBtn.textContent = "📓 Voir l’historique des réponses";
        const historyBlock = document.createElement("div");
        historyBlock.className = "mt-3 p-3 rounded bg-gray-50 border text-sm text-gray-700 hidden";
        renderLikertChart(historyBlock, q.history, normalize);
        const orderedForStats = orderForHistory(q.history);
        const LIMIT = 10;
        const WINDOW = 30;
        const badge = (title, value, tone = "blue") => {
          const tones = {
            blue:"bg-blue-50 text-blue-700 border-blue-200",
            green:"bg-green-50 text-green-700 border-green-200",
            yellow:"bg-yellow-50 text-yellow-700 border-yellow-200",
            red:"bg-red-50 text-red-900 border-red-200",
            gray:"bg-gray-50 text-gray-700 border-gray-200",
            purple:"bg-purple-50 text-purple-700 border-purple-200"
          };
          const div = document.createElement("div");
          div.className = `px-2.5 py-1 rounded-full border text-xs font-medium ${tones[tone] || tones.gray}`;
          const span1 = document.createElement("span");
          span1.className = "opacity-70";
          span1.textContent = `${title}:`;
          const span2 = document.createElement("span");
          span2.className = "font-semibold";
          span2.textContent = String(value ?? "");
          div.append(span1, document.createTextNode(" "), span2);
          return div;
        };
        const POSITIVE = new Set(["oui","plutot oui"]);
        const windowHist = orderedForStats.slice(0, WINDOW);
        let currentStreak = 0;
          for (const e of windowHist) { if (POSITIVE.has(normalize(e.value))) currentStreak++; else break; }
          const counts = {}; const order = ["non","plutot non","moyen","plutot oui","oui"];
          for (const e of windowHist) { const v = normalize(e.value); counts[v] = (counts[v] || 0) + 1; }
          let best = null, bestCount = -1; for (const k of order) { const c = counts[k] || 0; if (c > bestCount) { best = k; bestCount = c; } }
        const pretty = { "non":"Non","plutot non":"Plutôt non","moyen":"Moyen","plutot oui":"Plutôt oui","oui":"Oui" };
          const statsWrap = document.createElement("div"); statsWrap.className = "mb-3 flex flex-wrap gap-2 items-center";
        statsWrap.appendChild(badge("Série actuelle (positifs)", currentStreak, currentStreak>0 ? "green":"gray"));
        if (best) statsWrap.appendChild(badge("Réponse la plus fréquente", pretty[best] || best, "purple"));
        historyBlock.appendChild(statsWrap);
          const colorMap = { "oui": "bg-green-100 text-green-800", "plutot oui": "bg-green-50 text-green-700", "moyen": "bg-yellow-100 text-yellow-800", "plutot non": "bg-red-100 text-red-900", "non": "bg-red-200 text-red-900", "pas de reponse": "bg-gray-200 text-gray-700 italic" };
        orderedForStats.forEach((entry, idx) => {
          const keyPretty = prettyKeyWithDate(entry);
          const val = entry.value;
          const normalized = normalize(val);
          const entryDiv = document.createElement("div");
          entryDiv.className = `mb-2 px-3 py-2 rounded ${colorMap[normalized] || "bg-gray-100 text-gray-700"}`;
          if (idx >= LIMIT) entryDiv.classList.add("hidden", "extra-history");
          entryDiv.textContent = "";
          entryDiv.appendChild(strongText(keyPretty));
          entryDiv.append(" – " + (val ?? ""));
          historyBlock.appendChild(entryDiv);
        });
        if (orderedForStats.length > LIMIT) {
            const moreBtn = document.createElement("button"); moreBtn.type = "button"; moreBtn.className = "mt-2 text-xs text-blue-600 hover:underline";
            let expanded = false; const rest = orderedForStats.length - LIMIT; const setLabel = () => moreBtn.textContent = expanded ? "Réduire" : `Afficher plus (${rest} de plus)`; setLabel();
            moreBtn.addEventListener("click", () => { expanded = !expanded; historyBlock.querySelectorAll(".extra-history").forEach(el => el.classList.toggle("hidden", !expanded)); setLabel(); });
          historyBlock.appendChild(moreBtn);
        }
        toggleBtn.addEventListener("click", () => { const wasHidden = historyBlock.classList.contains("hidden"); historyBlock.classList.toggle("hidden"); if (wasHidden) scrollToRight(historyBlock._likertScroller); });
        wrap.appendChild(toggleBtn);
        wrap.appendChild(historyBlock);
      }
      body.appendChild(wrap);
    });

    block.appendChild(body);
    container.appendChild(block);
  };

  renderGroup(p1, { title:"Priorité haute",   style:{ badge:"bg-red-100 text-red-700",    card:"ring-1 ring-red-100" }, groupKey:"p1" });
  renderGroup(p2, { title:"Priorité normale", style:{ badge:"bg-gray-100 text-gray-800",  card:"" }, groupKey:"p2" });
  renderGroup(p3, { title:"Priorité basse",   style:{ badge:"bg-green-100 text-green-700",card:"bg-green-50 bg-opacity-40" }, collapsed:true, groupKey:"p3" });

  // === Panneau "Questions masquées (SR)" ===
  if (hiddenSR.length) {
    const panel = document.createElement("div");
    panel.className = "mt-6";
    const details = document.createElement("details");
    details.className = "bg-gray-50 border border-gray-200 rounded-lg";
    details.open = false;
    const summary = document.createElement("summary");
    summary.className = "cursor-pointer select-none px-4 py-2 font-medium text-gray-800 flex items-center justify-between";
    summary.textContent = "";
    const left  = document.createElement("span");
    left.textContent = `🔕 ${hiddenSR.length} question(s) masquée(s) — répétition espacée`;
    const right = document.createElement("span");
    right.className = "text-sm text-gray-500";
    right.textContent = "voir";
    summary.append(left, right);
    details.appendChild(summary);
    const list = document.createElement("div");
    list.className = "px-4 pt-2 pb-3";
    const normalize = (str) => (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\u00A0\u202F\u200B]/g, " ").replace(/\s+/g, " ").toLowerCase().trim();
    hiddenSR.forEach(item => {
      const row = document.createElement("div"); row.className = "mb-2 rounded bg-white border border-gray-200";
      const content = document.createElement("div"); content.className = "px-3 pb-3 hidden";
      const head = document.createElement("div"); head.className = "px-3 py-2 flex items-center justify-between";
      const title = document.createElement("div"); title.textContent = ""; title.appendChild(strongText(item.label)); head.appendChild(title);
      head.classList.add("cursor-pointer");
      head.addEventListener("click", () => { const wasHidden = content.classList.contains("hidden"); content.classList.toggle("hidden"); if (wasHidden) { const sc = content.querySelector('[data-autoscroll="right"]'); scrollToRight(sc); } });
      const sub = document.createElement("div"); sub.className = "px-3 pb-2 text-sm text-gray-700 flex items-center gap-2";
      const extras = []; if (item.scheduleInfo?.nextDate) extras.push(`Prochaine : ${item.scheduleInfo.nextDate}`); if (Number(item.scheduleInfo?.remaining) > 0) extras.push(`Restant : ${item.scheduleInfo.remaining} itér.`);
      const tail = extras.length ? ` (${extras.join(" — ")})` : ""; const reason = item.reason || "Répétition espacée"; sub.textContent = `⏱️ ${reason.replace(/^✅\s*/, '')}${tail}`;
      
      const srWrap = document.createElement("div");
      addSROnlyUI(srWrap, item);
      content.appendChild(srWrap);
      if (item.history && item.history.length > 0) {
        const toggleBtn = document.createElement("button"); toggleBtn.type = "button"; toggleBtn.className = "mt-3 text-sm text-blue-600 hover:underline"; toggleBtn.textContent = "📓 Voir l’historique des réponses";
        const historyBlock = document.createElement("div"); historyBlock.className = "mt-3 p-3 rounded bg-gray-50 border text-sm text-gray-700 hidden";
        renderLikertChart(historyBlock, item.history, normalize);
        const ordered = orderForHistory(item.history);
        const colorMap = { "oui": "bg-green-100 text-green-800", "plutot oui": "bg-green-50 text-green-700", "moyen": "bg-yellow-100 text-yellow-800", "plutot non": "bg-red-100 text-red-900", "non": "bg-red-200 text-red-900", "pas de reponse": "bg-gray-200 text-gray-700 italic" };
        const LIMIT = 10;
        ordered.forEach((entry, idx) => {
          const keyPretty = prettyKeyWithDate(entry); const val = entry.value; const normalized = normalize(val);
          const div = document.createElement("div"); div.className = `mb-2 px-3 py-2 rounded ${colorMap[normalized] || "bg-gray-100 text-gray-700"}`;
          if (idx >= LIMIT) div.classList.add("hidden", "extra-history");
          div.textContent = ""; div.appendChild(strongText(keyPretty)); div.append(" – " + (val ?? "")); historyBlock.appendChild(div);
        });
        if (ordered.length > LIMIT) {
          const moreBtn = document.createElement("button"); moreBtn.type = "button"; moreBtn.className = "mt-2 text-xs text-blue-600 hover:underline";
          let expanded = false; const rest = ordered.length - LIMIT; const setLabel = () => moreBtn.textContent = expanded ? "Réduire" : `Afficher plus (${rest} de plus)`; setLabel();
          moreBtn.addEventListener("click", () => { expanded = !expanded; historyBlock.querySelectorAll(".extra-history").forEach(el => el.classList.toggle("hidden", !expanded)); setLabel(); });
          historyBlock.appendChild(moreBtn);
        }
        toggleBtn.addEventListener("click", () => { const wasHidden = historyBlock.classList.contains("hidden"); historyBlock.classList.toggle("hidden"); if (wasHidden) scrollToRight(historyBlock._likertScroller); });
        content.appendChild(toggleBtn); content.appendChild(historyBlock);
      }
      row.appendChild(head); row.appendChild(sub); row.appendChild(content); list.appendChild(row);
    });
    const note = document.createElement("p"); note.className = "mt-2 text-xs text-gray-500"; note.textContent = "Ces items sont masqués automatiquement suite à vos réponses positives. Ils réapparaîtront à l’échéance."; list.appendChild(note);
    details.appendChild(list); panel.appendChild(details); container.appendChild(panel);
  }
  showFormUI(); console.log("✅ Rendu des questions terminé.");
}

// --- Fallbacks légers / helpers manquants ---
function showFormUI() {
  document.getElementById("daily-form")?.classList.remove("hidden");
  document.getElementById("submit-section")?.classList.remove("hidden");
  document.getElementById("loader")?.classList.add("hidden");
}
// No-ops pour helpers graphiques si absents
window.renderLikertChart  ??= function(el){ /* no-op */ };
window.orderForHistory    ??= function(arr){ return (arr||[]).slice().reverse(); };
window.prettyKeyWithDate  ??= function(e){ return e?.date || e?.key || ""; };
window.scrollToRight      ??= function(scroller){
  try { scroller?.scrollTo?.({ left: scroller.scrollWidth, behavior: "smooth" }); } catch(_) {}
};
let __loadAbort;
async function loadFormForDate(dateISO) {
  try {
    __loadAbort?.abort?.();
    __loadAbort = new AbortController();
    const res = await fetch(`${apiUrl}?date=${encodeURIComponent(dateISO)}&ts=${Date.now()}`, { signal: __loadAbort.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const questions = await res.json();
    window.__lastQuestions = questions;
    renderQuestions(questions);
  } catch (e) {
    if (e.name === "AbortError") return;
    console.error(e);
    showToast("❌ Erreur chargement du formulaire", "red");
  }
}
function handleSelectChange() {
  const sel = document.getElementById("date-select");
  const dateISO = sel?.value;
  if (dateISO) loadFormForDate(dateISO);
}
window.handleSelectChange = handleSelectChange;
window.rebuildSelector = (typeof buildCombinedSelect === "function") ? buildCombinedSelect : () => {};

async function initApp() {
  // retire les boutons de la barre
  document.getElementById("btn-home")?.closest("button, a, li, div")?.remove();
  document.getElementById("btn-manage")?.closest("button, a, li, div")?.remove();
  window.rebuildSelector = (typeof buildCombinedSelect === "function") ? buildCombinedSelect : () => {};
  const dateSelect = document.getElementById("date-select");
  if (dateSelect) {
    dateSelect.addEventListener("change", handleSelectChange);
    const todayISO = new Date().toISOString().slice(0, 10);
    dateSelect.value = todayISO;
    handleSelectChange();
  } else {
    const todayISO = new Date().toISOString().slice(0, 10);
    loadFormForDate(todayISO);
  }
}
