(function (global) {
  'use strict';

  const DB_NAME = 'matgar-offline-v1';
  const DB_VERSION = 1;
  const OUTBOX = 'outbox';
  const SNAPSHOTS = 'snapshots';
  const META = 'meta';
  let dbPromise = null;
  let ownerUid = null;
  let syncHandler = null;
  let syncPromise = null;
  const listeners = new Set();
  const status = {
    online: navigator.onLine,
    syncing: false,
    pendingCount: 0,
    lastSyncAt: null,
    error: null,
    blocked: false
  };

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in global)) {
        reject(new Error('IndexedDB غير متاح'));
        return;
      }
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OUTBOX)) {
          const outbox = db.createObjectStore(OUTBOX, { keyPath: 'id' });
          outbox.createIndex('ownerUid', 'ownerUid', { unique: false });
          outbox.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(SNAPSHOTS)) {
          db.createObjectStore(SNAPSHOTS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('تعذر فتح IndexedDB'));
    });
    return dbPromise;
  }

  function emit() {
    const snapshot = Object.freeze({ ...status });
    listeners.forEach(listener => {
      try { listener(snapshot); } catch (error) { console.warn('Offline listener failed', error); }
    });
  }

  function transaction(storeName, mode, action) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = action(store, tx); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('فشلت معاملة IndexedDB'));
      tx.onabort = () => reject(tx.error || new Error('ألغيت معاملة IndexedDB'));
    }));
  }

  function scopedKey(key) {
    return (ownerUid || 'anonymous') + '::' + key;
  }

  async function allPending() {
    if (!ownerUid) return [];
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(OUTBOX, 'readonly').objectStore(OUTBOX).getAll();
      request.onsuccess = () => resolve((request.result || []).filter(item =>
        item.ownerUid === ownerUid && item.status !== 'synced'
      ));
      request.onerror = () => reject(request.error);
    });
  }

  async function refresh() {
    try {
      status.pendingCount = (await allPending()).length;
      emit();
    } catch (error) {
      status.error = 'تعذر قراءة طابور الفواتير المحلي';
      emit();
    }
    return status.pendingCount;
  }

  async function setOwner(uid) {
    ownerUid = uid ? String(uid) : null;
    status.error = null;
    status.blocked = false;
    await refresh();
  }

  async function enqueueSale(payload) {
    if (!ownerUid) throw new Error('لا يمكن حفظ فاتورة بدون مستخدم مسجل');
    const id = 'offline-sale-' + (global.crypto && global.crypto.randomUUID
      ? global.crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2));
    const item = {
      id,
      ownerUid,
      type: 'sale',
      payload,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await transaction(OUTBOX, 'readwrite', store => store.put(item));
    await refresh();
    return item;
  }

  async function updateOutbox(item) {
    item.updatedAt = new Date().toISOString();
    await transaction(OUTBOX, 'readwrite', store => store.put(item));
  }

  async function removeOutbox(id) {
    await transaction(OUTBOX, 'readwrite', store => store.delete(id));
  }

  async function getSnapshot(key) {
    if (!ownerUid) return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).get(scopedKey(key));
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => reject(request.error);
    });
  }

  async function setSnapshot(key, value) {
    if (!ownerUid) throw new Error('لا يمكن حفظ Snapshot بدون مستخدم');
    await transaction(SNAPSHOTS, 'readwrite', store => store.put({ key: scopedKey(key), ownerUid, value, updatedAt: new Date().toISOString() }));
    return true;
  }

  async function syncNow() {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      status.online = navigator.onLine;
      if (!status.online || !ownerUid) return status;
      const items = await allPending();
      if (!items.length) {
        status.blocked = false;
        status.error = null;
        emit();
        return status;
      }
      if (typeof syncHandler !== 'function') {
        status.blocked = true;
        status.error = null;
        emit();
        return status;
      }
      status.syncing = true;
      status.blocked = false;
      status.error = null;
      emit();
      for (const item of items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        item.status = 'syncing';
        item.attempts = Number(item.attempts || 0) + 1;
        await updateOutbox(item);
        try {
          const result = await syncHandler(item);
          await removeOutbox(item.id);
          global.dispatchEvent(new CustomEvent('matgar:offline-synced', { detail: { item, result } }));
        } catch (error) {
          item.status = 'pending';
          item.lastError = error && error.message ? error.message : 'تعذر مزامنة الفاتورة';
          await updateOutbox(item);
          status.error = 'تعذر مزامنة فاتورة معلقة؛ ستتم إعادة المحاولة لاحقًا';
          break;
        }
        await refresh();
      }
      status.syncing = false;
      status.lastSyncAt = new Date().toISOString();
      await refresh();
      emit();
      return status;
    })().finally(() => { syncPromise = null; });
    return syncPromise;
  }

  global.addEventListener('online', () => {
    status.online = true;
    status.error = null;
    emit();
    syncNow();
  });
  global.addEventListener('offline', () => {
    status.online = false;
    status.syncing = false;
    emit();
  });

  global.MatgarOffline = Object.freeze({
    onState(listener) { listeners.add(listener); listener(Object.freeze({ ...status })); return () => listeners.delete(listener); },
    setOwner,
    setSyncHandler(handler) { syncHandler = typeof handler === 'function' ? handler : null; refresh(); },
    enqueueSale,
    getSnapshot,
    setSnapshot,
    refresh,
    syncNow,
    isOnline() { return status.online; },
    hasOwner() { return Boolean(ownerUid); },
    getState() { return Object.freeze({ ...status }); }
  });
}(window));
