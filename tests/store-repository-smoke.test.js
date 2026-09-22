const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/store-repository.js', 'utf8'), context);

let stored = '[]';
let subscribed;
const fakeDoc = {
  async get() { return { exists: true, data: () => ({ value: stored }) }; },
  async set(value) { stored = value.value; },
  onSnapshot(callback) { subscribed = callback; return () => {}; }
};
const fakeDb = { collection() { return { doc() { return fakeDoc; } }; } };
const repository = context.window.MatgarStore.createStoreRepository(fakeDb);

(async () => {
  assert.equal(await repository.get('products'), '[]');
  await repository.set('products', '[{"id":"p1"}]');
  assert.equal(await repository.get('products'), '[{"id":"p1"}]');
  let observed = null;
  repository.subscribe('products', value => { observed = value; });
  subscribed({ exists: true, data: () => ({ value: '[]' }) });
  assert.equal(observed, '[]');
  console.log('store repository smoke tests: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
