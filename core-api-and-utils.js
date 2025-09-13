// -- Constantes & user --
export const WORKER_URL = "https://tight-snowflake-cdad.como-denizot.workers.dev/";
export const apiUrl = "https://script.google.com/macros/s/AKfycbyF2k4XNW6rqvME1WnPlpTFljgUJaX58x0jwQINd6XPyRVP3FkDOeEwtuierf_CcCI5hQ/exec";

const urlParams = new URLSearchParams(location.search);
export const user = urlParams.get("user")?.toLowerCase();

// -- Helpers généraux --
export const isAnswerKey = (k) => (
  /^\d+$/.test(k) ||               // ancien format (numérique pur)
  /^c_[0-9a-f]+$/i.test(k)         // nouveau format style "c_fd9b2014"
);

export function normalizeFRDate(raw) {
  if (!raw) return null;
  const s = String(raw);
  // Déjà en FR -> on renvoie tel quel
  if (s.includes('/')) return s;
  // ISO -> convertir
  const [y, m, d] = s.split('-');
  if (y && m && d) {
    return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
  }
  // Format inconnu -> ne tente rien
  return s;
}

export function toISODate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // dd/MM/yyyy -> yyyy-MM-dd
  if (s.includes("/")) {
    const [dd, mm, yyyy] = s.split("/");
    if (dd && mm && yyyy) {
      return `${String(yyyy).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    }
  }
  // yyyy-MM-dd -> yyyy-MM-dd (déjà ISO)
  if (s.includes("-")) {
    const [y, m, d] = s.split("-");
    if (y && m && d) {
      return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
  }
  return null;
}

export async function apiFetch(method, pathOrParams, opts = {}) {
  if (method !== "GET") throw new Error("apiFetch() n'est utilisé ici que pour GET");
  let query = pathOrParams || "";

  // Ajoute user=... à chaque GET
  if (!/[?&]user=/.test(query)) {
    query += (query.includes("?") ? "&" : "?") + "user=" + encodeURIComponent(user);
  }
  if (opts.fresh) {
    query += (query.includes("?") ? "&" : "?") + "nocache=1&_=" + Date.now();
  }

  const u = new URL(WORKER_URL);
  u.searchParams.set("apiUrl", apiUrl);
  u.searchParams.set("query", query);
  if (opts.fresh) u.searchParams.set("nocache", "1");

  const res = await fetch(u.toString());
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// -- Backoff POST --
export async function postWithRetry(url, body, {
  retries = 5,
  baseDelay = 800,      // ms
  maxDelay = 6000,      // ms
  jitter = 0.25         // ±25% de jitter
} = {}) {
  let attempt = 0, lastErr;

  while (attempt <= retries) {
    try {
      const res = await fetch(url, { 
        method: "POST", 
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) return res;

      // On retente seulement sur 429 et erreurs 5xx
      if (res.status !== 429 && (res.status < 500 || res.status > 599)) {
        const t = await res.text().catch(()=> "");
        throw new Error(t || `HTTP ${res.status}`);
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }

    attempt++;
    if (attempt > retries) break;

    const jitterMs = (Math.random()*2 - 1) * jitter * baseDelay;
    const delay = Math.min(maxDelay, Math.round(baseDelay * Math.pow(2, attempt - 1) + jitterMs));
    showToast("⏳ Quota atteint, tentative suivante…", "blue");
    await new Promise(r => setTimeout(r, delay));
  }
  throw lastErr;
}

export async function postWithBackoff(body, {
  maxRetries = 5,
  baseDelayMs = 500,
  retryOn = [429, 500, 502, 503, 504]
} = {}) {
  const attempt = async (n) => {
    const res = await fetch(WORKER_URL, { 
      method: "POST", 
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    }).catch(err => ({ ok:false, status:0, __netErr: String(err) }));

    if (res.ok) return res;
    const status = res.status || 0;
    const shouldRetry = retryOn.includes(status) || res.__netErr;

    console.warn(`[SUBMIT][try ${n}] status=${status} ${res.__netErr ? res.__netErr : ''}`);
    if (!shouldRetry || n >= maxRetries) return res;

    const jitter = Math.random() * 120;
    const delay = Math.floor(baseDelayMs * Math.pow(2, n-1) + jitter);
    await new Promise(r => setTimeout(r, delay));
    return attempt(n + 1);
  };
  console.log(`[SUBMIT] start, body keys =`, Object.keys(body));
  return attempt(1);
}

// -- Toasts & feedback --
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

export function showToast(message, tone = "green") {
  const t = ensureToast();
  const bg = tone === "red" ? "bg-red-600" : tone === "blue" ? "bg-blue-600" : "bg-green-600";
  t.className = `fixed top-4 right-4 ${bg} text-white px-4 py-2 rounded shadow z-50`;
  t.textContent = message;
  t.classList.remove("hidden");
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.add("hidden"), 2400);
}

export function flashSaved(anchorEl) {
  try {
    const target = anchorEl || document.body;
    const rect = target.getBoundingClientRect();
    const dot = document.createElement("div");
    dot.style.cssText = `
      position: fixed;
      left: ${Math.round(rect.right) - 6}px;
      top: ${Math.round(rect.top) - 6}px;
      width: 18px; height: 18px;
      background:#10b981; color:#fff; border-radius:9999px;
      display:flex; align-items:center; justify-content:center;
      font-size:12px; box-shadow:0 1px 4px rgba(0,0,0,.15);
      opacity:0; transform:scale(.6); transition:opacity .15s, transform .2s;
      z-index: 9999; pointer-events:none;
    `;
    dot.textContent = "✔";
    document.body.appendChild(dot);
    requestAnimationFrame(() => { dot.style.opacity = "1"; dot.style.transform = "scale(1)"; });
    setTimeout(() => { dot.style.opacity = "0"; }, 800);
    setTimeout(() => { dot.remove(); }, 1100);
  } catch {}
}

// -- Parsing backend --
export function toQuestions(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.consignes)) return raw.consignes;
  if (Array.isArray(raw?.questions)) return raw.questions;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.items)) return raw.items;
  if (typeof raw === "string") {
    const txt = raw.trim();
    if (txt.startsWith("<!DOCTYPE") || txt.startsWith("<html")) {
      console.error("⚠️ Le backend renvoie du HTML (probable erreur Apps Script).");
      return null;
    }
    try { return toQuestions(JSON.parse(txt)); } catch { return null; }
  }
  return null;
}

export function canonicalizeLikert(v) {
  const s = String(v || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[\u00A0\u202F\u200B]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}
