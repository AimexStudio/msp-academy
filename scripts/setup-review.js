// Fills the review site's Firebase project (used by the Vercel review site) with Pelagos as client 1 and
// the demo clients and courses, then creates your platform admin. Run once:
//   npm run review:setup -- --email you@example.com --name "Your Name"
// It refuses to run against the live Pelagos project. Example staff are made up; nothing real is copied.
import { fileURLToPath } from 'node:url';
import { connectReview, arg, ask, stop } from './connect.js';
import { createBucketStorage } from '../src/storage.js';
import { importContent } from '../src/importer.js';
import { seedDemoStaff, seedDemoPlatform, seedDemoSharing, seedDemoLibrary, seedDemoLibraryLessons } from '../src/staff-admin.js';
import { createPlatformAdmin, validEmail, validPassword } from '../src/platform.js';
import { config } from '../src/config.js';

const email = arg('email'), name = arg('name');
if (!validEmail(email) || !name) stop('Usage: npm run review:setup -- --email you@example.com --name "Your Name"');
const { db, bucket, project } = await connectReview({ what: 'load Pelagos (example staff), the demo clients and courses, and create your platform admin' });
const pw = await ask('Choose a platform password (at least 12 characters, typing is hidden): ', { hidden: true });
if (!validPassword(pw)) stop('The password must be at least 12 characters. Nothing was changed.');
if (await ask('Type it again: ', { hidden: true }) !== pw) stop("The two passwords don't match. Nothing was changed.");

console.log('\nLoading Pelagos (documents, PDFs and the training video: a minute or two)…');
const r = await importContent({ db, storage: createBucketStorage(bucket), dir: fileURLToPath(new URL('../content/', import.meta.url)), orgId: config.orgId, publish: true });
console.log(`  ${r.added.length} documents added, ${r.published.length} published${r.skipped.length ? `, ${r.skipped.length} already there` : ''}.`);
await seedDemoStaff(db, config.orgId);
await seedDemoPlatform(db, { demoAdmin: false });
await seedDemoSharing(db, config.orgId);
await seedDemoLibrary(db);
await seedDemoLibraryLessons(db);
console.log('  Harbour Demo, HR Demo, the groups and the two library courses are there.');
let secret = null;
try { secret = (await createPlatformAdmin(db, { email, name, password: pw })).totpSecret; }
catch (e) { if (/already a platform admin/.test(e.message)) console.log(`  ${email} is already a platform admin here (password unchanged).`); else throw e; }
console.log(`\nDone. The review project "${project}" is ready.\n`);
if (secret) {
  console.log('Add your platform sign-in to an authenticator app on your phone:');
  console.log('  "Add account" / "+"  →  "Enter a setup key"');
  console.log(`  Account: ${email}   Key: ${secret.match(/.{1,4}/g).join(' ')}   Type: time-based\n`);
  console.log("Then clear this terminal (Cmd+K) so the key isn't left on screen.\n");
}
console.log('Example sign-ins on the review site (made-up people):');
console.log('  Client code PELAGOS: PL001 (manager) or PL002, PIN 1234');
console.log('  Client code HARBOUR: HB001 PIN 123456 (manager), HB002 PIN 1234');
console.log('  Client code HRDEMO:  HR001 PIN 123456 (manager)');
console.log('  Platform: <your Vercel address>/platform with your email, password and authenticator code\n');
process.exit(0);
