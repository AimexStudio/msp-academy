// The platform admin area: sign-in with an authenticator code, creating and managing clients,
// branding, and audited, read-only support visits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTwoClients, client, makePlatformAdmin, uploadAs, ORG, HARBOUR, signaturePng } from './helpers.js';
import { platformLogin, setPlatformAdminPassword } from '../src/platform.js';

let env;
before(async () => { env = await setupTwoClients(); });
after(async () => { await env.close(); });
async function signedInAdmin(email) {
  const a = await makePlatformAdmin(env.db, { email });
  const p = client(env.app);
  assert.equal((await p.platformLogin(a.email, a.password)).status, 200);
  return { a, p };
}

test('Platform sign-in is email and password; wrong passwords are refused and repeated ones pause sign-in', async () => {
  const a = await makePlatformAdmin(env.db, { email: 'signin@example.com' });
  const p = client(env.app);
  const bad = await p.platformLogin(a.email, 'wrong password!!');
  assert.equal(bad.status, 401); assert.match(bad.body.error, /email and password don't match/);
  assert.equal((await p.platformLogin('Signin@Example.com', a.password)).status, 200, 'email ignores capitals');
  assert.equal((await p.get('/api/platform/me')).body.admin.email, a.email);
  const q = client(env.app);
  for (let i = 0; i < 5; i++) await q.platformLogin(a.email, 'still wrong!!!');
  assert.equal((await q.platformLogin(a.email, a.password)).status, 429, 'paused after five wrong passwords');
  // A new password (set from the terminal) works at once, ends old sessions and clears the pause.
  await setPlatformAdminPassword(env.db, { email: a.email, password: 'a brand new password' });
  assert.equal((await p.get('/api/platform/me')).status, 404, 'old sessions end (platform routes look non-existent when signed out)');
  assert.equal((await client(env.app).platformLogin(a.email, a.password)).status, 401, 'old password no longer works');
  assert.equal((await client(env.app).platformLogin(a.email, 'a brand new password')).status, 200);
  // Accounts created with an authenticator before this change sign in with just their password.
  const old = await makePlatformAdmin(env.db, { email: 'had-a-code@example.com' });
  await env.db.collection('platformAdmins').doc(old.id).update({ totpSecret: 'JBSWY3DPEHPK3PXP', lastTotpStep: 0 });
  assert.equal((await platformLogin(env.db, { email: old.email, password: old.password })).ok, true);
});

test('Client staff, even managers, can’t reach any platform route', async () => {
  const m = client(env.app); await m.login('PL001');
  for (const r of env.app.routeList.filter(r => r.url.startsWith('/api/platform/') && r.url !== '/api/platform/login')) {
    const url = r.url.replace(':orgId', ORG).replace(':host', 'x.example.com').replace(':id', 'anything');
    const res = await m.call(r.method, url, r.method === 'GET' || r.method === 'DELETE' ? undefined : { orgId: ORG, reason: 'trying to get in here', status: 'suspended', name: 'X', loginCode: 'XX1', docPrefix: 'XX', manager: { name: 'A B', staffNo: 'A1', pin: '123456' }, host: 'x.example.com', staffNo: 'PL001', pin: '111111', sourceOrgId: ORG, courseId: 'x', targetOrgIds: [HARBOUR], email: 'x@y.co', password: 'twelve chars long', active: true });
    assert.equal(res.status, 404, `${r.method} ${r.url} must not exist for client staff`);
  }
  assert.equal((await client(env.app).get('/api/platform/clients')).status, 404, 'nor for anyone signed out');
});

test('Creating a client gives it the next number, its own code and prefix, and a working first manager', async () => {
  const { p } = await signedInAdmin('create@example.com');
  const bad = await p.post('/api/platform/clients', { name: 'Clash', loginCode: 'pelagos', docPrefix: 'CL', manager: { name: 'A Person', staffNo: 'C1', pin: '123456' } });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /already used/);
  const r = await p.post('/api/platform/clients', { name: 'Cape Café', loginCode: 'cape-cafe', docPrefix: 'cap', staffNoPrefix: 'cc', manager: { name: 'Cape Manager', staffNo: 'cc001', pin: '246810' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.clientNo, r.body.loginCode, r.body.orgId], [3, 'CAPECAFE', 'cape-cafe']);
  const c = client(env.app, { clientCode: 'CAPECAFE' });
  assert.equal((await c.login('CC001', '246810')).status, 200);
  assert.equal((await c.get('/api/admin/next-code?kind=sop')).body.code, 'CAP-SOP-001');
  const me = (await c.get('/api/me')).body;
  assert.equal(me.brand.colors.primary, '#26292D', 'a new client starts in the MSP Academy look');
  const list = (await p.get('/api/platform/clients')).body.clients;
  assert.deepEqual(list.map(x => x.clientNo), [1, 2, 3]);
  const log = (await c.get('/api/admin/audit')).body.entries;
  assert.ok(log.some(e => e.action === 'client.create' && /platform/.test(e.actor)), 'the client sees who set it up');
});

test('Branding, wording, client code and prefixes can be changed; bad values are refused', async () => {
  const { p } = await signedInAdmin('brand@example.com');
  assert.equal((await p.put(`/api/platform/clients/${HARBOUR}`, { branding: { colors: { primary: 'red', accent: '#00AA00' }, headingFont: 'comic-sans', wordmark: 'HARBOUR HOTEL',
    announcement: 'Fire drill on Friday', terms: { course: 'Qualification', courses: 'Qualifications' } } })).status, 200);
  const b = (await client(env.app).get('/api/branding?code=HARBOUR')).body.client;
  assert.equal(b.colors.primary, '#123456', 'an invalid colour keeps the old one');
  assert.equal(b.colors.accent, '#00AA00'); assert.equal(b.headingFont, 'figtree', 'unknown fonts are refused'); assert.equal(b.wordmark, 'HARBOUR HOTEL');
  assert.equal(b.announcement, 'Fire drill on Friday'); assert.equal(b.terms.course, 'Qualification'); assert.equal(b.terms.module, 'Module');
  assert.equal((await p.put(`/api/platform/clients/${HARBOUR}`, { docPrefix: '1X' })).status, 400);
  assert.equal((await p.put(`/api/platform/clients/${HARBOUR}`, { loginCode: 'PELAGOS' })).status, 400, 'codes are unique');
  assert.equal((await p.put(`/api/platform/clients/${HARBOUR}`, { loginCode: 'HARBOURHOTEL' })).status, 200);
  assert.equal((await client(env.app, { clientCode: 'HARBOUR' }).login('PL002', '1111')).status, 404, 'the old code stops working');
  assert.equal((await client(env.app, { clientCode: 'HARBOURHOTEL' }).login('PL002', '1111')).status, 200);
  await p.put(`/api/platform/clients/${HARBOUR}`, { loginCode: 'HARBOUR' });
});

test('Logos: PNG/JPEG/WebP only, served publicly for the sign-in page, never another client’s file', async () => {
  const { p } = await signedInAdmin('logo@example.com');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await uploadAs(p, `/api/platform/clients/${HARBOUR}/logo`, svg, 'logo.svg', 'image/svg+xml')).status, 400, 'no SVG');
  const png = Buffer.from(signaturePng().split(',')[1], 'base64');
  const up = await uploadAs(p, `/api/platform/clients/${HARBOUR}/logo`, png, 'logo.png', 'image/png');
  assert.equal(up.status, 200);
  const anon = client(env.app);
  const br = (await anon.get('/api/branding?code=HARBOUR')).body.client;
  assert.equal(br.logoUrl, up.body.logoUrl);
  const img = await anon.get(br.logoUrl);
  assert.equal(img.status, 200); assert.equal(img.raw.headers['content-type'], 'image/png');
  assert.equal((await anon.get(`/api/branding/logo/${env.pelagos.pdfFileId}`)).status, 404, 'the logo route serves logos only');
  assert.equal((await env.harbour.staff.get(`/api/files/${up.body.logoUrl.split('/').pop()}`)).status, 404, 'and logos are not training files');
  assert.equal((await p.call('DELETE', `/api/platform/clients/${HARBOUR}/logo`)).status, 200);
  assert.equal((await anon.get(br.logoUrl)).status, 404, 'a removed logo is no longer served');
});

test('Support visits: reason required, read-only, no training, time-limited, visible to the client', async () => {
  const { a, p } = await signedInAdmin('support@example.com');
  assert.equal((await p.post('/api/platform/support', { orgId: HARBOUR, reason: 'help' })).status, 400, 'a real reason is required');
  assert.equal((await p.get('/api/admin/overview')).status, 401, 'no client access before a visit starts');
  assert.equal((await p.post('/api/platform/support', { orgId: HARBOUR, reason: 'Manager asked why a report total looks wrong', minutes: 30 })).status, 200);
  const me = (await p.get('/api/me')).body;
  assert.equal(me.staff.role, 'support'); assert.match(me.support.reason, /report total/);
  assert.equal((await p.get('/api/admin/overview')).body.orgName, 'Harbour Hotel');
  assert.equal((await p.get(`/api/admin/staff/${env.harbour.staffId}`)).status, 200);
  assert.equal((await p.get(`/api/declarations/${env.harbour.declarationId}/signature.png`)).status, 200);
  for (const [m, u, b] of [['POST', '/api/admin/staff', { name: 'X Y', staffNo: 'Z9', positionId: 'staff', pin: '1234' }], ['POST', `/api/admin/staff/${env.harbour.staffId}/pin`, { pin: '9999' }],
    ['POST', '/api/admin/documents/publish-all', {}], ['PUT', '/api/admin/config', {}], ['POST', '/api/admin/courses', { title: 'Sneaky' }], ['POST', '/api/auth/login', { clientCode: 'HARBOUR', staffNo: 'PL002', pin: '1111' }]]) {
    const r = await p.call(m, u, b);
    assert.equal(r.status, 403, `${m} ${u}`); assert.match(r.body.error, /read-only/);
  }
  assert.equal((await p.get('/api/my/course')).status, 403, 'support can’t take part in training');
  const audit = (await env.harbour.manager.get('/api/admin/audit')).body.entries;
  const start = audit.find(e => e.action === 'support.start');
  assert.ok(start && /Olivia Ops/.test(start.actor) && /report total/.test(start.details.reason));
  const logged = (await env.db.collection('supportLog').where('orgId', '==', HARBOUR).where('adminId', '==', a.id).get()).docs.map(d => d.get('path'));
  assert.ok(logged.includes(`/api/admin/staff/${env.harbour.staffId}`));
  assert.equal((await p.post('/api/platform/support/end')).status, 200);
  assert.equal((await p.get('/api/admin/overview')).status, 401);
  const visit = (await p.get(`/api/platform/clients/${HARBOUR}`)).body.supportVisits.find(v => v.adminId === a.id);
  assert.ok(visit.endedAt && visit.requests >= 3);
  await p.post('/api/platform/support', { orgId: HARBOUR, reason: 'Checking an expired visit ends', minutes: 5 });
  const sess = (await env.db.collection('sessions').where('adminId', '==', a.id).get()).docs.find(d => d.get('support'));
  await sess.ref.update({ 'support.until': new Date(Date.now() - 1000).toISOString() });
  assert.equal((await p.get('/api/admin/overview')).status, 401);
});

test('A locked-out client manager can be helped back in, with the reason in the client’s log', async () => {
  const { p } = await signedInAdmin('rescue@example.com');
  assert.equal((await p.post(`/api/platform/clients/${HARBOUR}/manager`, { staffNo: 'PL002', pin: '135790', reason: 'Manager forgot PIN' })).status, 400, 'only managers, not staff');
  assert.equal((await p.post(`/api/platform/clients/${HARBOUR}/manager`, { staffNo: 'PL001', pin: '135790', reason: 'x' })).status, 400, 'reason required');
  const h = client(env.app, { clientCode: 'HARBOUR' });
  for (let i = 0; i < 15; i++) await h.login('PL001', '000000');
  assert.equal((await h.login('PL001', '654321')).status, 429, 'blocked');
  assert.equal((await p.post(`/api/platform/clients/${HARBOUR}/manager`, { staffNo: 'PL001', pin: '135790', reason: 'Manager blocked after wrong PINs, phoned in' })).status, 200);
  assert.equal((await h.login('PL001', '135790')).status, 200);
  const log = (await h.get('/api/admin/audit')).body.entries.find(e => e.action === 'staff.pin_reset_by_platform');
  assert.match(log.details.reason, /phoned in/);
  const added = await p.post(`/api/platform/clients/${HARBOUR}/manager`, { staffNo: 'PL050', name: 'New Harbour Manager', pin: '112233', reason: 'Previous manager left' });
  assert.equal(added.body.created, true);
  assert.equal((await client(env.app, { clientCode: 'HARBOUR' }).login('PL050', '112233')).status, 200);
});

test('The platform audit log records every platform action', async () => {
  const { p } = await signedInAdmin('audit@example.com');
  await p.post(`/api/platform/clients/${HARBOUR}/status`, { status: 'suspended', reason: 'Audit test' });
  await p.post(`/api/platform/clients/${HARBOUR}/status`, { status: 'active' });
  await p.post(`/api/platform/clients/${HARBOUR}/domains`, { host: 'audit.example.co.za' });
  const actions = (await p.get('/api/platform/audit')).body.entries.map(e => e.action);
  for (const a of ['client.create', 'client.update', 'client.suspend', 'client.reactivate', 'client.domain_add', 'client.logo_upload', 'support.start', 'support.end', 'staff.pin_reset_by_platform', 'platform_admin.create', 'platform_admin.password_set'])
    assert.ok(actions.includes(a), a);
});

test('Open portal: an MSP Academy admin works in a client’s portal as a manager, recorded in the client’s log', async () => {
  const { a, p } = await signedInAdmin('portal@example.com');
  assert.equal((await p.post('/api/platform/support', { orgId: HARBOUR, mode: 'manage' })).status, 200, 'no reason needed');
  const me = (await p.get('/api/me')).body;
  assert.equal(me.staff.role, 'manager'); assert.equal(me.support.mode, 'manage'); assert.equal(me.staff.positionName, 'MSP Academy admin');
  const add = await p.post('/api/admin/staff', { name: 'Added By Msp', staffNo: 'HB900', positionId: 'staff', pin: '2468' });
  assert.equal(add.status, 200, 'can make changes');
  assert.equal((await p.get('/api/my/course')).status, 403, 'still can’t take part in training');
  assert.equal((await p.get(`/api/admin/staff/${env.pelagos.staffId}`)).status, 404, 'and nothing of another client');
  // (Read as the client's own manager sees it: Harbour's manager PIN was reset by an earlier test, so sign in afresh.)
  const hm = client(env.app, { clientCode: 'HARBOUR' }); assert.equal((await hm.login('PL050', '112233')).status, 200);
  const log = (await hm.get('/api/admin/audit')).body.entries;
  assert.ok(log.some(e => e.action === 'portal.open'));
  assert.equal(log.find(e => e.action === 'staff.create' && e.details && e.details.staffNo === 'HB900').actor, 'MSP Academy', 'changes show as made by MSP Academy');
  assert.equal((await p.post('/api/platform/support/end')).status, 200);
  assert.equal((await p.get('/api/admin/overview')).status, 401, 'back on the platform');
  assert.ok((await hm.get('/api/admin/audit')).body.entries.some(e => e.action === 'portal.close'));
  void a;
});

test('The Team page: add MSP Academy admins, give a new password, switch one off (never yourself)', async () => {
  const { p } = await signedInAdmin('lead@example.com');
  assert.equal((await p.post('/api/platform/admins', { email: 'new@example.com', name: 'New Person', password: 'short' })).status, 400);
  const r = await p.post('/api/platform/admins', { email: 'New@Example.com', name: 'New Person', password: 'a long enough password' });
  assert.equal(r.status, 200);
  const n = client(env.app);
  assert.equal((await n.platformLogin('new@example.com', 'a long enough password')).status, 200);
  assert.equal((await p.post(`/api/platform/admins/${r.body.id}/password`, { password: 'another long password' })).status, 200);
  assert.equal((await n.get('/api/platform/me')).status, 404, 'a new password ends their sessions');
  assert.equal((await client(env.app).platformLogin('new@example.com', 'another long password')).status, 200);
  assert.equal((await p.post(`/api/platform/admins/${r.body.id}/active`, { active: false })).status, 200);
  assert.equal((await client(env.app).platformLogin('new@example.com', 'another long password')).status, 401, 'switched off');
  const team = (await p.get('/api/platform/admins')).body;
  assert.equal((await p.post(`/api/platform/admins/${team.me}/active`, { active: false })).status, 400, 'never yourself');
  assert.ok(team.admins.every(x => !('passwordHash' in x)), 'no password hashes leave the server');
  const log = (await p.get('/api/platform/audit')).body.entries.map(e => e.action);
  for (const x of ['platform_admin.add', 'platform_admin.password_set', 'platform_admin.deactivate']) assert.ok(log.includes(x), x);
});
