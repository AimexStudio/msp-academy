// The platform operator's side: platform admin accounts, creating and managing clients, support access.
// Platform admins are not staff of any client. They sign in with email, a password and a 6-digit code
// from an authenticator app, and everything they do is written to platformAudit (and, where it
// concerns a client, to that client's own audit log as well).
//
//   platformAdmins/{id}     email, name, password hash, authenticator secret, active
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
export const PLATFORM_IDLE_SECONDS = 15 * 60;
export const SUPPORT_MAX_MINUTES = 120;
export const normEmail = s => String(s || '').trim().toLowerCase();
export const validEmail = s => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(String(s || ''));
export const validPassword = s => typeof s === 'string' && s.length >= 12 && s.length <= 200;

/* ---------- authenticator codes (TOTP, RFC 6238: 30 seconds, 6 digits, SHA-1) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) { const i = B32.indexOf(ch); if (i < 0) throw new Error('bad base32'); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
export function totpAt(secret, step, digits = 6) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits;
  return String(n).padStart(digits, '0');
}
export const totpStep = (ms = Date.now()) => Math.floor(ms / 1000 / 30);
/** The step a code matches (allowing one step either side for clock drift), or null. */
export function matchTotp(secret, code, ms = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const s = totpStep(ms);
  for (const d of [0, -1, 1]) {
    const a = Buffer.from(totpAt(secret, s + d)), b = Buffer.from(String(code));
    if (crypto.timingSafeEqual(a, b)) return s + d;
  }
  return null;
}
export const otpauthUri = (secret, email, issuer = 'MSP Academy') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/* ---------- audit ---------- */
export function platformAuditRecord(admin, action, details = {}, { orgId = null, ip = null } = {}) {
  return { adminId: admin ? admin.id : null, adminName: admin ? admin.name : null, action, orgId, details, ip, at: now() };
}
export const platformAudit = (db, ...a) => db.collection('platformAudit').add(platformAuditRecord(...a));
/** The entry that goes into the client's own audit log, so the client can see what the platform did. */
export const clientAuditFromPlatform = (orgId, admin, action, entity, entityId, details, ip) =>
  ({ ...auditRecord(orgId, null, action, entity, entityId, details, ip), actorName: admin ? `${admin.name} (platform)` : 'Platform' });

/* ---------- admin accounts ---------- */
export async function createPlatformAdmin(db, { email, name, password, totpSecret = newTotpSecret(), requireTotp = true }) {
  email = normEmail(email);
  if (!validEmail(email)) throw httpError(400, 'Enter a valid email address.');
  if (!String(name || '').trim()) throw httpError(400, 'Enter the name.');
  if (!validPassword(password)) throw httpError(400, 'The password must be at least 12 characters.');
  const ref = db.collection('platformAdmins').doc();
  const passwordHash = await argon2.hash(password, ARGON);
  await db.runTransaction(async t => {
    const e = await t.get(db.collection('platformAdminEmails').doc(email));
    if (e.exists) throw httpError(400, `${email} is already a platform admin.`);
    t.create(ref, { email, name: String(name).trim(), passwordHash, totpSecret: requireTotp ? totpSecret : null, lastTotpStep: 0,
      active: true, createdAt: now(), lastLoginAt: null });
    t.create(db.collection('platformAdminEmails').doc(email), { adminId: ref.id });
    t.create(db.collection('platformAudit').doc(), platformAuditRecord(null, 'platform_admin.create', { email, name }));
  });
  return { id: ref.id, totpSecret: requireTotp ? totpSecret : null };
}

const platLoginRef = (db, email) => db.collection('loginState').doc(`platform_${sha(email).slice(0, 32)}`);
const ipRef = (db, ip) => db.collection('ipState').doc(sha(ip || 'unknown').slice(0, 32));
let dummy = null;

/**
 * Sign in a platform admin. Same lockout ladder as staff. Live, an authenticator code is always
 * required; an admin without one can only sign in on the emulators (the local demo admin).
 */
export async function platformLogin(db, { email, password, code, ip, userAgent, production }) {
  email = normEmail(email);
  const fail = { ok: false, error: "That email, password and code don't match." };
  if (!validEmail(email) || typeof password !== 'string' || !password) return fail;
  const map = await db.collection('platformAdminEmails').doc(email).get();
  const adminSnap = map.exists ? await db.collection('platformAdmins').doc(map.get('adminId')).get() : null;
  const a = adminSnap && adminSnap.exists ? adminSnap.data() : null;
  const [ls, is] = await Promise.all([platLoginRef(db, email).get(), ipRef(db, ip).get()]);
  const state = ls.exists ? ls.data() : {};
  const event = (success, reason) => db.collection('platformLoginEvents').add({ email, adminId: adminSnap && adminSnap.exists ? adminSnap.id : null, success, reason, ip: ip || null, userAgent: userAgent || null, at: now() });
  const lock = lockFor(state, is.exists ? is.data() : null);
  if (lock.locked) { await event(false, 'locked'); return { ok: false, locked: true, error: lock.permanent ? 'Sign-in is blocked for this account. Another platform admin must reset it.' : 'Too many attempts. Wait, then try again.' }; }
  dummy ||= await argon2.hash('not-a-real-password', ARGON);
  const pwOk = await argon2.verify(a ? a.passwordHash : dummy, password).catch(() => false);
  let step = null;
  if (a && pwOk) {
    if (a.totpSecret) step = matchTotp(a.totpSecret, code);
    else if (!production) step = 0; // local demo admin without an authenticator
  }
  const replay = step !== null && a.totpSecret && step <= (a.lastTotpStep || 0);
  if (!a || !pwOk || step === null || replay || !a.active) {
    const fails = (state.fails || 0) + 1;
    await platLoginRef(db, email).set({ fails, lastFailAt: now() }, { merge: true });
    const ipd = is.exists ? is.data() : {};
    const fresh = !ipd.windowStart || (Date.now() - new Date(ipd.windowStart).getTime()) / 1000 > 900;
    await ipRef(db, ip).set({ fails: fresh ? 1 : (ipd.fails || 0) + 1, windowStart: fresh ? now() : ipd.windowStart }, { merge: true });
    await event(false, !a || !pwOk ? 'bad_password' : replay ? 'code_reused' : !a.active ? 'inactive' : 'bad_code');
    return fail;
  }
  await platLoginRef(db, email).set({ fails: 0, lastFailAt: null, lastOkAt: now() });
  await adminSnap.ref.update({ lastLoginAt: now(), ...(a.totpSecret ? { lastTotpStep: step } : {}) });
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
