// Moves the single-client Pelagos database onto the multi-client platform as client number 1.
//
// What it changes: it ADDS the client fields to orgs/pelagos-langebaan (status, client number, sign-in
// code, document and staff-number prefixes, branding) and adds the sign-in code, the web address and
// the client counter. Nothing else is written. No staff, document, file or evidence record is touched,
// and no stored file moves (old file locations stay valid for Pelagos only).
//
// What it checks, before and after: every record belongs to Pelagos; every person's evidence chain is
// intact; and a fingerprint of every evidence record, frozen version and stored-file reference is
// identical afterwards.
import crypto from 'node:crypto';
import { canonical, verifyChain, EVIDENCE } from './evidence.js';
import { cleanBranding, codeRef, domainRef, normCode, normHost, HOST_RE, invalidate } from './tenancy.js';
import { now } from './documents.js';

const PER_CLIENT = ['staff', 'staffNumbers', 'documents', 'files', 'progress', 'quizAttempts', 'signoffs', 'declarations', 'positionHistory', 'auditLog', 'loginEvents'];

/** A fingerprint of everything that must never change: evidence, frozen versions, files, people. */
export async function evidenceFingerprint(db, orgId) {
  const h = crypto.createHash('sha256');
  const add = (path, data) => h.update(path + '\n' + canonical(data) + '\n');
  let n = 0;
  for (const c of [...EVIDENCE, 'files']) {
    const q = await db.collection(c).where('orgId', '==', orgId).get();
    for (const d of q.docs.sort((a, b) => a.id.localeCompare(b.id))) { add(`${c}/${d.id}`, d.data()); n++; }
  }
  const docs = await db.collection('documents').where('orgId', '==', orgId).get();
  for (const d of docs.docs.sort((a, b) => a.id.localeCompare(b.id))) {
    for (const v of (await d.ref.collection('versions').get()).docs.sort((a, b) => a.id.localeCompare(b.id))) { add(`documents/${d.id}/versions/${v.id}`, v.data()); n++; }
  }
  const staff = await db.collection('staff').where('orgId', '==', orgId).get();
  for (const s of staff.docs.sort((a, b) => a.id.localeCompare(b.id))) { const x = s.data(); add(`staff/${s.id}`, { chainHead: x.chainHead, chainSeq: x.chainSeq, staffNo: x.staffNo, name: x.name, pinHash: x.pinHash }); n++; }
  return { hash: h.digest('hex'), records: n };
}

async function checkChains(db, orgId) {
  const staff = await db.collection('staff').where('orgId', '==', orgId).get();
  const problems = []; let records = 0;
  for (const s of staff.docs) {
    const r = await verifyChain(db, s.id);
    records += r.records;
    if (!r.ok) problems.push(`${s.get('staffNo')} ${s.get('name')}: ${r.problem}`);
  }
  return { people: staff.size, records, problems };
}

/**
 * @param apply   false (default) only checks and reports; true writes the changes.
 * @param hosts   web addresses that should open Pelagos directly (no client code needed).
 */
export async function migrateFirstClient(db, { orgId = 'pelagos-langebaan', loginCode = 'PELAGOS', docPrefix = 'PEL', staffNoPrefix = 'PL',
  branding = {}, hosts = [], apply = false, log = console.log } = {}) {
  const say = (...a) => log(...a);
  const stop = msg => { throw Object.assign(new Error(msg), { migrationStopped: true }); };
  loginCode = normCode(loginCode);
  hosts = [...new Set(hosts.map(normHost))];
  for (const h of hosts) if (!HOST_RE.test(h)) stop(`"${h}" is not a valid web address.`);

  const orgSnap = await db.collection('orgs').doc(orgId).get();
  if (!orgSnap.exists) stop(`There is no organisation "${orgId}" in this database. Nothing to move.`);
  const org = orgSnap.data();
  say(`Client: ${org.name} (${orgId})`);
  const already = org.clientNo != null && org.loginCode;
  if (already) say(`It is already client number ${org.clientNo} with code ${org.loginCode}. Only missing pieces will be added.`);

  say('\nChecking every record belongs to this client…');
  const strays = [];
  for (const c of PER_CLIENT) {
    const all = await db.collection(c).get();
    const mine = all.docs.filter(d => d.get('orgId') === orgId).length;
    const missing = all.docs.filter(d => !d.get('orgId'));
    const other = all.docs.filter(d => d.get('orgId') && d.get('orgId') !== orgId);
    say(`  ${c.padEnd(16)} ${String(mine).padStart(6)} records${missing.length ? `, ${missing.length} WITHOUT a client` : ''}${other.length ? `, ${other.length} of other clients` : ''}`);
    for (const d of missing) strays.push(`${c}/${d.id} has no orgId`);
    if (other.length && !already) for (const d of other) strays.push(`${c}/${d.id} belongs to "${d.get('orgId')}"`);
  }
  if (strays.length) stop(`Some records don't belong to ${orgId}:\n  ${strays.slice(0, 20).join('\n  ')}${strays.length > 20 ? `\n  …and ${strays.length - 20} more` : ''}\nNothing was changed. Send this list to your developer.`);

  say('\nChecking every evidence chain…');
  const before = await checkChains(db, orgId);
  say(`  ${before.records} evidence records for ${before.people} people.`);
  if (before.problems.length) stop(`Some evidence chains are already broken (this must be looked at before moving):\n  ${before.problems.join('\n  ')}\nNothing was changed.`);
  const fpBefore = await evidenceFingerprint(db, orgId);
  say(`  Fingerprint of ${fpBefore.records} protected records: ${fpBefore.hash.slice(0, 16)}…`);

  const code = await codeRef(db, loginCode).get();
  if (code.exists && code.get('orgId') !== orgId) stop(`The client code ${loginCode} already belongs to "${code.get('orgId')}".`);
  for (const h of hosts) {
    const d = await domainRef(db, h).get();
    if (d.exists && d.get('orgId') !== orgId) stop(`${h} already belongs to "${d.get('orgId')}".`);
  }

  const fields = {
    status: org.status || 'active', statusReason: org.statusReason ?? null,
    clientNo: org.clientNo ?? 1, loginCode: org.loginCode || loginCode, docPrefix: org.docPrefix || docPrefix, staffNoPrefix: org.staffNoPrefix ?? staffNoPrefix,
    domains: [...new Set([...(org.domains || []), ...hosts])], legacyStorage: true, groupId: org.groupId || null,
    branding: org.branding ? cleanBranding(org.branding) : cleanBranding(branding), createdAt: org.createdAt || org.updatedAt || now(),
  };
  say(`\nPlan:\n  client number ${fields.clientNo}, sign-in code ${fields.loginCode}, document prefix ${fields.docPrefix}, staff numbers ${fields.staffNoPrefix}…`);
  say(`  web addresses that open ${org.name} directly: ${fields.domains.length ? fields.domains.join(', ') : '(none; everyone uses the client code)'}`);
  say(`  existing files stay where they are (allowed for this client only)`);
  if (!apply) { say('\nDry run: nothing was changed. Run again with --apply to make these changes.'); return { applied: false, before: fpBefore }; }

  await db.runTransaction(async t => {
    const counterRef = db.collection('counters').doc('platform');
    const reads = await Promise.all([t.get(counterRef), t.get(codeRef(db, fields.loginCode)), ...hosts.map(h => t.get(domainRef(db, h)))]);
    const [counter, codeNow, ...hostSnaps] = reads;
    const next = counter.exists ? counter.get('nextClientNo') : 1;
    t.set(counterRef, { nextClientNo: Math.max(next, fields.clientNo + 1) }, { merge: true });
    if (!codeNow.exists) t.create(codeRef(db, fields.loginCode), { orgId });
    hosts.forEach((h, i) => { if (!hostSnaps[i].exists) t.create(domainRef(db, h), { orgId, addedAt: now() }); });
    t.update(db.collection('orgs').doc(orgId), { ...fields, migratedAt: org.migratedAt || now(), updatedAt: now() });
    t.create(db.collection('auditLog').doc(), { orgId, actorId: null, actorName: 'Platform', action: 'client.migrate', entity: 'organisation', entityId: orgId,
      details: { clientNo: fields.clientNo, loginCode: fields.loginCode, domains: fields.domains, evidenceFingerprint: fpBefore.hash }, ip: null, at: now() });
    t.create(db.collection('platformAudit').doc(), { adminId: null, adminName: 'Migration script', action: 'client.migrate', orgId,
      details: { clientNo: fields.clientNo, loginCode: fields.loginCode, evidenceFingerprint: fpBefore.hash }, ip: null, at: now() });
  });
  invalidate(db);

  say('\nChecking again after the move…');
  const after = await checkChains(db, orgId);
  const fpAfter = await evidenceFingerprint(db, orgId);
  if (after.problems.length || fpAfter.hash !== fpBefore.hash || after.records !== before.records)
    stop(`STOP: the check after the move does not match (${fpAfter.hash.slice(0, 16)}… vs ${fpBefore.hash.slice(0, 16)}…). Do not deploy. Send this output to your developer.`);
  say(`  All ${after.records} evidence records check out; fingerprint unchanged (${fpAfter.hash.slice(0, 16)}…).`);
  say(`\nDone. ${org.name} is client number ${fields.clientNo}.`);
  return { applied: true, before: fpBefore, after: fpAfter, fields };
}
