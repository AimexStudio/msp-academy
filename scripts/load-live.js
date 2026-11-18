// Loads the Pelagos content into the LIVE Firebase project and creates the first real manager.
// Run it once, after the first deploy. It never adds the example staff.
//
//   npm run load-live -- --staff-no PL001 --name "Full Name" --position gm --pin 482913
//
// It signs in to Google Cloud with a service account key (see the README, "Going live").
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { initFirebase } from '../src/firebase.js';
import { createBucketStorage } from '../src/storage.js';
import { importContent } from '../src/importer.js';
import { createStaff } from '../src/staff-admin.js';
import { validPin } from '../src/auth.js';
import { audit } from '../src/documents.js';
import { config } from '../src/config.js';

const LIVE = 'pelagos-portal';
const arg = k => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const staffNo = arg('staff-no'), name = arg('name'), positionId = arg('position') || 'gm', pin = arg('pin');
const stop = msg => { console.error(`\n${msg}\n`); process.exit(1); };

if (!staffNo || !name || !validPin(pin)) stop('Usage: npm run load-live -- --staff-no PL001 --name "Full Name" --position gm --pin 482913\n(Use a 6-digit PIN that is not 1234.)');
if (pin === '1234' || /^(\d)\1+$/.test(pin)) stop('Choose a PIN that is harder to guess than 1234 or repeated digits.');
if (process.env.FIRESTORE_EMULATOR_HOST) stop('This is for the live project. Close any terminal running the emulators and run it from a fresh terminal.');
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!key || !fs.existsSync(key)) stop('Set GOOGLE_APPLICATION_CREDENTIALS to the service account key file first (see the README, "Going live").');
let keyProject; try { keyProject = JSON.parse(fs.readFileSync(key, 'utf8')).project_id; } catch { stop('The service account key file could not be read.'); }
if (keyProject !== LIVE) stop(`That key belongs to the project "${keyProject}", not "${LIVE}".`);
process.env.GCLOUD_PROJECT = LIVE;
config.projectId = LIVE;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ok = await rl.question(`This writes to the LIVE project "${LIVE}" (bucket ${config.storageBucket}).\nType LIVE to continue: `);
rl.close();
if (ok.trim() !== 'LIVE') stop('Nothing was changed.');

const { db, bucket } = initFirebase({ allowLive: true });
console.log('Loading the documents, PDFs and video (a minute or two)…');
const dir = fileURLToPath(new URL('../content/', import.meta.url));
const r = await importContent({ db, storage: createBucketStorage(bucket), dir, orgId: config.orgId, publish: false });
console.log(`Documents: ${r.added.length} added as drafts${r.skipped.length ? `, ${r.skipped.length} already there` : ''}.`);
const org = await db.collection('orgs').doc(config.orgId).get();
if (!org.get('positions').some(p => p.id === positionId)) stop(`Position "${positionId}" not found.`);
const id = await createStaff(db, config.orgId, { staffNo, name, positionId, role: 'manager', pin });
if (id) { await audit(db, config.orgId, null, 'staff.manager_create_cli', 'staff', id, { staffNo }); console.log(`Manager ${staffNo} created.`); }
else console.log(`Staff number ${staffNo} already exists; left unchanged.`);
console.log('\nDone. Sign in at https://pelagos-portal.web.app, review the drafts in the SOP library, then publish them.\n');
process.exit(0);
