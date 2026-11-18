// Proof that clients can't see or change each other's data.
//
// 1. A sweep over EVERY route the app registers: signed in to Harbour Hotel (as its manager, its staff
//    member, and a platform admin on a support visit), each route is called with Pelagos's IDs. Nothing
//    may come back that belongs to Pelagos, and no Pelagos record may change. A new route that isn't in
//    the table below makes this test fail, so it can't be forgotten.
// 2. A scan of the whole database: every record carries a client, and everything it points at (a person,
//    a file, a stored object, a document, a course) belongs to the same client.
// 3. Sign-in: client codes, own web addresses, the same staff number in two clients, suspended clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTwoClients, client, makePlatformAdmin, uploadAs, ORG, HARBOUR } from './helpers.js';
import { verifyChain } from '../src/evidence.js';

let env;
before(async () => { env = await setupTwoClients(); });
after(async () => { await env.close(); });

// Strings that only exist in Pelagos's data. None may appear in anything Harbour receives.
const markers = () => ['Pelagos', 'PEL-', 'Example ', 'Steps of Service', 'Langebaan', env.pelagos.staffId, env.pelagos.waitronId, env.pelagos.managerId,
  env.pelagos.pdfFileId, env.pelagos.videoFileId, env.pelagos.declarationId, env.pelagos.courseId];
function assertNoPelagos(res, label) {
  const text = res.raw.body || '';
  for (const m of markers()) assert.ok(!text.includes(m), `${label} leaked "${m}" (status ${res.status}): ${text.slice(0, 200)}`);
}

/** Everything that belongs to one client, so we can check nothing changed. */
const CLIENT_COLLECTIONS = ['courses', 'courseProgress', 'courseCompletions', 'staff', 'staffNumbers', 'documents', 'files', 'progress', 'quizAttempts', 'signoffs', 'declarations', 'positionHistory', 'auditLog', 'loginEvents'];
async function snapshot(orgId) {
  const out = {};
  for (const c of CLIENT_COLLECTIONS) {
    const q = await env.db.collection(c).where('orgId', '==', orgId).get();
    for (const d of q.docs) {
      const data = d.data();
      if (c === 'staff') delete data.lastLoginAt;
      out[`${c}/${d.id}`] = data;
      if (c === 'documents' || c === 'courses') for (const v of (await d.ref.collection('versions').get()).docs) out[`${c}/${d.id}/versions/${v.id}`] = v.data();
    }
  }
  out.org = (await env.db.collection('orgs').doc(orgId).get()).data();
  return out;
}

// Every route, with Pelagos IDs filled in. 'own' = the route takes no ID and acts on the caller's own client.
const P = () => env.pelagos;
const ROUTES = () => ({
  'GET /api/my/course': { own: true },
  'GET /api/my/documents/:code': { url: `/api/my/documents/${P().docCode}` },
  'POST /api/my/documents/:code/videos/:fileId/progress': { url: `/api/my/documents/${P().docCode}/videos/${P().videoFileId}/progress`, body: { versionId: `${P().docCode}@${P().version}`, segments: [[0, 5]] } },
  'POST /api/my/documents/:code/videos/:fileId/failed': { url: `/api/my/documents/${P().docCode}/videos/${P().videoFileId}/failed`, body: { versionId: `${P().docCode}@${P().version}` } },
  'POST /api/my/documents/:code/read': { url: `/api/my/documents/${P().docCode}/read`, body: { versionId: `${P().docCode}@${P().version}` } },
  'POST /api/my/documents/:code/attempts': { url: `/api/my/documents/${P().docCode}/attempts`, body: { versionId: `${P().docCode}@${P().version}`, answers: [0, 0, 0, 0, 0, 0, 0] } },
  'POST /api/my/documents/:code/signoff': { url: `/api/my/documents/${P().docCode}/signoff`, body: { versionId: `${P().docCode}@${P().version}`, agree: true, typedName: 'Harbour Waitron' } },
  'GET /api/my/declaration': { own: true },
  'POST /api/my/declaration': { own: true, skip: 'covered by the Harbour fixture; signs for the caller only' },
  'GET /api/my/record': { own: true },
  'GET /api/declarations/:id/signature.png': { url: `/api/declarations/${P().declarationId}/signature.png` },
  'GET /api/files/:id': { url: `/api/files/${P().pdfFileId}` },
  'GET /api/admin/overview': { own: true },
  'GET /api/admin/staff': { own: true },
  'GET /api/admin/staff/:id': { url: `/api/admin/staff/${P().staffId}` },
  'POST /api/admin/staff': { own: true, body: { name: 'Harbour Barista', staffNo: 'PL003', positionId: 'staff', pin: '2222' } },
  'PATCH /api/admin/staff/:id': { url: `/api/admin/staff/${P().waitronId}`, body: { name: 'Hijacked', staffNo: 'PL002', positionId: 'staff', role: 'manager' } },
  'POST /api/admin/staff/:id/pin': { url: `/api/admin/staff/${P().waitronId}/pin`, body: { pin: '9999' } },
  'POST /api/admin/staff/:id/active': { url: `/api/admin/staff/${P().waitronId}/active`, body: { active: false } },
  'GET /api/admin/documents': { own: true },
  'GET /api/admin/next-code': { own: true, url: '/api/admin/next-code?kind=sop' },
  'GET /api/admin/documents/:code': { url: `/api/admin/documents/${P().docCode}` },
  'POST /api/admin/documents': { own: true, body: { kind: 'memo' } },
  'PUT /api/admin/documents/:code': { url: `/api/admin/documents/${P().docCode}`, body: { draft: { title: 'Hijacked', body: 'x', audience: { all: true } } } },
  'POST /api/admin/documents/:code/publish': { url: `/api/admin/documents/${P().docCode}/publish`, body: { change: 'major' } },
  'POST /api/admin/documents/publish-all': { own: true },
  'POST /api/admin/documents/:code/archive': { url: `/api/admin/documents/${P().docCode}/archive` },
  'POST /api/admin/documents/:code/hold': { url: '/api/admin/documents/PEL-MAN-002/hold', body: { reason: null } },
  'POST /api/admin/documents/:code/discard': { url: `/api/admin/documents/${P().docCode}/discard` },
  'DELETE /api/admin/documents/:code': { url: '/api/admin/documents/PEL-MAN-002' },
  'GET /api/admin/documents/:code/versions/:vid': { url: `/api/admin/documents/${P().docCode}/versions/${P().version}` },
  'GET /api/admin/documents/:code/preview': { url: `/api/admin/documents/${P().docCode}/preview` },
  'GET /api/admin/preview/:positionId': { url: '/api/admin/preview/waitron' },
  'POST /api/admin/documents/:code/draft-questions': { url: `/api/admin/documents/${P().docCode}/draft-questions` },
  'POST /api/admin/files': { own: true, skip: 'uploads go to the caller’s own folder; checked in the storage test' },
  'GET /api/admin/reports': { own: true },
  'GET /api/admin/reports/register.csv': { own: true },
  'GET /api/admin/config': { own: true },
  'PUT /api/admin/config': { own: true, skip: 'changes the caller’s own settings only; checked by the snapshot in the settings test' },
  'GET /api/admin/audit': { own: true },
  'GET /api/admin/courses': { own: true },
  'POST /api/admin/courses': { body: { title: 'Hijack', codes: [P().docCode] } },
  'PUT /api/admin/courses/:id': { url: `/api/admin/courses/${P().courseId}`, body: { title: 'Hijacked', codes: [] } },
  'DELETE /api/admin/courses/:id': { url: `/api/admin/courses/${P().courseId}` },
  'GET /api/admin/courses/:id': { url: `/api/admin/courses/${P().courseId}` },
  'POST /api/admin/courses/:id/publish': { url: `/api/admin/courses/${P().courseId}/publish`, body: { change: 'major' } },
  'GET /api/my/courses': { own: true },
  'GET /api/my/courses/:id': { url: `/api/my/courses/${P().courseId}` },
  'POST /api/my/courses/:id/lessons/:lessonId/done': { url: `/api/my/courses/${P().courseId}/lessons/${P().lessonId}/done`, body: { versionId: `${P().courseId}@1.0` } },
  'POST /api/my/courses/:id/lessons/:lessonId/quiz': { url: `/api/my/courses/${P().courseId}/lessons/${P().quizId}/quiz`, body: { versionId: `${P().courseId}@1.0`, answers: [0] } },
  'POST /api/my/courses/:id/certificate': { url: `/api/my/courses/${P().courseId}/certificate` },
  'GET /api/my/courses/:id/certificate': { url: `/api/my/courses/${P().courseId}/certificate` },
  // Public, signed-in-anywhere and platform routes have their own tests.
  'GET /api/branding': { other: true }, 'GET /api/branding/logo/:fileId': { url: `/api/branding/logo/${P().pdfFileId}` },
  'POST /api/auth/login': { other: true }, 'POST /api/auth/logout': { other: true }, 'POST /api/auth/keepalive': { other: true }, 'GET /api/me': { own: true },
  'GET /api/healthz': { other: true }, 'GET /*': { other: true },
  'POST /api/platform/login': { platform: true }, 'GET /api/platform/me': { platform: true }, 'GET /api/platform/clients': { platform: true },
  'POST /api/platform/clients': { platform: true }, 'GET /api/platform/clients/:orgId': { platform: true }, 'PUT /api/platform/clients/:orgId': { platform: true },
  'POST /api/platform/clients/:orgId/status': { platform: true }, 'POST /api/platform/clients/:orgId/domains': { platform: true },
  'DELETE /api/platform/clients/:orgId/domains/:host': { platform: true }, 'POST /api/platform/clients/:orgId/logo': { platform: true },
  'DELETE /api/platform/clients/:orgId/logo': { platform: true }, 'POST /api/platform/clients/:orgId/manager': { platform: true },
  'POST /api/platform/support': { platform: true }, 'POST /api/platform/support/end': { platform: true }, 'GET /api/platform/audit': { platform: true },
  'GET /api/platform/groups': { platform: true }, 'POST /api/platform/groups': { platform: true }, 'PUT /api/platform/groups/:id': { platform: true },
  'DELETE /api/platform/groups/:id': { platform: true }, 'POST /api/platform/share': { platform: true },
  'GET /api/platform/library': { platform: true }, 'POST /api/platform/library/open': { platform: true },
});

async function sweep(c, label) {
  const table = ROUTES();
  const before = await snapshot(ORG);
  for (const r of env.app.routeList) {
    const key = `${r.method} ${r.url}`;
    const spec = table[key];
    assert.ok(spec, `New route ${key}: add it to ROUTES in test/isolation.test.js so client separation is checked for it.`);
    if (spec.other || spec.platform || spec.skip) continue;
    const res = await c.call(r.method, spec.url || r.url, spec.body ?? (r.method === 'GET' || r.method === 'DELETE' ? undefined : {}));
    assertNoPelagos(res, `${label}: ${key}`);
    if (!spec.own) assert.ok([400, 403, 404, 409].includes(res.status), `${label}: ${key} with a Pelagos ID should be refused, got ${res.status}`);
  }
  assert.deepEqual(await snapshot(ORG), before, `${label}: no Pelagos record may change`);
}

test('Every route, called by Harbour’s manager with Pelagos IDs, reveals and changes nothing of Pelagos', async () => {
  await sweep(env.harbour.manager, 'Harbour manager');
});

test('Every route, called by Harbour’s staff member with Pelagos IDs, reveals and changes nothing of Pelagos', async () => {
  await sweep(env.harbour.staff, 'Harbour staff');
});

test('Every route, during a platform support visit to Harbour, reveals and changes nothing of Pelagos', async () => {
  const a = await makePlatformAdmin(env.db, { email: 'sweep@example.com' });
  const p = client(env.app);
  assert.equal((await p.platformLogin(a.email, a.password)).status, 200);
  assert.equal((await p.post('/api/platform/support', { orgId: HARBOUR, reason: 'Isolation sweep during automated tests', minutes: 15 })).status, 200);
  await sweep(p, 'Support visit to Harbour');
  await p.post('/api/platform/support/end');
});

test('Harbour still works normally for itself: its own course, record, files and reports', async () => {
  const s = env.harbour.staff, m = env.harbour.manager;
  const course = (await s.get('/api/my/course')).body;
  assert.deepEqual(course.items.map(i => i.code), [env.harbour.docCode]);
  assert.equal(course.upToDate, true);
  const rec = (await s.get('/api/my/record')).body;
  assert.equal(rec.recordCode, 'HBR-FRM-001', 'the certificate uses the client’s own document prefix');
  assert.equal((await s.get(rec.declaration.signatureUrl)).status, 200);
  assert.equal((await s.get(`/api/files/${env.harbour.fileId}`)).status, 200);
  const staff = (await m.get('/api/admin/staff')).body.staff;
  assert.ok(staff.every(x => x.name.startsWith('Harbour')), 'only Harbour people');
  assert.equal((await m.get('/api/admin/next-code?kind=policy')).body.code, 'HBR-POL-001');
  const csv = await m.get('/api/admin/reports/register.csv');
  assert.match(csv.raw.headers['content-disposition'], /harbour-hotel-training-register/);
  assert.ok(!csv.raw.body.includes('Example '));
});

test('Pelagos staff are equally fenced off from Harbour', async () => {
  const pm = client(env.app); await pm.login('PL001');
  assert.equal((await pm.get(`/api/admin/staff/${env.harbour.staffId}`)).status, 404);
  assert.equal((await pm.get(`/api/admin/documents/${env.harbour.docCode}`)).status, 404);
  assert.equal((await pm.get(`/api/files/${env.harbour.fileId}`)).status, 404);
  assert.equal((await pm.get(`/api/declarations/${env.harbour.declarationId}/signature.png`)).status, 404);
  const ps = client(env.app); await ps.login('PL002');
  assert.equal((await ps.get(`/api/my/documents/${env.harbour.docCode}`)).status, 404);
  const all = JSON.stringify((await pm.get('/api/admin/overview')).body) + JSON.stringify((await pm.get('/api/admin/audit')).body);
  assert.ok(!all.includes('Harbour'), 'nothing of Harbour in Pelagos’s overview or audit log');
});

test('Every record carries its client, and everything it points to belongs to the same client', async () => {
  const PER_CLIENT = CLIENT_COLLECTIONS;
  // Collections that aren't per client, and why.
  const GLOBAL = {
    orgs: 'the clients themselves', orgCodes: 'client code -> client', orgDomains: 'web address -> client', counters: 'next client number',
    sessions: 'checked below', loginState: 'keyed by client', ipState: 'per device, holds no client data',
    platformAdmins: 'platform staff', platformAdminEmails: 'platform staff', platformAudit: 'platform actions', platformLoginEvents: 'platform sign-ins',
    supportGrants: 'support visits (carry orgId)', supportLog: 'support requests (carry orgId)',
    groups: 'groups of clients (platform only)', sharedLinks: 'shared document -> its copy at the receiving client', sharedCourses: 'shared course -> its copy',
    shares: 'record of each share (platform only)',
  };
  if (env.db.store) {
    const top = new Set([...env.db.store.keys()].map(k => k.split('/')[0]));
    for (const c of top) assert.ok(PER_CLIENT.includes(c) || GLOBAL[c], `New collection "${c}": decide whether it is per client and add it to this test.`);
  }
  const orgs = new Set((await env.db.collection('orgs').get()).docs.map(d => d.id));
  const byId = {};
  for (const c of PER_CLIENT) {
    for (const d of (await env.db.collection(c).get()).docs) {
      const x = d.data();
      assert.ok(orgs.has(x.orgId), `${c}/${d.id} has no valid client (${x.orgId})`);
      byId[`${c}/${d.id}`] = x;
    }
  }
  const orgOf = (c, id) => byId[`${c}/${id}`] && byId[`${c}/${id}`].orgId;
  for (const [path, x] of Object.entries(byId)) {
    const [c, id] = path.split('/');
    if (x.staffId && !String(x.staffId).startsWith('support:') && !String(x.staffId).startsWith('platform:')) assert.equal(orgOf('staff', x.staffId), x.orgId, `${path} points at a person of another client`);
    if (c === 'documents') {
      assert.ok(id.startsWith(`${x.orgId}__`), `${path} id is not prefixed by its client`);
      for (const f of [x.draft.pdfFileId, ...(x.draft.videos || []).map(v => v.fileId)].filter(Boolean)) assert.equal(orgOf('files', f), x.orgId, `${path} uses a file of another client`);
      for (const v of (await env.db.collection('documents').doc(id).collection('versions').get()).docs) assert.equal(v.get('orgId'), x.orgId, `${path}/versions/${v.id}`);
    }
    if (c === 'courses' && x.draft) for (const l of x.draft.modules.flatMap(m => m.lessons)) {
      if (l.fileId) assert.equal(orgOf('files', l.fileId), x.orgId, `${path} has a lesson using a file of another client`);
      if (l.code) assert.ok(byId[`documents/${x.orgId}__${l.code}`], `${path} has a lesson pointing at another client's document`);
    }
    if (c === 'courseProgress' || c === 'courseCompletions') assert.equal(orgOf('courses', x.courseId), x.orgId, `${path} is about another client's course`);
    if (c === 'courses') for (const code of x.codes || []) assert.ok(byId[`documents/${x.orgId}__${code}`], `${path} holds ${code}, which isn't a document of its own client`);
    if (c === 'staffNumbers') assert.ok(id.startsWith(`${x.orgId}_`), `${path} is not keyed by its client`);
    if (c === 'files') assert.ok(x.storageKey.startsWith(`orgs/${x.orgId}/`), `${path} is stored outside its client’s folder: ${x.storageKey}`);
    if (c === 'declarations') assert.ok(x.signatureKey.startsWith(`orgs/${x.orgId}/signatures/`), `${path} signature is outside its client’s folder`);
  }
  for (const s of (await env.db.collection('sessions').get()).docs) {
    const x = s.data();
    if (x.kind === 'platform') { assert.equal(x.staffId, null); continue; }
    assert.equal(orgOf('staff', x.staffId), x.orgId, `session ${s.id} is bound to the wrong client`);
  }
});

test('The same staff number works in both clients and signs in to the right one', async () => {
  const a = client(env.app, { clientCode: 'PELAGOS' }), b = client(env.app, { clientCode: 'harbour' });
  assert.equal((await a.login('PL001', '1234')).status, 200);
  assert.equal((await b.login('PL001', '654321')).status, 200, 'client codes ignore capitals');
  assert.equal((await a.get('/api/me')).body.staff.name, 'Example Manager');
  assert.equal((await b.get('/api/me')).body.staff.name, 'Harbour Manager');
  assert.equal((await client(env.app, { clientCode: 'HARBOUR' }).login('PL001', '1234')).status, 401);
  assert.equal((await client(env.app).login('PL001', '654321')).status, 401);
  const dup = await env.harbour.manager.post('/api/admin/staff', { name: 'Second Waitron', staffNo: 'pl002', positionId: 'staff', pin: '3333' });
  assert.equal(dup.status, 400); assert.match(dup.body.error, /already in use/);
  const h = client(env.app, { clientCode: 'HARBOUR' });
  await env.harbour.manager.post('/api/admin/staff', { name: 'Harbour Porter', staffNo: 'PL006', positionId: 'staff', pin: '4444' });
  for (let i = 0; i < 5; i++) await h.login('PL006', '0000');
  assert.equal((await h.login('PL006', '4444')).status, 429, 'Harbour PL006 is paused');
  assert.notEqual((await client(env.app).login('PL006', '5678')).status, 429, 'Pelagos PL006 is not');
});

test('Sign-in needs a known client code on the shared page; unknown codes are refused', async () => {
  assert.equal((await client(env.app, { clientCode: '' }).login('PL001')).status, 400);
  const r = await client(env.app, { clientCode: 'NOPE' }).login('PL001');
  assert.equal(r.status, 404); assert.match(r.body.error, /don't recognise that client code/);
  const br = await client(env.app).get('/api/branding?code=pelagos');
  assert.equal(br.body.client.name, 'Pelagos Langebaan');
  assert.equal(br.body.client.docPrefix, 'PEL');
  assert.equal(br.body.client.colors.primary, '#213537');
  assert.ok(!JSON.stringify(br.body).match(/pinHash|declarationText|"positions"|"departments"|staffId/), 'branding holds nothing private');
});

test('A client’s own web address picks the client; its sessions only work there', async () => {
  const a = await makePlatformAdmin(env.db, { email: 'domains@example.com' });
  const p = client(env.app);
  await p.platformLogin(a.email, a.password);
  assert.equal((await p.post(`/api/platform/clients/${HARBOUR}/domains`, { host: 'https://Training.HarbourHotel.co.za/' })).status, 200);
  assert.equal((await p.post(`/api/platform/clients/${ORG}/domains`, { host: 'training.harbourhotel.co.za' })).status, 400, 'an address belongs to one client');
  const onHarbour = client(env.app, { clientCode: 'PELAGOS', host: 'training.harbourhotel.co.za' });
  assert.equal((await onHarbour.get('/api/branding')).body.client.name, 'Harbour Hotel');
  assert.equal((await onHarbour.login('PL001', '1234')).status, 401, 'Pelagos PIN does not work on Harbour’s address');
  assert.equal((await onHarbour.login('PL001', '654321')).status, 200);
  assert.equal((await onHarbour.get('/api/me')).body.staff.name, 'Harbour Manager');
  const pel = client(env.app);
  await pel.login('PL002');
  const stolen = client(env.app, { host: 'training.harbourhotel.co.za' }); stolen.cookie = pel.cookie;
  assert.equal((await stolen.get('/api/my/course')).status, 401);
  assert.equal((await pel.get('/api/my/course')).status, 200, 'but still works on the shared address');
  const viaHosting = await env.app.inject({ method: 'GET', url: '/api/branding', headers: { host: 'europe-west1-x.cloudfunctions.net', 'x-forwarded-host': 'training.harbourhotel.co.za' } });
  assert.equal(viaHosting.json().client.name, 'Harbour Hotel');
  assert.equal((await client(env.app, { host: 'training.harbourhotel.co.za' }).platformLogin(a.email, a.password)).status, 404);
  assert.equal((await p.call('DELETE', `/api/platform/clients/${HARBOUR}/domains/training.harbourhotel.co.za`)).status, 200);
});

test('Suspending a client stops its sign-ins and sessions at once, and nobody else’s', async () => {
  const a = await makePlatformAdmin(env.db, { email: 'suspend@example.com' });
  const p = client(env.app); await p.platformLogin(a.email, a.password);
  const h = client(env.app, { clientCode: 'HARBOUR' }); await h.login('PL002', '1111');
  const pel = client(env.app); await pel.login('PL002');
  assert.equal((await p.post(`/api/platform/clients/${HARBOUR}/status`, { status: 'suspended' })).status, 400, 'a reason is required');
  assert.equal((await p.post(`/api/platform/clients/${HARBOUR}/status`, { status: 'suspended', reason: 'Account on hold' })).status, 200);
  const r = await h.get('/api/my/course');
  assert.equal(r.status, 403); assert.equal(r.body.suspended, true);
  assert.equal((await client(env.app, { clientCode: 'HARBOUR' }).login('PL002', '1111')).status, 403);
  assert.equal((await pel.get('/api/my/course')).status, 200, 'Pelagos is unaffected');
  assert.equal((await p.post(`/api/platform/clients/${HARBOUR}/status`, { status: 'active' })).status, 200);
  assert.equal((await h.get('/api/my/course')).status, 200, 'the session works again after reactivation');
  const log = (await env.harbour.manager.get('/api/admin/audit')).body.entries.map(e => e.action);
  assert.ok(log.includes('client.suspend') && log.includes('client.reactivate'), 'the client can see it in their audit log');
});

test('Uploads go into the client’s own storage folder; a record pointing at another client’s object is refused', async () => {
  const fs = await import('node:fs');
  const up = await uploadAs(env.harbour.manager, '/api/admin/files', fs.readFileSync(new URL('../content/files/PEL-SOP-011.pdf', import.meta.url)), 'same-as-pelagos.pdf', 'application/pdf');
  assert.equal(up.status, 200);
  const f = (await env.db.collection('files').doc(up.body.id).get()).data();
  assert.ok(f.storageKey.startsWith(`orgs/${HARBOUR}/files/`), 'same bytes as a Pelagos PDF, but its own copy');
  const pelKey = (await env.db.collection('files').doc(env.pelagos.pdfFileId).get()).get('storageKey');
  assert.notEqual(f.storageKey, pelKey);
  const forged = env.db.collection('files').doc('ForgedFile000000000001');
  await forged.set({ ...f, storageKey: pelKey });
  assert.equal((await env.harbour.manager.get('/api/files/ForgedFile000000000001')).status, 404);
  await forged.delete();
});

test('A client can’t attach another client’s file to a document, and a tampered record doesn’t reveal it', async () => {
  const m = env.harbour.manager, code = env.harbour.docCode;
  const doc = (await m.get(`/api/admin/documents/${code}`)).body;
  assert.equal((await m.put(`/api/admin/documents/${code}`, { draft: { ...doc.draft, pdfFileId: env.pelagos.pdfFileId } })).status, 400, 'saving a draft with a Pelagos file is refused');
  assert.equal((await m.put(`/api/admin/documents/${code}`, { draft: { ...doc.draft, videos: [{ fileId: env.pelagos.videoFileId, title: 'x' }] } })).status, 400, 'and a Pelagos video');
  const ref = env.db.collection('documents').doc(`${HARBOUR}__${code}`);
  const orig = (await ref.get()).data();
  await ref.set({ ...orig, draft: { ...orig.draft, pdfFileId: env.pelagos.pdfFileId } });
  const det = await m.get(`/api/admin/documents/${code}`);
  assert.deepEqual(det.body.files, {}, 'no name, size or fingerprint of the Pelagos file');
  assert.equal((await m.get(`/api/admin/documents/${code}/preview`)).body.doc.pdf, null);
  for (const url of [`/api/admin/documents/${code}`, `/api/admin/documents/${code}/preview`]) {
    const r = await m.get(url);
    r.raw.body = r.raw.body.split(env.pelagos.pdfFileId).join(''); // the planted ID itself is echoed in the draft
    assertNoPelagos(r, url);
  }
  assert.equal((await m.post(`/api/admin/documents/${code}/publish`, { change: 'minor' })).status, 400, 'and it can’t be published');
  await ref.set(orig);
});

test('A record slipped into someone’s evidence chain from another client is detected', async () => {
  const id = env.harbour.staffId;
  assert.equal((await verifyChain(env.db, id)).ok, true);
  const so = (await env.db.collection('signoffs').where('staffId', '==', id).get()).docs[0];
  const orig = so.data();
  await so.ref.set({ ...orig, orgId: ORG });
  const r = await verifyChain(env.db, id);
  assert.equal(r.ok, false); assert.match(r.problem, /different client/);
  await so.ref.set(orig);
  assert.equal((await verifyChain(env.db, id)).ok, true);
  assert.equal((await verifyChain(env.db, env.pelagos.staffId)).ok, true);
});

test('Two clients may use the same document code and version without seeing each other’s sign-offs', async () => {
  const m = env.harbour.manager;
  const created = await m.post('/api/admin/documents', { kind: 'memo', code: 'PEL-MEM-015' });
  assert.equal(created.status, 200, 'codes are per client');
  await m.put('/api/admin/documents/PEL-MEM-015', { draft: { ...created.body.draft, title: 'Harbour memo', body: 'Harbour only.', audience: { all: true, positions: [] } } });
  const pub = await m.post('/api/admin/documents/PEL-MEM-015/publish', {});
  assert.equal(pub.body.result.versionId, 'PEL-MEM-015@1.0', 'the same version id as Pelagos’s');
  const v = (await m.get('/api/admin/documents/PEL-MEM-015/versions/1.0')).body;
  assert.equal(v.title, 'Harbour memo');
  assert.equal(v.signoffs, 0, 'Pelagos sign-offs of its own PEL-MEM-015 1.0 are not counted');
  const item = (await env.harbour.staff.get('/api/my/course')).body.items.find(i => i.code === 'PEL-MEM-015');
  assert.equal(item.status, 'todo');
  const pc = client(env.app); await pc.login('PL005');
  const pi = (await pc.get('/api/my/course')).body.items.find(i => i.code === 'PEL-MEM-015');
  assert.equal(pi.status, 'done'); assert.notEqual(pi.title, 'Harbour memo');
});

test('Harbour’s settings save changes only Harbour', async () => {
  const before = await snapshot(ORG);
  const cfg = (await env.harbour.manager.get('/api/admin/config')).body;
  assert.equal(cfg.docPrefix, 'HBR');
  const r = await env.harbour.manager.put('/api/admin/config', { orgName: 'Harbour Hotel', courseTitle: 'Harbour standards', declarationText: cfg.declarationText,
    departments: cfg.departments, positions: [...cfg.positions, { id: 'new-1', name: 'Barista', dept: 'general' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(await snapshot(ORG), before);
});
