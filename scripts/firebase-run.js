// Runs the Firebase emulators for the npm commands, with friendly checks first.
//   start      everything (Hosting, Functions, Firestore, Storage) -> http://localhost:5050
//   emulators  just Firestore and Storage, for F5 debugging in VS Code (portal on :3000)
//   setup      load the content and example staff, then save to ./emulator-data
//   test       run the automated tests against the real Firestore emulator
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const mode = process.argv[2];
const DATA = './emulator-data';
const hasData = fs.existsSync(`${DATA}/firebase-export-metadata.json`);
const fail = msg => { console.error(`\n${msg}\n`); process.exit(1); };

const java = spawnSync('java', ['-version'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (java.error || java.status !== 0) {
  fail('Java is needed for the Firebase emulators and was not found.\n' +
    'Install Java 21 (free): download the macOS installer (.pkg) from https://adoptium.net, or run  brew install --cask temurin@21\n' +
    'Then close and reopen the terminal and try again.');
}
const ver = /version "(\d+)/.exec(java.stderr || java.stdout || '');
if (ver && Number(ver[1]) < 21) fail(`Java ${ver[1]} is installed, but the Firebase emulators need Java 21 or newer. Install it from https://adoptium.net`);

const base = ['--project', 'demo-pelagos'];
let args;
if (mode === 'start' || mode === 'emulators') {
  if (!hasData) fail('There is no local data yet. Run  npm run setup  first (once).');
  args = ['emulators:start', ...base, ...(mode === 'emulators' ? ['--only', 'firestore,storage'] : []), `--import=${DATA}`, '--export-on-exit'];
} else if (mode === 'setup') {
  args = ['emulators:exec', ...base, '--only', 'firestore,storage', ...(hasData ? [`--import=${DATA}`] : []), `--export-on-exit=${DATA}`, 'node scripts/setup-local.js'];
} else if (mode === 'test') {
  args = ['emulators:exec', ...base, '--only', 'firestore,storage', 'node --test --test-concurrency=1 test/*.test.js'];
} else fail('Unknown command.');

const quoted = args.map(a => (/\s/.test(a) ? `"${a}"` : a));
const child = spawn('npx', ['firebase', ...quoted], { stdio: 'inherit', shell: true });
child.on('exit', code => process.exit(code ?? 0));
