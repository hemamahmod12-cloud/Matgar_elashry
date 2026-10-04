'use strict';

/*
 * مقارنة read-only بين storeData القديم و stores/{storeId} الجديد.
 * لا ينفذ أي كتابة أو تعديل أو حذف.
 * المتطلبات: GOOGLE_APPLICATION_CREDENTIALS و FIREBASE_PROJECT_ID اختياري.
 */
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'story-market-35565';
const STORE_ID = process.env.FIREBASE_STORE_ID || 'main';
const ARTIFACT_DIR = path.resolve(process.env.COMPARISON_ARTIFACT_DIR || 'migration-artifacts');

const ENTITY_MAP = {
  products: { legacy: 'products', target: 'products' },
  sales: { legacy: 'sales', target: 'sales' },
  moves: { legacy: 'moves', target: 'stockMoves' },
  categories: { legacy: 'categories', target: 'categories' },
  settings: { legacy: 'settings', target: 'settings' },
  users: { legacy: 'users', target: 'users' },
  suppliers: { legacy: 'suppliers', target: 'suppliers' },
  parked: { legacy: 'parked', target: 'parkedOrders' },
  expenses: { legacy: 'expenses', target: 'expenses' }
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID
  });
}

const db = admin.firestore();
const legacyStore = db.collection('storeData');
const targetStore = db.collection('stores').doc(STORE_ID);

function parseLegacy(snapshot, fallback) {
  if (!snapshot.exists) return fallback;
  const value = snapshot.data()?.value;
  if (typeof value !== 'string') {
    throw new Error(`storeData/${snapshot.id}: value ليست JSON string`);
  }
  const parsed = JSON.parse(value);
  return parsed ?? fallback;
}

async function countCollection(name) {
  const snapshot = await targetStore.collection(name).get();
  return snapshot.size;
}

async function readLegacyCounts() {
  const keys = Object.values(ENTITY_MAP).map(item => item.legacy);
  const snapshots = await Promise.all(keys.map(key => legacyStore.doc(key).get()));
  const result = {};
  snapshots.forEach((snapshot, index) => {
    const key = keys[index];
    const fallback = key === 'settings' ? {} : [];
    const value = parseLegacy(snapshot, fallback);
    result[key] = Array.isArray(value) ? value.length : snapshot.exists ? 1 : 0;
  });
  const counter = await legacyStore.doc('invoiceCounter').get();
  result.invoiceCounter = counter.exists ? Number(counter.data()?.value || 1000) : null;
  return result;
}

async function readTargetCounts() {
  const entries = await Promise.all(Object.entries(ENTITY_MAP).map(async ([key, item]) => {
    return [key, await countCollection(item.target)];
  }));
  const counter = await targetStore.collection('invoiceCounters').doc('main').get();
  return {
    ...Object.fromEntries(entries),
    invoiceCounter: counter.exists ? Number(counter.data()?.nextInvoiceNo ?? null) : null
  };
}

function compareCounts(legacy, target) {
  const rows = Object.keys(ENTITY_MAP).map(entity => ({
    entity,
    legacy: legacy[entity],
    target: target[entity],
    difference: target[entity] - legacy[entity],
    matches: target[entity] === legacy[entity]
  }));
  const counterMatches = legacy.invoiceCounter === target.invoiceCounter;
  return {
    rows,
    invoiceCounter: {
      legacy: legacy.invoiceCounter,
      target: target.invoiceCounter,
      matches: counterMatches
    },
    allCountsMatch: rows.every(row => row.matches) && counterMatches
  };
}

async function main() {
  const [legacy, target] = await Promise.all([readLegacyCounts(), readTargetCounts()]);
  const marker = await targetStore.collection('_migrations').doc('legacy-store-data-v1').get();
  const comparison = compareCounts(legacy, target);
  const report = {
    projectId: PROJECT_ID,
    storeId: STORE_ID,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    migrationMarker: marker.exists ? marker.data() : null,
    legacy,
    target,
    comparison,
    status: comparison.allCountsMatch && marker.data()?.status === 'completed' ? 'PASS' : 'FAIL'
  };

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'collections-count-comparison.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(JSON.stringify({
    status: report.status,
    storeId: STORE_ID,
    allCountsMatch: comparison.allCountsMatch,
    migrationMarkerStatus: marker.data()?.status || 'missing',
    rows: comparison.rows,
    invoiceCounter: comparison.invoiceCounter,
    report: path.join(ARTIFACT_DIR, 'collections-count-comparison.json')
  }, null, 2));

  if (report.status !== 'PASS') process.exitCode = 2;
}

main().catch(error => {
  console.error(`فشل فحص التطابق: ${error.message}`);
  process.exitCode = 1;
});
