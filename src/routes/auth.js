import { login, requireAuth, COOKIE, cookieOptions, now, sha, noteIpFailure } from '../auth.js';
import { loadOrg } from '../course.js';
import { config } from '../config.js';
import { getOrg, orgIdForCode, publicBranding, isActive } from '../tenancy.js';

export default async function (app) {
  const { db } = app;
  const unknown = "We don't recognise that client code. Check it with your manager.";

  // Which client this sign-in is for: the web address if it belongs to a client, otherwise the code.
  async function clientFor(req, code) {
    if (req.hostOrgId) return { org: await getOrg(db, req.hostOrgId), byHost: true };
    if (!String(code || '').trim()) return { error: 'Enter your client code.', status: 400 };
    const id = await orgIdForCode(db, code);
    const org = id && await getOrg(db, id);
    if (!org) {
      const blocked = await noteIpFailure(db, req.ip);
      return { error: blocked ? 'Too many attempts. Try again in 15 minutes.' : unknown, status: blocked ? 429 : 404 };
    }
    return { org };
  }

  /** Branding for the sign-in page: by web address, or by the client code the device remembers. */
  app.get('/api/branding', async (req, reply) => {
    if (!req.hostOrgId && !req.query.code) return { client: null, byHost: false };
    const r = await clientFor(req, req.query.code);
    if (r.error || !r.org) return reply.code(r.status || 404).send({ error: r.error || unknown });
    return { client: { ...publicBranding(r.org), loginCode: r.byHost ? null : r.org.loginCode, active: isActive(r.org) }, byHost: !!r.byHost };
  });

  app.get('/api/branding/logo/:fileId', async (req, reply) => {
    const id = String(req.params.fileId);
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return reply.code(404).send({ error: 'Not found.' });
    const f = await db.collection('files').doc(id).get();
    if (!f.exists || f.get('kind') !== 'logo') return reply.code(404).send({ error: 'Not found.' });
    const org = await getOrg(db, f.get('orgId'));
    if (!org || (org.branding || {}).logoFileId !== id) return reply.code(404).send({ error: 'Not found.' });
    reply.header('Content-Type', f.get('mime')).header('Cache-Control', 'public, max-age=86400').header('X-Content-Type-Options', 'nosniff');
    return reply.send(await app.storage.getBuffer(f.get('storageKey')));
  });

  app.post('/api/auth/login', {
    schema: { body: { type: 'object', required: ['staffNo', 'pin'], properties: {
      clientCode: { type: 'string', maxLength: 40 }, staffNo: { type: 'string', maxLength: 40 }, pin: { type: 'string', maxLength: 12 } } } },
  }, async (req, reply) => {
    const c = await clientFor(req, req.body.clientCode);
    if (c.error) return reply.code(c.status).send({ error: c.error });
    if (!isActive(c.org)) return reply.code(403).send({ error: 'This training portal is paused. Speak to your manager.', suspended: true });
    const r = await login(db, { orgId: c.org.id, staffNo: req.body.staffNo, pin: req.body.pin, ip: req.ip, userAgent: req.headers['user-agent'] });
    if (!r.ok) return reply.code(r.locked ? 429 : 401).send({ error: r.error, locked: !!r.locked });
    // One person per browser: whoever was signed in here before is signed out.
    const old = req.cookies[COOKIE];
    if (old) await db.collection('sessions').doc(sha(old)).update({ revokedAt: now() }).catch(() => {});
    reply.setCookie(COOKIE, r.token, cookieOptions());
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const tok = req.cookies[COOKIE];
    if (tok) await db.collection('sessions').doc(sha(tok)).update({ revokedAt: now() }).catch(() => {});
    reply.clearCookie(COOKIE, cookieOptions());
    return { ok: true };
  });

  // Called by the page while someone is actively reading, so a long read doesn't count as idle.
  app.post('/api/auth/keepalive', async (req, reply) => {
    if (req.platform && !req.session) return { ok: true, idleSeconds: 900 };
    if (!requireAuth(req, reply)) return;
    return { ok: true, idleSeconds: req.session.idleSeconds };
  });

  app.get('/api/me', async (req) => {
    if (!req.session) return { staff: null, expired: !!req.sessionExpired, suspended: !!req.orgSuspended, platform: req.platform ? { name: req.platform.name } : null };
    const org = await loadOrg(db, req.orgId);
    const s = req.session.staff;
    const support = req.session.kind === 'support', author = req.session.kind === 'author';
    return {
      staff: { id: s.id, name: s.name, staffNo: s.staffNo, positionId: s.positionId, role: s.role,
        positionName: support ? 'Platform support' : author ? 'MSP Academy author' : org.posName(s.positionId), deptId: org.deptOf(s.positionId), deptName: org.deptName(org.deptOf(s.positionId)) },
      org: { orgName: org.orgName, courseTitle: org.courseTitle, departments: org.departments, positions: org.positions },
      brand: { ...publicBranding(org.raw), loginCode: org.raw.loginCode || null },
      support: support ? { orgName: org.orgName, until: req.session.support.until, reason: req.session.support.reason } : author ? { orgName: org.orgName, until: req.session.support.until, author: true } : null,
      idleSeconds: req.session.idleSeconds,
      features: { aiQuestions: !!config.anthropicApiKey },
    };
  });
}
