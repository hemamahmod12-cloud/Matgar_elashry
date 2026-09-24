/* واجهة العميل للهيكل الجديد؛ لا تعدل المبيعات أو المخزون مباشرة. */
(function (global) {
  'use strict';

  const STORE_ID = 'main';

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
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function subscribeProducts(onChange, onError) {
    return collection('products')
      .where('deleted', '==', false)
      .onSnapshot(snapshot => {
        onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
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
    const result = await functionsApi().httpsCallable('processSaleRequest')({
      storeId: STORE_ID,
      requestId
    });
    return result.data;
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
    const result = await functionsApi().httpsCallable('processReturnRequest')({
      storeId: STORE_ID,
      requestId
    });
    return result.data;
  }

  global.MatgarCollections = Object.freeze({
    collection,
    subscribeProducts,
    createSaleRequest,
    processSaleRequest,
    createReturnRequest,
    processReturnRequest
  });
}(window));
