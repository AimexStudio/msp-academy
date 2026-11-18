// Connects to Firestore and Cloud Storage: the emulators on a laptop, the real project in the cloud.
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { config } from './config.js';

export function initFirebase({ allowLive = false } = {}) {
  if (!allowLive && !config.usingEmulators && !config.production && !process.env.K_SERVICE && !process.env.FUNCTION_TARGET) {
    throw new Error(
      'The Firebase emulators are not running, so there is nothing to connect to.\n' +
      'Start them in another terminal with:  npm run emulators\n' +
      '(This check stops a laptop from writing to a real Firebase project by accident.)');
  }
  const app = getApps()[0] || initializeApp({ projectId: config.projectId, storageBucket: config.storageBucket });
  const db = getFirestore(app);
  try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* already set */ }
  return { db, bucket: getStorage(app).bucket() };
}
