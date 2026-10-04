/* ترحيل آمن من storeData/users إلى roles؛ لا يشغل تلقائيًا داخل CI. */
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const serviceAccountPath = path.resolve(
  process.env.SERVICE_ACCOUNT_KEY || '../serviceAccountKey.json'
);
if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(`مفتاح Firebase غير موجود: ${serviceAccountPath}`);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

function decodeUsers(data) {
  const raw = data && Object.prototype.hasOwnProperty.call(data, 'value') ? data.value : data;
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed
        : Object.entries(parsed || {}).map(([id, user]) => ({ id, ...user }));
    } catch (error) {
      throw new Error(`تعذر تحليل storeData/users: ${error.message}`);
    }
  }
  return Object.entries(raw || {}).map(([id, user]) => ({ id, ...user }));
}

async function migrateRoles() {
  console.log('🚀 بدء ترحيل الأدوار...');
  const usersSnap = await db.collection('storeData').doc('users').get();
  if (!usersSnap.exists) {
    console.log('⚠️ لا يوجد مستند users.');
    return;
  }
  const users = decodeUsers(usersSnap.data());
  const batch = db.batch();
  let count = 0;
  for (const user of users) {
    if (!user || !user.id || !['admin', 'manager', 'cashier'].includes(user.role)) {
      continue;
    }
    batch.set(
      db.collection('roles').doc(user.id),
      {
        role: user.role,
        isAdmin: user.role === 'admin',
        isManager: user.role === 'manager',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        migratedFrom: 'storeData/users',
      },
      { merge: true }
    );
    count += 1;
  }
  await batch.commit();
  console.log(`✅ تم ترحيل ${count} مستخدم.`);
}

migrateRoles()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ فشل:', error);
    process.exit(1);
  });
