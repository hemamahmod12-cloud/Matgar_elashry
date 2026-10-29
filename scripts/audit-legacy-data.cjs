'use strict';

/*
 * تدقيق read-only لبيانات POS القديمة. يدعم:
 * 1) FIREBASE_AUDIT_INPUT=path/to/legacy-snapshot.json
 * 2) Firebase Admin عبر GOOGLE_APPLICATION_CREDENTIALS.
 * لا ينفذ أي كتابة أو حذف.
 */
const fs = require('node:fs');
const path = require('node:path');
let admin;

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'story-market-35565';
const INPUT = process.env.FIREBASE_AUDIT_INPUT || '';
const ARTIFACT_DIR = path.resolve(process.env.AUDIT_ARTIFACT_DIR || 'audit-artifacts');
const WARN_BYTES = Number(process.env.STOREDOC_WARN_BYTES || 900_000);
const HARD_BYTES = Number(process.env.STOREDOC_HARD_BYTES || 1_048_576);
const KEYS = ['products', 'sales', 'moves', 'categories', 'settings', 'users', 'suppliers', 'parked', 'expenses', 'shifts'];

function decodeLegacySnapshot(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('legacy snapshot must be an object');
  const result = {};
  for (const key of KEYS) {
    const value = raw[key];
    if (Array.isArray(value) || (value && typeof value === 'object')) result[key] = value;
    else if (value && typeof value.value === 'string') result[key] = JSON.parse(value.value);
    else result[key] = Array.isArray(value) ? value : [];
  }
  return result;
}

async function readFirebaseSnapshot() {
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
  }
  const db = admin.firestore();
  const snapshots = await Promise.all(KEYS.map(key => db.collection('storeData').doc(key).get()));
  const result = {};
  snapshots.forEach((snapshot, index) => {
    const key = KEYS[index];
    if (!snapshot.exists) { result[key] = []; return; }
    const raw = snapshot.data()?.value;
    result[key] = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
  });
  return result;
}

function valuesOf(value) {
  return Array.isArray(value) ? value : [];
}

function duplicates(items, selector) {
  const seen = new Map();
  for (const item of items) {
    const value = selector(item);
    if (value === undefined || value === null || value === '') continue;
    const key = String(value);
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

function audit(data) {
  const docSizes = Object.fromEntries(KEYS.map(key => {
    const bytes = Buffer.byteLength(JSON.stringify(data[key] ?? null), 'utf8');
    return [key, { bytes, megabytes: Number((bytes / 1024 / 1024).toFixed(3)), warning: bytes >= WARN_BYTES, overLimit: bytes >= HARD_BYTES }];
  }));
  const products = valuesOf(data.products);
  const sales = valuesOf(data.sales);
  const productIds = new Set(products.map(item => String(item?.id || '')).filter(Boolean));
  const duplicateProductIds = duplicates(products, item => item?.id);
  const duplicateBarcodes = duplicates(products.filter(item => item?.deleted !== true), item => String(item?.barcode || '').trim());
  const duplicateInvoiceNumbers = duplicates(sales, item => item?.invoiceNo);
  const duplicateSaleIds = duplicates(sales, item => item?.id);
  const missingSaleProducts = [];
  for (const sale of sales) {
    for (const item of Array.isArray(sale?.items) ? sale.items : []) {
      const productId = String(item?.productId || '');
      if (productId && !productIds.has(productId)) missingSaleProducts.push({ saleId: sale?.id || '', invoiceNo: sale?.invoiceNo || '', productId });
    }
  }
  const negativeProducts = products.filter(item => Number(item?.qty) < 0 || Number(item?.sellPrice) < 0 || Number(item?.buyPrice) < 0).map(item => item?.id || item?.name || 'unknown');
  const errors = [];
  for (const [key, size] of Object.entries(docSizes)) if (size.overLimit) errors.push(`storeData/${key} exceeds 1MB`);
  if (duplicateProductIds.length) errors.push('duplicate product ids');
  if (duplicateInvoiceNumbers.length) errors.push('duplicate invoice numbers');
  if (duplicateSaleIds.length) errors.push('duplicate sale ids');
  if (missingSaleProducts.length) errors.push('sales reference missing products');
  if (negativeProducts.length) errors.push('negative product values');
  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    projectId: PROJECT_ID,
    thresholds: { warningBytes: WARN_BYTES, hardBytes: HARD_BYTES },
    counts: Object.fromEntries(KEYS.map(key => [key, valuesOf(data[key]).length])),
    docSizes,
    duplicateProductIds,
    duplicateBarcodes,
    duplicateInvoiceNumbers,
    duplicateSaleIds,
    missingSaleProducts,
    negativeProducts,
    errors,
    status: errors.length ? 'FAIL' : (Object.values(docSizes).some(item => item.warning) ? 'WARN' : 'PASS')
  };
}

function explainReadError(error) {
  const code = String(error?.code ?? '');
  if (code === '7' || code.toUpperCase().includes('PERMISSION')) {
    return `PERMISSION_DENIED أثناء القراءة من مشروع ${PROJECT_ID}. يحتاج حساب الخدمة إلى صلاحية Firestore قراءة مثل Cloud Datastore Viewer، أو أن project_id داخل المفتاح لا يطابق المشروع؛ لم يتم تعديل أي بيانات. التفاصيل الأصلية: ${error.message}`;
  }
  return error.message;
}

(async () => {
  const data = INPUT
    ? decodeLegacySnapshot(JSON.parse(fs.readFileSync(path.resolve(INPUT), 'utf8')))
    : await readFirebaseSnapshot();
  const report = audit(data);
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const output = path.join(ARTIFACT_DIR, 'legacy-data-audit.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: output }, null, 2));
  if (report.status === 'FAIL') process.exitCode = 2;
})().catch(error => {
  console.error(`فشل تدقيق بيانات legacy: ${explainReadError(error)}`);
  process.exitCode = 1;
});
