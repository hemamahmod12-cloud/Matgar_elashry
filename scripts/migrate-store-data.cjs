'use strict';

/*
 * ترحيل storeData القديم إلى stores/main.
 * الوضع الافتراضي dry-run ولا يكتب إلى Firebase.
 * التطبيق الفعلي يتطلب: --apply و ALLOW_PRODUCTION_MIGRATION=YES.
 */
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'story-market-35565';
const STORE_ID = process.env.FIREBASE_STORE_ID || 'main';
const APPLY = process.argv.includes('--apply');
const CONFIRM = process.env.ALLOW_PRODUCTION_MIGRATION === 'YES';
const ARTIFACT_DIR = path.resolve(process.env.MIGRATION_ARTIFACT_DIR || 'migration-artifacts');
const SOURCE_KEYS = ['products', 'sales', 'moves', 'categories', 'settings', 'users', 'suppliers', 'parked', 'expenses'];

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID
  });
}

const db = admin.firestore();
const source = db.collection('storeData');
const target = db.collection('stores').doc(STORE_ID);

function fail(message) {
  throw new Error(message);
}

function parseLegacy(snapshot, fallback) {
  if (!snapshot.exists) return fallback;
  const value = snapshot.data()?.value;
  if (typeof value !== 'string') fail(`storeData/${snapshot.id}: value ليست JSON string`);
  try {
    return JSON.parse(value) ?? fallback;
  } catch (error) {
    fail(`storeData/${snapshot.id}: JSON غير صالح (${error.message})`);
  }
}

function stableId(value, fallback) {
  const id = String(value ?? '').trim();
  return id || fallback;
}

function categoryId(name, index) {
  const slug = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `category-${index + 1}`;
}

function assertArray(value, key) {
  if (!Array.isArray(value)) fail(`storeData/${key}: المتوقع مصفوفة`);
  return value;
}

function validate(data) {
  const errors = [];
  data.products.forEach((item, index) => {
    if (!item || !String(item.id || '').trim()) errors.push(`products[${index}] بلا id`);
    if (!item || typeof item.name !== 'string' || !item.name.trim()) errors.push(`products[${index}] بلا name`);
    if (Number(item.qty) < 0) errors.push(`products[${index}] كمية سالبة`);
    if (Number(item.sellPrice) < 0) errors.push(`products[${index}] سعر بيع سالب`);
  });
  data.sales.forEach((item, index) => {
    if (!item || !String(item.id || '').trim()) errors.push(`sales[${index}] بلا id`);
    if (!item || !Array.isArray(item.items) || item.items.length === 0) errors.push(`sales[${index}] بلا items`);
    if (Number(item.total) < 0) errors.push(`sales[${index}] إجمالي سالب`);
  });
  for (const key of ['moves', 'users', 'suppliers', 'parked', 'expenses']) {
    data[key].forEach((item, index) => {
      if (!item || !String(item.id || '').trim()) errors.push(`${key}[${index}] بلا id`);
    });
  }
  if (errors.length) fail(`فشل التحقق:\n- ${errors.join('\n- ')}`);
}

async function readLegacy() {
  const snapshots = await Promise.all(SOURCE_KEYS.map(key => source.doc(key).get()));
  const data = {};
  snapshots.forEach((snapshot, index) => {
    const key = SOURCE_KEYS[index];
    data[key] = parseLegacy(snapshot, key === 'settings' ? {} : []);
  });
  const counter = await source.doc('invoiceCounter').get();
  data.invoiceCounter = counter.exists ? Number(counter.data()?.value || 1000) : 1000;
  ['products', 'sales', 'moves', 'users', 'suppliers', 'parked', 'expenses'].forEach(key => assertArray(data[key], key));
  assertArray(data.categories, 'categories');
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) fail('settings ليس كائنًا');
  validate(data);
  return data;
}

function toTargetData(item, sourcePath) {
  return {
    ...item,
    migration: { source: sourcePath, version: 1 },
    migratedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

function makePlan(data) {
  return {
    products: data.products.map((item, index) => ({ id: stableId(item.id, `product-${index + 1}`), data: toTargetData(item, `storeData/products/${item.id}`) })),
    sales: data.sales.map((item, index) => ({ id: stableId(item.id, `sale-${index + 1}`), data: toTargetData(item, `storeData/sales/${item.id}`) })),
    stockMoves: data.moves.map((item, index) => ({ id: stableId(item.id, `move-${index + 1}`), data: toTargetData(item, `storeData/moves/${item.id}`) })),
    users: data.users.map((item, index) => ({ id: stableId(item.id, `user-${index + 1}`), data: toTargetData(item, `storeData/users/${item.id}`) })),
    suppliers: data.suppliers.map((item, index) => ({ id: stableId(item.id, `supplier-${index + 1}`), data: toTargetData(item, `storeData/suppliers/${item.id}`) })),
    parkedOrders: data.parked.map((item, index) => ({ id: stableId(item.id, `parked-${index + 1}`), data: toTargetData(item, `storeData/parked/${item.id}`) })),
    expenses: data.expenses.map((item, index) => ({ id: stableId(item.id, `expense-${index + 1}`), data: toTargetData(item, `storeData/expenses/${item.id}`) })),
    categories: data.categories.map((name, index) => ({ id: categoryId(name, index), data: toTargetData({ name: String(name) }, `storeData/categories[${index}]`) }))
  };
}

function summarize(data, plan) {
  return {
    projectId: PROJECT_ID,
    storeId: STORE_ID,
    source: SOURCE_KEYS.reduce((result, key) => ({ ...result, [key]: Array.isArray(data[key]) ? data[key].length : 1 }), {}),
    target: Object.fromEntries(Object.entries(plan).map(([key, items]) => [key, items.length])),
    nextInvoiceNo: data.invoiceCounter,
    generatedAt: new Date().toISOString()
  };
}

function writeArtifact(name, value) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACT_DIR, name), JSON.stringify(value, null, 2));
}

async function writePlan(data, plan) {
  if (!APPLY || !CONFIRM) {
    console.log('DRY-RUN: لا توجد كتابة إلى Firebase. استخدم --apply مع ALLOW_PRODUCTION_MIGRATION=YES بعد المراجعة.');
    return;
  }

  const marker = target.collection('_migrations').doc('legacy-store-data-v1');
  const existing = await marker.get();
  if (existing.exists && existing.data()?.status === 'completed') {
    fail('الترحيل مكتمل مسبقًا. استخدم أداة تحقق أو غيّر نسخة الترحيل بدل إعادة الكتابة.');
  }

  await marker.set({ status: 'started', source: 'storeData', version: 1, startedAt: admin.firestore.FieldValue.serverTimestamp() });
  const writer = db.bulkWriter();
  writer.onWriteError(error => {
    if (error.failedAttempts < 3) return true;
    console.error('فشل المستند:', error.documentRef.path, error.message);
    return false;
  });

  for (const [collectionName, items] of Object.entries(plan)) {
    for (const item of items) {
      writer.set(target.collection(collectionName).doc(item.id), item.data, { merge: false });
    }
  }

  writer.set(target.collection('settings').doc('main'), toTargetData(data.settings, 'storeData/settings'), { merge: false });
  writer.set(target.collection('invoiceCounters').doc('main'), {
    nextInvoiceNo: data.invoiceCounter,
    migration: { source: 'storeData/invoiceCounter', version: 1 },
    migratedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: false });
  await writer.close();
  await marker.set({ status: 'completed', source: 'storeData', version: 1, completedAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log('تم الترحيل بنجاح. لم يتم حذف storeData.');
}

(async () => {
  const data = await readLegacy();
  const plan = makePlan(data);
  const summary = summarize(data, plan);
  writeArtifact('migration-summary.json', summary);
  writeArtifact('legacy-snapshot.json', data);
  console.log(JSON.stringify(summary, null, 2));
  await writePlan(data, plan);
})().catch(error => {
  console.error(`فشل الترحيل: ${error.message}`);
  process.exitCode = 1;
});
