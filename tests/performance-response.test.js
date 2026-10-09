const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const source = file => fs.readFileSync(file, 'utf8');
const elapsed = work => {
  const start = performance.now();
  const result = work();
  return { result, ms: performance.now() - start };
};

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function measureAsync(work, samples) {
  const values = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    await work(i);
    values.push(performance.now() - start);
  }
  return { p95: percentile(values, 0.95), max: Math.max(...values), values };
}

async function testCashierResponse() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source('src/sale-calculator.js'), context);
  const lines = Array.from({ length: 18 }, (_, index) => ({
    price: 7.25 + index,
    qty: (index % 4) + 1,
    discount: index % 3 === 0 ? 0.5 : 0
  }));

  for (let i = 0; i < 100; i += 1) {
    context.window.MatgarSales.calculateSale({ lines, discount: 3, taxRate: 14, paymentMethod: 'نقدي', received: 1000 });
  }
  const result = await measureAsync(() => {
    const sale = context.window.MatgarSales.calculateSale({ lines, discount: 3, taxRate: 14, paymentMethod: 'نقدي', received: 1000 });
    assert.equal(sale.total > 0, true);
  }, 1000);

  assert.ok(result.p95 < 5, `cashier calculation p95 too slow: ${result.p95.toFixed(2)}ms`);
  return { p95: result.p95, max: result.max };
}

function createFakeFirestore() {
  const values = new Map();
  const listeners = new Map();
  const doc = key => ({
    async get() {
      const value = values.get(key);
      return { exists: value !== undefined, data: () => ({ value }) };
    },
    async set(data) {
      values.set(key, data.value);
      const listener = listeners.get(key);
      if (listener) listener({ exists: true, data: () => ({ value: data.value }) });
    },
    onSnapshot(callback) {
      listeners.set(key, callback);
      return () => listeners.delete(key);
    }
  });
  return { collection: () => ({ doc }) };
}

async function testCloudRepositoryResponse() {
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(source('src/store-repository.js'), context);
  const repository = context.window.MatgarStore.createStoreRepository(createFakeFirestore());
  const payload = JSON.stringify(Array.from({ length: 120 }, (_, index) => ({ id: `p${index}`, qty: index + 1 })));
  const result = await measureAsync(async index => {
    await repository.set(`perf-${index}`, payload);
    assert.equal(await repository.get(`perf-${index}`), payload);
  }, 250);

  assert.ok(result.p95 < 10, `repository round-trip p95 too slow: ${result.p95.toFixed(2)}ms`);
  return { p95: result.p95, max: result.max };
}

function createFakeIndexedDB() {
  const records = new Map();
  const request = value => {
    const result = { result: value, onsuccess: null, onerror: null, error: null };
    return result;
  };
  const transaction = () => {
    const tx = { oncomplete: null, onerror: null };
    const store = {
      getAll() {
        const result = request([...records.values()]);
        setTimeout(() => { result.onsuccess?.(); tx.oncomplete?.(); }, 0);
        return result;
      },
      put(value) {
        records.set(value.clientOperationId, value);
        setTimeout(() => tx.oncomplete?.(), 0);
        return request(undefined);
      },
      delete(key) {
        records.delete(key);
        setTimeout(() => tx.oncomplete?.(), 0);
        return request(undefined);
      },
      createIndex() {}
    };
    tx.objectStore = () => store;
    return tx;
  };
  return {
    open() {
      const result = { result: { objectStoreNames: { contains: () => true }, transaction }, onsuccess: null, onerror: null, onupgradeneeded: null, error: null };
      setTimeout(() => { result.onupgradeneeded?.(); result.onsuccess?.(); }, 0);
      return result;
    },
    _records: records
  };
}

async function testOfflineQueueResponse() {
  const indexedDB = createFakeIndexedDB();
  const context = { window: { indexedDB }, navigator: {} };
  vm.createContext(context);
  vm.runInContext(source('src/offline-queue.js'), context);
  const queue = context.window.MatgarOfflineQueue;
  const samples = 100;
  const result = await measureAsync(index => queue.enqueue({
    clientOperationId: `perf-sale-${index}`,
    sale: { total: index + 10, items: [{ productId: 'p1', qty: 1 }] }
  }), samples);
  const pendingStart = performance.now();
  const pending = await queue.pending();
  const pendingMs = performance.now() - pendingStart;

  assert.equal(pending.length, samples);
  assert.equal(new Set(pending.map(item => item.clientOperationId)).size, samples);
  assert.ok(percentile(result.values, 0.95) < 25, `offline enqueue p95 too slow: ${percentile(result.values, 0.95).toFixed(2)}ms`);
  assert.ok(pendingMs < 25, `offline pending read too slow: ${pendingMs.toFixed(2)}ms`);
  return { enqueueP95: percentile(result.values, 0.95), pendingMs };
}

(async () => {
  const cashier = await testCashierResponse();
  const repository = await testCloudRepositoryResponse();
  const queue = await testOfflineQueueResponse();
  console.log('performance response tests: OK', JSON.stringify({ cashier, repository, queue }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
