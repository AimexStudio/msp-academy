// The course builder: modules and lessons, publishing, taking a course in order, certificates,
// versions, the MSP Academy library, and sharing a built course with a client.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupTwoClients, client, makePlatformAdmin, uploadAs, HARBOUR, CONTENT } from './helpers.js';
import { verifyChain } from '../src/evidence.js';
import { LIBRARY_ORG_ID } from '../src/tenancy.js';

let env, m, s, courseId, videoId, pdfId;
const quiz = () => ({ id: 'l-quiz', type: 'quiz', title: 'Check your knowledge', passMark: 100,
  questions: [{ q: 'Greet within?', options: ['30 seconds', '5 minutes'], correct: 0 }, { q: 'Offer help with luggage?', options: ['Before the room', 'Never'], correct: 0 }] });
const draft = extra => ({ title: 'Guest Service Basics', description: 'For every new starter', audience: { all: false, positions: ['staff'] }, modules: [
  { id: 'm-1', title: 'Welcome', lessons: [{ id: 'l-intro', type: 'text', title: 'Why service matters', body: '## Welcome\n\nEvery guest, every time.' },
    { id: 'l-video', type: 'video', title: 'Watch: a great arrival', fileId: videoId }] },
  { id: 'm-2', title: 'Standards', lessons: [{ id: 'l-pdf', type: 'pdf', title: 'The service checklist', fileId: pdfId }, quiz(),
    { id: 'l-sop', type: 'document', code: env.harbour.docCode }] }], ...extra });
const vid = () => `${courseId}@1.0`;

before(async () => {
  env = await setupTwoClients();
  m = env.harbour.manager; s = env.harbour.staff;
  videoId = (await uploadAs(m, '/api/admin/files', fs.readFileSync(`${CONTENT}files/PEL-SOP-001-video.mp4`), 'arrival.mp4', 'video/mp4')).body.id;
  pdfId = (await uploadAs(m, '/api/admin/files', fs.readFileSync(`${CONTENT}files/PEL-SOP-004.pdf`), 'checklist.pdf', 'application/pdf')).body.id;
  assert.ok(videoId && pdfId);
});
after(async () => { await env.close(); });

test('A manager builds a course from modules and lessons; problems are listed until it can be published', async () => {
  const r = await m.post('/api/admin/courses', { draft: { title: 'Guest Service Basics', modules: [{ title: '', lessons: [{ type: 'text', title: '' }, { type: 'nonsense' }] }] } });
  assert.equal(r.status, 200); courseId = r.body.id;
  let d = (await m.get(`/api/admin/courses/${courseId}`)).body;
  assert.equal(d.draft.modules[0].lessons.length, 1, 'unknown lesson types are dropped');
  assert.ok(d.draft.modules[0].id && d.draft.modules[0].lessons[0].id);
  assert.ok(d.problems.length >= 3);
  assert.equal((await m.post(`/api/admin/courses/${courseId}/publish`, {})).status, 400);
  assert.equal((await m.put(`/api/admin/courses/${courseId}`, { draft: draft({ modules: [{ id: 'm-x', title: 'X', lessons: [{ id: 'l-x', type: 'pdf', title: 'X', fileId: env.pelagos.pdfFileId }] }] }) })).status, 400);
  const ok = await m.put(`/api/admin/courses/${courseId}`, { draft: draft() });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.deepEqual(ok.body.problems, []);
  assert.equal((await m.post(`/api/admin/courses/${courseId}/publish`, {})).body.result.label, '1.0');
  d = (await m.get(`/api/admin/courses/${courseId}`)).body;
  assert.equal(d.status, 'published'); assert.equal(d.lessonCount, 5); assert.deepEqual(d.stats, { total: 1, completed: 0 });
});

test('Only people it is for see the course, and never the quiz answers', async () => {
  assert.deepEqual((await s.get('/api/my/courses')).body.courses.map(c => [c.title, c.done, c.total]), [['Guest Service Basics', 1, 5]], 'the SOP they already signed counts');
  const v = (await s.get(`/api/my/courses/${courseId}`)).body;
  assert.ok(v.course.modules[1].lessons.find(l => l.type === 'quiz').questions.every(x => x.correct === undefined));
  assert.deepEqual(v.course.modules.flatMap(x => x.lessons).map(l => l.state.status), ['open', 'locked', 'locked', 'locked', 'done']);
  assert.equal((await m.get(`/api/my/courses/${courseId}`)).status, 404, 'the manager position is not in this course');
  assert.equal((await s.get(`/api/files/${videoId}`)).status, 200);
  const pel = client(env.app); await pel.login('PL002');
  assert.equal((await pel.get(`/api/files/${videoId}`)).status, 404);
});

test('Lessons go in order; a failed quiz doesn’t count; finishing issues the certificate', async () => {
  const base = `/api/my/courses/${courseId}/lessons`;
  assert.equal((await s.post(`${base}/l-video/done`, { versionId: vid() })).status, 400);
  assert.equal((await s.post(`${base}/l-intro/done`, { versionId: 'old@1.0' })).status, 409);
  assert.equal((await s.post(`${base}/l-intro/done`, { versionId: vid() })).status, 200);
  // The video must really be watched (90% by default); reporting progress is capped by real time.
  const r0 = await s.post(`${base}/l-video/done`, { versionId: vid() });
  assert.equal(r0.status, 400); assert.match(r0.body.error, /Watch at least 90%/);
  const rep = await s.post(`${base}/l-video/video`, { versionId: vid(), segments: [[0, 300]] });
  assert.ok(rep.body.watched < 30, 'a whole video reported at once is not believed: it is capped by the time that has passed');
  await env.db.collection('courseProgress').doc(`${env.harbour.staffId}__${courseId}__1`).set({ video: { 'l-video': { watched: 99999 } } }, { merge: true }); // as if watched in full
  for (const l of ['l-video', 'l-pdf']) assert.equal((await s.post(`${base}/${l}/done`, { versionId: vid() })).status, 200, l);
  assert.equal((await s.post(`${base}/l-quiz/done`, { versionId: vid() })).status, 400);
  const fail = await s.post(`${base}/l-quiz/quiz`, { versionId: vid(), answers: [1, 0] });
  assert.equal(fail.body.result.passed, false); assert.deepEqual(fail.body.result.wrong, [0]);
  const pass = await s.post(`${base}/l-quiz/quiz`, { versionId: vid(), answers: [0, 0] });
  assert.equal(pass.body.result.passed, true); assert.ok(pass.body.progress.completion);
});

test('The certificate is evidence in the person’s chain, and printable', async () => {
  const c = (await s.get(`/api/my/courses/${courseId}/certificate`)).body.certificate;
  assert.equal(c.title, 'Guest Service Basics'); assert.equal(c.name, 'Harbour Waitron'); assert.match(c.reference, /^[0-9A-F]{12}$/);
  assert.equal((await verifyChain(env.db, env.harbour.staffId)).ok, true);
  const snap = (await env.db.collection('courseCompletions').where('staffId', '==', env.harbour.staffId).get()).docs[0];
  const rec = snap.data();
  await snap.ref.set({ ...rec, title: 'Something else' });
  assert.equal((await verifyChain(env.db, env.harbour.staffId)).ok, false, 'a changed certificate is detected');
  await snap.ref.set(rec);
  assert.deepEqual((await m.get(`/api/admin/courses/${courseId}`)).body.stats, { total: 1, completed: 1 });
});

test('A minor change keeps progress; a new version asks people to take it again, keeping the old certificate', async () => {
  const d = (await m.get(`/api/admin/courses/${courseId}`)).body.draft;
  d.modules[0].lessons[0].body += '\n\nA small wording fix.';
  await m.put(`/api/admin/courses/${courseId}`, { draft: d });
  assert.equal((await m.post(`/api/admin/courses/${courseId}/publish`, { change: 'minor' })).body.result.label, '1.1');
  assert.ok((await s.get(`/api/my/courses/${courseId}`)).body.progress.completion);
  d.modules[1].lessons.push({ id: 'l-new', type: 'text', title: 'New rule', body: 'Name badges on.' });
  await m.put(`/api/admin/courses/${courseId}`, { draft: d });
  assert.equal((await m.post(`/api/admin/courses/${courseId}/publish`, { change: 'major' })).body.result.label, '2.0');
  const v = (await s.get(`/api/my/courses/${courseId}`)).body;
  assert.equal(v.progress.completion, null); assert.equal(v.progress.retake, true); assert.equal(v.progress.done, 1);
  assert.equal((await env.db.collection('courseCompletions').where('staffId', '==', env.harbour.staffId).get()).size, 1);
});

test('A course that was published is archived, not deleted; staff no longer see it', async () => {
  assert.equal((await m.call('DELETE', `/api/admin/courses/${courseId}`)).body.archived, true);
  assert.equal((await s.get('/api/my/courses')).body.courses.length, 0);
  assert.equal((await s.get(`/api/my/courses/${courseId}/certificate`)).status, 200, 'the certificate stays');
});

test('The MSP Academy library: build there, share a finished course with a client', async () => {
  const a = await makePlatformAdmin(env.db, { email: 'author@example.com' });
  const p = client(env.app); await p.platformLogin(a.email, a.password);
  assert.deepEqual((await p.get('/api/platform/library')).body.courses, []);
  assert.ok(!(await p.get('/api/platform/clients')).body.clients.some(c => c.orgId === LIBRARY_ORG_ID));
  assert.equal((await p.post('/api/platform/library/open')).status, 200);
  const me = (await p.get('/api/me')).body;
  assert.equal(me.support.author, true); assert.equal(me.staff.role, 'manager');
  assert.equal((await p.get('/api/my/courses')).status, 403);
  const pdf = (await uploadAs(p, '/api/admin/files', fs.readFileSync(`${CONTENT}files/PEL-POL-002.pdf`), 'popia.pdf', 'application/pdf')).body.id;
  const c = (await p.post('/api/admin/courses', { draft: { title: 'POPIA for Everyone', description: 'Personal information at work', audience: { all: true, positions: [] }, modules: [
    { id: 'm-a', title: 'The basics', lessons: [{ id: 'l-a', type: 'text', title: 'What POPIA is', body: 'It protects personal information.' }, { id: 'l-b', type: 'pdf', title: 'Read the summary', fileId: pdf }] },
    { id: 'm-b', title: 'Check', lessons: [{ id: 'l-c', type: 'quiz', title: 'Quick check', passMark: 100, questions: [{ q: 'Does POPIA protect personal information?', options: ['Yes', 'No'], correct: 0 }] }] }] } })).body.id;
  assert.equal((await p.post('/api/platform/share', { sourceOrgId: LIBRARY_ORG_ID, courseId: c, targetOrgIds: [HARBOUR] })).status, 400, 'only published courses');
  assert.equal((await p.post(`/api/admin/courses/${c}/publish`, {})).status, 200);
  assert.equal((await p.post('/api/platform/support/end')).status, 200);
  assert.equal((await p.get('/api/admin/courses')).status, 401);
  const r = await p.post('/api/platform/share', { sourceOrgId: LIBRARY_ORG_ID, courseId: c, targetOrgIds: [HARBOUR, LIBRARY_ORG_ID], publish: true });
  assert.deepEqual(r.body.results.map(x => [x.targetOrgId, x.course, x.coursePublished]), [[HARBOUR, 'new', '1.0']]);
  const got = (await s.get('/api/my/courses')).body.courses.find(x => x.title === 'POPIA for Everyone');
  assert.ok(got && got.shared);
  const lesson = (await s.get(`/api/my/courses/${got.id}`)).body.course.modules[0].lessons[1];
  const f = (await env.db.collection('files').doc(lesson.fileId).get()).data();
  assert.equal(f.orgId, HARBOUR); assert.ok(f.storageKey.startsWith(`orgs/${HARBOUR}/`));
  const hd = (await m.get(`/api/admin/courses/${got.id}`)).body;
  assert.equal(hd.shared.provider, 'MSP Academy');
  assert.equal((await m.put(`/api/admin/courses/${got.id}`, { draft: { ...hd.draft, title: 'Our POPIA' } })).status, 400);
  assert.equal((await m.put(`/api/admin/courses/${got.id}`, { draft: { ...hd.draft, audience: { all: false, positions: ['staff'] } } })).status, 200);
  assert.ok(!JSON.stringify(hd).includes('library'));
  assert.deepEqual((await p.get('/api/platform/library')).body.courses[0].sharedTo.map(t => [t.targetName, t.behind]), [['Harbour Hotel', false]]);
});
