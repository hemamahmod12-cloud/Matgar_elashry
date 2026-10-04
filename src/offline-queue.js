/* طابور المبيعات Offline: idempotent، قابل لإعادة المحاولة، ولا يخصم المخزون محليًا. */
(function (global) {
  'use strict';

  const DB_NAME = 'storeSystemDB_v1';
  const DB_VERSION = 2;
  const OUTBOX = 'outbox';
  const MAX_ATTEMPTS = 5;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('indexeddb-unavailable'));
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains(OUTBOX)) {
          const store = db.createObjectStore(OUTBOX, { keyPath: 'clientOperationId' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { dbPromise = null; reject(request.error || new Error('indexeddb-open-failed')); };
    });
    return dbPromise;
  }

  function allRecords() {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(OUTBOX, 'readonly');
      const request = tx.objectStore(OUTBOX).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('indexeddb-list-failed'));
    }));
  }

  function put(record) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(OUTBOX, 'readwrite');
      tx.objectStore(OUTBOX).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error || new Error('indexeddb-write-failed'));
    }));
  }

  const api = {
    async enqueue(payload) {
      if (!payload || !payload.clientOperationId) throw new Error('invalid-payload');
      const existing = (await allRecords()).find(item => item.clientOperationId === payload.clientOperationId);
      if (existing) return existing;
      return put({
        clientOperationId: payload.clientOperationId,
        type: 'SALE',
        status: 'pending',
        createdAt: Date.now(),
        attempts: 0,
        lastError: null,
        payload
      });
    },
    list() { return allRecords(); },
    pending() { return allRecords().then(items => items.filter(item => item.status === 'pending')); },
    count() { return allRecords().then(items => items.length); },
    async update(clientOperationId, patch) {
      const item = (await allRecords()).find(row => row.clientOperationId === clientOperationId);
      if (!item) return null;
      return put(Object.assign({}, item, patch, { updatedAt: Date.now() }));
    },
    async remove(clientOperationId) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(OUTBOX, 'readwrite');
        tx.objectStore(OUTBOX).delete(clientOperationId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('indexeddb-delete-failed'));
      });
    },
    async canRetry(clientOperationId) {
      const item = (await allRecords()).find(row => row.clientOperationId === clientOperationId);
      return item && item.attempts < MAX_ATTEMPTS;
    },
    async requestBackgroundSync() {
      try {
        const registration = await navigator.serviceWorker?.ready;
        if (registration?.sync) await registration.sync.register('matgar-offline-sync');
      } catch (_) { /* fallback: مزامنة online من الصفحة */ }
    }
  };

  global.MatgarOfflineQueue = Object.freeze(api);
}(window));
