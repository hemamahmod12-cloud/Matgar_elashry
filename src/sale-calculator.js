/* حسابات البيع مستقلة عن DOM وFirestore لتسهيل الاختبار وإعادة الاستخدام. */
(function (global) {
  'use strict';

  function toNonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function roundCents(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function calculateSale({ lines = [], discount = 0, taxRate = 0, paymentMethod = 'نقدي', received = 0 } = {}) {
    const subtotal = lines.reduce((sum, line) => {
      const price = toNonNegativeNumber(line.price);
      const quantity = toNonNegativeNumber(line.qty);
      const lineDiscount = Math.min(toNonNegativeNumber(line.discount), price * quantity);
      return sum + Math.max(0, price * quantity - lineDiscount);
    }, 0);

    const roundedSubtotal = roundCents(subtotal);
    const safeDiscount = roundCents(Math.min(toNonNegativeNumber(discount), roundedSubtotal));
    const taxable = roundCents(roundedSubtotal - safeDiscount);
    const safeTaxRate = toNonNegativeNumber(taxRate);
    const tax = roundCents(taxable * (safeTaxRate / 100));
    const total = roundCents(taxable + tax);
    const safeReceived = toNonNegativeNumber(received);

    return {
      subtotal: roundedSubtotal,
      discount: safeDiscount,
      tax,
      total,
      paymentMethod,
      received: safeReceived,
      change: paymentMethod === 'نقدي' ? roundCents(safeReceived - total) : 0
    };
  }

  function validatePayment({ total, paymentMethod, received } = {}) {
    if (paymentMethod === 'نقدي' && toNonNegativeNumber(received) < toNonNegativeNumber(total)) {
      throw new Error('insufficient-payment');
    }
    return true;
  }

  global.MatgarSales = Object.freeze({ calculateSale, validatePayment });
}(window));
