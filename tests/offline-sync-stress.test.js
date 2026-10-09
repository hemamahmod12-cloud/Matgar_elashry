const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const QUEUE_SOURCE = fs.readFileSync('src/offline-queue.js', 'utf8');
const TOTAL_SALES = 5000;
const P95_ENQUEUE_LIMIT_MS = 25;
const P95_SYNC_STEP_LIMIT_MS = 25;
const MAX_MEMORY_DELTA_MB = 128;

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function createFastIndexedDB() {
  const records = new Map();
  const later = fn => queueMicrotask(fn);
  const transaction = () => {
    const tx = { oncomplete: null, onerror: null, error: null };
    const store = {
      get(key) {
        const request = { result: records.get(key), onsuccess: null, onerror: null, error: null };
        later(() => request.onsuccess?.());
        return request;
      },
      getAll() {
        const request = { result: [...records.values()], onsuccess: null, onerror: null, error: null };
        later(() => { request.onsuccess?.(); tx.oncomplete?.(); });
        return request;
      },
      put(value) {
        records.set(value.clientOperationId, value);
        later(() => tx.oncomplete?.());
        return { result: undefined, onsuccess: null, onerror: null, error: null };
      },
      delete(key) {
        records.delete(key);
        later(() => tx.oncomplete?.());
        return { result: undefined, onsuccess: null, onerror: null, error: null };
      },
      createIndex() {}
    };
    tx.objectStore = () => store;
    return tx;
  };
  return {
    open() {
      const request = {
        result: {
          objectStoreNames: { contains: () => true },
          transaction
        },
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        error: null
      };
      later(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
    records
  };
}

function makeSale(index) {
  return {
    clientOperationId: `stress-sale-${index}`,
    cashierId: 'stress-cashier',
    cashierName: 'Stress Test',
    items: [{ productId: `product-${index % 50}`, name: 'Test product', price: 10, qty: 1, discount: 0 }],
    subtotal: 10,
    discount: 0,
    tax: 1.4,
    total: 11.4,
    paymentMethod: 'نقدي',
    received: 20,
    walletBalance: 0,
    change: 8.6
  };
}

async function main() {
  const indexedDB = createFastIndexedDB();
  const context = { window: { indexedDB }, navigator: { onLine: false } };
  vm.createContext(context);
  vm.runInContext(QUEUE_SOURCE, context);
  const queue = context.window.MatgarOfflineQueue;
  const enqueueTimes = [];
  const startMemory = process.memoryUsage().heapUsed;
  const enqueueStart = performance.now();

  // محاكاة انقطاع الإنترنت: لا يوجد أي استدعاء سحابي، وكل الفواتير تحفظ محليًا.
  for (let index = 0; index < TOTAL_SALES; index += 1) {
    const started = performance.now();
    await queue.enqueue(makeSale(index));
    enqueueTimes.push(performance.now() - started);
  }
  const enqueueMs = performance.now() - enqueueStart;
  assert.equal(context.navigator.onLine, false);
  assert.equal(await queue.count(), TOTAL_SALES);

  const pendingStart = performance.now();
  const pending = await queue.pending();
  const pendingMs = performance.now() - pendingStart;
  assert.equal(pending.length, TOTAL_SALES);
  assert.equal(new Set(pending.map(item => item.clientOperationId)).size, TOTAL_SALES);
  assert.equal(pending[0].clientOperationId, 'stress-sale-0');
  assert.equal(pending.at(-1).clientOperationId, `stress-sale-${TOTAL_SALES - 1}`);

  // محاكاة عودة الاتصال: كل خطوة تمثل تحديث الحالة ثم اعتماد العملية السحابية ثم حذفها.
  context.navigator.onLine = true;
  const syncTimes = [];
  const syncStart = performance.now();
  for (const operation of pending) {
    const started = performance.now();
    const attempt = (operation.attempts || 0) + 1;
    await queue.update(operation.clientOperationId, { status: 'syncing', attempts: attempt });
    // Cloud write mock: نختبر تكلفة الطابور دون اختلاق زمن شبكة.
    await queue.remove(operation.clientOperationId);
    syncTimes.push(performance.now() - started);
  }
  const syncMs = performance.now() - syncStart;
  const remaining = await queue.count();
  const memoryDeltaMb = (process.memoryUsage().heapUsed - startMemory) / (1024 * 1024);

  assert.equal(remaining, 0);
  assert.ok(percentile(enqueueTimes, 0.95) < P95_ENQUEUE_LIMIT_MS,
    `enqueue p95 exceeded limit: ${percentile(enqueueTimes, 0.95).toFixed(2)}ms`);
  assert.ok(percentile(syncTimes, 0.95) < P95_SYNC_STEP_LIMIT_MS,
    `sync step p95 exceeded limit: ${percentile(syncTimes, 0.95).toFixed(2)}ms`);
  assert.ok(memoryDeltaMb < MAX_MEMORY_DELTA_MB,
    `memory delta exceeded limit: ${memoryDeltaMb.toFixed(2)}MB`);

  console.log('offline sync stress test: OK', JSON.stringify({
    totalSales: TOTAL_SALES,
    offlineEnqueueMs: Number(enqueueMs.toFixed(2)),
    enqueueP50Ms: Number(percentile(enqueueTimes, 0.50).toFixed(4)),
    enqueueP95Ms: Number(percentile(enqueueTimes, 0.95).toFixed(4)),
    pendingReadMs: Number(pendingMs.toFixed(2)),
    onlineSyncMs: Number(syncMs.toFixed(2)),
    syncStepP95Ms: Number(percentile(syncTimes, 0.95).toFixed(4)),
    memoryDeltaMb: Number(memoryDeltaMb.toFixed(2)),
    remaining
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
