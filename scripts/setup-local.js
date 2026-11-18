// Loads the Pelagos content and the example staff into the Firebase emulators. Run it with
// `npm run setup` (which starts the emulators for it and saves the data to ./emulator-data).
import { fileURLToPath } from 'node:url';
import { initFirebase } from '../src/firebase.js';
import { createBucketStorage } from '../src/storage.js';
import { importContent } from '../src/importer.js';
import { seedDemoStaff } from '../src/staff-admin.js';
import { config } from '../src/config.js';

if (!config.usingEmulators) { console.error('Setup only runs against the Firebase emulators. Use: npm run setup'); process.exit(1); }
const { db, bucket } = initFirebase();
const dir = fileURLToPath(new URL('../content/', import.meta.url));
const r = await importContent({ db, storage: createBucketStorage(bucket), dir, orgId: config.orgId, publish: true });
console.log(`Content: ${r.added.length} documents imported, ${r.published.length} published${r.skipped.length ? `, ${r.skipped.length} already there` : ''}.`);
const ids = await seedDemoStaff(db, config.orgId);
console.log(`Example staff: ${Object.keys(ids).length ? Object.keys(ids).join(', ') : 'already there'} (PIN 1234).`);
console.log('\nReady. Start the portal with:  npm start   then open http://localhost:5050\n');
process.exit(0);
