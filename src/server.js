// Runs the portal as a plain Node server on http://localhost:3000, connected to the Firebase emulators.
// Handy for debugging with breakpoints in VS Code (F5). `npm start` runs the full Firebase setup instead.
import { buildApp } from './app.js';
import { config } from './config.js';
import { initFirebase } from './firebase.js';
import { createBucketStorage } from './storage.js';

import net from 'node:net';

// Locally, connect to the emulators started with `npm run emulators` (or `npm start`).
if (!config.production) {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199';
  process.env.GCLOUD_PROJECT ||= config.projectId;
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const up = await new Promise(res => { const s = net.connect(Number(port), host, () => { s.end(); res(true); }); s.on('error', () => res(false)); s.setTimeout(1500, () => { s.destroy(); res(false); }); });
  if (!up) { console.error('\nThe Firebase emulators are not running. Start them in another terminal with:  npm run emulators\n'); process.exit(1); }
}
let fb;
try { fb = initFirebase(); } catch (e) { console.error('\n' + e.message + '\n'); process.exit(1); }
const app = await buildApp({ db: fb.db, storage: createBucketStorage(fb.bucket) });
await app.listen({ port: config.port, host: config.host });
console.log(`MSP Academy listening on http://localhost:${config.port}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
