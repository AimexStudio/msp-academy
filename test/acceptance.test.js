// The acceptance checks from the developer pack (section 9), plus Appendix B, run against the real content.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, completeDoc, signaturePng, answersOf, versionOf, ORG } from './helpers.js';
import { verifyChain } from '../src/evidence.js';

let env;
const ageSessions = async (staffId, minutes) => { const q = await env.db.collection('sessions').where('staffId', '==', staffId).get(); for (const d of q.docs) await d.ref.update({ lastSeenAt: new Date(Date.now() - minutes * 60000).toISOString() }); };
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const APPENDIX_B = {
  gm: [8, 236, 54], rm: [15, 356, 106], fnb: [6, 214, 42], dm: [15, 356, 106], headwaiter: [14, 349, 100],
  waitron: [12, 324, 86], runner: [9, 151, 62], deli: [10, 162, 69], host: [10, 177, 72], bartender: [14, 339, 98],
  headchef: [10, 258, 69], chef: [7, 96, 47], kitchenasst: [7, 96, 47], hksup: [8, 112, 55], housekeeper: [6, 87, 41],
  maintenance: [7, 95, 47],
};

test('Appendix B: every position gets the right documents, reading time and questions', async () => {
  const m = client(env.app); await m.login('PL001');
  for (const [pos, [docs, minutes, qs]] of Object.entries(APPENDIX_B)) {
    const r = await m.get(`/api/admin/preview/${pos}`);
    const pub = r.body.items.filter(i => !i.draft);
    assert.equal(pub.length, docs, `${pos} documents`);
    assert.equal(pub.reduce((n, i) => n + i.estMinutes, 0), minutes, `${pos} minutes`);
    assert.equal(pub.reduce((n, i) => n + i.questionCount, 0), qs, `${pos} questions`);
  }
});

test('A waitron sees only Waitron and all-staff documents, in register order, and never the answers', async () => {
  const c = client(env.app);
  assert.equal((await c.login('pl002')).status, 200);
  const course = (await c.get('/api/my/course')).body;
  assert.equal(course.total, 12);
  assert.deepEqual(course.items.map(i => i.code), ['PEL-SOP-001', 'PEL-SOP-002', 'PEL-SOP-003', 'PEL-SOP-012', 'PEL-MAN-001',
    'PEL-MAN-003', 'PEL-MAN-004', 'PEL-MAN-005', 'PEL-POL-001', 'PEL-POL-002', 'PEL-MEM-009', 'PEL-MEM-015']);
  assert.ok(!course.items.some(i => i.code === 'PEL-MAN-002'), 'held draft is never shown');
  const doc = await c.get('/api/my/documents/PEL-SOP-003');
  assert.equal(doc.status, 200);
  assert.ok(!JSON.stringify(doc.body).includes('"correct"'), 'correct answers never reach the browser');
  assert.equal((await c.get('/api/my/documents/PEL-SOP-008')).status, 404, 'housekeeping SOP is not in a waitron course');
});

test('Video gate: about 85% must actually be played; skipping or faking does not count; a broken video does not trap anyone', async () => {
  const c = client(env.app); await c.login('PL002');
  const d = (await c.get('/api/my/documents/PEL-SOP-001')).body.doc;
  const v = d.videos[0];
  assert.equal(v.duration, 376);
  const url = `/api/my/documents/PEL-SOP-001/videos/${v.fileId}/progress`;
  assert.equal((await c.post('/api/my/documents/PEL-SOP-001/read', { versionId: d.versionId })).status, 400, 'locked before watching');

  // Faking "watched all of it" in one report is clipped to what real time allows.
  let r = await c.post(url, { versionId: d.versionId, segments: [[0, 376]] });
  assert.ok(r.body.watched < 10 && !r.body.completed, 'instant full report is not accepted');

  // Skipping ahead: watching the start and the end only is not enough.
  const pref = env.db.collection('progress').doc(`${env.ids.PL002}__PEL-SOP-001__${d.major}`);
  const age = s => pref.set({ videos: { [v.fileId]: { lastReportAt: new Date(Date.now() - s * 1000).toISOString() } } }, { merge: true });
  await age(60); r = await c.post(url, { versionId: d.versionId, segments: [[0, 60]] });
  await age(60); r = await c.post(url, { versionId: d.versionId, segments: [[300, 376]] });
  assert.ok(!r.body.completed && r.body.watched < 150);
  assert.equal((await c.post('/api/my/documents/PEL-SOP-001/read', { versionId: d.versionId })).status, 400);

  // Real playback in stretches completes it.
  await age(250); r = await c.post(url, { versionId: d.versionId, segments: [[60, 300]] });
  assert.ok(r.body.completed, 'played through');
  assert.equal((await c.post('/api/my/documents/PEL-SOP-001/read', { versionId: d.versionId })).status, 200);

  // Another person's device can't play the video: they may continue, and it's recorded.
  const b = client(env.app); await b.login('PL003');
  const bd = (await b.get('/api/my/documents/PEL-SOP-001')).body.doc;
  await b.post(`/api/my/documents/PEL-SOP-001/videos/${v.fileId}/failed`, { versionId: bd.versionId });
  assert.equal((await b.post('/api/my/documents/PEL-SOP-001/read', { versionId: bd.versionId })).status, 200);
});

test('Quiz below the pass mark cannot be signed; wrong questions are flagged without the answers', async () => {
  const c = client(env.app); await c.login('PL002');
  const d = (await c.get('/api/my/documents/PEL-SOP-003')).body.doc;
  assert.equal((await c.post('/api/my/documents/PEL-SOP-003/attempts', { versionId: d.versionId, answers: d.questions.map(() => 0) })).status, 400, 'must read first');
  await c.post('/api/my/documents/PEL-SOP-003/read', { versionId: d.versionId });
  const correct = await answersOf(env.db, 'PEL-SOP-003');
  const wrong = correct.map((c, i) => (i < 2 ? (c + 1) % 4 : c));
  const r = await c.post('/api/my/documents/PEL-SOP-003/attempts', { versionId: d.versionId, answers: wrong });
  assert.equal(r.body.result.passed, false);
  assert.deepEqual(r.body.result.wrong, [0, 1]);
  assert.ok(!JSON.stringify(r.body).includes('"correct":') || r.body.result.correct === 4, 'only a count, no answer key');
  const s = await c.post('/api/my/documents/PEL-SOP-003/signoff', { versionId: d.versionId, agree: true, typedName: 'Example Waitron' });
  assert.equal(s.status, 400);
  const pass = await c.post('/api/my/documents/PEL-SOP-003/attempts', { versionId: d.versionId, answers: correct });
  assert.equal(pass.body.result.passed, true);
  assert.equal(pass.body.state.attempts, 2);
});

test('The typed name must match; the sign-off records version, time, name, score and attempts', async () => {
  const c = client(env.app); await c.login('PL002');
  const d = (await c.get('/api/my/documents/PEL-SOP-003')).body.doc;
  const bad = await c.post('/api/my/documents/PEL-SOP-003/signoff', { versionId: d.versionId, agree: true, typedName: 'Someone Else' });
  assert.equal(bad.status, 400);
  const ok = await c.post('/api/my/documents/PEL-SOP-003/signoff', { versionId: d.versionId, agree: true, typedName: '  example   WAITRON ' });
  assert.equal(ok.status, 200);
  const row = (await env.db.collection('signoffs').doc(ok.body.signoff.id).get()).data();
  assert.equal(row.label, '2.0'); assert.equal(row.score, 100); assert.equal(row.attempts, 2);
  assert.equal(row.typedName, 'example   WAITRON');
  assert.match(row.statement, /^I, Example Waitron, confirm that I have read and understood PEL-SOP-003 Dineplan Reservations \(version 2\.0\)/);
  assert.match(row.versionHash, /^[0-9a-f]{64}$/);
  assert.equal((await c.post('/api/my/documents/PEL-SOP-003/signoff', { versionId: d.versionId, agree: true, typedName: 'Example Waitron' })).status, 400, 'no second sign-off of the same version');
});

test('Evidence records form a chain: any edit or deletion is detected', async () => {
  const id = env.ids.PL002;
  const ok = await verifyChain(env.db, id);
  assert.equal(ok.ok, true); assert.equal(ok.records, 3, 'two quiz attempts and one sign-off');
  const so = (await env.db.collection('signoffs').where('staffId', '==', id).get()).docs[0];
  const original = so.data();
  await so.ref.set({ ...original, score: 60 });
  const tampered = await verifyChain(env.db, id);
  assert.equal(tampered.ok, false); assert.match(tampered.problem, /changed/);
  await so.ref.set(original);
  assert.equal((await verifyChain(env.db, id)).ok, true);
  const qa = (await env.db.collection('quizAttempts').where('staffId', '==', id).get()).docs.find(d => d.get('seq') === 1);
  const qd = qa.data(); await qa.ref.delete();
  assert.equal((await verifyChain(env.db, id)).ok, false, 'a deleted record is noticed');
  await qa.ref.set(qd);
  assert.equal((await verifyChain(env.db, id)).ok, true);
});

test('The declaration unlocks only when everything is signed and needs a drawn signature', async () => {
  const c = client(env.app); await c.login('PL005');
  const codes = (await c.get('/api/my/course')).body.items.map(i => i.code);
  assert.equal(codes.length, 6);
  for (const code of codes.slice(0, 5)) await completeDoc(env.db, c, code, 'Example Housekeeper', env.ids.PL005);
  const early = await c.post('/api/my/declaration', { agree: true, typedName: 'Example Housekeeper', signature: signaturePng() });
  assert.equal(early.status, 400);
  await completeDoc(env.db, c, codes[5], 'Example Housekeeper', env.ids.PL005);
  assert.equal((await c.post('/api/my/declaration', { agree: true, typedName: 'Example Housekeeper', signature: 'data:image/png;base64,AAAA' })).status, 400);
  const ok = await c.post('/api/my/declaration', { agree: true, typedName: 'Example Housekeeper', signature: signaturePng() });
  assert.equal(ok.status, 200);
  const rec = (await c.get('/api/my/record')).body;
  assert.equal(rec.declaration.items.length, 6);
  assert.match(rec.declaration.text, /^I, Example Housekeeper \(Housekeeper\), confirm/);
  assert.equal((await c.get(rec.declaration.signatureUrl)).status, 200);
  const other = client(env.app); await other.login('PL002');
  assert.equal((await other.get(rec.declaration.signatureUrl)).status, 404, "nobody else's signature");
});

test('Minor change keeps everyone signed; a new version sends them back with history kept; New after a declaration', async () => {
  const m = client(env.app); await m.login('PL001');
  const doc = (await m.get('/api/admin/documents/PEL-SOP-008')).body;
  // Minor change
  let r = await m.put('/api/admin/documents/PEL-SOP-008', { draft: { ...doc.draft, summary: doc.draft.summary + ' (typo fixed)' } });
  assert.equal(r.body.draftDirty, true);
  r = await m.post('/api/admin/documents/PEL-SOP-008/publish', { change: 'minor' });
  assert.equal(r.body.result.label, '2.1');
  const c = client(env.app); await c.login('PL005');
  let item = (await c.get('/api/my/course')).body.items.find(i => i.code === 'PEL-SOP-008');
  assert.equal(item.status, 'done'); assert.equal(item.label, '2.1');
  // New version
  r = await m.put('/api/admin/documents/PEL-SOP-008', { draft: { ...doc.draft, body: doc.draft.body + '\n\n## NEW STEP\n\nCheck the minibar.' } });
  r = await m.post('/api/admin/documents/PEL-SOP-008/publish', { change: 'major' });
  assert.equal(r.body.result.label, '3.0');
  item = (await c.get('/api/my/course')).body.items.find(i => i.code === 'PEL-SOP-008');
  assert.equal(item.status, 'updated'); assert.equal(item.signoff.label, '2.0');
  // Old version is still there, frozen, exactly as signed
  const versions = r.body.document.versions;
  assert.deepEqual(versions.map(v => v.label), ['3.0', '2.1', '2.0']);
  const v20 = (await m.get(`/api/admin/documents/PEL-SOP-008/versions/${versions[2].id}`)).body;
  assert.ok(!v20.body.includes('Check the minibar'));
  assert.equal(v20.signoffs, 1);
  // Sign again; the declaration is no longer current until renewed
  await completeDoc(env.db, c, 'PEL-SOP-008', 'Example Housekeeper', env.ids.PL005);
  const course = (await c.get('/api/my/course')).body;
  assert.equal(course.upToDate, true); assert.equal(course.canDeclare, true);
  const hist = (await m.get(`/api/admin/staff/${env.ids.PL005}`)).body.signoffHistory.filter(h => h.code === 'PEL-SOP-008');
  assert.deepEqual(hist.map(h => h.label), ['3.0', '2.0']);

  // A brand-new all-staff memo published after the declaration shows as New.
  const created = (await m.post('/api/admin/documents', { kind: 'memo' })).body;
  assert.equal(created.code, 'PEL-MEM-016');
  await m.put('/api/admin/documents/PEL-MEM-016', { draft: { ...created.draft, title: 'Year-end function', body: '## Details\n\nFriday 18 December.', audience: { all: true, positions: [] } } });
  await m.post('/api/admin/documents/PEL-MEM-016/publish', {});
  const mem = (await c.get('/api/my/course')).body.items.find(i => i.code === 'PEL-MEM-016');
  assert.equal(mem.isNew, true); assert.equal(mem.status, 'todo'); assert.equal(mem.label, '1.0');
});

test('Changing position changes the course at once and keeps earlier sign-offs', async () => {
  const m = client(env.app); await m.login('PL001');
  const c = client(env.app); await c.login('PL004');
  await completeDoc(env.db, c, 'PEL-SOP-007', 'Example Chef', env.ids.PL004);
  const p = (await m.get(`/api/admin/staff/${env.ids.PL004}`)).body.person;
  assert.equal((await m.patch(`/api/admin/staff/${p.id}`, { name: p.name, staffNo: p.staffNo, positionId: 'headchef', role: 'staff' })).status, 200);
  const course = (await c.get('/api/my/course')).body;
  assert.equal(course.total, 11, 'Head Chef course (10) plus the new all-staff memo');
  assert.equal(course.items.find(i => i.code === 'PEL-SOP-007').status, 'done');
  assert.ok(course.items.some(i => i.code === 'PEL-SOP-004'), 'Duty Manager Procedure now required');
  const det = (await m.get(`/api/admin/staff/${p.id}`)).body;
  assert.equal(det.positionHistory[0].to, 'Head Chef');
});

test('A deactivated person cannot sign in, drops out of figures, and stays in the CSV as Left', async () => {
  const m = client(env.app); await m.login('PL001');
  const before = (await m.get('/api/admin/overview')).body.staffCount;
  const c = client(env.app); await c.login('PL003');
  assert.equal((await m.post(`/api/admin/staff/${env.ids.PL003}/active`, { active: false })).status, 200);
  assert.equal((await c.get('/api/my/course')).status, 401, 'existing session ends');
  assert.equal((await client(env.app).login('PL003')).status, 401);
  assert.equal((await m.get('/api/admin/overview')).body.staffCount, before - 1);
  const csv = (await m.get('/api/admin/reports/register.csv')).raw.body;
  const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
  assert.equal(header, 'Staff number,Name,Position,Department,Employment,Document,Title,Type,Current version,Sign-off status,Version signed,Signed on,Quiz score,Attempts,Declaration signed');
  const rows = csv.split('\r\n').filter(l => l.startsWith('PL003'));
  assert.equal(rows.length, 15, 'Bartender course (14) plus the new all-staff memo');
  assert.ok(rows.every(l => l.includes(',Left,')));
});

test('Five wrong PINs pause sign-in; idle sessions end on the server', async () => {
  const c = client(env.app);
  for (let i = 0; i < 4; i++) assert.equal((await c.login('PL006', '9999')).status, 401);
  assert.equal((await c.login('PL006', '9999')).status, 429);
  const locked = await c.login('PL006', '1234');
  assert.equal(locked.status, 429, 'even the right PIN waits out the minute');
  // Idle: staff 10 minutes
  const s = client(env.app); await s.login('PL002');
  await ageSessions(env.ids.PL002, 11);
  const r = await s.get('/api/my/course');
  assert.equal(r.status, 401); assert.equal(r.body.expired, true);
  // Managers get 30 minutes
  const m = client(env.app); await m.login('PL001');
  await ageSessions(env.ids.PL001, 11);
  assert.equal((await m.get('/api/admin/overview')).status, 200);
});

test('Staff cannot read anyone else’s records, manager pages, or files outside their course', async () => {
  const c = client(env.app); await c.login('PL002');
  for (const url of ['/api/admin/overview', '/api/admin/staff', `/api/admin/staff/${env.ids.PL005}`, '/api/admin/documents/PEL-SOP-003',
    '/api/admin/reports', '/api/admin/reports/register.csv', '/api/admin/audit']) {
    assert.equal((await c.get(url)).status, 403, url);
  }
  const pdf = (await versionOf(env.db, 'PEL-SOP-008')).pdfFileId;
  assert.equal((await c.get(`/api/files/${pdf}`)).status, 404);
  const own = (await c.get('/api/my/documents/PEL-SOP-002')).body.doc.pdf.id;
  const f = await c.call('GET', `/api/files/${own}`, undefined, { range: 'bytes=0-99' });
  assert.equal(f.status, 206); assert.equal(f.raw.rawPayload.length, 100);
  // CSRF: a write without our header is refused.
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { staffNo: 'PL002', pin: '1234' } });
  assert.equal(res.statusCode, 403);
});

test('Head of department sees only their department and cannot edit', async () => {
  const h = client(env.app); await h.login('PL007');
  const staff = (await h.get('/api/admin/staff')).body.staff;
  assert.ok(staff.length > 0 && staff.every(s => s.deptId === 'kitchen'));
  assert.equal((await h.get(`/api/admin/staff/${env.ids.PL002}`)).status, 404);
  assert.equal((await h.post('/api/admin/staff', { name: 'X Y', staffNo: 'PL099', positionId: 'chef', pin: '1234' })).status, 403);
  assert.equal((await h.get('/api/admin/documents')).status, 403);
  const a = client(env.app); await a.login('PL008');
  assert.equal((await a.get('/api/admin/documents')).status, 200, 'auditor can read');
  assert.equal((await a.post('/api/admin/documents/publish-all')).status, 403, 'auditor cannot change anything');
});

test('Held drafts are skipped by Publish all; published documents cannot be deleted', async () => {
  const m = client(env.app); await m.login('PL001');
  const r = await m.post('/api/admin/documents/publish-all');
  assert.deepEqual(r.body.published, []); assert.equal(r.body.held, 1);
  assert.equal((await m.call('DELETE', '/api/admin/documents/PEL-SOP-001')).status, 400);
  const lib = (await m.get('/api/admin/documents')).body.documents;
  assert.equal(lib.find(d => d.code === 'PEL-MAN-002').status, 'draft');
});

test('PIN reset ends sessions and clears the lockout; the last manager cannot be removed', async () => {
  const m = client(env.app); await m.login('PL001');
  assert.equal((await m.post(`/api/admin/staff/${env.ids.PL006}/pin`, { pin: '5678' })).status, 200);
  assert.equal((await client(env.app).login('PL006', '5678')).status, 200);
  assert.equal((await m.post(`/api/admin/staff/${env.ids.PL001}/active`, { active: false })).status, 400);
  const me = (await m.get(`/api/admin/staff/${env.ids.PL001}`)).body.person;
  assert.equal((await m.patch(`/api/admin/staff/${me.id}`, { name: me.name, staffNo: me.staffNo, positionId: 'gm', role: 'staff' })).status, 400);
});
