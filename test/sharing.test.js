// Groups of clients, and sharing a course from one client to clients in other groups.
// An HR client in an HR group builds "HR Essentials"; the platform shares it with Harbour and Pelagos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupTwoClients, client, makePlatformAdmin, uploadAs, completeDoc, ORG, HARBOUR, CONTENT } from './helpers.js';
import { createClient } from '../src/platform.js';
import { verifyChain } from '../src/evidence.js';

const HR = 'hr-partners';
let env, p, hr, harbourMgr, courseId;
const q = (t, c) => ({ q: t, options: ['Yes', 'No', 'Not sure'], correct: c });
async function makeDoc(c, kind, title, body, extra = {}) {
  const created = (await c.post('/api/admin/documents', { kind })).body;
  const r = await c.put(`/api/admin/documents/${created.code}`, { draft: { ...created.draft, title, body, audience: { all: true, positions: [] }, questions: [q(`${title}: understood?`, 0)], ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await c.post(`/api/admin/documents/${created.code}/publish`, {})).status, 200);
  return created.code;
}
async function everythingVisible(c) {
  const parts = [await c.get('/api/admin/documents'), await c.get('/api/admin/courses'), await c.get('/api/admin/audit'), await c.get('/api/admin/overview')];
  for (const d of parts[0].body.documents) parts.push(await c.get(`/api/admin/documents/${d.code}`));
  return parts.map(r => r.raw.body).join('\n');
}

before(async () => {
  env = await setupTwoClients();
  await createClient(env.db, null, { name: 'HR Partners', loginCode: 'HRP', docPrefix: 'HRP', manager: { name: 'Hannah Resource', staffNo: 'H1', pin: '111222' } });
  hr = client(env.app, { clientCode: 'HRP' }); await hr.login('H1', '111222');
  const pdf = await uploadAs(hr, '/api/admin/files', fs.readFileSync(`${CONTENT}files/PEL-POL-002.pdf`), 'leave-policy.pdf', 'application/pdf');
  const leave = await makeDoc(hr, 'policy', 'Leave Policy', '## Annual leave\n\nApply two weeks ahead.', { pdfFileId: pdf.body.id });
  const conduct = await makeDoc(hr, 'policy', 'Code of Conduct', '## Respect\n\nTreat colleagues with respect.');
  courseId = (await hr.post('/api/admin/courses', { title: 'HR Essentials', description: 'Every employee, every client', codes: [leave, conduct] })).body.id;
  const a = await makePlatformAdmin(env.db, { email: 'share@example.com' });
  p = client(env.app); await p.platformLogin(a.email, a.password);
  harbourMgr = env.harbour.manager;
});
after(async () => { await env.close(); });

test('Groups: create, rename, put clients in them; a group with clients can’t be deleted', async () => {
  const hrg = (await p.post('/api/platform/groups', { name: 'HR' })).body;
  const hosp = (await p.post('/api/platform/groups', { name: 'Hospitality' })).body;
  assert.equal((await p.post('/api/platform/groups', { name: 'hr' })).status, 400, 'names are unique');
  assert.equal((await p.put(`/api/platform/clients/${HR}`, { groupId: hrg.id })).status, 200);
  for (const o of [ORG, HARBOUR]) assert.equal((await p.put(`/api/platform/clients/${o}`, { groupId: hosp.id })).status, 200);
  assert.equal((await p.put(`/api/platform/clients/${ORG}`, { groupId: 'no-such-group' })).status, 400);
  const groups = (await p.get('/api/platform/groups')).body.groups;
  assert.deepEqual(groups.map(g => [g.name, g.clients.length]), [['Hospitality', 2], ['HR', 1]]);
  assert.equal((await p.get('/api/platform/clients')).body.clients.find(c => c.orgId === HR).groupName, 'HR');
  assert.equal((await p.call('DELETE', `/api/platform/groups/${hosp.id}`)).status, 400);
  assert.equal((await p.put(`/api/platform/groups/${hosp.id}`, { name: 'Hospitality & Leisure' })).status, 200);
  const empty = (await p.post('/api/platform/groups', { name: 'Construction' })).body;
  assert.equal((await p.call('DELETE', `/api/platform/groups/${empty.id}`)).status, 200);
  const log = (await p.get('/api/platform/audit')).body.entries.map(e => e.action);
  for (const x of ['group.create', 'group.rename', 'group.delete']) assert.ok(log.includes(x), x);
});

test('A client’s manager builds courses from their own documents only', async () => {
  const courses = (await hr.get('/api/admin/courses')).body.courses;
  assert.equal(courses[0].title, 'HR Essentials'); assert.equal(courses[0].documents.length, 2);
  assert.equal((await hr.post('/api/admin/courses', { title: 'Sneaky', codes: ['PEL-SOP-001'] })).status, 400);
  const s = (await p.get(`/api/platform/clients/${HR}`)).body.courses[0];
  assert.equal(s.shareable, true); assert.deepEqual(s.sharedTo, []);
});

test('Sharing as drafts: each receiving client gets its own copies, files and course, and never sees where it came from', async () => {
  const r = await p.post('/api/platform/share', { sourceOrgId: HR, courseId, targetOrgIds: [HARBOUR, ORG, HR], publish: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.results.map(x => x.targetOrgId), [HARBOUR, ORG], 'never to itself');
  assert.deepEqual(r.body.results[0].documents.map(d => [d.targetCode, d.result, d.published]), [['HBR-POL-001', 'new', null], ['HBR-POL-002', 'new', null]]);
  assert.ok(r.body.results[1].documents.every(d => d.targetCode.startsWith('PEL-POL-')));
  const det = (await harbourMgr.get('/api/admin/documents/HBR-POL-001')).body;
  assert.equal(det.status, 'draft'); assert.equal(det.draft.audience.all, true); assert.equal(det.shared.provider, 'MSP Academy');
  const f = (await env.db.collection('files').doc(det.draft.pdfFileId).get()).data();
  assert.equal(f.orgId, HARBOUR); assert.ok(f.storageKey.startsWith(`orgs/${HARBOUR}/files/`));
  const src = (await env.db.collection('files').where('orgId', '==', HR).get()).docs[0].data();
  assert.equal(f.sha256, src.sha256); assert.notEqual(f.storageKey, src.storageKey);
  assert.equal((await harbourMgr.get(`/api/files/${det.draft.pdfFileId}`)).status, 200);
  const shared = (await harbourMgr.get('/api/admin/courses')).body.courses.find(c => c.title === 'HR Essentials');
  assert.deepEqual(shared.documents.map(d => d.code), ['HBR-POL-001', 'HBR-POL-002']); assert.ok(shared.shared);
  const seen = await everythingVisible(harbourMgr);
  assert.ok(!/HR Partners|Hannah Resource|HRP-/.test(seen), 'Harbour never sees which client the course came from');
  assert.ok(/course\.shared_in/.test(seen) && /MSP Academy/.test(seen));
  const s = (await p.get(`/api/platform/clients/${HR}`)).body.courses[0];
  assert.deepEqual(s.sharedTo.map(t => [t.targetName, t.behind]), [['Harbour Hotel', false], ['Pelagos Langebaan', false]]);
  assert.equal((await p.get(`/api/platform/clients/${HARBOUR}`)).body.received[0].fromName, 'HR Partners');
});

test('The receiving manager chooses who completes it, but can’t change the content', async () => {
  const det = (await harbourMgr.get('/api/admin/documents/HBR-POL-001')).body;
  const r = await harbourMgr.put('/api/admin/documents/HBR-POL-001', { draft: { ...det.draft, title: 'Our own leave policy' } });
  assert.equal(r.status, 400); assert.match(r.body.error, /provided by MSP Academy/);
  assert.equal((await harbourMgr.put('/api/admin/documents/HBR-POL-001', { draft: det.draft, code: 'HBR-POL-099' })).status, 400);
  assert.equal((await harbourMgr.put('/api/admin/documents/HBR-POL-001', { draft: { ...det.draft, audience: { all: false, positions: ['staff'] }, order: 5 } })).status, 200);
  const course = (await harbourMgr.get('/api/admin/courses')).body.courses.find(c => c.title === 'HR Essentials');
  assert.equal((await harbourMgr.put(`/api/admin/courses/${course.id}`, { title: 'Renamed', codes: [] })).status, 400);
});

test('Harbour publishes, its staff complete it, and the evidence is Harbour’s own', async () => {
  for (const code of ['HBR-POL-001', 'HBR-POL-002']) assert.equal((await harbourMgr.post(`/api/admin/documents/${code}/publish`, {})).status, 200);
  const s = env.harbour.staff;
  for (const code of ['HBR-POL-001', 'HBR-POL-002']) await completeDoc(env.db, s, code, 'Harbour Waitron', env.harbour.staffId, HARBOUR);
  const so = (await env.db.collection('signoffs').where('staffId', '==', env.harbour.staffId).get()).docs.map(d => d.data()).filter(x => x.code.startsWith('HBR-POL'));
  assert.equal(so.length, 2); assert.ok(so.every(x => x.orgId === HARBOUR));
  assert.equal((await verifyChain(env.db, env.harbour.staffId)).ok, true);
  const mc = (await harbourMgr.get('/api/my/course')).body.items.map(i => i.code);
  assert.ok(!mc.includes('HBR-POL-001') && mc.includes('HBR-POL-002'), 'the staff-only choice held');
});

test('A new version at the source reaches others only when shared again; their choices are kept', async () => {
  const d = (await hr.get('/api/admin/documents/HRP-POL-001')).body;
  await hr.put('/api/admin/documents/HRP-POL-001', { draft: { ...d.draft, body: '## Annual leave\n\nApply THREE weeks ahead.' } });
  assert.equal((await hr.post('/api/admin/documents/HRP-POL-001/publish', { change: 'major' })).status, 200);
  assert.match((await harbourMgr.get('/api/admin/documents/HBR-POL-001')).body.draft.body, /two weeks/);
  assert.ok((await p.get(`/api/platform/clients/${HR}`)).body.courses[0].sharedTo.every(t => t.behind));
  const r = await p.post('/api/platform/share', { sourceOrgId: HR, courseId, targetOrgIds: [HARBOUR], publish: true, change: 'major' });
  assert.deepEqual(r.body.results[0].documents.map(x => [x.targetCode, x.result, x.published]), [['HBR-POL-001', 'updated', '2.0'], ['HBR-POL-002', 'unchanged', null]]);
  const det = (await harbourMgr.get('/api/admin/documents/HBR-POL-001')).body;
  assert.match(det.draft.body, /THREE weeks/); assert.deepEqual(det.draft.audience, { all: false, positions: ['staff'] }); assert.equal(det.draft.order, 5);
  assert.equal((await env.harbour.staff.get('/api/my/course')).body.items.find(i => i.code === 'HBR-POL-001').status, 'updated');
  assert.deepEqual((await p.get(`/api/platform/clients/${HR}`)).body.courses[0].sharedTo.map(t => [t.targetName, t.behind]), [['Harbour Hotel', false], ['Pelagos Langebaan', true]]);
});

test('Sharing and publishing straight away: staff see it at once', async () => {
  const r = await p.post('/api/platform/share', { sourceOrgId: HR, courseId, targetOrgIds: [ORG], publish: true });
  assert.ok(r.body.results[0].documents.every(d => d.published), JSON.stringify(r.body));
  const pc = client(env.app); await pc.login('PL002');
  const items = (await pc.get('/api/my/course')).body.items.map(i => i.code);
  for (const c of r.body.results[0].documents.map(d => d.targetCode)) assert.ok(items.includes(c), c);
});

test('Only ready courses can be shared; never to itself; a course is found only at its own client', async () => {
  const draftDoc = (await hr.post('/api/admin/documents', { kind: 'memo' })).body.code;
  const c2 = (await hr.post('/api/admin/courses', { title: 'Unfinished', codes: [draftDoc] })).body.id;
  const r = await p.post('/api/platform/share', { sourceOrgId: HR, courseId: c2, targetOrgIds: [HARBOUR] });
  assert.equal(r.status, 400); assert.match(r.body.error, /isn't published/);
  assert.equal((await p.post('/api/platform/share', { sourceOrgId: HR, courseId, targetOrgIds: [HR] })).status, 400);
  assert.equal((await p.post('/api/platform/share', { sourceOrgId: HARBOUR, courseId, targetOrgIds: [ORG] })).status, 404);
  const c3 = (await hr.post('/api/admin/courses', { title: 'Conduct only', codes: ['HRP-POL-002'] })).body.id;
  const first = (await p.post('/api/platform/share', { sourceOrgId: HR, courseId: c3, targetOrgIds: [HARBOUR] })).body.results[0].documents[0];
  assert.equal(first.result, 'unchanged', 'Harbour already has it from HR Essentials: linked, not duplicated');
});

test('Client staff can’t share', async () => {
  for (const c of [harbourMgr, hr]) assert.equal((await c.post('/api/platform/share', { sourceOrgId: HR, courseId, targetOrgIds: [HARBOUR] })).status, 404);
});
