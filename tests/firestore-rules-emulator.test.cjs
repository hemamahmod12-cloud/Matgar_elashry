const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const PROJECT_ID = process.env.FIRESTORE_TEST_PROJECT || 'demo-matgar-staging';
const ADMIN_UID = 'VvzxZTFfYOawEnk4vw3QtFNFGR2';
const CASHIER_UID = 'staging-cashier-001';

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') }
  });
  try {
    const unauthenticated = testEnv.unauthenticatedContext().firestore();
    const admin = testEnv.authenticatedContext(ADMIN_UID).firestore();
    const cashier = testEnv.authenticatedContext(CASHIER_UID).firestore();

    const products = doc(admin, 'storeData/products');
    const settings = doc(admin, 'storeData/settings');
    const unauthProducts = doc(unauthenticated, 'storeData/products');
    const cashierSettings = doc(cashier, 'storeData/settings');

    await assertFails(getDoc(unauthProducts));
    await assertSucceeds(setDoc(products, { value: '[]', updatedAt: 1 }));
    await assertSucceeds(getDoc(products));
    await assertSucceeds(setDoc(settings, { value: '{}', updatedAt: 1 }));
    await assertFails(setDoc(cashierSettings, { value: '{}', updatedAt: 1 }));

    console.log('firestore rules emulator tests: OK');
  } finally {
    await testEnv.clearFirestore();
    await testEnv.cleanup();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
