// migrate-create-admin.js
// Usage (local emulator):
//   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/migrate-create-admin.js <projectId> <adminUid>
// Usage (production): run from a trusted environment with GOOGLE_APPLICATION_CREDENTIALS set

const admin = require('firebase-admin');

const [,, projectId, adminUid] = process.argv;
if(!projectId || !adminUid){
  console.error('Usage: node scripts/migrate-create-admin.js <projectId> <adminUid>');
  process.exit(1);
}

// Initialize admin SDK for the given project. In CI or prod, set GOOGLE_APPLICATION_CREDENTIALS env.
admin.initializeApp({ projectId });
const db = admin.firestore();

(async () => {
  try{
    const ref = db.doc(`users/${adminUid}`);
    await ref.set({ role: 'admin', migratedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    console.log(`OK: created/updated users/${adminUid} with role=admin`);
    process.exit(0);
  }catch(err){
    console.error('ERROR:', err);
    process.exit(2);
  }
})();
