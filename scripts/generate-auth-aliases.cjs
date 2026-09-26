const fs = require('fs');

async function main() {
  const output = 'auth-aliases.json';
  const fallback = () => fs.writeFileSync(output, JSON.stringify({}, null, 2) + '\n');
  try {
    const { getApps, initializeApp, cert } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return fallback();
    const serviceAccount = JSON.parse(raw);
    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId: 'story-market-35565'
      });
    }
    const snapshot = await getFirestore().collection('storeData').doc('users').get();
    const users = snapshot.exists ? JSON.parse(String(snapshot.data()?.value || '[]')) : [];
    const aliases = {};
    for (const user of Array.isArray(users) ? users : []) {
      const username = String(user?.username || '').trim().toLowerCase();
      const email = String(user?.authEmail || '').trim().toLowerCase();
      if (username && email && email.includes('@')) aliases[username] = email;
    }
    fs.writeFileSync(output, JSON.stringify(aliases, null, 2) + '\n');
  } catch (error) {
    console.warn('auth alias generation skipped:', error.message);
    fallback();
  }
}

main();
