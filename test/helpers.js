import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { importContent } from '../src/importer.js';
import { seedDemoStaff } from '../src/staff-admin.js';
import { MemoryFirestore } from '../src/memory-firestore.js';
import { createMemoryStorage, createBucketStorage } from '../src/storage.js';
import { docRef } from '../src/documents.js';
import { config } from '../src/config.js';

export const CONTENT = fileURLToPath(new URL('../content/', import.meta.url));
export const ORG = config.orgId;
export const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

/** A fresh database with all the real content imported and published, plus the example staff. */
export async function setup() {
  let db, storage;
  if (usingEmulator) {
    const { initFirebase } = await import('../src/firebase.js');
    const fb = initFirebase();
    db = fb.db; storage = createBucketStorage(fb.bucket);
    await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${config.projectId}/databases/(default)/documents`, { method: 'DELETE' });
  } else {
    db = new MemoryFirestore(); storage = createMemoryStorage();
  }
  await importContent({ db, storage, dir: CONTENT, orgId: ORG, publish: true, log: { warn() {} } });
  const ids = await seedDemoStaff(db, ORG);
  const app = await buildApp({ db, storage, logger: false, orgId: ORG });
  return { app, db, ids, close: () => app.close() };
}

export const versionOf = async (db, code) => {
  const d = (await docRef(db, ORG, code).get()).data();
  return (await docRef(db, ORG, code).collection('versions').doc(`${d.current.major}.${d.current.minor}`).get()).data();
};
export const answersOf = async (db, code) => (await versionOf(db, code)).questions.map(q => q.correct);

export function client(app) {
  let cookie = '';
  const call = async (method, url, body, extraHeaders = {}) => {
    const res = await app.inject({ method, url, payload: body, headers: { 'x-pelagos': '1', cookie, ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders } });
    const set = res.headers['set-cookie'];
    if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(';')[0];
    let json = null; try { json = res.json(); } catch {}
    return { status: res.statusCode, body: json, raw: res };
  };
  return {
    call, get: url => call('GET', url), post: (url, body = {}) => call('POST', url, body), put: (url, body) => call('PUT', url, body), patch: (url, body) => call('PATCH', url, body),
    login: (staffNo, pin = '1234') => call('POST', '/api/auth/login', { staffNo, pin }),
  };
}

/** Read (marking any video as watched), pass the quiz and sign one document. */
export async function completeDoc(db, c, code, name, staffId) {
  const d = (await c.get(`/api/my/documents/${code}`)).body.doc;
  for (const v of d.videos) await db.collection('progress').doc(`${staffId}__${code}__${d.major}`).set({ orgId: ORG, staffId, code, major: d.major, videos: { [v.fileId]: { completedAt: new Date().toISOString() } } }, { merge: true });
  const read = await c.post(`/api/my/documents/${code}/read`, { versionId: d.versionId });
  if (read.status !== 200) throw new Error(`read ${code}: ${read.body.error}`);
  if (d.questions.length) {
    const a = await c.post(`/api/my/documents/${code}/attempts`, { versionId: d.versionId, answers: await answersOf(db, code) });
    if (!a.body.result.passed) throw new Error('quiz failed');
  }
  const s = await c.post(`/api/my/documents/${code}/signoff`, { versionId: d.versionId, agree: true, typedName: name });
  if (s.status !== 200) throw new Error(`sign ${code}: ${s.body.error}`);
  return s.body.signoff;
}

/** A valid 300x100 PNG with a scribble on it, as the signature pad would produce. */
export function signaturePng() {
  const W = 300, H = 100, rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 4);
    for (let x = 0; x < W; x++) if (Math.abs(y - (50 + 30 * Math.sin(x / 17))) < 2) row.writeUInt32BE(0x18302fff, 1 + x * 4);
    rows.push(row);
  }
  const tbl = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = tbl[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
