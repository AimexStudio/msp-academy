// All settings come from the environment, so the same code runs on a laptop and in Firebase.
// For local work they are read from a .env file in the project folder (copy .env.example to .env).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
// On Vercel, the Firebase project comes from the service account key stored in Vercel's settings.
export function serviceAccountFromEnv() {
  const raw = env.FIREBASE_SERVICE_ACCOUNT || (env.FIREBASE_SERVICE_ACCOUNT_B64 ? Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8') : '');
  if (!raw) return null;
  try { const j = JSON.parse(raw); return j && j.project_id && j.private_key ? j : null; } catch { return null; }
}
const keyProject = (serviceAccountFromEnv() || {}).project_id;
const projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || env.PELAGOS_PROJECT || keyProject || 'demo-pelagos';

export const config = {
  port: num(env.PORTAL_PORT || env.PORT, 3000),
  host: env.HOST || '0.0.0.0',
  projectId,
  // Projects created since late 2024 use <project>.firebasestorage.app. The emulators accept any name.
  get storageBucket() { return env.STORAGE_BUCKET || (process.env.FIRESTORE_EMULATOR_HOST ? `${this.projectId}.appspot.com` : `${this.projectId}.firebasestorage.app`); },
  // Cloud Functions region: europe-west1 (Belgium), next to the Firestore database in eur3 (Europe).
  // If you change it, change the rewrite region in firebase.json to match.
  region: env.PELAGOS_REGION || 'europe-west1',
  // Live on Firebase (Cloud Functions), not the emulators: switches on secure cookies and HSTS.
  production: env.NODE_ENV === 'production' || env.VERCEL === '1' || (!!env.K_SERVICE && env.FUNCTIONS_EMULATOR !== 'true'),
  vercel: env.VERCEL === '1',
  // The shared address where /platform works, for the Admin button on a client's own web address.
  // Set PLATFORM_URL (e.g. https://academy.mspcondev.co.za) once the platform has its own domain.
  get platformUrl() { return (env.PLATFORM_URL || (this.production && !this.vercel && !this.usingEmulators ? `https://${this.projectId}.firebaseapp.com` : '')).replace(/\/+$/, ''); },
  // Vercel functions can't send or receive more than 4.5 MB at once: uploads are capped and videos stream in pieces.
  get maxResponseBytes() { return this.vercel ? 4 * 1024 * 1024 : Infinity; },
  // The emulators are "local"; anything else is a real Firebase project.
  get usingEmulators() { return !!process.env.FIRESTORE_EMULATOR_HOST; },
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true' || env.VERCEL === '1',
  orgId: env.ORG_ID || 'pelagos-langebaan',
  // Cloud Functions accepts requests up to 32 MB, so uploads stay under that.
  get maxUploadMb() { return this.vercel ? 4 : Math.min(num(env.MAX_UPLOAD_MB, 30), 30); },
  idleMinutes: { staff: num(env.IDLE_MINUTES_STAFF, 10), manager: num(env.IDLE_MINUTES_MANAGER, 30) },
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
};
