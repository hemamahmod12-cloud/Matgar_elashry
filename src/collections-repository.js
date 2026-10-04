/* واجهة العميل للهيكل الجديد؛ كل عنصر يُحفظ كمستند مستقل داخل stores/{storeId}. */
(function (global) {
  'use strict';

  const STORE_ID = 'main';
  const TIMEOUT_MS = 30000;

  function db() {
    if (!global.firebase || !global.firebase.firestore) {
      throw new Error('Firebase Firestore غير متاح');
    }
    return global.firebase.firestore();
  }

  function functionsApi() {
    if (!global.firebase || !global.firebase.app || !global.firebase.functions) {
      throw new Error('Firebase Functions غير متاحة');
    }
    return global.firebase.app().functions('europe-west1');
  }

  function collection(name) {
    return db().collection('stores').doc(STORE_ID).collection(name);
  }

  function createId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function documentId(value, fallback) {
    const id = String(value ?? '').trim();
    return id || fallback || createId();
  }

  async function readCollection(name) {
    const snapshot = await collection(name).get();
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  }

  async function readState() {
    const [products, sales, stockMoves, categories, settings, users, suppliers, parkedOrders, expenses] = await Promise.all([
      readCollection('products'),
      readCollection('sales'),
      readCollection('stockMoves'),
      readCollection('categories'),
      collection('settings').doc('main').get(),
      readCollection('users'),
      readCollection('suppliers'),
      readCollection('parkedOrders'),
      readCollection('expenses')
    ]);
    return {
      products: products.filter(item => item.deleted !== true),
      sales: sales.sort((a, b) => Number(b.date || b.createdAt?.toMillis?.() || 0) - Number(a.date || a.createdAt?.toMillis?.() || 0)),
      moves: stockMoves.sort((a, b) => Number(b.date || b.createdAt?.toMillis?.() || 0) - Number(a.date || a.createdAt?.toMillis?.() || 0)),
      categories: categories.filter(item => item.deleted !== true).map(item => String(item.name || '')).filter(Boolean),
      settings: settings.exists ? settings.data() : {},
      users: users.filter(item => item.deleted !== true),
      suppliers: suppliers.filter(item => item.deleted !== true),
      parked: parkedOrders.filter(item => item.deleted !== true),
      expenses: expenses.filter(item => item.deleted !== true)
    };
  }

  function normalizeCategoryId(value, index) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || `category-${index + 1}`;
  }

  async function writeState(name, value) {
    if (name === 'settings') {
      await collection('settings').doc('main').set(value || {}, { merge: true });
      return true;
    }
    const entries = Array.isArray(value) ? value : [];
    const writer = db().bulkWriter();
    entries.forEach((item, index) => {
      const id = name === 'categories'
        ? normalizeCategoryId(item, index)
        : documentId(item && item.id, `${name}-${index + 1}`);
      const data = name === 'categories' ? { name: String(item || ''), deleted: false } : { ...item };
      writer.set(collection(name === 'moves' ? 'stockMoves' : name === 'parked' ? 'parkedOrders' : name).doc(id), data, { merge: true });
    });
    await writer.close();
    return true;
  }

  function subscribeCollection(name, onChange, onError) {
    return collection(name).onSnapshot(snapshot => {
      onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
    }, onError);
  }

  function subscribeProducts(onChange, onError) {
    return subscribeCollection('products', items => {
      onChange(items.filter(item => item.deleted !== true).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar')));
    }, onError);
  }

  async function createSaleRequest(payload, providedRequestId) {
    const requestId = providedRequestId || createId();
    await collection('saleRequests').doc(requestId).set({
      ...payload,
      status: 'pending',
      createdAt: global.firebase.firestore.FieldValue.serverTimestamp()
    });
    return requestId;
  }

  async function processSaleRequest(requestId) {
    try {
      const result = await Promise.race([
        functionsApi().httpsCallable('processSaleRequest')({ storeId: STORE_ID, requestId }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))
      ]);
      return result.data;
    } catch (err) {
      console.error('خطأ معالجة طلب البيع:', err);
      throw err;
    }
  }

  async function createReturnRequest(payload) {
    const requestId = createId();
    await collection('returnRequests').doc(requestId).set({
      ...payload,
      status: 'pending',
      createdAt: global.firebase.firestore.FieldValue.serverTimestamp()
    });
    return requestId;
  }

  async function processReturnRequest(requestId) {
    try {
      const result = await Promise.race([
        functionsApi().httpsCallable('processReturnRequest')({ storeId: STORE_ID, requestId }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))
      ]);
      return result.data;
    } catch (err) {
      console.error('خطأ معالجة طلب الاسترجاع:', err);
      throw err;
    }
  }

  global.MatgarCollections = Object.freeze({
    collection,
    readCollection,
    readState,
    writeState,
    subscribeCollection,
    subscribeProducts,
    createSaleRequest,
    processSaleRequest,
    createReturnRequest,
    processReturnRequest
  });
}(window));
