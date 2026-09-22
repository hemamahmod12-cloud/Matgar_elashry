'use strict';

/*
 * يفعّل مسار Collections الجديد فقط بعد التحقق من marker ترحيل مكتمل.
 * لا يكتب إلى Firebase ولا يعدل index.html إلا إذا استوفى كل الشروط.
 */
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID || 'story-market-35565';
const storeId = process.env.FIREBASE_STORE_ID || 'main';
const indexPath = path.resolve('index.html');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS غير مضبوط؛ لم يتم التفعيل');
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId
  });
}

(async () => {
  const db = admin.firestore();
  const markerRef = db.collection('stores').doc(storeId)
    .collection('_migrations').doc('legacy-store-data-v1');
  const marker = await markerRef.get();

  if (!marker.exists || marker.data()?.status !== 'completed') {
    throw new Error('الترحيل غير مكتمل؛ بقي COLLECTIONS_BACKEND_ENABLED=false');
  }

  const required = [
    ['products', 'products'],
    ['sales', 'sales'],
    ['users', 'users'],
    ['stockMoves', 'stockMoves']
  ];
  for (const [collectionName, label] of required) {
    const snapshot = await db.collection('stores').doc(storeId)
      .collection(collectionName).limit(1).get();
    if (snapshot.empty) throw new Error(`Collection ${label} فارغة؛ لم يتم التفعيل`);
  }

  const source = fs.readFileSync(indexPath, 'utf8');
  if (!source.includes('const COLLECTIONS_BACKEND_ENABLED = false;')) {
    throw new Error('لم يتم العثور على مفتاح التفعيل المتوقع؛ أوقف التفعيل للمراجعة اليدوية');
  }

  const updated = source.replace(
    'const COLLECTIONS_BACKEND_ENABLED = false;',
    'const COLLECTIONS_BACKEND_ENABLED = true;'
  );
  fs.writeFileSync(indexPath, updated);
  console.log('تم اجتياز بوابة الجاهزية. راجع git diff ثم أنشئ commit التفعيل.');
})().catch(error => {
  console.error(`لم يتم التفعيل: ${error.message}`);
  process.exitCode = 1;
});
