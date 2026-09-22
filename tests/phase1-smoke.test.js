/* تشغيل: node tests/phase1-smoke.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {}, console };
vm.createContext(context);
for (const file of ['src/shared-utils.js', 'src/sale-calculator.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const { MatgarUtils, MatgarSales } = context.window;
assert.equal(MatgarUtils.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
assert.equal(MatgarUtils.safeImageDataUrl('javascript:alert(1)'), '');
assert.equal(MatgarUtils.safeImageDataUrl('data:text/html;base64,PHNjcmlwdD4='), '');
assert.equal(MatgarUtils.importNumber('١٢٫٥'), 12.5);
assert.equal(JSON.stringify(MatgarUtils.parseCSV('name,qty\n"أرز, فاخر",3')), JSON.stringify([{ name: 'أرز, فاخر', qty: '3' }]));
assert.equal(JSON.stringify(MatgarUtils.parseCSV('sep=;\n"اسم المنتج";"سعر الشراء";"الكمية"\n"أرز فاخر";"25";"4"')), JSON.stringify([{ name: 'أرز فاخر', buyPrice: '25', qty: '4' }]));

const sale = MatgarSales.calculateSale({
  lines: [{ price: 10, qty: 2, discount: 0 }],
  discount: -5,
  taxRate: 14,
  paymentMethod: 'نقدي',
  received: 25
});
assert.equal(sale.subtotal, 20);
assert.equal(sale.discount, 0);
assert.equal(sale.total, 22.8);
assert.equal(sale.change, 2.2);
assert.throws(() => MatgarSales.validatePayment({ total: 22.8, paymentMethod: 'نقدي', received: 20 }), /insufficient-payment/);
assert.doesNotThrow(() => MatgarSales.validatePayment({ total: 22.8, paymentMethod: 'بطاقة', received: 0 }));

console.log('phase1 smoke tests: OK');
