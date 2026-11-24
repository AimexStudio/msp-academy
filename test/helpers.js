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
  const app = await buildApp({ db, storage, logger: false });
  return { app, db, storage, ids, close: () => app.close() };
}

export const versionOf = async (db, code, orgId = ORG) => {
  const d = (await docRef(db, orgId, code).get()).data();
  return (await docRef(db, orgId, code).collection('versions').doc(`${d.current.major}.${d.current.minor}`).get()).data();
};
export const answersOf = async (db, code, orgId = ORG) => (await versionOf(db, code, orgId)).questions.map(q => q.correct);

/** A browser. clientCode is what the shared sign-in page sends; host is the web address it was opened on. */
export function client(app, { clientCode = 'PELAGOS', host = 'localhost' } = {}) {
  let cookie = '';
  const call = async (method, url, body, extraHeaders = {}) => {
    const res = await app.inject({ method, url, payload: body, headers: { 'x-pelagos': '1', host, cookie, ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders } });
    const set = res.headers['set-cookie'];
    if (set) cookie = String(Array.isArray(set) ? set[0] : set).split(';')[0];
    let json = null; try { json = res.json(); } catch {}
    return { status: res.statusCode, body: json, raw: res };
  };
  return {
    call, get: url => call('GET', url), post: (url, body = {}) => call('POST', url, body), put: (url, body) => call('PUT', url, body), patch: (url, body) => call('PATCH', url, body),
    login: (staffNo, pin = '1234', code = clientCode) => call('POST', '/api/auth/login', { clientCode: code, staffNo, pin }),
    platformLogin: (email, password) => call('POST', '/api/platform/login', { email, password }),
    get cookie() { return cookie; }, set cookie(v) { cookie = v; },
  };
}

/** Read (marking any video as watched), pass the quiz and sign one document. */
export async function completeDoc(db, c, code, name, staffId, orgId = ORG) {
  const d = (await c.get(`/api/my/documents/${code}`)).body.doc;
  for (const v of d.videos) await db.collection('progress').doc(`${staffId}__${code}__${d.major}`).set({ orgId, staffId, code, major: d.major, videos: { [v.fileId]: { completedAt: new Date().toISOString() } } }, { merge: true });
  const read = await c.post(`/api/my/documents/${code}/read`, { versionId: d.versionId });
  if (read.status !== 200) throw new Error(`read ${code}: ${read.body.error}`);
  if (d.questions.length) {
    const a = await c.post(`/api/my/documents/${code}/attempts`, { versionId: d.versionId, answers: await answersOf(db, code, orgId) });
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

/* ---------- two clients side by side, for the isolation, platform, sharing and builder tests ---------- */
import { createClient, createPlatformAdmin } from '../src/platform.js';

export const HARBOUR = 'harbour-hotel';

/** Upload a file through a manager endpoint (multipart), as the browser does. */
export async function uploadAs(c, url, buf, filename, type) {
  const b = '----testboundary' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
  return c.call('POST', url, payload, { 'content-type': `multipart/form-data; boundary=${b}` });
}

/**
 * Pelagos (client 1, all real content) plus Harbour Hotel (client 2), built the way a real second
 * client would be: created on the platform, then set up by its own manager through the screens.
 * Harbour deliberately reuses Pelagos's staff numbers (PL001, PL002) to prove they are per client.
 */
export async function setupTwoClients() {
  const env = await setup();
  const { db, app } = env;
  const fs = await import('node:fs');
  await createClient(db, null, { name: 'Harbour Hotel', loginCode: 'HARBOUR', docPrefix: 'HBR', staffNoPrefix: 'PL',
    manager: { name: 'Harbour Manager', staffNo: 'PL001', pin: '654321' },
    branding: { wordmark: 'HARBOUR', colors: { primary: '#123456', accent: '#336699', highlight: '#CC9933', background: '#F0F0F0' } } });
  const hm = client(app, { clientCode: 'HARBOUR' });
  const lr = await hm.login('PL001', '654321');
  if (lr.status !== 200) throw new Error('Harbour manager sign-in: ' + JSON.stringify(lr.body));
  const staff = await hm.post('/api/admin/staff', { name: 'Harbour Waitron', staffNo: 'PL002', positionId: 'staff', pin: '1111' });
  if (staff.status !== 200) throw new Error('Harbour staff: ' + JSON.stringify(staff.body));
  const up = await uploadAs(hm, '/api/admin/files', fs.readFileSync(`${CONTENT}files/PEL-SOP-003.pdf`), 'harbour-checkin.pdf', 'application/pdf');
  if (up.status !== 200) throw new Error('Harbour upload: ' + JSON.stringify(up.body));
  const created = (await hm.post('/api/admin/documents', { kind: 'sop' })).body;
  const q = (t, c) => ({ q: t, options: ['Yes', 'No', 'Maybe'], correct: c });
  await hm.put(`/api/admin/documents/${created.code}`, { draft: { ...created.draft, title: 'Guest Check-in', body: '## Check-in\n\nGreet every guest by name.',
    audience: { all: true, positions: [] }, pdfFileId: up.body.id, questions: [q('Greet by name?', 0), q('Skip the ID check?', 1)] } });
  const pub = await hm.post(`/api/admin/documents/${created.code}/publish`, {});
  if (pub.status !== 200) throw new Error('Harbour publish: ' + JSON.stringify(pub.body));
  const hs = client(app, { clientCode: 'HARBOUR' });
  await hs.login('PL002', '1111');
  const hsId = staff.body.id;
  await completeDoc(db, hs, created.code, 'Harbour Waitron', hsId, HARBOUR);
  const hdecl = await hs.post('/api/my/declaration', { agree: true, typedName: 'Harbour Waitron', signature: signaturePng() });
  if (hdecl.status !== 200) throw new Error('Harbour declaration: ' + JSON.stringify(hdecl.body));

  // A Pelagos person with a full record and a signed declaration.
  const pc = client(app); await pc.login('PL005');
  for (const i of (await pc.get('/api/my/course')).body.items) await completeDoc(db, pc, i.code, 'Example Housekeeper', env.ids.PL005);
  const pdecl = await pc.post('/api/my/declaration', { agree: true, typedName: 'Example Housekeeper', signature: signaturePng() });

  // A Pelagos built course, finished by PL005, for the isolation sweep to try to reach from Harbour.
  const pm = client(app); await pm.login('PL001');
  const pcourse = await pm.post('/api/admin/courses', { draft: { title: 'Pelagos Front of House', description: 'Service standards', audience: { all: true, positions: [] }, modules: [
    { id: 'm-welcome', title: 'Welcome', lessons: [{ id: 'l-welcome', type: 'text', title: 'Welcome to Pelagos', body: 'Pelagos service is warm and exact.' },
      { id: 'l-check', type: 'quiz', title: 'Check', passMark: 100, questions: [{ q: 'Is Pelagos service warm?', options: ['Yes', 'No'], correct: 0 }] }] },
    { id: 'm-sops', title: 'Standards', lessons: [{ id: 'l-sop1', type: 'document', code: 'PEL-SOP-001' }] }] } });
  if (pcourse.status !== 200) throw new Error('Pelagos course: ' + JSON.stringify(pcourse.body));
  const cpub = await pm.post(`/api/admin/courses/${pcourse.body.id}/publish`, {});
  if (cpub.status !== 200) throw new Error('Pelagos course publish: ' + JSON.stringify(cpub.body));
  await pc.post(`/api/my/courses/${pcourse.body.id}/lessons/l-welcome/done`, { versionId: `${pcourse.body.id}@1.0` });
  const cq = await pc.post(`/api/my/courses/${pcourse.body.id}/lessons/l-check/quiz`, { versionId: `${pcourse.body.id}@1.0`, answers: [0] });
  if (!cq.body.progress || !cq.body.progress.completion) throw new Error('Pelagos course certificate: ' + JSON.stringify(cq.body));

  // Leave tracking switched on for both clients; a Pelagos leave record with a medical certificate.
  for (const o of [ORG, HARBOUR]) await db.collection('orgs').doc(o).update({ features: { leave: true } });
  const { invalidate } = await import('../src/tenancy.js'); invalidate(db);
  await pm.put(`/api/admin/leave/${env.ids.PL005}/profile`, { annualDays: 15, openingBalance: 1, accrualStart: '2026-01-01' });
  const cert = await uploadAs(pm, `/api/admin/leave/${env.ids.PL005}/certificate`, fs.readFileSync(`${CONTENT}files/PEL-SOP-003.pdf`), 'pelagos-certificate.pdf', 'application/pdf');
  if (cert.status !== 200) throw new Error('Pelagos certificate: ' + JSON.stringify(cert.body));
  const leave = await pm.post(`/api/admin/leave/${env.ids.PL005}/entries`, { type: 'sick', startDate: '2026-03-02', endDate: '2026-03-03', note: 'Pelagos private note', certificateFileId: cert.body.id });
  if (leave.status !== 200) throw new Error('Pelagos leave: ' + JSON.stringify(leave.body));
  const evRef = await db.collection('courseEvidence').add({ orgId: ORG, staffId: env.ids.PL005, courseId: pcourse.body.id, versionId: `${pcourse.body.id}@1.0`, major: 1,
    lessonId: 'l-welcome', lessonTitle: 'Welcome to Pelagos', courseTitle: 'Pelagos Front of House', text: 'Pelagos evidence', fileId: null, status: 'pending', note: null,
    submittedAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null });
  const pv = await versionOf(db, 'PEL-SOP-001');
  return { ...env, harbour: { manager: hm, staff: hs, staffId: hsId, docCode: created.code, fileId: up.body.id, declarationId: hdecl.body.declaration.id },
    pelagos: { staffId: env.ids.PL005, waitronId: env.ids.PL002, managerId: env.ids.PL001, docCode: 'PEL-SOP-001', pdfFileId: pv.pdfFileId,
      videoFileId: pv.videos[0].fileId, declarationId: pdecl.body.declaration.id, version: `${pv.major}.${pv.minor}`,
      courseId: pcourse.body.id, lessonId: 'l-welcome', quizId: 'l-check', evidenceId: evRef.id, leaveId: leave.body.id, certificateId: cert.body.id } };
}

/** A platform admin for tests: signs in with email and password. */
export async function makePlatformAdmin(db, { email = 'ops@example.com', password = 'correct horse battery' } = {}) {
  const r = await createPlatformAdmin(db, { email, name: 'Olivia Ops', password });
  return { ...r, email, password };
}
