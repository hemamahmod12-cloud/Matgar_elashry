/* شريط الاتصال وعدّاد الفواتير المعلقة — يعمل مع state.parked وIndexedDB الحاليين. */
(function (global) {
  'use strict';

  const DB_NAME = 'storeSystemDB_v1';
  const STORE_NAME = 'kv';

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('indexeddb-unavailable'));
      const request = global.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
    });
  }

  function readLocal(key) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result == null ? null : request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb-read-failed'));
    }));
  }

  function parseArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  async function pendingCount() {
    if (global.MatgarAppState && Array.isArray(global.MatgarAppState.parked)) {
      return global.MatgarAppState.parked.length;
    }
    try {
      return parseArray(await readLocal('parked')).length;
    } catch (_) {
      return 0;
    }
  }

  function connectionText(online) {
    return online ? 'متصل بالإنترنت' : 'وضع العمل بدون إنترنت';
  }

  async function refresh() {
    const bar = document.getElementById('offlineStatusBar');
    const text = document.getElementById('connectionText');
    const count = document.getElementById('pendingInvoicesCount');
    const salesCount = document.getElementById('offlineSalesCount');
    const sync = document.getElementById('lastSyncText');
    if (!bar || !text || !count) return;

    const online = global.navigator.onLine;
    bar.classList.toggle('is-online', online);
    bar.classList.toggle('is-offline', !online);
    text.textContent = connectionText(online);
    const total = await pendingCount();
    count.textContent = String(total);
    count.setAttribute('aria-label', `${total} فواتير معلقة`);
    if (salesCount && global.MatgarOfflineQueue) {
      const queued = await global.MatgarOfflineQueue.count().catch(() => 0);
      salesCount.hidden = queued === 0;
      salesCount.textContent = `مبيعات تحتاج مزامنة: ${queued}`;
    }
    if (sync) {
      sync.textContent = `آخر فحص: ${new Date().toLocaleTimeString('ar-EG', {
        hour: '2-digit', minute: '2-digit'
      })}`;
    }
  }

  function init() {
    global.refreshOfflineStatus = refresh;
    global.addEventListener('online', refresh);
    global.addEventListener('offline', refresh);
    global.addEventListener('parked-invoices-changed', refresh);
    global.addEventListener('offline-queue-changed', refresh);
    const button = document.getElementById('pendingInvoicesButton');
    button?.addEventListener('click', () => {
      document.getElementById('parkedSection')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}(window));

// التسجيل هنا بعد تعريف التطبيق لا يعتمد على Firebase ولا يمنع تحميل الصفحة Offline.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(registration => registration.update().catch(() => {}))
      .catch(error => console.warn('تعذر تسجيل Service Worker:', error));
  }, { once: true });
}
