// The richer lesson types (from the course builder brief): checklists, enforced videos with chapters and a
// check question, policy sign-offs, and field evidence approved by a manager.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupTwoClients, client, uploadAs, signaturePng, CONTENT } from './helpers.js';
import { verifyChain } from '../src/evidence.js';

let env, m, s, courseId, videoId, base;
const vid = () => `${courseId}@1.0`;
const draft = () => ({ title: 'Site Safety Induction', description: 'Before your first shift', audience: { all: false, positions: ['staff'] }, modules: [
  { id: 'm-1', title: 'Before you start', lessons: [
    { id: 'l-check', type: 'checklist', title: 'Daily start-up', summary: 'Do these every morning.', steps: ['Sign the register', 'Put on your safety boots', 'Check the first aid box'] },
    { id: 'l-vid', type: 'video', title: 'Fire exits', fileId: videoId, minWatchPct: 90, noSkipAhead: true, pauseWhenHidden: true,
      chapters: [{ at: 0, label: 'Introduction' }, { at: 60, label: 'Where the exits are' }],
      checkpoint: { q: 'How many ways out should you know?', options: ['One', 'Two', 'None'], correct: 1 } }] },
  { id: 'm-2', title: 'Commitments', lessons: [
    { id: 'l-sign', type: 'signoff', title: 'Safety policy', code: 'HBR-POL-009', statement: 'I will follow the site safety policy at all times.' },
    { id: 'l-ev', type: 'evidence', title: 'Show your workstation', prompt: 'Describe your workstation set-up and add a photo.', placeholder: 'e.g. Boots on, area clear', photo: 'required' },
    { id: 'l-last', type: 'text', title: 'Thank you', body: 'Welcome aboard.' }] }] });

before(async () => {
  env = await setupTwoClients();
  m = env.harbour.manager; s = env.harbour.staff;
  videoId = (await uploadAs(m, '/api/admin/files', fs.readFileSync(`${CONTENT}files/PEL-SOP-001-video.mp4`), 'exits.mp4', 'video/mp4')).body.id;
  courseId = (await m.post('/api/admin/courses', { draft: draft() })).body.id;
  base = `/api/my/courses/${courseId}/lessons`;
});
after(async () => { await env.close(); });

test('Each new lesson type is checked before publishing', async () => {
  const bad = draft();
  bad.modules[0].lessons[0].steps = ['Sign the register', ''];
  bad.modules[0].lessons[1].checkpoint = { q: 'Unfinished', options: ['A', ''], correct: -1 };
  bad.modules[1].lessons[0].statement = '';
  bad.modules[1].lessons[1].prompt = '';
  const r = await m.put(`/api/admin/courses/${courseId}`, { draft: bad });
  const p = r.body.problems.join(' | ');
  for (const x of [/empty step/, /check question/, /statement people agree to/, /what must people submit/]) assert.match(p, x);
  assert.equal((await m.post(`/api/admin/courses/${courseId}/publish`, {})).status, 400);
  assert.deepEqual((await m.put(`/api/admin/courses/${courseId}`, { draft: draft() })).body.problems, []);
  assert.equal((await m.post(`/api/admin/courses/${courseId}/publish`, {})).status, 200);
  const d = (await m.get(`/api/admin/courses/${courseId}`)).body.draft;
  assert.deepEqual(d.modules[0].lessons[1].chapters.map(c => c.at), [0, 60]);
});

test('A checklist is done only when every step is ticked', async () => {
  assert.equal((await s.post(`${base}/l-check/done`, { versionId: vid(), checked: [0, 1] })).status, 400);
  assert.equal((await s.post(`${base}/l-check/done`, { versionId: vid(), checked: [0, 1, 2] })).status, 200);
});

test('An enforced video: really watched, then the check question; answers never sent; a broken video never traps anyone', async () => {
  const v = (await s.get(`/api/my/courses/${courseId}`)).body.course.modules[0].lessons[1];
  assert.equal(v.checkpoint.correct, undefined, 'the right answer stays on the server');
  assert.deepEqual(v.chapters.map(c => c.label), ['Introduction', 'Where the exits are']);
  assert.match((await s.post(`${base}/l-vid/done`, { versionId: vid(), checkpoint: 1 })).body.error, /Watch at least 90%/);
  await env.db.collection('courseProgress').doc(`${env.harbour.staffId}__${courseId}__1`).set({ video: { 'l-vid': { watched: 99999 } } }, { merge: true });
  const wrong = await s.post(`${base}/l-vid/done`, { versionId: vid(), checkpoint: 0 });
  assert.equal(wrong.status, 400); assert.match(wrong.body.error, /not the right answer/);
  const st = (await s.get(`/api/my/courses/${courseId}`)).body.course.modules[0].lessons[1].state;
  assert.equal(st.checkpointTries, 1, 'wrong tries are counted');
  assert.equal((await s.post(`${base}/l-vid/done`, { versionId: vid(), checkpoint: 1 })).status, 200);
  // Someone whose device can't play the video can say so and continue; it's recorded.
  const other = client(env.app, { clientCode: 'HARBOUR' });
  await m.post('/api/admin/staff', { name: 'Harbour Porter', staffNo: 'HB777', positionId: 'staff', pin: '7777' });
  await other.login('HB777', '7777');
  await other.post(`${base}/l-check/done`, { versionId: vid(), checked: [0, 1, 2] });
  const f = await other.post(`${base}/l-vid/video`, { versionId: vid(), failed: true });
  assert.equal(f.body.failed, true);
  assert.equal((await other.post(`${base}/l-vid/done`, { versionId: vid(), checkpoint: 1 })).status, 200);
});

test('A policy sign-off needs agreement and the person’s own name', async () => {
  assert.equal((await s.post(`${base}/l-sign/done`, { versionId: vid(), agree: false, typedName: 'Harbour Waitron' })).status, 400);
  const r = await s.post(`${base}/l-sign/done`, { versionId: vid(), agree: true, typedName: 'Someone Else' });
  assert.equal(r.status, 400); assert.match(r.body.error, /exactly as it appears/);
  assert.equal((await s.post(`${base}/l-sign/done`, { versionId: vid(), agree: true, typedName: '  harbour   WAITRON ' })).status, 200);
});

test('Field evidence: submitted with a photo, reviewed by a manager; the certificate waits for approval', async () => {
  assert.match((await s.post(`${base}/l-ev/evidence`, { versionId: vid(), text: 'Boots on, area clear.' })).body.error, /Add a photo/);
  const sub = await s.post(`${base}/l-ev/evidence`, { versionId: vid(), text: 'Boots on, area clear.', photo: signaturePng() });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const ev = sub.body.course.modules[1].lessons[1].state.evidence;
  assert.equal(ev.status, 'pending');
  assert.equal(sub.body.course.modules[1].lessons[2].state.status, 'open', 'waiting for review doesn’t hold up the next lesson');
  assert.equal((await s.post(`${base}/l-ev/evidence`, { versionId: vid(), text: 'Again', photo: signaturePng() })).status, 400, 'one submission waits at a time');
  const fin = await s.post(`${base}/l-last/done`, { versionId: vid() });
  assert.equal(fin.body.progress.completion, null, 'no certificate while evidence is waiting');
  // The photo: the person and their managers, nobody else.
  assert.equal((await s.get(`/api/files/${ev.fileId}`)).status, 200);
  assert.equal((await m.get(`/api/files/${ev.fileId}`)).status, 200);
  const peer = client(env.app, { clientCode: 'HARBOUR' }); await peer.login('HB777', '7777');
  assert.equal((await peer.get(`/api/files/${ev.fileId}`)).status, 404);
  // Review: another client's manager can't; a rejection needs a note; the person can submit again.
  const q = (await m.get('/api/admin/evidence')).body;
  assert.equal(q.pending, 1); assert.equal(q.items[0].staffName, 'Harbour Waitron');
  const pel = client(env.app); await pel.login('PL001');
  assert.equal((await pel.post(`/api/admin/evidence/${ev.id}/review`, { decision: 'approve' })).status, 404);
  assert.equal((await pel.get('/api/admin/evidence')).body.items.some(i => i.id === ev.id), false);
  assert.equal((await m.post(`/api/admin/evidence/${ev.id}/review`, { decision: 'reject' })).status, 400);
  assert.equal((await m.post(`/api/admin/evidence/${ev.id}/review`, { decision: 'reject', note: 'The photo is blurred' })).status, 200);
  let st = (await s.get(`/api/my/courses/${courseId}`)).body.course.modules[1].lessons[1].state;
  assert.equal(st.evidence.status, 'rejected'); assert.equal(st.evidence.note, 'The photo is blurred');
  const again = await s.post(`${base}/l-ev/evidence`, { versionId: vid(), text: 'Clearer photo attached.', photo: signaturePng() });
  const ev2 = again.body.course.modules[1].lessons[1].state.evidence;
  assert.equal((await m.post(`/api/admin/evidence/${ev2.id}/review`, { decision: 'approve' })).status, 200);
  assert.equal((await m.post(`/api/admin/evidence/${ev2.id}/review`, { decision: 'approve' })).status, 400, 'reviewed once');
  // Approval completed the course: the certificate is issued and records the policy sign-off.
  const view = (await s.get(`/api/my/courses/${courseId}`)).body;
  assert.ok(view.progress.completion, 'certificate issued on approval');
  const rec = (await env.db.collection('courseCompletions').where('staffId', '==', env.harbour.staffId).where('courseId', '==', courseId).get()).docs[0].data();
  assert.equal(rec.acknowledgements.length, 1); assert.equal(rec.acknowledgements[0].code, 'HBR-POL-009'); assert.match(rec.acknowledgements[0].typedName, /harbour/i);
  assert.equal((await verifyChain(env.db, env.harbour.staffId)).ok, true);
  const audit = (await m.get('/api/admin/audit')).body.entries.map(e => e.action);
  assert.ok(audit.includes('evidence.reject') && audit.includes('evidence.approve'));
});

test('YouTube videos: any usual link works, others are refused; watching is checked against the video’s length', async () => {
  const yt = (url, extra = {}) => ({ title: 'YouTube course', audience: { all: true, positions: [] }, modules: [{ id: 'm', title: 'Watch', lessons: [
    { id: 'l-yt', type: 'video', title: 'Service basics', source: 'youtube', youtubeUrl: url, durationSec: 300, minWatchPct: 90, ...extra }] }] });
  const c = (await m.post('/api/admin/courses', { draft: yt('https://evil.example.com/watch?v=dQw4w9WgXcQ') })).body.id;
  let d = (await m.get(`/api/admin/courses/${c}`)).body;
  assert.equal(d.draft.modules[0].lessons[0].youtubeId, null);
  assert.match(d.problems.join(' '), /paste a YouTube link/);
  for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ']) {
    await m.put(`/api/admin/courses/${c}`, { draft: yt(url) });
    assert.equal((await m.get(`/api/admin/courses/${c}`)).body.draft.modules[0].lessons[0].youtubeId, 'dQw4w9WgXcQ', url);
  }
  await m.put(`/api/admin/courses/${c}`, { draft: yt('https://youtu.be/dQw4w9WgXcQ', { durationSec: 0 }) });
  assert.match((await m.get(`/api/admin/courses/${c}`)).body.problems.join(' '), /enter the video's length/);
  await m.put(`/api/admin/courses/${c}`, { draft: yt('https://youtu.be/dQw4w9WgXcQ') });
  assert.equal((await m.post(`/api/admin/courses/${c}/publish`, {})).status, 200);
  const url = `/api/my/courses/${c}/lessons/l-yt`, v = `${c}@1.0`;
  const lesson = (await s.get(`/api/my/courses/${c}`)).body.course.modules[0].lessons[0];
  assert.equal(lesson.youtubeId, 'dQw4w9WgXcQ'); assert.equal(lesson.fileId, null);
  assert.match((await s.post(`${url}/done`, { versionId: v })).body.error, /Watch at least 90%/);
  const r = await s.post(`${url}/video`, { versionId: v, segments: [[0, 300]] });
  assert.equal(r.body.duration, 300, 'the length the author set is what counts');
  assert.ok(r.body.watched < 30, 'reporting the whole video at once is capped by the time that has passed');
  await env.db.collection('courseProgress').doc(`${env.harbour.staffId}__${c}__1`).set({ video: { 'l-yt': { watched: 280 } } }, { merge: true });
  assert.equal((await s.post(`${url}/done`, { versionId: v })).status, 200, '280 of 300 seconds is over 90%');
});

test('The pages allow YouTube’s player and nothing else from outside', async () => {
  const res = await env.app.inject({ method: 'GET', url: '/' });
  const csp = res.headers['content-security-policy'];
  assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com/);
  assert.match(csp, /script-src 'self' https:\/\/www\.youtube\.com https:\/\/s\.ytimg\.com/);
  assert.match(csp, /connect-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
  const hosting = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).hosting.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.match(hosting, /frame-src https:\/\/www\.youtube-nocookie\.com/, 'the live site has the same rule');
});
