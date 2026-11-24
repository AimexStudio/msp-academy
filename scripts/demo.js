// Quick look, no Java or emulators needed: runs MSP Academy on http://localhost:3000 with everything
// held in memory. Nothing is saved; stop it and it's gone. For real local work use `npm start`.
import { fileURLToPath } from 'node:url';
import { MemoryFirestore } from '../src/memory-firestore.js';
import { createMemoryStorage } from '../src/storage.js';
import { importContent } from '../src/importer.js';
import { seedDemoStaff, seedDemoPlatform, seedDemoSharing, seedDemoLibrary, seedDemoLibraryLessons, seedDemoLeave, DEMO_ADMIN } from '../src/staff-admin.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';

const db = new MemoryFirestore(), storage = createMemoryStorage();
const r = await importContent({ db, storage, dir: fileURLToPath(new URL('../content/', import.meta.url)), orgId: config.orgId, publish: true });
await seedDemoStaff(db, config.orgId);
await seedDemoPlatform(db);
await seedDemoSharing(db, config.orgId);
await seedDemoLibrary(db);
await seedDemoLibraryLessons(db);
await seedDemoLeave(db, config.orgId);
const app = await buildApp({ db, storage, logger: false });
await app.listen({ port: config.port, host: config.host });
console.log(`MSP Academy quick-look demo (nothing is saved): Pelagos with ${r.published.length} documents, Harbour Demo, HR Demo, and a library course.`);
console.log(`Open http://localhost:${config.port}`);
console.log('  Client code PELAGOS: PL001 (manager) or PL002, PIN 1234');
console.log('  Client code HARBOUR: HB001 PIN 123456 (manager), HB002 PIN 1234');
console.log('  Client code HRDEMO:  HR001 PIN 123456 (manager)');
console.log(`  Platform: http://localhost:${config.port}/platform  ${DEMO_ADMIN.email} / ${DEMO_ADMIN.password}`);
