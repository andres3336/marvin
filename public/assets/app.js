import { APP_NAME, CACHE_KEY, CSV_URL, THEME_KEY } from './config.js';
import { parseTransactions } from './csv.js';
import {
  formatColones,
  formatMonthHeading,
  formatNumber,
  formatShortDate,
  formatTime,
  monthKey,
  normalizeText,
  relativeTime,
} from './format.js';

const PAGE_SIZE = 60;
const REFRESH_AFTER_MS = 5 * 60 * 1000;
const SEARCH_DELAY_MS = 140;

const state = {
  all: [],
  fetchedAt: 0,
  status: 'loading', // loading | cached | ready | offline | stale | error
  loading: false,
  search: '',
  merchant: '',
  visible: PAGE_SIZE,
  online: navigator.onLine,
};

const els = {
  totalLabel: document.getElementById('total-label'),
  totalAmount: document.getElementById('total-amount'),
  summaryCount: document.getElementById('summary-count'),
  summarySpent: document.getElementById('summary-spent'),
  summaryCredits: document.getElementById('summary-credits'),
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  transactions: document.getElementById('transactions'),
  resultsCount: document.getElementById('results-count'),
  txSubtitle: document.getElementById('tx-subtitle'),
  search: document.getElementById('filter-search'),
  merchant: document.getElementById('filter-merchant'),
  clearFilters: document.getElementById('clear-filters'),
  loadMore: document.getElementById('load-more'),
  empty: document.getElementById('empty-state'),
  emptyIcon: document.getElementById('empty-icon'),
  emptyTitle: document.getElementById('empty-title'),
  emptyText: document.getElementById('empty-text'),
  emptyAction: document.getElementById('empty-action'),
  refreshBtn: document.getElementById('refresh-btn'),
  themeBtn: document.getElementById('theme-btn'),
  installBtn: document.getElementById('install-btn'),
  toast: document.getElementById('toast'),
};

const EMPTY_ICONS = {
  search:
    '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>',
  offline:
    '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M8.5 8.5A7 7 0 0 1 18 10m-9.5 6a3 3 0 0 1 4.2 0M5 5a12 12 0 0 0-2 1.5M19 6.5A12 12 0 0 1 21 8M2 9a17 17 0 0 1 4-2.5M18 6.5A17 17 0 0 1 22 9"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 14h4l2 3h4l2-3h4"/></svg>',
};

let searchTimer = 0;
let toastTimer = 0;
let deferredPrompt = null;
let emptyActionKind = null;

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
  return storedTheme() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
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

  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#07110f' : '#073c35');
}

/* ------------------------------------------------------------------ cache */

function prepareTransactions(transactions) {
  return transactions.map((transaction) => ({
    ...transaction,
    searchText: normalizeText(transaction.merchant),
  }));
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;

    const cached = JSON.parse(raw);
    if (!cached || !Array.isArray(cached.transactions)) return false;

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

    state.all = prepareTransactions(transactions);
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
  if (state.loading) return;

  state.loading = true;
  state.status = 'loading';
  setLoading(true);
  renderStatus();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(CSV_URL, {
      cache: 'no-store',
      mode: 'cors',
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const servedFromCache = response.headers.get('X-Marvin-Cache') === 'hit';
    const transactions = parseTransactions(await response.text());
    if (transactions.length === 0) {
      throw new Error('El documento no contiene movimientos válidos');
    }

    state.all = prepareTransactions(transactions);
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
    state.loading = false;
    setLoading(false);
  }
}

function setLoading(isLoading) {
  els.refreshBtn.classList.toggle('is-spinning', isLoading);
  els.refreshBtn.disabled = isLoading;
  els.refreshBtn.setAttribute('aria-busy', String(isLoading));
}

/* --------------------------------------------------------------- filtering */

function isFiltering() {
  return Boolean(state.search || state.merchant);
}

function filteredTransactions() {
  const query = normalizeText(state.search);

  return state.all
    .filter((transaction) => {
      if (state.merchant && transaction.merchant !== state.merchant) return false;
      if (query && !transaction.searchText.includes(query)) return false;
      return true;
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime() || a.index - b.index);
}

/* ---------------------------------------------------------------- rendering */

function renderAll() {
  if (!state.all.length) return;
  renderMerchantOptions();
  renderSummary();
  renderTransactions();
  renderFilters();
  renderStatus();
}

function renderResults() {
  if (!state.all.length) return;
  renderMerchantOptions();
  renderSummary();
  renderTransactions();
  renderFilters();
}

function renderSummary() {
  const transactions = filteredTransactions();
  const total = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const spent = transactions.reduce(
    (sum, transaction) => sum + (transaction.amount > 0 ? transaction.amount : 0),
    0,
  );
  const credits = Math.abs(
    transactions.reduce(
      (sum, transaction) => sum + (transaction.amount < 0 ? transaction.amount : 0),
      0,
    ),
  );

  els.totalLabel.textContent = isFiltering() ? 'Total filtrado' : 'Total neto';
  els.totalAmount.textContent = formatColones(total);
  els.summarySpent.textContent = formatColones(spent);
  els.summaryCredits.textContent = credits > 0 ? `+${formatColones(credits)}` : formatColones(0);
  els.summaryCount.textContent = formatNumber(transactions.length);
  els.resultsCount.textContent = formatNumber(transactions.length);
  els.txSubtitle.textContent = isFiltering() ? 'Resultados filtrados' : 'Todos los movimientos';
}

function renderMerchantOptions() {
  const counts = new Map();
  for (const transaction of state.all) {
    counts.set(transaction.merchant, (counts.get(transaction.merchant) ?? 0) + 1);
  }

  const merchants = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
  const fragment = document.createDocumentFragment();

  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'Todos los comercios';
  fragment.append(all);

  for (const [merchant, count] of merchants) {
    const option = document.createElement('option');
    option.value = merchant;
    option.textContent = `${merchant} (${formatNumber(count)})`;
    fragment.append(option);
  }

  const exists = merchants.some(([merchant]) => merchant === state.merchant);
  if (!exists) state.merchant = '';

  els.merchant.replaceChildren(fragment);
  els.merchant.value = state.merchant;
}

function renderTransactions() {
  if (!state.all.length) return;

  const transactions = filteredTransactions();
  const visible = transactions.slice(0, state.visible);
  const remaining = Math.max(0, transactions.length - state.visible);

  els.loadMore.hidden = remaining === 0;
  els.loadMore.textContent = `Mostrar más (${formatNumber(remaining)})`;

  if (transactions.length === 0) {
    els.transactions.replaceChildren();
    els.transactions.hidden = true;
    showEmpty({
      kind: 'search',
      title: 'Sin resultados',
      text: 'No hay movimientos que coincidan con los filtros actuales.',
      action: 'Limpiar filtros',
      actionKind: 'clear',
    });
    return;
  }

  hideEmpty();
  els.transactions.hidden = false;

  // Monthly totals are computed from the filtered set, not only the loaded page.
  const monthTotals = new Map();
  for (const transaction of transactions) {
    const key = monthKey(transaction.date);
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + transaction.amount);
  }

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

      const inner = document.createElement('div');
      inner.className = 'month-divider-inner';

      const label = document.createElement('span');
      label.className = 'month-divider-label';
      label.textContent = formatMonthHeading(key);

      const monthTotal = monthTotals.get(key) ?? 0;
      const total = document.createElement('span');
      total.className = 'month-divider-total';
      if (monthTotal < 0) total.classList.add('is-credit');
      total.textContent = formatColones(monthTotal);

      inner.append(label, total);
      cell.append(inner);
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

  const day = document.createElement('span');
  day.className = 'tx-date-day';
  day.textContent = formatShortDate(transaction.date);

  const time = document.createElement('span');
  time.className = 'tx-time';
  time.textContent = formatTime(transaction.date);

  dateCell.append(day, time);

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

function renderFilters() {
  els.clearFilters.hidden = !isFiltering();
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

function renderLoadError() {
  els.transactions.replaceChildren();
  els.transactions.hidden = true;
  els.resultsCount.textContent = '0';
  els.loadMore.hidden = true;
  showEmpty({
    kind: 'offline',
    title: 'No se pudieron cargar los datos',
    text: 'Revise su conexión a internet e intente de nuevo. La última copia guardada se conserva en este dispositivo.',
    action: 'Reintentar',
    actionKind: 'retry',
  });
  renderStatus();
}

function showEmpty({ kind, title, text, action, actionKind }) {
  els.empty.hidden = false;
  els.emptyIcon.innerHTML = EMPTY_ICONS[kind] ?? EMPTY_ICONS.inbox;
  els.emptyTitle.textContent = title;
  els.emptyText.textContent = text;

  if (action) {
    els.emptyAction.hidden = false;
    els.emptyAction.textContent = action;
    emptyActionKind = actionKind ?? null;
  } else {
    els.emptyAction.hidden = true;
    emptyActionKind = null;
  }
}

function hideEmpty() {
  els.empty.hidden = true;
  emptyActionKind = null;
}

/* ------------------------------------------------------------------ events */

function clearFilters() {
  state.search = '';
  state.merchant = '';
  state.visible = PAGE_SIZE;
  els.search.value = '';
  els.merchant.value = '';
  hideEmpty();
  renderResults();
}

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

  els.search.addEventListener('input', (event) => {
    const value = event.target.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = value;
      state.visible = PAGE_SIZE;
      renderResults();
    }, SEARCH_DELAY_MS);
  });

  els.merchant.addEventListener('change', (event) => {
    state.merchant = event.target.value;
    state.visible = PAGE_SIZE;
    renderResults();
  });

  els.clearFilters.addEventListener('click', clearFilters);

  els.loadMore.addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    renderTransactions();
  });

  els.emptyAction.addEventListener('click', () => {
    if (emptyActionKind === 'clear') clearFilters();
    if (emptyActionKind === 'retry') loadData({ announce: true });
  });

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

  // Chrome/Edge expose a native prompt; other browsers get instructions.
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

function init() {
  applyTheme(preferredTheme(), false);
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
