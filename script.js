// ===================================
//  CONFIG
// ===================================
// Remplacez 'YOUR_MACRO_ID' par l'ID de votre application web Google Apps Script
const API_URL = 'https://script.google.com/macros/s/YOUR_MACRO_ID/exec';
const URL_PRACTICE = `${API_URL}?mode=practice`;
const URL_DAILY = `${API_URL}?mode=daily`;

// ===================================
//  CONSTANTES & HELPERS
// ===================================

const ANSWER_VALUES = {
  "oui": 1,
  "plutot oui": 0.75,
  "moyen": 0.25,
  "plutot non": 0,
  "non": -1,
  "pas de reponse": 0
};

const ANSWER_LABELS = {
  "oui": "Oui",
  "plutot oui": "Plutôt oui",
  "moyen": "Moyen",
  "plutot non": "Plutôt non",
  "non": "Non",
  "pas de reponse": "Non répondu"
};

// Couleurs en format RGBA pour une compatibilité directe avec Chart.js
const ANSWER_COLORS = {
  "oui": "rgba(34,197,94,0.9)",       // green-500
  "plutot oui": "rgba(132,204,22,0.9)", // lime-500
  "moyen": "rgba(245,158,11,0.9)",    // amber-500
  "plutot non": "rgba(249,115,22,0.9)",// orange-500
  "non": "rgba(239,68,68,0.9)",       // red-500
  "pas de reponse": "rgba(209,213,219,0.9)" // gray-300
};

// Couleurs pour le graphique de score quotidien (échelle 0-6)
const DAILY_SCORE_COLORS = {
  "0": 'rgb(239, 68, 68)',   // Rouge
  "1": 'rgb(249, 115, 22)',   // Orange foncé
  "2": 'rgb(245, 158, 11)',   // Orange
  "3": 'rgb(234, 179, 8)',    // Jaune
  "4": 'rgb(132, 204, 22)',   // Vert clair
  "5": 'rgb(84, 182, 17)',    // Vert
  "6": 'rgb(34, 197, 94)',    // Vert foncé
};

// Nettoie une chaîne de caractères pour une comparaison insensible à la casse et aux accents
function clean(str) {
  return (str || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u00A0\u202F\u200B]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// ===================================
//  FONCTIONS DE RENDU (GRAPHIQUES)
// ===================================
const chartRegistry = {}; // Stocke les instances Chart.js pour les détruire avant de les recréer

// Affiche un graphique de type Likert pour l'historique d'une question
function renderLikertChart(id, history) {
  const chartEl = document.getElementById(id);
  if (!chartEl) return;

  const ctx = chartEl.getContext('2d');
  
  const WINDOW = 30; // Nombre de points affichés pour éviter de surcharger le graphique
  const windowed = history.slice(0, WINDOW);     // Sélectionne les entrées les plus récentes
  const reversedHistory = [...windowed].reverse(); // Inverse pour un ordre chronologique (ancien → récent)

  const labels = [];
  const data = [];
  const colors = [];

  for (const hist of reversedHistory) {
    const raw = hist?.date || hist?.key || "";
    // Extrait la date au format "dd/mm" à partir des en-têtes
    const m = raw.match(/\((\d{2}\/\d{2}\/\d{4})\)/) || raw.match(/^(\d{2}\/\d{2}\/\d{4})$/);
    const formattedDate = m ? m[1].slice(0,5) : ""; 
    const value = clean(hist.value);

    labels.push(formattedDate);
    data.push(ANSWER_VALUES[value]);
    colors.push(ANSWER_COLORS[value] || 'rgba(209,213,219,0.9)');
  }
  
  // Ajuste la largeur du canvas pour éviter l'écrasement des barres
  chartEl.width = Math.max(300, labels.length * 24);

  const chartData = {
    labels: labels,
    datasets: [{
      label: 'Réponses',
      data: data,
      backgroundColor: colors,
      borderColor: colors,
      borderWidth: 1
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        min: -1,
        max: 1,
        ticks: {
          stepSize: 0.25,
          // Affiche un libellé clair pour chaque niveau de la réponse Likert
          callback: (v) => ({
            1: 'Oui',
            0.75: 'Plutôt oui',
            0.25: 'Moyen',
            0: 'Plutôt non',
            [-1]: 'Non'
          })[v] || ''
        }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: function(context) {
            const value = context.raw;
            const label = Object.keys(ANSWER_VALUES).find(key => ANSWER_VALUES[key] === value);
            return ANSWER_LABELS[label] || "Non répondu";
          }
        }
      }
    }
  };

  if (chartRegistry[id]) {
    chartRegistry[id].destroy();
  }

  chartRegistry[id] = new Chart(ctx, {
    type: 'bar',
    data: chartData,
    options: chartOptions
  });
}

// Affiche un graphique du score quotidien global
function renderDailyScoreChart(data) {
  const chartEl = document.getElementById('daily-score-chart');
  if (!chartEl) return;

  const ctx = chartEl.getContext('2d');
  
  const headers = {};
  data.forEach(q => {
    q.history.forEach(h => {
      const { value, date } = h;
      if (!headers[date]) headers[date] = [];
      headers[date].push(value);
    });
  });

  const sortedDates = Object.keys(headers).sort((a, b) => {
    const [d1, m1, y1] = a.split('/').map(Number);
    const [d2, m2, y2] = b.split('/').map(Number);
    return new Date(y1, m1 - 1, d1) - new Date(y2, m2 - 1, d2);
  });

  const labels = sortedDates.map(d => d.slice(0,5)); // "dd/mm"

  const scores = sortedDates.map(date => {
    const vals = headers[date].map(v => ANSWER_VALUES[clean(v)]).filter(x => x !== undefined);
    if (!vals.length) return 0;
    const avg = vals.reduce((a,b)=>a+b,0) / vals.length;   // Calcule la moyenne des réponses (-1..1)
    const score0to6 = Math.round((avg + 1) * 3);           // Mappe la moyenne sur une échelle de 0..6
    return score0to6;
  });
  
  const chartData = {
    labels: labels,
    datasets: [{
      label: 'Score Quotidien',
      data: scores,
      backgroundColor: scores.map(s => DAILY_SCORE_COLORS[s.toString()]),
      borderColor: scores.map(s => DAILY_SCORE_COLORS[s.toString()]),
      borderWidth: 1
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        min: 0,
        max: 6,
        ticks: { stepSize: 1 }
      },
      x: { grid: { display: false } }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: function(context) {
            const score = context.raw;
            return `Score: ${score}`;
          }
        }
      }
    }
  };

  if (chartRegistry['daily-score-chart']) {
    chartRegistry['daily-score-chart'].destroy();
  }

  chartRegistry['daily-score-chart'] = new Chart(ctx, {
    type: 'bar',
    data: chartData,
    options: chartOptions
  });
}


// ===================================
//  GESTION DES PAGES ET DONNÉES
// ===================================
const pageDaily = document.getElementById('page-daily');
const pagePractice = document.getElementById('page-practice');

let dailyData = [];

// Charge les données pour le mode journalier à une date donnée
async function loadDailyData(dateStr) {
  const loadingEl = document.getElementById('daily-loading');
  const questionsListEl = document.getElementById('daily-questions-list');
  questionsListEl.innerHTML = '';
  loadingEl.classList.remove('hidden');

  try {
    const url = `${URL_DAILY}&date=${dateStr}`;
    const response = await fetch(url);
    const data = await response.json();
    dailyData = data;
    renderDailyPage(data);
    renderDailyScoreChart(data);
  } catch (err) {
    console.error("Erreur lors du chargement des données journalières", err);
    alert("Erreur de chargement des données.");
  } finally {
    loadingEl.classList.add('hidden');
  }
}

// Affiche la page journalière avec les questions et graphiques
function renderDailyPage(data) {
  const questionsListEl = document.getElementById('daily-questions-list');
  questionsListEl.innerHTML = '';

  data.forEach(q => {
    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded-lg shadow-md mb-4';
    card.innerHTML = `
      <h3 class="font-bold text-lg mb-2">${q.label}</h3>
      <p class="text-sm text-gray-500 mb-2">${q.type}</p>
      ${q.reason ? `<div class="bg-blue-100 text-blue-800 p-2 rounded-md">${q.reason}</div>` : ''}
      <div class="mt-4">
        ${!q.skipped ? `
          <div class="flex flex-wrap gap-2 mb-4">
            ${Object.keys(ANSWER_LABELS).map(val => {
              if (val === "pas de reponse") return '';
              return `<button class="answer-btn bg-gray-200 text-gray-800 px-4 py-2 rounded-full hover:bg-gray-300" data-question-id="${q.id}" data-value="${val}">${ANSWER_LABELS[val]}</button>`;
            }).join('')}
          </div>
        ` : ''}
        ${q.history && q.history.length > 0 ? `
          <div class="w-full h-24 overflow-x-auto">
            <canvas id="chart-daily-${q.id}"></canvas>
          </div>
        ` : ''}
      </div>
    `;
    questionsListEl.appendChild(card);
    if (q.history && q.history.length > 0) {
      renderLikertChart(`chart-daily-${q.id}`, q.history);
    }
  });

  document.querySelectorAll('#page-daily .answer-btn').forEach(btn => {
    btn.addEventListener('click', handleDailyAnswer);
  });
}

// Gère la sélection des réponses pour le mode journalier
function handleDailyAnswer(e) {
  const btn = e.target;
  const questionId = btn.dataset.questionId;
  const answerValue = btn.dataset.value;
  const q = dailyData.find(d => d.id === questionId);

  if (!q) return;

  const currentAnswer = clean(q.history?.[0]?.value);
  if (currentAnswer === answerValue) {
      q.history[0].value = ''; // Désélectionne si l'utilisateur clique sur la même réponse
  } else if (q.history?.[0]?.date) {
      q.history[0].value = answerValue; // Met à jour l'historique
  } else {
      q.history.unshift({ value: answerValue, date: document.getElementById('daily-date').value });
  }

  // Met à jour l'état visuel des boutons de réponse
  const card = btn.closest('.bg-white');
  card.querySelectorAll('.answer-btn').forEach(b => {
      if (clean(q.history?.[0]?.value) === b.dataset.value) {
          b.classList.add('bg-blue-500', 'text-white', 'hover:bg-blue-600');
          b.classList.remove('bg-gray-200', 'text-gray-800', 'hover:bg-gray-300');
      } else {
          b.classList.remove('bg-blue-500', 'text-white', 'hover:bg-blue-600');
          b.classList.add('bg-gray-200', 'text-gray-800', 'hover:bg-gray-300');
      }
  });

  // Met à jour le graphique de l'historique de la question
  const chartId = `chart-daily-${questionId}`;
  if (chartRegistry[chartId]) {
    chartRegistry[chartId].destroy();
  }
  renderLikertChart(chartId, q.history);

  // Met à jour le graphique du score quotidien global
  renderDailyScoreChart(dailyData);
}

// Envoie les réponses journalières au script Apps Script
async function submitDailyData() {
  const loadingEl = document.getElementById('daily-loading');
  loadingEl.classList.remove('hidden');
  const submitBtn = document.getElementById('daily-submit-btn');
  submitBtn.disabled = true;

  try {
    const dataToSend = {
      _mode: 'daily',
      _date: document.getElementById('daily-date').value
    };
    dailyData.forEach(q => {
      const answer = q.history?.[0]?.value;
      if (answer) {
        dataToSend[q.id] = answer;
      }
    });

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataToSend)
    });

    const text = await response.text();
    alert(text);
    if (response.ok) {
      await loadDailyData(document.getElementById('daily-date').value);
    }
  } catch (err) {
    console.error("Erreur lors de l'envoi des données", err);
    alert("Erreur de soumission des données.");
  } finally {
    loadingEl.classList.add('hidden');
    submitBtn.disabled = false;
  }
}

// Charge la liste des catégories pour le mode "Pratique Délibérée"
async function loadPracticeCategories() {
  const loadingEl = document.getElementById('practice-loading');
  const categoriesListEl = document.getElementById('practice-categories');
  loadingEl.classList.remove('hidden');

  try {
    const response = await fetch(URL_PRACTICE);
    const categories = await response.json();
    categoriesListEl.innerHTML = '';
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'category-btn bg-gray-200 text-gray-800 px-4 py-2 rounded-full hover:bg-gray-300';
      btn.textContent = cat;
      btn.dataset.category = cat;
      categoriesListEl.appendChild(btn);
    });

    document.querySelectorAll('.category-btn').forEach(btn => {
      btn.addEventListener('click', () => loadPracticeQuestions(btn.dataset.category));
    });

    pagePractice.dataset.state = 'categories';
  } catch (err) {
    console.error("Erreur lors du chargement des catégories", err);
    alert("Erreur de chargement des catégories.");
  } finally {
    loadingEl.classList.add('hidden');
  }
}

let practiceData = [];
let currentCategory = null;

// Charge les questions pour une catégorie de pratique donnée
async function loadPracticeQuestions(category) {
  currentCategory = category;
  const loadingEl = document.getElementById('practice-loading');
  const questionsListEl = document.getElementById('practice-questions-list');
  questionsListEl.innerHTML = '';
  loadingEl.classList.remove('hidden');
  document.getElementById('practice-category-title').textContent = `Pratique délibérée : ${category}`;

  try {
    const url = `${URL_PRACTICE}&category=${encodeURIComponent(category)}`;
    const response = await fetch(url);
    const data = await response.json();
    practiceData = data;
    renderPracticePage(data);
  } catch (err) {
    console.error("Erreur lors du chargement des questions de pratique", err);
    alert("Erreur de chargement des questions de pratique.");
  } finally {
    loadingEl.classList.add('hidden');
  }
}

// Affiche la page de pratique avec les questions
function renderPracticePage(data) {
  const questionsListEl = document.getElementById('practice-questions-list');
  questionsListEl.innerHTML = '';
  const submitBtn = document.getElementById('practice-submit-btn');
  submitBtn.disabled = false;
  
  const questionsToAnswer = data.filter(q => !q.skipped);

  if (questionsToAnswer.length === 0) {
      questionsListEl.innerHTML = `<p class="text-gray-500">🎉 Aucune question à répondre aujourd'hui dans cette catégorie !</p>`;
      submitBtn.disabled = true;
  } else {
    questionsToAnswer.forEach(q => {
      const card = document.createElement('div');
      card.className = 'bg-white p-4 rounded-lg shadow-md mb-4';
      card.innerHTML = `
        <h3 class="font-bold text-lg mb-2">${q.label}</h3>
        <p class="text-sm text-gray-500 mb-2">${q.type}</p>
        <div class="mt-4">
          <div class="flex flex-wrap gap-2 mb-4">
            ${Object.keys(ANSWER_LABELS).map(val => {
              if (val === "pas de reponse") return '';
              return `<button class="answer-btn bg-gray-200 text-gray-800 px-4 py-2 rounded-full hover:bg-gray-300" data-question-id="${q.id}" data-value="${val}">${ANSWER_LABELS[val]}</button>`;
            }).join('')}
          </div>
          ${q.history && q.history.length > 0 ? `
            <div class="w-full h-24 overflow-x-auto">
              <canvas id="chart-practice-${q.id}"></canvas>
            </div>
          ` : ''}
        </div>
      `;
      questionsListEl.appendChild(card);
      if (q.history && q.history.length > 0) {
        renderLikertChart(`chart-practice-${q.id}`, q.history);
      }
    });
  }

  // Affiche les questions masquées par la Répétition Espacée
  const skippedQuestions = data.filter(q => q.skipped);
  if (skippedQuestions.length > 0) {
    const skippedTitle = document.createElement('h3');
    skippedTitle.className = 'font-bold text-lg mt-8 mb-4';
    skippedTitle.textContent = 'Questions masquées (SR)';
    questionsListEl.appendChild(skippedTitle);

    skippedQuestions.forEach(q => {
      const card = document.createElement('div');
      card.className = 'bg-white p-4 rounded-lg shadow-md mb-4 opacity-50';
      card.innerHTML = `
        <h3 class="font-bold text-lg mb-2">${q.label}</h3>
        <p class="text-sm text-gray-500 mb-2">${q.type}</p>
        ${q.reason ? `<div class="bg-blue-100 text-blue-800 p-2 rounded-md mt-4">${q.reason}</div>` : ''}
        ${q.history && q.history.length > 0 ? `
          <div class="w-full h-24 overflow-x-auto">
            <canvas id="chart-practice-${q.id}"></canvas>
          </div>
        ` : ''}
      `;
      questionsListEl.appendChild(card);
      if (q.history && q.history.length > 0) {
        renderLikertChart(`chart-practice-${q.id}`, q.history);
      }
    });
  }
  
  document.querySelectorAll('#page-practice .answer-btn').forEach(btn => {
    btn.addEventListener('click', handlePracticeAnswer);
  });
  
  pagePractice.dataset.state = 'questions';
}

// Gère la sélection des réponses pour le mode "Pratique Délibérée"
function handlePracticeAnswer(e) {
  const btn = e.target;
  const questionId = btn.dataset.questionId;
  const answerValue = btn.dataset.value;
  const q = practiceData.find(d => d.id === questionId);

  if (!q) return;

  const currentAnswer = btn.closest('.flex').querySelector('.bg-blue-500')?.dataset.value || null;

  // Désélectionne si l'utilisateur clique sur la même réponse
  if (currentAnswer === answerValue) {
    q.history.unshift({ value: '', date: null, key: null });
  } else {
    q.history.unshift({ value: answerValue, date: null, key: null });
  }

  // Met à jour l'état visuel des boutons
  const allButtons = btn.closest('.flex').querySelectorAll('.answer-btn');
  allButtons.forEach(b => {
    b.classList.remove('bg-blue-500', 'text-white', 'hover:bg-blue-600');
    b.classList.add('bg-gray-200', 'text-gray-800', 'hover:bg-gray-300');
  });

  const newAnswer = clean(q.history[0]?.value);
  if (newAnswer) {
    const newActiveBtn = btn.closest('.flex').querySelector(`[data-value="${newAnswer}"]`);
    if (newActiveBtn) {
      newActiveBtn.classList.add('bg-blue-500', 'text-white', 'hover:bg-blue-600');
      newActiveBtn.classList.remove('bg-gray-200', 'text-gray-800', 'hover:bg-gray-300');
    }
  }

  // Met à jour le graphique de l'historique
  const chartId = `chart-practice-${questionId}`;
  if (chartRegistry[chartId]) {
    chartRegistry[chartId].destroy();
  }
  renderLikertChart(chartId, q.history);
}

// Envoie les réponses de pratique au script Apps Script
async function submitPracticeData() {
  const loadingEl = document.getElementById('practice-loading');
  loadingEl.classList.remove('hidden');
  const submitBtn = document.getElementById('practice-submit-btn');
  submitBtn.disabled = true;

  try {
    const dataToSend = {
      _mode: 'practice',
      _category: currentCategory,
    };
    practiceData.forEach(q => {
      if (!q.skipped) {
        dataToSend[q.id] = q.history?.[0]?.value || '';
      }
    });

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataToSend)
    });

    const text = await response.text();
    alert(text);
    if (response.ok) {
      await loadPracticeQuestions(currentCategory);
    }
  } catch (err) {
    console.error("Erreur lors de l'envoi des données de pratique", err);
    alert("Erreur de soumission des données.");
  } finally {
    loadingEl.classList.add('hidden');
    submitBtn.disabled = false;
  }
}

// ===================================
//  NAVIGATION ET INITIALISATION
// ===================================

document.getElementById('nav-daily-btn').addEventListener('click', () => {
  pageDaily.classList.remove('hidden');
  pagePractice.classList.add('hidden');
  loadDailyData(document.getElementById('daily-date').value);
});

document.getElementById('nav-practice-btn').addEventListener('click', () => {
  pagePractice.classList.remove('hidden');
  pageDaily.classList.add('hidden');
  loadPracticeCategories();
});

document.getElementById('daily-date').addEventListener('change', (e) => {
  loadDailyData(e.target.value);
});

document.getElementById('daily-submit-btn').addEventListener('click', submitDailyData);
document.getElementById('practice-submit-btn').addEventListener('click', submitPracticeData);

// Lance le chargement initial de la page "Journalier"
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  document.getElementById('daily-date').value = dateStr;
  loadDailyData(dateStr);
});
