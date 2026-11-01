/* eslint-env serviceworker */

/**
 * Marvin service worker.
 *
 * - App shell: cache first, then refresh in the background.
 * - Navigations: network first with an offline fallback to index.html.
 * - Published CSV: network first, cached copy available offline.
 *
 * Bump VERSION whenever the precache list changes.
 */

const VERSION = 'v1.1.0';
const SHELL_CACHE = `marvin-shell-${VERSION}`;
const DATA_CACHE = 'marvin-data-v2';
const DATA_HOST = 'docs.google.com';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/app.js',
  './assets/config.js',
  './assets/csv.js',
  './assets/format.js',
  './assets/icons/favicon.svg',
  './assets/icons/favicon-32.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE]);

  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.hostname === DATA_HOST) {
    event.respondWith(handleData(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./')) ||
      new Response('Marvin no está disponible sin conexión.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function handleData(request) {
  const cache = await caches.open(DATA_CACHE);

  try {
    const response = await fetchWithTimeout(request, 12_000);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    return new Response('', {
      status: 503,
      statusText: 'Sin conexión y sin copia guardada',
    });
  }
}

function staleWhileRevalidate(event) {
  const { request } = event;

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  event.waitUntil(network);

  return caches.open(SHELL_CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    return cached || (await network) || Response.error();
  });
}

function fetchWithTimeout(request, milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);

  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}
