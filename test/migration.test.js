// Moving live Pelagos onto the platform. The starting data was produced by the ORIGINAL single-client
// code (test/fixtures/pelagos-v1.json.gz: content, example staff, completed sign-offs, quiz attempts and a
// signed declaration), so this checks the real thing, not data the new code made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MemoryFirestore } from '../src/memory-firestore.js';
import { createMemoryStorage } from '../src/storage.js';
import { buildApp } from '../src/app.js';
import { migrateFirstClient, evidenceFingerprint } from '../src/migrate.js';
import { createClient } from '../src/platform.js';
import { verifyChain } from '../src/evidence.js';
import { client, CONTENT, ORG } from './helpers.js';

const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/pelagos-v1.json.gz', import.meta.url))));
const pelagosBranding = JSON.parse(fs.readFileSync(`${CONTENT}config.json`, 'utf8')).client.branding;
const quiet = () => {};
async function liveToday() {
  const db = new MemoryFirestore(), storage = createMemoryStorage();
  for (const [k, v] of Object.entries(fixture.docs)) db.store.set(k, v);
  for (const f of fs.readdirSync(`${CONTENT}files`)) await storage.putBuffer(fs.readFileSync(`${CONTENT}files/${f}`), f.endsWith('.pdf') ? 'application/pdf' : 'video/mp4', 'files');
  for (const [key, b64] of Object.entries(fixture.signatures)) {
    const r = await storage.putBuffer(Buffer.from(b64, 'base64'), 'image/png', 'signatures');
    assert.equal(r.key, key, 'signature back at its original location');
  }
  return { db, storage };
}
const staffIdOf = (db, no) => [...db.store].find(([k, v]) => k.startsWith('staff/') && v.staffNo === no)[0].split('/')[1];
const dump = db => JSON.stringify([...db.store].sort());

test('The starting data is the old layout: no client fields, files at the old locations', () => {
  const org = fixture.docs[`orgs/${ORG}`];
  assert.equal(org.loginCode, undefined); assert.equal(org.clientNo, undefined);
  assert.ok(Object.values(fixture.docs).some(d => /^signatures\/[0-9a-f]{2}\//.test(d.signatureKey || '')));
  assert.ok(Object.values(fixture.docs).some(d => /^files\/[0-9a-f]{2}\//.test(d.storageKey || '')));
});

test('A dry run checks everything and changes nothing', async () => {
  const { db } = await liveToday();
  const before = dump(db), out = [];
  const r = await migrateFirstClient(db, { branding: pelagosBranding, hosts: ['pelagos-portal.web.app'], log: s => out.push(s) });
  assert.equal(r.applied, false); assert.equal(dump(db), before);
  assert.match(out.join('\n'), /Dry run: nothing was changed/);
});

test('Without the move, the new code would refuse Pelagos sign-ins: the move must come before the deploy', async () => {
  const { db, storage } = await liveToday();
  const app = await buildApp({ db, storage, logger: false });
  assert.equal((await client(app, { clientCode: '', host: 'pelagos-portal.web.app' }).login('PL002')).status, 400);
  assert.equal((await client(app).login('PL002')).status, 404);
  await app.close();
});

test('After the move: evidence identical, staff sign in as before, every old record, file and signature still works', async () => {
  const { db, storage } = await liveToday();
  const fpOld = await evidenceFingerprint(db, ORG);
  const r = await migrateFirstClient(db, { branding: pelagosBranding, hosts: ['pelagos-portal.web.app'], apply: true, log: quiet });
  assert.equal(r.after.hash, fpOld.hash, 'evidence, frozen versions and files are exactly as they were');
  for (const [k] of db.store) if (k.startsWith('staff/')) assert.equal((await verifyChain(db, k.split('/')[1])).ok, true, k);
  const org = (await db.collection('orgs').doc(ORG).get()).data();
  assert.deepEqual([org.clientNo, org.loginCode, org.docPrefix, org.status, org.legacyStorage], [1, 'PELAGOS', 'PEL', 'active', true]);
  assert.equal(org.positions.length, 16, 'settings untouched');
  const app = await buildApp({ db, storage, logger: false });
  const hk = client(app, { clientCode: '', host: 'pelagos-portal.web.app' });
  assert.equal((await hk.login('PL005')).status, 200);
  const course = (await hk.get('/api/my/course')).body;
  assert.equal(course.upToDate, true); assert.equal(course.declarationCurrent, true);
  const rec = (await hk.get('/api/my/record')).body;
  assert.equal(rec.recordCode, 'PEL-FRM-001');
  assert.equal((await hk.get(rec.declaration.signatureUrl)).status, 200, 'signature at the old location is still served');
  const doc = (await hk.get('/api/my/documents/PEL-SOP-008')).body.doc;
  const pdf = await hk.call('GET', `/api/files/${doc.pdf.id}`, undefined, { range: 'bytes=0-4' });
  assert.equal(pdf.status, 206); assert.equal(pdf.raw.body, '%PDF-');
  const m = client(app); assert.equal((await m.login('PL001')).status, 200);
  const person = (await m.get(`/api/admin/staff/${staffIdOf(db, 'PL002')}`)).body;
  assert.equal(person.evidence.ok, true);
  assert.equal((await m.get('/api/admin/next-code?kind=sop')).body.code, 'PEL-SOP-013');
  const w = client(app); await w.login('PL002');
  const d = (await w.get('/api/my/documents/PEL-SOP-002')).body.doc;
  await w.post('/api/my/documents/PEL-SOP-002/read', { versionId: d.versionId });
  const v = (await db.collection('documents').doc(`${ORG}__PEL-SOP-002`).collection('versions').doc(`${d.major}.${d.minor}`).get()).data();
  await w.post('/api/my/documents/PEL-SOP-002/attempts', { versionId: d.versionId, answers: v.questions.map(q => q.correct) });
  assert.equal((await w.post('/api/my/documents/PEL-SOP-002/signoff', { versionId: d.versionId, agree: true, typedName: 'Example Waitron' })).status, 200);
  assert.equal((await verifyChain(db, staffIdOf(db, 'PL002'))).ok, true, 'new sign-offs extend the old chain');
  const c2 = await createClient(db, null, { name: 'Second Client', loginCode: 'SECOND', docPrefix: 'SEC', manager: { name: 'Second Manager', staffNo: 'S1', pin: '123456' } });
  assert.equal(c2.clientNo, 2);
  const oldKey = (await db.collection('files').doc(doc.pdf.id).get()).get('storageKey');
  await db.collection('files').doc('ForgedLegacyFile00001').set({ orgId: 'second-client', kind: 'pdf', name: 'x.pdf', mime: 'application/pdf', size: 5, storageKey: oldKey });
  const s = client(app, { clientCode: 'SECOND' }); await s.login('S1', '123456');
  assert.equal((await s.get('/api/files/ForgedLegacyFile00001')).status, 404, 'other clients cannot use Pelagos’s old locations');
  await app.close();
});

test('Running it twice is safe; it stops, changing nothing, on a stray record or a broken chain', async () => {
  let { db } = await liveToday();
  await migrateFirstClient(db, { branding: pelagosBranding, apply: true, log: quiet });
  assert.equal((await migrateFirstClient(db, { branding: pelagosBranding, apply: true, log: quiet })).fields.clientNo, 1);
  ({ db } = await liveToday());
  db.store.set('progress/odd', { staffId: 'x', code: 'PEL-SOP-001' });
  let before = dump(db);
  await assert.rejects(migrateFirstClient(db, { apply: true, log: quiet }), /don't belong/); assert.equal(dump(db), before);
  ({ db } = await liveToday());
  const [k, v] = [...db.store].find(([k]) => k.startsWith('signoffs/'));
  db.store.set(k, { ...v, score: 1 }); before = dump(db);
  await assert.rejects(migrateFirstClient(db, { apply: true, log: quiet }), /already broken/); assert.equal(dump(db), before);
});
