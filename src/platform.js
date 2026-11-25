// The platform operator's side: platform admin accounts, creating and managing clients, support access.
// Platform admins are not staff of any client. They sign in with an email and a password (stored in
// Firestore, hashed with argon2id), and everything they do is written to platformAudit (and, where it
// concerns a client, to that client's own audit log as well).
//
//   platformAdmins/{id}     email, name, password hash, active
//   platformAdminEmails/{e} email -> admin id (keeps emails unique)
//   platformAudit/{id}      every platform action
//   supportGrants/{id}      each support visit: who, which client, why, from when until when
//   supportLog/{id}         each request made during a support visit
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { hashPin, normStaffNo, staffNoRef, sha, now, lockFor } from './auth.js';
import { auditRecord, httpError } from './documents.js';
import { CLIENT_CODE_RE, DOC_PREFIX_RE, STAFF_PREFIX_RE, ORG_ID_RE, normCode, codeRef, orgRef, cleanBranding, starterConfig, invalidate } from './tenancy.js';

const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const PLATFORM_IDLE_SECONDS = 4 * 3600; // 4 hours without activity (sessions still end after 12 hours)
export const SUPPORT_MAX_MINUTES = 120;
export const normEmail = s => String(s || '').trim().toLowerCase();
export const validEmail = s => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(String(s || ''));
export const validPassword = s => typeof s === 'string' && s.length >= 12 && s.length <= 200;

/* ---------- audit ---------- */
export function platformAuditRecord(admin, action, details = {}, { orgId = null, ip = null } = {}) {
  return { adminId: admin ? admin.id : null, adminName: admin ? admin.name : null, action, orgId, details, ip, at: now() };
}
export const platformAudit = (db, ...a) => db.collection('platformAudit').add(platformAuditRecord(...a));
/** The entry that goes into the client's own audit log, so the client can see what the platform did. */
export const clientAuditFromPlatform = (orgId, admin, action, entity, entityId, details, ip) =>
  ({ ...auditRecord(orgId, null, action, entity, entityId, details, ip), actorName: admin ? `${admin.name} (platform)` : 'Platform' });

/* ---------- admin accounts ---------- */
export async function createPlatformAdmin(db, { email, name, password }) {
  email = normEmail(email);
  if (!validEmail(email)) throw httpError(400, 'Enter a valid email address.');
  if (!String(name || '').trim()) throw httpError(400, 'Enter the name.');
  if (!validPassword(password)) throw httpError(400, 'The password must be at least 12 characters.');
  const ref = db.collection('platformAdmins').doc();
  const passwordHash = await argon2.hash(password, ARGON);
  await db.runTransaction(async t => {
    const e = await t.get(db.collection('platformAdminEmails').doc(email));
    if (e.exists) throw httpError(400, `${email} is already a platform admin.`);
    t.create(ref, { email, name: String(name).trim(), passwordHash, active: true, createdAt: now(), lastLoginAt: null });
    t.create(db.collection('platformAdminEmails').doc(email), { adminId: ref.id });
    t.create(db.collection('platformAudit').doc(), platformAuditRecord(null, 'platform_admin.create', { email, name }));
  });
  return { id: ref.id };
}

/** Give an existing platform admin a new password (and switch the account back on). Ends their sessions. */
export async function setPlatformAdminPassword(db, { email, password }) {
  email = normEmail(email);
  if (!validPassword(password)) throw httpError(400, 'The password must be at least 12 characters.');
  const map = await db.collection('platformAdminEmails').doc(email).get();
  if (!map.exists) throw httpError(404, `${email} is not a platform admin.`);
  const ref = db.collection('platformAdmins').doc(map.get('adminId'));
  await ref.update({ passwordHash: await argon2.hash(password, ARGON), active: true, passwordSetAt: now() });
  await platLoginRef(db, email).set({ fails: 0, lastFailAt: null });
  const sessions = await db.collection('sessions').where('adminId', '==', ref.id).get();
  for (const x of sessions.docs) if (!x.get('revokedAt')) await x.ref.update({ revokedAt: now() });
  await db.collection('platformAudit').add(platformAuditRecord(null, 'platform_admin.password_set', { email }));
  return { id: ref.id };
}

const platLoginRef = (db, email) => db.collection('loginState').doc(`platform_${sha(email).slice(0, 32)}`);
const ipRef = (db, ip) => db.collection('ipState').doc(sha(ip || 'unknown').slice(0, 32));
let dummy = null;

/** Sign in a platform admin with email and password. Same lockout ladder as staff, plus the per-device limit. */
export async function platformLogin(db, { email, password, ip, userAgent }) {
  email = normEmail(email);
  const fail = { ok: false, error: "That email and password don't match." };
  if (!validEmail(email) || typeof password !== 'string' || !password) return fail;
  const map = await db.collection('platformAdminEmails').doc(email).get();
  const adminSnap = map.exists ? await db.collection('platformAdmins').doc(map.get('adminId')).get() : null;
  const a = adminSnap && adminSnap.exists ? adminSnap.data() : null;
  const [ls, is] = await Promise.all([platLoginRef(db, email).get(), ipRef(db, ip).get()]);
  const state = ls.exists ? ls.data() : {};
  const event = (success, reason) => db.collection('platformLoginEvents').add({ email, adminId: adminSnap && adminSnap.exists ? adminSnap.id : null, success, reason, ip: ip || null, userAgent: userAgent || null, at: now() });
  const lock = lockFor(state, is.exists ? is.data() : null);
  if (lock.locked) { await event(false, 'locked'); return { ok: false, locked: true, error: lock.permanent ? 'Sign-in is blocked for this account. Set a new password with npm run platform-admin.' : 'Too many attempts. Wait, then try again.' }; }
  dummy ||= await argon2.hash('not-a-real-password', ARGON);
  const pwOk = await argon2.verify(a ? a.passwordHash : dummy, password).catch(() => false);
  if (!a || !pwOk || !a.active) {
    const fails = (state.fails || 0) + 1;
    await platLoginRef(db, email).set({ fails, lastFailAt: now() }, { merge: true });
    const ipd = is.exists ? is.data() : {};
    const fresh = !ipd.windowStart || (Date.now() - new Date(ipd.windowStart).getTime()) / 1000 > 900;
    await ipRef(db, ip).set({ fails: fresh ? 1 : (ipd.fails || 0) + 1, windowStart: fresh ? now() : ipd.windowStart }, { merge: true });
    await event(false, !a || !pwOk ? 'bad_password' : 'inactive');
    return fail;
  }
  await platLoginRef(db, email).set({ fails: 0, lastFailAt: null, lastOkAt: now() });
  await adminSnap.ref.update({ lastLoginAt: now() });
  await event(true, null);
  const token = crypto.randomBytes(32).toString('base64url');
  await db.collection('sessions').doc(sha(token)).set({ kind: 'platform', adminId: adminSnap.id, orgId: null, staffId: null,
    createdAt: now(), lastSeenAt: now(), idleSeconds: PLATFORM_IDLE_SECONDS, revokedAt: null, support: null, ip: ip || null, userAgent: userAgent || null });
  return { ok: true, token, adminId: adminSnap.id };
}

/* ---------- clients ---------- */
export const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

/**
 * Create a client with its first manager, in one transaction: the client number, the sign-in code,
 * the organisation and the manager either all exist afterwards or none do.
 */
export async function createClient(db, admin, input, { ip = null } = {}) {
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  const loginCode = normCode(input.loginCode);
  const docPrefix = String(input.docPrefix || '').trim().toUpperCase();
  const staffNoPrefix = String(input.staffNoPrefix ?? '').trim().toUpperCase();
  const m = input.manager || {};
  const mgrName = String(m.name || '').trim().replace(/\s+/g, ' ');
  const mgrNo = normStaffNo(m.staffNo);
  if (name.length < 2) throw httpError(400, 'Enter the client’s name.');
  if (!CLIENT_CODE_RE.test(loginCode)) throw httpError(400, 'The client code is 3 to 20 letters and numbers, e.g. HARBOUR.');
  if (!DOC_PREFIX_RE.test(docPrefix)) throw httpError(400, 'The document code prefix is 2 to 8 capital letters or numbers, starting with a letter, e.g. HBR.');
  if (!STAFF_PREFIX_RE.test(staffNoPrefix)) throw httpError(400, 'The staff number prefix is up to 6 letters, e.g. HB.');
  if (mgrName.length < 2) throw httpError(400, 'Enter the first manager’s full name.');
  if (!/^[A-Z0-9-]{2,30}$/.test(mgrNo)) throw httpError(400, 'Enter the first manager’s staff number.');
  if (!/^\d{6}$/.test(String(m.pin || ''))) throw httpError(400, 'The first manager’s PIN must be 6 digits.');
  const orgId = input.orgId || slugify(name);
  if (!ORG_ID_RE.test(orgId)) throw httpError(400, 'The client name needs at least two letters or numbers.');
  const pinHash = await hashPin(m.pin);
  const start = starterConfig(name);
  const staffRef = db.collection('staff').doc();
  const result = await db.runTransaction(async t => {
    const counterRef = db.collection('counters').doc('platform');
    const [counter, code, existing] = await Promise.all([t.get(counterRef), t.get(codeRef(db, loginCode)), t.get(orgRef(db, orgId))]);
    if (code.exists) throw httpError(400, `The client code ${loginCode} is already used by another client.`);
    if (existing.exists) throw httpError(400, `There is already a client called ${name}. Use a slightly different name.`);
    const clientNo = counter.exists ? counter.get('nextClientNo') : 1;
    const at = now();
    t.set(counterRef, { nextClientNo: clientNo + 1 }, { merge: true });
    t.create(codeRef(db, loginCode), { orgId });
    t.create(orgRef(db, orgId), {
      name, courseTitle: start.courseTitle, declarationText: start.declarationText, departments: start.departments, positions: start.positions,
      status: 'active', statusReason: null, clientNo, loginCode, docPrefix, staffNoPrefix, domains: [], legacyStorage: false, groupId: input.groupId || null,
      branding: cleanBranding({ ...(input.branding || {}), wordmark: (input.branding && input.branding.wordmark) || name.split(/\s+/)[0].toUpperCase().slice(0, 24), subtitle: (input.branding && input.branding.subtitle) || '' }),
      createdAt: at, createdBy: admin ? admin.id : null, updatedAt: at,
    });
    t.create(staffRef, { orgId, staffNo: mgrNo, name: mgrName, positionId: 'manager', role: 'manager', active: true, startDate: null, leftAt: null,
      pinHash, pinSetAt: at, lastLoginAt: null, createdAt: at, updatedAt: at, chainHead: null, chainSeq: 0 });
    t.create(staffNoRef(db, orgId, mgrNo), { staffId: staffRef.id, orgId });
    t.create(db.collection('positionHistory').doc(), { orgId, staffId: staffRef.id, from: null, to: 'manager', by: null, at });
    t.create(db.collection('auditLog').doc(), clientAuditFromPlatform(orgId, admin, 'client.create', 'organisation', orgId, { clientNo, loginCode, firstManager: mgrNo }, ip));
    t.create(db.collection('platformAudit').doc(), platformAuditRecord(admin, 'client.create', { name, clientNo, loginCode, docPrefix, firstManager: mgrNo }, { orgId, ip }));
    return { orgId, clientNo, loginCode, managerId: staffRef.id };
  });
  invalidate(db);
  return result;
}
