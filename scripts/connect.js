// Shared by the scripts that can run against the live project: connects to the emulators if they are
// running, otherwise to the live project with a service account key, after asking you to type LIVE.
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { initFirebase } from '../src/firebase.js';
import { config } from '../src/config.js';

export const LIVE_PROJECT = process.env.LIVE_PROJECT || 'pelagos-portal';
export const arg = k => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
export const flag = k => process.argv.includes(`--${k}`);
export const stop = msg => { console.error(`\n${msg}\n`); process.exit(1); };

export async function ask(question, { hidden = false } = {}) {
  if (!hidden || !process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question(question); rl.close(); return a;
  }
  process.stdout.write(question);
  return new Promise(resolve => {
    let s = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const onData = ch => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stdout.write('\n'); resolve(s); }
      else if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }
      else if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1);
      else s += ch;
    };
    process.stdin.on('data', onData);
  });
}

/** { db, bucket, live } */
export async function connect({ what, confirm = true }) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const fb = initFirebase();
    console.log(`Using the local emulators (project ${config.projectId}). Nothing live is touched.`);
    return { ...fb, live: false };
  }
  const key = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!key || !fs.existsSync(key)) stop('To run this against the live project, set GOOGLE_APPLICATION_CREDENTIALS to the service account key file first (README: "Service account key").\nTo try it locally instead, use the :local version of the command.');
  let keyProject; try { keyProject = JSON.parse(fs.readFileSync(key, 'utf8')).project_id; } catch { stop('The service account key file could not be read.'); }
  if (keyProject !== LIVE_PROJECT) stop(`That key belongs to the project "${keyProject}", not "${LIVE_PROJECT}".`);
  process.env.GCLOUD_PROJECT = LIVE_PROJECT;
  config.projectId = LIVE_PROJECT;
  if (confirm) {
    const ok = await ask(`\nThis will ${what} in the LIVE project "${LIVE_PROJECT}".\nType LIVE to continue: `);
    if (ok.trim() !== 'LIVE') stop('Nothing was changed.');
  }
  return { ...initFirebase({ allowLive: true }), live: true };
}
