// Loads Pelagos (client 1), the demo clients, a demo platform admin and a sample library course into the
// Firebase emulators. Run it with `npm run setup`. Local data from the single-client version is moved onto
// the platform first, the same way as the live move.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initFirebase } from '../src/firebase.js';
import { createBucketStorage } from '../src/storage.js';
import { importContent } from '../src/importer.js';
import { seedDemoStaff, seedDemoPlatform, seedDemoSharing, seedDemoLibrary, seedDemoLibraryLessons, seedDemoLeave, DEMO_ADMIN } from '../src/staff-admin.js';
import { migrateFirstClient } from '../src/migrate.js';
import { config } from '../src/config.js';

if (!config.usingEmulators) { console.error('Setup only runs against the Firebase emulators. Use: npm run setup'); process.exit(1); }
const { db, bucket } = initFirebase();
const dir = fileURLToPath(new URL('../content/', import.meta.url));
const old = await db.collection('orgs').doc(config.orgId).get();
if (old.exists && old.get('clientNo') == null) {
  console.log('Your local data is from the single-client version. Moving it onto the platform first…');
  const c = JSON.parse(fs.readFileSync(new URL('../content/config.json', import.meta.url), 'utf8')).client;
  await migrateFirstClient(db, { orgId: config.orgId, loginCode: c.loginCode, docPrefix: c.docPrefix, staffNoPrefix: c.staffNoPrefix, branding: c.branding, apply: true });
  console.log('');
}
const r = await importContent({ db, storage: createBucketStorage(bucket), dir, orgId: config.orgId, publish: true });
console.log(`Pelagos: ${r.added.length} documents imported, ${r.published.length} published${r.skipped.length ? `, ${r.skipped.length} already there` : ''}.`);
const ids = await seedDemoStaff(db, config.orgId);
console.log(`Pelagos example staff: ${Object.keys(ids).length ? Object.keys(ids).join(', ') : 'already there'} (PIN 1234).`);
if (await seedDemoPlatform(db)) console.log('Harbour Demo (client code HARBOUR): HB001 PIN 123456 (manager), HB002 and PL002 PIN 1234.');
if (await seedDemoSharing(db, config.orgId)) console.log('HR Demo (client code HRDEMO, HR group): HR001 PIN 123456, with an "HR Essentials" course to share.');
if (await seedDemoLibrary(db)) console.log('MSP Academy library: a sample course, "Customer Service Fundamentals", ready to share (Platform → Library).');
if (await seedDemoLibraryLessons(db)) console.log('MSP Academy library: "Workplace Safety Starter" (checklist, policy sign-off, field evidence).');
if (await seedDemoLeave(db, config.orgId)) console.log('Leave tracking: switched on for Pelagos and Harbour Demo, with sample leave.');
console.log(`Platform admin: ${DEMO_ADMIN.email}, password ${DEMO_ADMIN.password}, no code needed locally.`);
console.log('\nReady. Start it with:  npm start   then open http://localhost:5050\n');
process.exit(0);
