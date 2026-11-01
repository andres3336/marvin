import {
  APP_NAME,
  APP_VERSION,
  CACHE_KEY,
  CSV_URL,
  CSV_URL_KEY,
  THEME_KEY,
} from './config.js';
import { parseTransactions } from './csv.js';
import {
  formatColones,
  formatDayMonth,
  formatMonthHeading,
  formatNumber,
  monthKey,
  relativeTime,
} from './format.js';

const PAGE_SIZE = 60;
const REFRESH_AFTER_MS = 5 * 60 * 1000;

let csvUrl = readCsvUrl();
let currentController = null;
let requestToken = 0;
let toastTimer = 0;
let deferredPrompt = null;

const state = {
  all: [],
  fetchedAt: 0,
  status: 'loading', // loading | cached | ready | offline | stale | error
  loading: false,
  visible: PAGE_SIZE,
  online: navigator.onLine,
};

const els = {
  totalAmount: document.getElementById('total-amount'),
  summaryCount: document.getElementById('summary-count'),
  summarySpent: document.getElementById('summary-spent'),
  summaryCredits: document.getElementById('summary-credits'),
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  transactions: document.getElementById('transactions'),
  resultsCount: document.getElementById('results-count'),
  loadMore: document.getElementById('load-more'),
  empty: document.getElementById('empty-state'),
  emptyIcon: document.getElementById('empty-icon'),
  emptyTitle: document.getElementById('empty-title'),
  emptyText: document.getElementById('empty-text'),
  emptyAction: document.getElementById('empty-action'),
  refreshBtn: document.getElementById('refresh-btn'),
  themeBtn: document.getElementById('theme-btn'),
  installBtn: document.getElementById('install-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsForm: document.getElementById('settings-form'),
  settingsUrl: document.getElementById('settings-url'),
  settingsClose: document.getElementById('settings-close'),
  settingsDefault: document.getElementById('settings-default'),
  settingsError: document.getElementById('settings-error'),
  toast: document.getElementById('toast'),
};

const EMPTY_ICONS = {
  offline:
    '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M8.5 8.5A7 7 0 0 1 18 10m-9.5 6a3 3 0 0 1 4.2 0M5 5a12 12 0 0 0-2 1.5M19 6.5A12 12 0 0 1 21 8M2 9a17 17 0 0 1 4-2.5M18 6.5A17 17 0 0 1 22 9"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 14h4l2 3h4l2-3h4"/></svg>',
};

/* ------------------------------------------------------------- data source */

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function readCsvUrl() {
  try {
    const saved = localStorage.getItem(CSV_URL_KEY);
    if (saved && isHttpUrl(saved)) return saved;
  } catch {
    /* storage can be blocked */
  }
  return CSV_URL;
}

/* ------------------------------------------------------------------ theme */

function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function preferredTheme() {
  return (
    storedTheme() ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

function applyTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode */
    }
  }

  const label = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  els.themeBtn.setAttribute('aria-label', label);
  els.themeBtn.title = label;

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#050b14' : '#063a75');
}

/* ------------------------------------------------------------------ cache */

function sortByDate(transactions) {
  return transactions
    .slice()
    .sort((a, b) => b.date.getTime() - a.date.getTime() || a.index - b.index);
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;

    const cached = JSON.parse(raw);
    if (!cached || cached.url !== csvUrl || !Array.isArray(cached.transactions)) {
      return false;
    }

    const transactions = cached.transactions
      .map((item, index) => {
        const date = new Date(item.date);
        const amount = Number(item.amount);
        if (Number.isNaN(date.getTime()) || !Number.isFinite(amount)) return null;
        return {
          id: item.id ?? `${date.getTime()}-${index}`,
          index: Number.isFinite(item.index) ? item.index : index,
          date,
          merchant: String(item.merchant ?? 'Sin comercio'),
          amount,
        };
      })
      .filter(Boolean);

    if (transactions.length === 0) return false;

    state.all = sortByDate(transactions);
    state.fetchedAt = Number(cached.fetchedAt) || 0;
    state.status = 'cached';
    return true;
  } catch {
    return false;
  }
}

function saveCache() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: 1,
        url: csvUrl,
        fetchedAt: state.fetchedAt,
        transactions: state.all.map((transaction) => ({
          id: transaction.id,
          index: transaction.index,
          date: transaction.date.toISOString(),
          merchant: transaction.merchant,
          amount: transaction.amount,
        })),
      }),
    );
  } catch {
    /* storage can be full or blocked */
  }
}

/* ------------------------------------------------------------------- data */

async function loadData({ announce = false } = {}) {
  const token = ++requestToken;
  currentController?.abort();

  const controller = new AbortController();
  currentController = controller;
  const requestedUrl = csvUrl;
  let timedOut = false;

  state.loading = true;
  state.status = 'loading';
  setLoading(true);
  renderStatus();

  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);

  try {
    const response = await fetch(requestedUrl, {
      cache: 'no-store',
      mode: 'cors',
      signal: controller.signal,
    });

    if (token !== requestToken) return;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const servedFromCache = response.headers.get('X-Marvin-Cache') === 'hit';
    const transactions = parseTransactions(await response.text());

    if (token !== requestToken) return;
    if (transactions.length === 0) {
      throw new Error('El documento no contiene movimientos válidos');
    }

    state.all = sortByDate(transactions);
    state.online = navigator.onLine;

    // The service worker can answer from its CSV cache. Keep the previous
    // timestamp in that case so "updated" stays honest.
    if (state.online && !servedFromCache) {
      state.fetchedAt = Date.now();
      state.status = 'ready';
    } else {
      state.status = state.online ? 'stale' : 'offline';
      if (!state.fetchedAt) state.fetchedAt = Date.now();
    }

    state.visible = PAGE_SIZE;
    saveCache();
    renderAll();

    if (announce) toast('Datos actualizados');
  } catch (error) {
    if (token !== requestToken) return;
    if (error.name === 'AbortError' && !timedOut) return;

    console.error(`[${APP_NAME}] No se pudieron cargar los datos`, error);

    if (state.all.length > 0) {
      state.status = state.online ? 'stale' : 'offline';
      renderStatus();
      toast('No se pudo actualizar. Mostrando los datos guardados.');
    } else {
      state.status = 'error';
      renderLoadError();
      toast('No se pudieron cargar los datos. Revise la conexión.');
    }
  } finally {
    window.clearTimeout(timeout);
    if (token === requestToken) {
      state.loading = false;
      currentController = null;
      setLoading(false);
    }
  }
}

function setLoading(isLoading) {
  els.refreshBtn.classList.toggle('is-spinning', isLoading);
  els.refreshBtn.disabled = isLoading;
  els.refreshBtn.setAttribute('aria-busy', String(isLoading));
}

function resetData() {
  state.all = [];
  state.fetchedAt = 0;
  state.status = 'loading';
  state.visible = PAGE_SIZE;

  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage can be blocked */
  }

  els.totalAmount.textContent = formatColones(0);
  els.summarySpent.textContent = formatColones(0);
  els.summaryCredits.textContent = formatColones(0);
  els.summaryCount.textContent = '0';
  els.resultsCount.textContent = '0';
  els.loadMore.hidden = true;
  els.transactions.hidden = false;
  els.transactions.replaceChildren(createSkeletons());
  hideEmpty();
  renderStatus();
}

/* ---------------------------------------------------------------- rendering */

function renderAll() {
  if (!state.all.length) return;
  renderSummary();
  renderTransactions();
  renderStatus();
}

function renderSummary() {
  const total = state.all.reduce((sum, transaction) => sum + transaction.amount, 0);
  const spent = state.all.reduce(
    (sum, transaction) => sum + (transaction.amount > 0 ? transaction.amount : 0),
    0,
  );
  const credits = Math.abs(
    state.all.reduce(
      (sum, transaction) => sum + (transaction.amount < 0 ? transaction.amount : 0),
      0,
    ),
  );

  els.totalAmount.textContent = formatColones(total);
  els.summarySpent.textContent = formatColones(spent);
  els.summaryCredits.textContent = credits > 0 ? `+${formatColones(credits)}` : formatColones(0);
  els.summaryCount.textContent = formatNumber(state.all.length);
  els.resultsCount.textContent = formatNumber(state.all.length);
}

function renderTransactions() {
  if (!state.all.length) return;

  const visible = state.all.slice(0, state.visible);
  const remaining = Math.max(0, state.all.length - state.visible);

  els.loadMore.hidden = remaining === 0;
  els.loadMore.textContent = `Mostrar más (${formatNumber(remaining)})`;

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';

  const table = document.createElement('table');
  table.className = 'tx-table';

  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent = 'Movimientos';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  for (const [label, className] of [
    ['Fecha', 'col-date'],
    ['Comercio', ''],
    ['Monto', 'col-amount'],
  ]) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    if (className) cell.className = className;
    cell.textContent = label;
    headRow.append(cell);
  }

  thead.append(headRow);

  const tbody = document.createElement('tbody');
  let currentMonth = null;

  for (const transaction of visible) {
    const key = monthKey(transaction.date);

    if (key !== currentMonth) {
      const divider = document.createElement('tr');
      divider.className = 'month-divider';

      const cell = document.createElement('td');
      cell.colSpan = 3;

      const label = document.createElement('span');
      label.className = 'month-divider-label';
      label.textContent = formatMonthHeading(key);

      cell.append(label);
      divider.append(cell);
      tbody.append(divider);
      currentMonth = key;
    }

    tbody.append(createTransactionRow(transaction));
  }

  table.append(caption, thead, tbody);
  wrap.append(table);
  els.transactions.replaceChildren(wrap);
}

function createTransactionRow(transaction) {
  const row = document.createElement('tr');
  row.className = 'tx-row';
  if (transaction.amount < 0) row.classList.add('is-credit');

  const dateCell = document.createElement('td');
  dateCell.className = 'tx-date';
  dateCell.textContent = formatDayMonth(transaction.date);

  const merchantCell = document.createElement('td');
  merchantCell.className = 'tx-merchant';
  merchantCell.textContent = transaction.merchant;
  merchantCell.title = transaction.merchant;

  const amountCell = document.createElement('td');
  amountCell.className = 'tx-amount';
  amountCell.textContent = formatColones(transaction.amount);

  row.append(dateCell, merchantCell, amountCell);
  return row;
}

function renderStatus() {
  const labels = {
    loading: state.all.length ? 'Actualizando…' : 'Cargando datos…',
    cached: state.fetchedAt
      ? `Datos guardados · ${relativeTime(state.fetchedAt)}`
      : 'Datos guardados',
    ready: state.fetchedAt ? `Actualizado ${relativeTime(state.fetchedAt)}` : 'Actualizado',
    offline: state.fetchedAt
      ? `Sin conexión · ${relativeTime(state.fetchedAt)}`
      : 'Sin conexión',
    stale: state.fetchedAt
      ? `No se pudo actualizar · ${relativeTime(state.fetchedAt)}`
      : 'No se pudo actualizar',
    error: 'No se pudieron cargar los datos',
  };

  els.status.dataset.state = state.status;
  els.statusText.textContent = labels[state.status] ?? '';
}

function createSkeletons() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 3; index += 1) {
    const row = document.createElement('div');
    row.className = 'skeleton skeleton-row';
    fragment.append(row);
  }
  return fragment;
}

function renderLoadError() {
  els.transactions.replaceChildren();
  els.transactions.hidden = true;
  els.resultsCount.textContent = '0';
  els.loadMore.hidden = true;
  showEmpty({
    kind: 'offline',
    title: 'No se pudieron cargar los datos',
    text: 'Revise la conexión o la URL del CSV en Ajustes e intente de nuevo.',
    action: 'Reintentar',
  });
  renderStatus();
}

function showEmpty({ kind, title, text, action }) {
  els.empty.hidden = false;
  els.emptyIcon.innerHTML = EMPTY_ICONS[kind] ?? EMPTY_ICONS.inbox;
  els.emptyTitle.textContent = title;
  els.emptyText.textContent = text;

  if (action) {
    els.emptyAction.hidden = false;
    els.emptyAction.textContent = action;
  } else {
    els.emptyAction.hidden = true;
  }
}

function hideEmpty() {
  els.empty.hidden = true;
}

/* ---------------------------------------------------------------- settings */

function openSettings() {
  els.settingsUrl.value = csvUrl;
  els.settingsError.hidden = true;
  els.settingsError.textContent = '';

  if (!els.settingsDialog.open) els.settingsDialog.showModal();

  window.requestAnimationFrame(() => {
    els.settingsUrl.focus();
    els.settingsUrl.select();
  });
}

function closeSettings() {
  if (els.settingsDialog.open) els.settingsDialog.close();
}

function showSettingsError(message) {
  els.settingsError.textContent = message;
  els.settingsError.hidden = false;
}

function saveSettings(event) {
  event.preventDefault();

  const nextUrl = els.settingsUrl.value.trim();
  if (!isHttpUrl(nextUrl)) {
    showSettingsError('Ingrese una URL http(s) válida.');
    els.settingsUrl.focus();
    return;
  }

  if (nextUrl === csvUrl) {
    closeSettings();
    toast('La fuente no cambió.');
    return;
  }

  try {
    localStorage.setItem(CSV_URL_KEY, nextUrl);
  } catch {
    /* use the URL for this session even if storage is blocked */
  }

  csvUrl = nextUrl;
  closeSettings();
  resetData();
  toast('Fuente actualizada. Cargando datos…');
  loadData({ announce: false });
}

/* ------------------------------------------------------------------ events */

function toast(message, duration = 3800) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), duration);
}

function bindEvents() {
  els.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  els.refreshBtn.addEventListener('click', () => loadData({ announce: true }));

  els.settingsBtn.addEventListener('click', openSettings);
  els.settingsClose.addEventListener('click', closeSettings);
  els.settingsForm.addEventListener('submit', saveSettings);

  els.settingsDefault.addEventListener('click', () => {
    els.settingsUrl.value = CSV_URL;
    els.settingsError.hidden = true;
    els.settingsUrl.focus();
    els.settingsUrl.select();
  });

  els.settingsDialog.addEventListener('click', (event) => {
    if (event.target === els.settingsDialog) closeSettings();
  });

  els.loadMore.addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    renderTransactions();
  });

  els.emptyAction.addEventListener('click', () => loadData({ announce: true }));

  window.addEventListener('online', () => {
    state.online = true;
    if (state.status === 'offline' || state.status === 'stale') {
      toast('Conexión restablecida');
      renderStatus();
      loadData({ announce: false });
    }
  });

  window.addEventListener('offline', () => {
    state.online = false;
    if (state.all.length > 0) state.status = 'offline';
    renderStatus();
    toast(
      state.all.length > 0
        ? 'Sin conexión. Mostrando los datos guardados.'
        : 'Sin conexión.',
    );
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const expired = Date.now() - state.fetchedAt > REFRESH_AFTER_MS;
    if (expired && !state.loading && state.all.length > 0) loadData({ announce: false });
  });
}

/* -------------------------------------------------------------------- pwa */

function setupInstallButton() {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  if (standalone) {
    els.installBtn.hidden = true;
    return;
  }

  els.installBtn.hidden = false;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    els.installBtn.hidden = false;
  });

  els.installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') els.installBtn.hidden = true;
      } catch {
        /* the prompt can be dismissed or unavailable */
      } finally {
        deferredPrompt = null;
      }
      return;
    }

    toast(
      'En Safari toque Compartir y luego “Agregar a pantalla de inicio”. En otros navegadores busque “Instalar aplicación” en el menú.',
      7000,
    );
  });

  window.addEventListener('appinstalled', () => {
    els.installBtn.hidden = true;
    deferredPrompt = null;
    toast('Marvin se instaló en este dispositivo');
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  try {
    const registration = await navigator.serviceWorker.register(
      new URL('./sw.js', document.baseURI),
      { scope: './', updateViaCache: 'none' },
    );

    if (!registration) return;

    if (registration.waiting) {
      toast('Hay una nueva versión disponible. Recargue para actualizarla.', 7000);
    }

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;

      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Hay una nueva versión disponible. Recargue para actualizarla.', 7000);
        }
      });
    });
  } catch (error) {
    console.warn(`[${APP_NAME}] No se pudo registrar el service worker`, error);
  }
}

/* ------------------------------------------------------------------- boot */

function fillVersion() {
  document.querySelectorAll('[data-version]').forEach((element) => {
    element.textContent = APP_VERSION;
  });
}

function init() {
  applyTheme(preferredTheme(), false);
  fillVersion();
  bindEvents();
  setupInstallButton();
  registerServiceWorker();

  if (loadCache()) renderAll();
  renderStatus();

  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  loadData({ announce: false });
  window.setInterval(renderStatus, 30_000);
}

init();
