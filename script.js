document.addEventListener('DOMContentLoaded', () => {
  let appState = {
    selectedDate: new Date(),
    user: null,
    mode: 'daily',
    category: null
  };

  const CONFIG_URL = "https://script.google.com/macros/s/AKfycbyF2k4XNW6rqvME1WnPlpTFljgUJaX58x0jwQINd6XPyRVP3FkDOeEwtuierf_CcCI5hQ/exec";
  let DYNAMIC_API_URL = null;

  async function fetchApiUrl(user) {
    try {
      const res = await fetch(`${CONFIG_URL}?user=${user}`);
      const config = await res.json();
      if (config.error || !config.apiurl) {
        throw new Error(config.error || "apiUrl manquant");
      }
      DYNAMIC_API_URL = config.apiurl;
      console.log("✅ apiUrl dynamique :", DYNAMIC_API_URL);
    } catch (err) {
      console.error("❌ Erreur chargement API URL :", err);
      alert("Erreur de configuration utilisateur.");
    }
  }

  const form = document.getElementById('trackingForm');
  const modeOrDateSelect = document.getElementById('modeOrDateSelect');
  const userTitle = document.getElementById('user-title');
  const categoryBlock = document.getElementById('categoryBlock');
  const categorySelect = document.getElementById('categorySelect');
  const questionsContainer = document.getElementById('questionsContainer');
  const statusMessage = document.getElementById('statusMessage');
  const loadingIndicator = document.getElementById('loading');

  function getScriptUrl() {
    return DYNAMIC_API_URL || '';
  }

  function showLoading() {
    loadingIndicator.style.display = 'flex';
  }

  function hideLoading() {
    loadingIndicator.style.display = 'none';
  }

  function cleanString(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function getColorClass(value) {
    const val = value.toLowerCase();
    if (val.includes('oui')) return 'text-green-600';
    if (val.includes('non')) return 'text-red-600';
    if (val.includes('moyen')) return 'text-yellow-600';
    return 'text-gray-500';
  }
  
  // Fonction pour peupler le nouveau sélecteur
  function populateModeOrDateSelect() {
    const today = new Date();
    modeOrDateSelect.innerHTML = '';

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().split("T")[0];
      const label = d.toLocaleDateString("fr-FR", { weekday: 'long', day: 'numeric', month: 'long' });

      const opt = document.createElement('option');
      opt.value = iso;
      opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      modeOrDateSelect.appendChild(opt);
    }

    const optPractice = document.createElement('option');
    optPractice.value = 'practice';
    optPractice.textContent = '⏱️ Mode pratique';
    modeOrDateSelect.appendChild(optPractice);
  }

  async function fetchQuestions() {
    if (!appState.user) {
      statusMessage.textContent = 'Veuillez sélectionner un utilisateur.';
      questionsContainer.innerHTML = '';
      form.style.display = 'none';
      return;
    }

    if (!DYNAMIC_API_URL) {
      showLoading();
      await fetchApiUrl(appState.user);
      hideLoading();
    }
    
    if (!DYNAMIC_API_URL) return;

    showLoading();
    questionsContainer.innerHTML = '';

    const params = new URLSearchParams({
      user: appState.user,
      mode: appState.mode,
      cat: appState.category || '',
      date: appState.mode === 'daily' ? appState.selectedDate.toISOString().split("T")[0] : ''
    });

    const url = `${getScriptUrl()}?${params.toString()}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        statusMessage.textContent = `Erreur: ${data.error}`;
        form.style.display = 'none';
        return;
      }
      renderQuestions(data);

    } catch (error) {
      console.error('Erreur lors de la récupération des questions:', error);
      statusMessage.textContent = 'Erreur lors de la récupération des questions.';
    } finally {
      hideLoading();
    }
  }

  function renderQuestions(questions) {
    questionsContainer.innerHTML = '';
    form.reset();

    if (questions.length === 0) {
      statusMessage.textContent = appState.mode === 'practice'
        ? 'Aucune pratique délibérée trouvée pour cette catégorie.'
        : 'Rien à remplir pour cette date. Profite de ta journée !';
      form.style.display = 'none';
      return;
    }

    form.style.display = 'block';
    statusMessage.textContent = '';

    questions.forEach(q => {
      const isSkipped = q.skipped;
      const questionDiv = document.createElement('div');
      questionDiv.className = `p-4 mb-4 border rounded-lg shadow-sm ${isSkipped ? 'bg-gray-100' : 'bg-white'}`;
      
      const titleDiv = document.createElement('div');
      titleDiv.className = `flex justify-between items-center ${isSkipped ? 'text-gray-500' : 'text-gray-800'}`;

      const label = document.createElement('label');
      label.textContent = q.label;
      label.className = `font-bold text-lg`;
      titleDiv.appendChild(label);

      if (q.isSpaced) {
        const info = document.createElement('span');
        info.className = 'text-sm text-gray-500';
        if (appState.mode === 'practice') {
          info.textContent = q.spacedInfo
            ? `(Répétition : ${q.spacedInfo.lastIteration} / ${q.spacedInfo.required})`
            : '(Nouvelle pratique)';
        } else {
          info.textContent = q.spacedInfo
            ? `(Prochaine : ${q.spacedInfo.nextDate})`
            : '(Jamais enregistré)';
        }
        titleDiv.appendChild(info);
      }
      questionDiv.appendChild(titleDiv);

      if (isSkipped) {
        const reasonDiv = document.createElement('div');
        reasonDiv.className = 'text-red-500 mt-2 italic';
        reasonDiv.textContent = q.reason || 'Cette question est désactivée.';
        questionDiv.appendChild(reasonDiv);
      }

      if (q.history && q.history.length > 0) {
        const historyToggle = document.createElement('button');
        historyToggle.textContent = '🔍 Voir l\'historique';
        historyToggle.className = 'text-blue-500 hover:underline text-sm mt-2 focus:outline-none';
        questionDiv.appendChild(historyToggle);

        const historyList = document.createElement('ul');
        historyList.className = 'mt-2 space-y-1 text-sm hidden';

        q.history.forEach(entry => {
          const li = document.createElement('li');
          const val = entry.value || '';
          const displayDate = entry.repetition ? `${entry.repetition} – ${entry.date}` : entry.date;
          li.innerHTML = `<strong>${displayDate}</strong> – <span class="${getColorClass(val)}">${val}</span>`;
          historyList.appendChild(li);
        });

        historyToggle.addEventListener('click', (e) => {
          e.preventDefault();
          historyList.classList.toggle('hidden');
          historyToggle.textContent = historyList.classList.contains('hidden') ? '🔼 Masquer l\'historique' : '🔍 Voir l\'historique';
        });
        questionDiv.appendChild(historyList);
      }

      const id = cleanString(q.label);
      if (!isSkipped) {
        if (q.type === 'slider') {
          const input = document.createElement('input');
          input.type = 'range';
          input.name = id;
          input.min = 0;
          input.max = 10;
          input.value = 5;
          input.className = 'w-full mt-2';
          questionDiv.appendChild(input);
        } else if (q.type === 'radio') {
          const options = ["Oui", "Plutôt oui", "Moyen", "Plutôt non", "Non"];
          const optionsDiv = document.createElement('div');
          optionsDiv.className = 'flex flex-wrap gap-2 mt-2';
          options.forEach(opt => {
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.id = `${id}-${opt}`;
            radio.name = id;
            radio.value = opt;
            radio.className = 'hidden peer';
            
            const radioLabel = document.createElement('label');
            radioLabel.htmlFor = `${id}-${opt}`;
            radioLabel.textContent = opt;
            radioLabel.className = 'px-3 py-1 border rounded-full cursor-pointer hover:bg-gray-100 peer-checked:bg-blue-500 peer-checked:text-white';
            
            optionsDiv.appendChild(radio);
            optionsDiv.appendChild(radioLabel);
          });
          questionDiv.appendChild(optionsDiv);
        } else if (q.type === 'text') {
          const input = document.createElement('textarea');
          input.name = id;
          input.placeholder = "Votre réponse...";
          input.className = 'w-full p-2 border rounded-md mt-2';
          questionDiv.appendChild(input);
        }
      }

      questionsContainer.appendChild(questionDiv);
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    showLoading();

    const formData = new FormData(form);
    const data = {
      _user: appState.user,
      _date: appState.mode === 'daily' ? appState.selectedDate.toISOString().split("T")[0] : '__practice__',
      mode: appState.mode,
      category: appState.category
    };

    formData.forEach((value, key) => {
      data[key] = value;
    });

    const options = {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json'
      }
    };

    try {
      const response = await fetch(getScriptUrl(), options);
      const text = await response.text();
      statusMessage.textContent = text;
      statusMessage.className = 'text-green-600 font-bold';
      fetchQuestions();
    } catch (error) {
      console.error('Erreur lors de l’envoi des données:', error);
      statusMessage.textContent = 'Erreur: Échec de l’enregistrement.';
      statusMessage.className = 'text-red-600 font-bold';
    } finally {
      hideLoading();
    }
  }

  function updateUrlWithState() {
    const params = new URLSearchParams(window.location.search);
    if (appState.user) params.set('user', appState.user);
    if (appState.mode) params.set('mode', appState.mode);
    if (appState.category) params.set('cat', appState.category);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }

  async function fetchCategories() {
    try {
      const url = `${getScriptUrl()}?user=${appState.user}&categoriesOnly=true`;
      const response = await fetch(url);
      return await response.json();
    } catch (error) {
      console.error('Erreur lors de la récupération des catégories:', error);
      return [];
    }
  }

  function renderCategories(categories) {
    categorySelect.innerHTML = '<option value="">Toutes les catégories</option>';
    categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      categorySelect.appendChild(option);
    });
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    appState.user = params.get('user') || 'user1';
    appState.mode = params.get('mode') || 'daily';
    appState.category = params.get('cat') || '';
    
    userTitle.textContent = `Utilisateur : ${appState.user}`;

    await fetchApiUrl(appState.user);
    populateModeOrDateSelect();
    
    // Initialiser le sélecteur avec les valeurs de l'URL ou par défaut
    if (appState.mode === 'daily') {
        const todayIso = new Date().toISOString().split("T")[0];
        modeOrDateSelect.value = appState.selectedDate ? appState.selectedDate.toISOString().split("T")[0] : todayIso;
        categoryBlock.classList.add('hidden');
    } else if (appState.mode === 'practice') {
        modeOrDateSelect.value = 'practice';
        categoryBlock.classList.remove('hidden');
        await fetchCategories();
        if (appState.category) {
            categorySelect.value = appState.category;
        }
    }

    modeOrDateSelect.addEventListener('change', async (e) => {
        const value = e.target.value;
        if (value === 'practice') {
          appState.mode = 'practice';
          appState.selectedDate = null;
          categoryBlock.classList.remove('hidden');
          await fetchCategories();
        } else {
          appState.mode = 'daily';
          appState.selectedDate = new Date(value);
          categoryBlock.classList.add('hidden');
        }

        updateUrlWithState();
        fetchQuestions();
    });

    categorySelect.addEventListener('change', () => {
      appState.category = categorySelect.value;
      updateUrlWithState();
      fetchQuestions();
    });

    form.addEventListener('submit', handleSubmit);
    fetchQuestions();
  }
  
  init();
});