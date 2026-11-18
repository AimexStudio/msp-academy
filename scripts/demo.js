// Quick look, no Java or emulators needed: runs the portal on http://localhost:3000 with everything
// held in memory. Nothing is saved; stop it and it's gone. For real local work use `npm start`.
import { fileURLToPath } from 'node:url';
import { MemoryFirestore } from '../src/memory-firestore.js';
import { createMemoryStorage } from '../src/storage.js';
import { importContent } from '../src/importer.js';
import { seedDemoStaff } from '../src/staff-admin.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';

const db = new MemoryFirestore(), storage = createMemoryStorage();
const r = await importContent({ db, storage, dir: fileURLToPath(new URL('../content/', import.meta.url)), orgId: config.orgId, publish: true });
await seedDemoStaff(db, config.orgId);
const app = await buildApp({ db, storage, logger: false });
await app.listen({ port: config.port, host: config.host });
console.log(`Quick-look demo (nothing is saved): ${r.published.length} documents published.`);
console.log(`Pelagos Training Portal listening on http://localhost:${config.port}  ·  sign in as PL001 or PL002, PIN 1234`);
