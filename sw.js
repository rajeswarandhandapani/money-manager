// Saves the app's own files for offline use. Bank data is never in here: it lives in IndexedDB.
// Tries the network first so updates show up, and falls back to the saved copy.
const CACHE = 'money-manager-v3';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './js/app.js',
  './js/charts.js',
  './js/classify.js',
  './js/dashboard.js',
  './js/parse.js',
  './js/report.js',
  './js/store.js',
  './js/ui.js',
  './js/workbook.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const offline = () => cache.match(request, { ignoreSearch: true }).then(hit => hit || cache.match('./index.html'));
    try {
      const response = await Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch {
      return (await offline()) || Response.error();
    }
  })());
});
