/* فحص بنيوي فقط؛ الاختبار التنفيذي يحتاج Firebase Emulator أو Rules Playground. */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const rules = fs.readFileSync('firestore.rules', 'utf8');
assert.match(rules, /rules_version\s*=\s*'2'/);
assert.match(rules, /request\.auth\.uid\s*==\s*'VvzxZTFfYOawEnk4vw3QtFNFGR2'/i);
assert.match(rules, /match \/auditLog\/\{entryId\}/);
assert.match(rules, /allow update, delete: if false;/);
assert.match(rules, /match \/\{document=\*\*\}/);
assert.match(rules, /allow read, write: if false;/);
assert.match(fs.readFileSync('tests/firestore-rules-emulator.test.cjs', 'utf8'), /initializeTestEnvironment/);
assert.match(fs.readFileSync('.github/workflows/firestore-rules-emulator.yml', 'utf8'), /emulators:exec/);
console.log('firestore rules smoke tests: OK');
