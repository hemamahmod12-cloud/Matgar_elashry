/* طبقة وصول صغيرة تفصل Firestore عن منطق التطبيق، مع الحفاظ على نموذج storeData القديم. */
(function (global) {
  'use strict';

  function createStoreRepository(db) {
    if (!db) throw new Error('firestore-unavailable');
    const collection = db.collection('storeData');

    return Object.freeze({
      async get(key) {
        const snapshot = await collection.doc(key).get();
        return snapshot.exists ? snapshot.data().value : null;
      },
      async set(key, value) {
        await collection.doc(key).set({ value, updatedAt: Date.now() });
        return true;
      },
      subscribe(key, onValue, onError) {
        return collection.doc(key).onSnapshot(snapshot => {
          if (!snapshot.exists) return;
          onValue(snapshot.data().value, snapshot);
        }, onError);
      }
    });
  }

  global.MatgarStore = Object.freeze({ createStoreRepository });
}(window));
