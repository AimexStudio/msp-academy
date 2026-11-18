// Sign-in with staff number + PIN, server-side sessions, lockouts and role checks.
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from './config.js';
import { getOrg, orgIdForHost, requestHost, isActive } from './tenancy.js';

// Firebase Hosting only passes a cookie called __session through to Cloud Functions.
export const COOKIE = '__session';
const MAX_SESSION_HOURS = 12;
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
let dummyHash = null;

export const now = () => new Date().toISOString();
export const validPin = pin => /^\d{4,6}$/.test(String(pin || ''));
export const hashPin = pin => argon2.hash(String(pin), ARGON);
export const normStaffNo = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
export const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
export const isManagerish = role => ['manager', 'hod', 'auditor', 'support'].includes(role);
export const idleSecondsFor = role => (isManagerish(role) ? config.idleMinutes.manager : config.idleMinutes.staff) * 60;
const secondsSince = iso => (iso ? (Date.now() - new Date(iso).getTime()) / 1000 : Infinity);

/**
 * Lockout ladder per staff number, counted since the last successful sign-in or PIN reset:
 *   5 wrong PINs -> 60 seconds (spec section 5); 10 -> 15 minutes; 15 -> until a manager resets the PIN.
 * Per device/IP: 30 failures within 15 minutes blocks that IP for 15 minutes.
 */
export function lockFor(state, ip) {
  const fails = state.fails || 0, since = secondsSince(state.lastFailAt);
  if (fails >= 15) return { locked: true, permanent: true };
  if (fails >= 10 && since < 900) return { locked: true, retryIn: 900 - since };
  if (fails >= 5 && since < 60) return { locked: true, retryIn: 60 - since };
  if (ip && (ip.fails || 0) >= 30 && secondsSince(ip.windowStart) < 900) return { locked: true, retryIn: 900 };
  return { locked: false };
}
const lockMessage = l => l.permanent ? 'Sign-in is blocked after too many wrong PINs. Ask your manager to reset your PIN.'
  : l.retryIn > 90 ? `Too many attempts. Try again in ${Math.ceil(l.retryIn / 60)} minutes.` : 'Too many attempts. Wait a minute, then try again.';

export const staffNoRef = (db, orgId, no) => db.collection('staffNumbers').doc(`${orgId}_${no}`);
const loginRef = (db, orgId, no) => db.collection('loginState').doc(`${orgId}_${no}`);
const ipRef = (db, ip) => db.collection('ipState').doc(sha(ip || 'unknown').slice(0, 32));

export async function login(db, { orgId, staffNo, pin, ip, userAgent }) {
  staffNo = normStaffNo(staffNo);
  if (!staffNo || !validPin(pin)) return { ok: false, error: 'Enter your staff number and your 4 to 6 digit PIN.' };
  const map = await staffNoRef(db, orgId, staffNo).get();
  const stSnap = map.exists ? await db.collection('staff').doc(map.get('staffId')).get() : null;
  // The staff-number map is keyed by client; the record must belong to the same client too.
  const st = stSnap && stSnap.exists && stSnap.get('orgId') === orgId ? stSnap.data() : null;
  const [ls, is] = await Promise.all([loginRef(db, orgId, staffNo).get(), ipRef(db, ip).get()]);
  const state = ls.exists ? ls.data() : {};
  const event = (success, reason) => db.collection('loginEvents').add({ orgId, staffNo, staffId: stSnap && stSnap.exists ? stSnap.id : null, success, reason, ip: ip || null, userAgent: userAgent || null, at: now() });
  const lock = lockFor(state, is.exists ? is.data() : null);
  if (lock.locked) { await event(false, 'locked'); return { ok: false, locked: true, error: lockMessage(lock) }; }

  dummyHash ||= await hashPin('000000');
  const good = await argon2.verify(st ? st.pinHash : dummyHash, String(pin)).catch(() => false);
  if (!st || !good) {
    const fails = (state.fails || 0) + 1;
    await loginRef(db, orgId, staffNo).set({ fails, lastFailAt: now() }, { merge: true });
    const ipd = is.exists ? is.data() : {};
    const fresh = secondsSince(ipd.windowStart) > 900;
    await ipRef(db, ip).set({ fails: fresh ? 1 : (ipd.fails || 0) + 1, windowStart: fresh ? now() : ipd.windowStart }, { merge: true });
    await event(false, 'bad_pin');
    if (fails % 5 === 0) return { ok: false, locked: true, error: lockMessage(lockFor({ fails, lastFailAt: now() })) };
    const left = 5 - (fails % 5);
    return { ok: false, error: left <= 2
      ? `That staff number and PIN don't match. ${left} more ${left === 1 ? 'try' : 'tries'} before sign-in is paused.`
      : "That staff number and PIN don't match. Check both and try again." };
  }
  if (!st.active) { await event(false, 'inactive'); return { ok: false, error: 'Your profile is no longer active. Speak to your manager.' }; }
  await loginRef(db, orgId, staffNo).set({ fails: 0, lastFailAt: null, lastOkAt: now() });
  await event(true, null);
  const updates = { lastLoginAt: now() };
  if (argon2.needsRehash(st.pinHash, ARGON)) updates.pinHash = await hashPin(pin);
  await stSnap.ref.update(updates);
  const token = crypto.randomBytes(32).toString('base64url');
  await db.collection('sessions').doc(sha(token)).set({ kind: 'staff', staffId: stSnap.id, orgId, createdAt: now(), lastSeenAt: now(),
    idleSeconds: idleSecondsFor(st.role), revokedAt: null, ip: ip || null, userAgent: userAgent || null });
  return { ok: true, token, staffId: stSnap.id };
}

/** Count a failed lookup (e.g. an unknown client code) against this device's IP. Returns true if it is blocked. */
export async function noteIpFailure(db, ip) {
  const is = await ipRef(db, ip).get();
  const ipd = is.exists ? is.data() : {};
  if (lockFor({}, ipd).locked) return true;
  const fresh = secondsSince(ipd.windowStart) > 900;
  await ipRef(db, ip).set({ fails: fresh ? 1 : (ipd.fails || 0) + 1, windowStart: fresh ? now() : ipd.windowStart }, { merge: true });
  return false;
}

/** Clear the lockout after a PIN reset. */
export const clearLockout = (db, orgId, staffNo) => loginRef(db, orgId, normStaffNo(staffNo)).set({ fails: 0, lastFailAt: null });

/**
 * Look up the session behind a cookie. Two kinds:
 *   staff     a client's staff member (or manager); bound to that client
 *   platform  a platform admin; optionally visiting one client (read-only support, or authoring the library)
 */
export async function resolveSession(db, token) {
  if (!token) return null;
  const ref = db.collection('sessions').doc(sha(token));
  const s = await ref.get();
  if (!s.exists) return null;
  const d = s.data();
  if (d.revokedAt) return null;
  if (secondsSince(d.lastSeenAt) > d.idleSeconds || secondsSince(d.createdAt) > MAX_SESSION_HOURS * 3600) {
    await ref.update({ revokedAt: now() });
    return { expired: true };
  }
  if (d.kind === 'platform') {
    const a = await db.collection('platformAdmins').doc(d.adminId).get();
    if (!a.exists || !a.get('active')) return null;
    return { ref, kind: 'platform', lastSeenAt: d.lastSeenAt, idleSeconds: d.idleSeconds, support: d.support || null,
      admin: { id: a.id, name: a.get('name'), email: a.get('email') } };
  }
  const st = await db.collection('staff').doc(d.staffId).get();
  if (!st.exists || !st.get('active')) return null;
  const x = st.data();
  if (x.orgId !== d.orgId) return null; // a session never moves between clients
  return { ref, kind: 'staff', orgId: x.orgId, lastSeenAt: d.lastSeenAt, idleSeconds: d.idleSeconds,
    staff: { id: st.id, orgId: x.orgId, staffNo: x.staffNo, name: x.name, positionId: x.positionId, role: x.role } };
}

export async function revokeAllFor(db, staffId) {
  const q = await db.collection('sessions').where('staffId', '==', staffId).get();
  const b = db.batch(); let n = 0;
  q.forEach(s => { if (!s.get('revokedAt')) { b.update(s.ref, { revokedAt: now() }); n++; } });
  if (n) await b.commit();
}

// While a platform admin visits a client as support, only these writes are allowed.
const SUPPORT_WRITES = new Set(['/api/auth/logout', '/api/auth/keepalive']);

/**
 * Every /api request: work out who is asking and which client they belong to.
 *   req.session   the signed-in person (staff, or a platform admin's support/author identity), or null
 *   req.orgId     their client. Set only from the session, never from the request.
 *   req.platform  the platform admin, for /api/platform routes
 *   req.hostOrgId the client registered to this web address, if any (sign-in page hint only)
 */
export function authHooks(app, db) {
  app.decorateRequest('session', null);
  app.decorateRequest('orgId', null);
  app.decorateRequest('platform', null);
  app.decorateRequest('hostOrgId', null);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-pelagos'] !== '1') return reply.code(403).send({ error: 'Request blocked.' });
    req.hostOrgId = await orgIdForHost(db, requestHost(req));
    const s = await resolveSession(db, req.cookies[COOKIE]);
    if (s && s.expired) { req.sessionExpired = true; return; }
    if (!s) return;
    const touch = async () => { if (!req.headers['x-pelagos-passive'] && secondsSince(s.lastSeenAt) > 10) await s.ref.update({ lastSeenAt: now() }); };

    if (s.kind === 'platform') {
      // Platform admins only ever sign in on the shared address, never on a client's own.
      if (req.hostOrgId) return;
      req.platform = { ...s.admin, sessionRef: s.ref, support: s.support };
      const sup = s.support;
      if (sup && sup.mode === 'author' && new Date(sup.until) > new Date()) {
        // Building courses in the MSP Academy library: full editing, but only ever inside the library.
        const org = await getOrg(db, sup.orgId);
        if (org && org.library) {
          req.orgId = org.id;
          req.session = { ref: s.ref, kind: 'author', lastSeenAt: s.lastSeenAt, idleSeconds: s.idleSeconds, support: sup,
            staff: { id: `platform:${s.admin.id}`, orgId: org.id, staffNo: '', name: s.admin.name, positionId: null, role: 'manager' } };
        }
      } else if (sup && new Date(sup.until) > new Date()) {
        const org = await getOrg(db, sup.orgId);
        if (org) {
          req.orgId = org.id;
          req.session = { ref: s.ref, kind: 'support', lastSeenAt: s.lastSeenAt, idleSeconds: s.idleSeconds, support: sup,
            staff: { id: `support:${s.admin.id}`, orgId: org.id, staffNo: '', name: s.admin.name, positionId: null, role: 'support' } };
          const path = req.url.split('?')[0];
          const platformPath = path.startsWith('/api/platform/');
          if (!['GET', 'HEAD'].includes(req.method) && !platformPath && !SUPPORT_WRITES.has(path)) return reply.code(403).send({ error: 'Support access is read-only.' });
          // Every look at the client's data during the visit is recorded, for the client to see.
          if (!platformPath) await db.collection('supportLog').add({ orgId: org.id, grantId: sup.grantId, adminId: s.admin.id, method: req.method, path: path.slice(0, 300), at: now() });
        }
      }
      await touch();
      return;
    }

    // A staff session works only for its own client: not on another client's address, not while suspended.
    if (req.hostOrgId && req.hostOrgId !== s.orgId) return;
    const org = await getOrg(db, s.orgId);
    if (!isActive(org)) { req.orgSuspended = true; return; }
    req.session = s;
    req.orgId = s.orgId;
    await touch();
  });
}

export function requireAuth(req, reply) {
  if (!req.session) {
    if (req.orgSuspended) { reply.code(403).send({ error: 'This training portal is paused. Speak to your manager.', suspended: true }); return false; }
    reply.code(401).send({ error: req.sessionExpired ? 'You were signed out after a period without activity.' : 'Sign in first.', expired: !!req.sessionExpired });
    return false;
  }
  return true;
}
export function requireRole(req, reply, roles) {
  if (!requireAuth(req, reply)) return false;
  if (!roles.includes(req.session.staff.role)) { reply.code(403).send({ error: "You don't have access to that." }); return false; }
  return true;
}
export const cookieOptions = () => ({ path: '/', httpOnly: true, sameSite: 'strict', secure: config.production });
/** Platform admin routes: a platform session on the shared address. */
export function requirePlatform(req, reply) {
  if (!req.platform) { reply.code(req.sessionExpired ? 401 : 404).send({ error: req.sessionExpired ? 'You were signed out after a period without activity.' : 'Not found.', expired: !!req.sessionExpired }); return false; }
  return true;
}
/** The staff journey (reading, quizzes, signing, courses): real staff only, never a support or author visit. */
export function requireStaff(req, reply) {
  if (!requireAuth(req, reply)) return false;
  if (req.session.kind !== 'staff') { reply.code(403).send({ error: 'Support access cannot take part in training.' }); return false; }
  return true;
}
