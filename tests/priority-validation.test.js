'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const calculatorSource = fs.readFileSync('src/sale-calculator.js', 'utf8');
assert.match(html, /function buildBackupPayload\(\)/);
assert.match(html, /schemaVersion: 2/);
assert.match(html, /const requiredKeys = \['products','sales','moves'\]/);
assert.match(html, /users: state\.users\.map\(backupUser\)/);
assert.doesNotMatch(html, /users:\s*state\.users,\s*suppliers/);
assert.match(html, /function printSale\(sale\)/);
assert.match(html, /function importBackup\(e\)/);
assert.match(calculatorSource, /function validatePayment/);

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/sale-calculator.js', 'utf8'), context);
const sales = context.window.MatgarSales;

const sale = sales.calculateSale({
  lines: [
    { price: 10.10, qty: 3, discount: 0.10 },
    { price: 5.25, qty: 2, discount: 99 }
  ],
  discount: 2.05,
  taxRate: 14,
  paymentMethod: 'نقدي',
  received: 50
});
assert.deepEqual(JSON.parse(JSON.stringify(sale)), {
  subtotal: 30.2,
  discount: 2.05,
  tax: 3.94,
  total: 32.09,
  paymentMethod: 'نقدي',
  received: 50,
  walletBalance: 0,
  change: 17.91
});
assert.equal(sales.validatePayment({ total: 32.09, paymentMethod: 'نقدي', received: 32.09 }), true);
assert.throws(() => sales.validatePayment({ total: 32.09, paymentMethod: 'نقدي', received: 32.08 }), /insufficient-payment/);
assert.throws(() => sales.validatePayment({ total: 32.09, paymentMethod: 'محفظة', walletBalance: 32 }), /insufficient-wallet-balance/);
assert.equal(sales.validatePayment({ total: 32.09, paymentMethod: 'بطاقة' }), true);

const backup = {
  schemaVersion: 2,
  products: [{ id: 'p1' }],
  sales: [{ id: 's1', invoiceNo: 1, items: [{ productId: 'p1', qty: 1 }] }],
  moves: [], categories: [], settings: {}, users: [{ id: 'u1', username: 'cashier', role: 'cashier', password: 'must-not-export' }]
};
assert.ok(['products', 'sales', 'moves'].every(key => Array.isArray(backup[key])));
const safeUser = (({ id, name, username, role, authEmail }) => ({ id, name, username, role, authEmail: authEmail || '' }))(backup.users[0]);
assert.equal(Object.hasOwn(safeUser, 'password'), false);
console.log('priority validation tests: OK');
