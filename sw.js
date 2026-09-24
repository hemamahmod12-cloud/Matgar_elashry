const CACHE_NAME = 'matgar-elashry-shell-v5';
const SAME_ORIGIN_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './src/shared-utils.js',
  './src/sale-calculator.js',
  './src/store-repository.js',
  './src/collections-repository.js',
  './src/offline-queue.js',
  './src/offline-status.js'
];
const THIRD_PARTY_SHELL = [
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions-compat.js'
];

async function cacheRequest(cache, url, options) {
  try {
    const response = await fetch(url, options);
    if (response.ok || response.type === 'opaque') await cache.put(url, response);
  } catch (_) {
    // يبقى التطبيق قابلًا للتثبيت حتى إذا تعذر تحميل مورد خارجي أثناء أول زيارة.
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SAME_ORIGIN_SHELL.map(url => cacheRequest(cache, url)));
    await Promise.all(THIRD_PARTY_SHELL.map(url => cacheRequest(cache, url, { mode: 'no-cors' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('sync', event => {
  if (event.tag !== 'matgar-offline-sync') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.forEach(client => client.postMessage({ type: 'matgar-offline-sync' }));
  }));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // صفحات HTML تُحدّث من الشبكة أولًا حتى لا يظل المستخدم على نسخة قديمة بعد النشر.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        return caches.match(request).then(cached => cached || caches.match('./index.html'));
      }
    })());
    return;
  }

  // لا نحتجز طلبات Firebase/Firestore أو أي كتابة سحابية داخل Service Worker.
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com') ||
      url.pathname.includes('/firestore') ||
      url.pathname.includes('/identitytoolkit')) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && url.origin === self.location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      return caches.match('./index.html');
    }
  })());
});
