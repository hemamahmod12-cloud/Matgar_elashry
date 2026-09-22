'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const db = getFirestore();
const MONEY_EPSILON = 0.01;

function storeRef(storeId) {
  return db.collection('stores').doc(storeId);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundCents(value) {
  return Math.round(numberOrZero(value) * 100) / 100;
}

function assertRequestAuth(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول أولًا');
  }
}

function assertText(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpsError('invalid-argument', message);
  }
}

async function assertActiveStaff(uid, storeId) {
  const snapshot = await storeRef(storeId).collection('users').doc(uid).get();
  if (!snapshot.exists || snapshot.data().active !== true) {
    throw new HttpsError('permission-denied', 'المستخدم غير نشط أو غير مسجل');
  }
  const role = snapshot.data().role;
  if (!['admin', 'cashier'].includes(role)) {
    throw new HttpsError('permission-denied', 'الدور غير مسموح');
  }
  return snapshot.data();
}

function validatePayment(paymentMethod, received, total) {
  if (!['نقدي', 'بطاقة', 'محفظة'].includes(paymentMethod)) {
    throw new HttpsError('invalid-argument', 'طريقة الدفع غير صالحة');
  }
  if (paymentMethod === 'نقدي' && numberOrZero(received) < total) {
    throw new HttpsError('failed-precondition', 'المبلغ المستلم أقل من الإجمالي');
  }
}

exports.processSaleRequest = onCall(async request => {
  assertRequestAuth(request);
  const storeId = String(request.data?.storeId || 'main');
  const requestId = String(request.data?.requestId || '');
  assertText(requestId, 'رقم طلب البيع مطلوب');
  await assertActiveStaff(request.auth.uid, storeId);

  const store = storeRef(storeId);
  const requestRef = store.collection('saleRequests').doc(requestId);

  return db.runTransaction(async transaction => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) {
      throw new HttpsError('not-found', 'طلب البيع غير موجود');
    }

    const saleRequest = requestSnapshot.data();
    if (saleRequest.cashierId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'طلب البيع لا يخص المستخدم الحالي');
    }
    if (saleRequest.status === 'completed') {
      return { status: 'completed', saleId: saleRequest.saleId, invoiceNo: saleRequest.invoiceNo };
    }
    if (saleRequest.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'حالة طلب البيع غير صالحة');
    }
    if (!Array.isArray(saleRequest.items) || saleRequest.items.length === 0) {
      throw new HttpsError('invalid-argument', 'لا توجد أصناف في الطلب');
    }

    const counterRef = store.collection('invoiceCounters').doc('main');
    const counterSnapshot = await transaction.get(counterRef);
    const productRefs = saleRequest.items.map(item => {
      const productId = String(item.productId || '');
      if (!productId) throw new HttpsError('invalid-argument', 'معرف المنتج مطلوب');
      return store.collection('products').doc(productId);
    });
    const productSnapshots = await Promise.all(productRefs.map(ref => transaction.get(ref)));

    const items = [];
    let subtotal = 0;
    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) throw new HttpsError('failed-precondition', 'أحد المنتجات غير موجود');
      const product = snapshot.data();
      const requested = saleRequest.items[index];
      const qty = Number(requested.qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new HttpsError('invalid-argument', 'كمية المنتج غير صالحة');
      }
      if (product.deleted === true || numberOrZero(product.qty) < qty) {
        throw new HttpsError('failed-precondition', `المخزون غير كافٍ للمنتج: ${product.name}`);
      }
      const unitPrice = roundCents(product.sellPrice);
      const lineDiscount = roundCents(Math.max(0, Math.min(numberOrZero(requested.lineDiscount), unitPrice * qty)));
      subtotal = roundCents(subtotal + (unitPrice * qty) - lineDiscount);
      items.push({
        ref: productRefs[index],
        product,
        qty,
        unitPrice,
        lineDiscount
      });
    });

    const discount = roundCents(Math.max(0, Math.min(numberOrZero(saleRequest.discount), subtotal)));
    const tax = roundCents(Math.max(0, numberOrZero(saleRequest.tax)));
    const total = roundCents(subtotal - discount + tax);
    if (Math.abs(numberOrZero(saleRequest.total) - total) > MONEY_EPSILON) {
      throw new HttpsError('failed-precondition', 'إجمالي الطلب لا يطابق الأسعار الحالية');
    }
    validatePayment(saleRequest.paymentMethod, saleRequest.received, total);

    const invoiceNo = counterSnapshot.exists ? numberOrZero(counterSnapshot.data().nextInvoiceNo) : 1000;
    const now = FieldValue.serverTimestamp();
    const saleRef = store.collection('sales').doc();
    const sale = {
      invoiceNo,
      cashierId: request.auth.uid,
      cashierName: String(saleRequest.cashierName || ''),
      items: items.map(item => ({
        productId: item.ref.id,
        nameSnapshot: String(item.product.name || ''),
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineDiscount: item.lineDiscount
      })),
      subtotal,
      discount,
      tax,
      total,
      paymentMethod: saleRequest.paymentMethod,
      received: roundCents(saleRequest.received),
      change: saleRequest.paymentMethod === 'نقدي' ? roundCents(numberOrZero(saleRequest.received) - total) : 0,
      returned: false,
      createdAt: now
    };

    transaction.create(saleRef, sale);
    transaction.set(counterRef, { nextInvoiceNo: invoiceNo + 1, updatedAt: now }, { merge: true });
    items.forEach(item => {
      transaction.update(item.ref, {
        qty: numberOrZero(item.product.qty) - item.qty,
        updatedAt: now,
        updatedBy: request.auth.uid
      });
      transaction.create(store.collection('stockMoves').doc(), {
        type: 'out',
        productId: item.ref.id,
        productName: String(item.product.name || ''),
        qty: item.qty,
        saleId: saleRef.id,
        reason: `بيع فاتورة #${invoiceNo}`,
        byUserId: request.auth.uid,
        createdAt: now
      });
    });
    transaction.update(requestRef, { status: 'completed', saleId: saleRef.id, invoiceNo, completedAt: now });
    transaction.create(store.collection('auditLog').doc(), {
      action: 'بيع فاتورة',
      targetType: 'sales',
      targetId: saleRef.id,
      invoiceNo,
      total,
      byUserId: request.auth.uid,
      createdAt: now
    });

    return { status: 'completed', saleId: saleRef.id, invoiceNo };
  });
});

exports.processReturnRequest = onCall(async request => {
  assertRequestAuth(request);
  const storeId = String(request.data?.storeId || 'main');
  const requestId = String(request.data?.requestId || '');
  assertText(requestId, 'رقم طلب الاسترجاع مطلوب');
  await assertActiveStaff(request.auth.uid, storeId);

  const store = storeRef(storeId);
  const requestRef = store.collection('returnRequests').doc(requestId);

  return db.runTransaction(async transaction => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) throw new HttpsError('not-found', 'طلب الاسترجاع غير موجود');
    const returnRequest = requestSnapshot.data();
    if (returnRequest.cashierId !== request.auth.uid) throw new HttpsError('permission-denied', 'طلب الاسترجاع لا يخص المستخدم الحالي');
    if (returnRequest.status === 'completed') return { status: 'completed', saleId: returnRequest.saleId };
    if (returnRequest.status !== 'pending') throw new HttpsError('failed-precondition', 'حالة طلب الاسترجاع غير صالحة');

    const saleRef = store.collection('sales').doc(String(returnRequest.saleId || ''));
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists) throw new HttpsError('not-found', 'الفاتورة الأصلية غير موجودة');
    const sale = saleSnapshot.data();
    if (sale.returned === true) throw new HttpsError('already-exists', 'الفاتورة مرتجعة بالفعل');

    const requestedItems = Array.isArray(returnRequest.items) && returnRequest.items.length
      ? returnRequest.items
      : sale.items;
    const productRefs = requestedItems.map(item => store.collection('products').doc(String(item.productId || '')));
    const productSnapshots = await Promise.all(productRefs.map(ref => transaction.get(ref)));
    const now = FieldValue.serverTimestamp();

    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) throw new HttpsError('failed-precondition', 'منتج الاسترجاع غير موجود');
      const item = requestedItems[index];
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty <= 0) throw new HttpsError('invalid-argument', 'كمية الاسترجاع غير صالحة');
      const product = snapshot.data();
      transaction.update(productRefs[index], { qty: numberOrZero(product.qty) + qty, updatedAt: now, updatedBy: request.auth.uid });
      transaction.create(store.collection('stockMoves').doc(), {
        type: 'in',
        productId: productRefs[index].id,
        productName: String(product.name || ''),
        qty,
        saleId: saleRef.id,
        reason: `استرجاع فاتورة #${sale.invoiceNo}`,
        byUserId: request.auth.uid,
        createdAt: now
      });
    });

    transaction.update(saleRef, { returned: true, returnedAt: now, returnedBy: request.auth.uid });
    transaction.update(requestRef, { status: 'completed', completedAt: now });
    transaction.create(store.collection('auditLog').doc(), {
      action: 'استرجاع فاتورة',
      targetType: 'sales',
      targetId: saleRef.id,
      invoiceNo: sale.invoiceNo,
      byUserId: request.auth.uid,
      createdAt: now
    });
    return { status: 'completed', saleId: saleRef.id };
  });
});
