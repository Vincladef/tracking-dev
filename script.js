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
  const datePicker = document.getElementById('datePicker');
  const userSelect = document.getElementById('userSelect');
  const modeSelect = document.getElementById('modeSelect');
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

  function formatDateForAPI(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function updateDatePicker() {
    datePicker.value = formatDateForAPI(appState.selectedDate);
  }

  function updateModeAndCategoryDisplay() {
    const isPracticeMode = appState.mode === 'practice';
    categorySelect.parentNode.style.display = isPracticeMode ? 'block' : 'none';
    datePicker.parentNode.style.display = isPracticeMode ? 'none' : 'block';
  }

  async function fetchQuestions() {
    if (!appState.user) {
      statusMessage.textContent = 'Veuillez sélectionner un utilisateur.';
      questionsContainer.innerHTML = '';
      form.style.display = 'none';
      return;
    }

    // Assurez-vous que l'URL est bien chargée avant de faire la requête
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
      date: appState.mode === 'daily' ? formatDateForAPI(appState.selectedDate) : ''
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

  function getColorClass(value) {
    const val = value.toLowerCase();
    if (val.includes('oui')) return 'text-green-600';
    if (val.includes('non')) return 'text-red-600';
    if (val.includes('moyen')) return 'text-yellow-600';
    return 'text-gray-500';
  }

  function renderQuestions(questions) {
    questionsContainer.innerHTML = '';
    form.reset();

    if (questions.length === 0) {
      statusMessage.textContent = appState.mode === 'practice'
        ? 'Aucune pratique délibérée trouvée pour cette catégorie.'
        : 'Rien à remplir pour aujourd\'hui. Profite de ta journée !';
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
          historyToggle.textContent = historyList.classList.contains('hidden') ? '🔍 Voir l\'historique' : '🔼 Masquer l\'historique';
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
            radio.className = 'hidden';
            
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
      _date: appState.mode === 'daily' ? formatDateForAPI(appState.selectedDate) : '__practice__',
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

  async function init() {
    const params = new URLSearchParams(window.location.search);
    appState.user = params.get('user') || 'user1';
    appState.mode = params.get('mode') || 'daily';
    appState.category = params.get('cat') || '';

    await fetchApiUrl(appState.user);

    userSelect.value = appState.user;
    modeSelect.value = appState.mode;

    updateModeAndCategoryDisplay();
    updateDatePicker();

    if (appState.mode === 'practice') {
      const categories = await fetchCategories();
      renderCategories(categories);
      if (appState.category) {
        categorySelect.value = appState.category;
      }
    }

    userSelect.addEventListener('change', async () => {
      appState.user = userSelect.value;
      await fetchApiUrl(appState.user);
      updateUrlWithState();
      fetchQuestions();
    });

    modeSelect.addEventListener('change', () => {
      appState.mode = modeSelect.value;
      updateModeAndCategoryDisplay();
      updateUrlWithState();
      fetchQuestions();
    });

    categorySelect.addEventListener('change', () => {
      appState.category = categorySelect.value;
      updateUrlWithState();
      fetchQuestions();
    });

    datePicker.addEventListener('change', (e) => {
      appState.selectedDate = new Date(e.target.value);
      fetchQuestions();
    });

    form.addEventListener('submit', handleSubmit);
    fetchQuestions();
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

  init();
});