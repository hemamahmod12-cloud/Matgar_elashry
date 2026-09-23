const CACHE_NAME = 'matgar-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',
  './src/offline-queue.js',
  './src/shared-utils.js',
  './src/sale-calculator.js',
  './src/store-repository.js',
  './src/collections-repository.js',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;
  const firebaseAsset = requestUrl.origin === 'https://www.gstatic.com';
  if (!sameOrigin && !firebaseAsset) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      }).catch(() => caches.match('./offline.html'));
    })
  );
});
