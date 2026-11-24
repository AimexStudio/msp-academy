// Staff leave: calculations, the per-client switch, recording by managers, and what staff can see.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupTwoClients, client, makePlatformAdmin, uploadAs, HARBOUR, CONTENT } from './helpers.js';
import { workingDays, publicHolidays, balancesOn } from '../src/leave.js';
import { createClient } from '../src/platform.js';

let env, m, s, id;
before(async () => { env = await setupTwoClients(); m = env.harbour.manager; s = env.harbour.staff; id = env.harbour.staffId; });
after(async () => { await env.close(); });

test('Working days skip weekends and South African public holidays; balances build up day by day', () => {
  const h = publicHolidays(2026);
  for (const d of ['2026-04-03', '2026-04-06', '2026-08-10', '2026-12-16']) assert.ok(h.has(d), d); // Good Friday, Family Day, Women’s Day moved to Monday
  assert.equal(workingDays('2026-04-01', '2026-04-10'), 6);
  assert.equal(workingDays('2026-12-21', '2026-12-31'), 8, 'Christmas Day and the weekend skipped (26 December 2026 is a Saturday, so no extra day off)');
  const p = { annualDays: 15, openingBalance: 2, accrualStart: '2026-01-01' };
  const e = [{ type: 'annual', startDate: '2026-03-02', days: 5 }, { type: 'annual', startDate: '2026-12-21', days: 4 }, { type: 'adjustment', startDate: '2026-07-01', days: -1 }, { type: 'annual', startDate: '2026-06-01', days: 3, deletedAt: 'x' }];
  assert.equal(balancesOn(p, e, '2026-06-30').annual.balance, 4.44);
  assert.equal(balancesOn(p, e, '2026-12-31').annual.balance, 7, 'a full year, two leave periods and an adjustment; the removed record is ignored');
  assert.equal(balancesOn(p, e, '2025-12-31').annual.balance, 2, 'nothing builds up before the start date');
  const sick = balancesOn(p, [{ type: 'sick', startDate: '2026-02-02', days: 3 }, { type: 'sick', startDate: '2029-02-02', days: 1 }], '2029-03-01').sick;
  assert.deepEqual([sick.cycleStart, sick.used, sick.left], ['2029-01-01', 1, 29], 'sick leave starts again every 36 months');
});

test('Leave is switched on per client from the platform; switched off, nobody sees it', async () => {
  const a = await makePlatformAdmin(env.db, { email: 'leave@example.com' });
  const p = client(env.app); await p.platformLogin(a.email, a.password);
  await createClient(env.db, null, { name: 'Off Client', loginCode: 'OFFC', docPrefix: 'OFF', manager: { name: 'Off Manager', staffNo: 'O1', pin: '123456' } });
  const om = client(env.app, { clientCode: 'OFFC' }); await om.login('O1', '123456');
  assert.equal((await om.get('/api/admin/leave')).status, 404);
  assert.equal((await om.get('/api/me')).body.features.leave, false);
  assert.equal((await p.put('/api/platform/clients/off-client', { features: { leave: true } })).status, 200);
  assert.equal((await om.get('/api/admin/leave')).status, 200);
  assert.equal((await p.get('/api/platform/clients/off-client')).body.client.features.leave, true);
  assert.ok((await p.get('/api/platform/audit')).body.entries.some(e => e.action === 'client.update' && e.details.leaveTracking === true));
});

test('A manager sets yearly leave and records leave; days are suggested; adjustments need a reason', async () => {
  assert.equal((await m.put(`/api/admin/leave/${id}/profile`, { annualDays: 15 })).status, 400, 'a start date is needed');
  assert.equal((await m.put(`/api/admin/leave/${id}/profile`, { annualDays: 18, openingBalance: 2, accrualStart: '2026-01-01', sickDays: 30, familyDays: 3 })).status, 200);
  const a = await m.post(`/api/admin/leave/${id}/entries`, { type: 'annual', startDate: '2026-12-21', endDate: '2026-12-31', note: 'Christmas break' });
  assert.equal(a.status, 200);
  const cert = await uploadAs(m, `/api/admin/leave/${id}/certificate`, fs.readFileSync(`${CONTENT}files/PEL-SOP-003.pdf`), 'certificate.pdf', 'application/pdf');
  assert.equal(cert.status, 200);
  assert.equal((await uploadAs(m, `/api/admin/leave/${id}/certificate`, Buffer.from('not a certificate'), 'x.txt', 'text/plain')).status, 400, 'PDF, JPEG or PNG only');
  assert.equal((await m.post(`/api/admin/leave/${id}/entries`, { type: 'sick', startDate: '2026-03-02', endDate: '2026-03-03', note: 'Flu, doctor’s note', certificateFileId: cert.body.id })).status, 200);
  assert.equal((await m.post(`/api/admin/leave/${id}/entries`, { type: 'sick', startDate: '2026-03-02', endDate: '2026-03-01' })).status, 400, 'last day before the first');
  assert.equal((await m.post(`/api/admin/leave/${id}/entries`, { type: 'adjustment', startDate: '2026-06-30', days: -2 })).status, 400, 'a reason is needed');
  assert.equal((await m.post(`/api/admin/leave/${id}/entries`, { type: 'adjustment', startDate: '2026-06-30', days: -2, note: 'Paid out two days' })).status, 200);
  assert.equal((await m.post(`/api/admin/leave/${id}/entries`, { type: 'annual', startDate: '2026-03-02', endDate: '2026-03-02', certificateFileId: env.pelagos.certificateId })).status, 400, 'never another client’s certificate');
  const d = (await m.get(`/api/admin/leave/${id}?date=2026-12-31`)).body;
  assert.equal(d.entries.find(e => e.type === 'annual').days, 8, 'working days suggested');
  assert.equal(d.at.annual.balance, 2 + 18 - 8 - 2, 'year-end: opening + a full year − leave − adjustment');
  assert.equal(d.at.sick.used, 2);
  assert.equal(d.entries.find(e => e.type === 'sick').note, 'Flu, doctor’s note');
  const list = (await m.get('/api/admin/leave')).body.staff;
  assert.ok(list.some(r => r.id === id && r.configured));
});

test('Staff see their balances now and on a future date, but not the managers’ notes; certificates are private', async () => {
  const me = (await s.get('/api/my/leave?date=2026-12-31')).body;
  assert.equal(me.enabled, true); assert.equal(me.at.annual.balance, 10); assert.equal(me.profile.annualDays, 18);
  assert.ok(me.entries.length >= 3); assert.ok(me.entries.every(e => e.note === undefined), 'notes are for managers');
  const certId = me.entries.find(e => e.type === 'sick').certificateFileId;
  assert.equal((await s.get(`/api/files/${certId}`)).status, 200, 'their own certificate');
  assert.equal((await m.get(`/api/files/${certId}`)).status, 200, 'their manager');
  const other = client(env.app, { clientCode: 'HARBOUR' });
  await m.post('/api/admin/staff', { name: 'Another Person', staffNo: 'PL077', positionId: 'staff', pin: '7070' });
  await other.login('PL077', '7070');
  assert.equal((await other.get(`/api/files/${certId}`)).status, 404, 'not a colleague');
  assert.equal((await other.get('/api/my/leave')).body.entries.length, 0, 'only their own leave');
  assert.equal((await s.get(`/api/admin/leave/${id}`)).status, 403, 'staff can’t open the manager pages');
});

test('Corrections: a record can be changed or removed; both are in the audit log', async () => {
  const d = (await m.get(`/api/admin/leave/${id}`)).body;
  const annual = d.entries.find(e => e.type === 'annual');
  assert.equal((await m.put(`/api/admin/leave/entries/${annual.id}`, { type: 'annual', startDate: '2026-12-21', endDate: '2026-12-24', note: 'Shortened' })).status, 200);
  assert.equal((await m.get(`/api/admin/leave/${id}`)).body.entries.find(e => e.id === annual.id).days, 4);
  assert.equal((await m.call('DELETE', `/api/admin/leave/entries/${annual.id}`)).status, 200);
  assert.ok(!(await m.get(`/api/admin/leave/${id}`)).body.entries.some(e => e.id === annual.id));
  assert.ok((await env.db.collection('leaveEntries').doc(annual.id).get()).get('deletedAt'), 'kept, marked as removed');
  const log = (await m.get('/api/admin/audit')).body.entries.map(e => e.action);
  for (const x of ['leave.settings', 'leave.record', 'leave.change', 'leave.remove']) assert.ok(log.includes(x), x);
});
