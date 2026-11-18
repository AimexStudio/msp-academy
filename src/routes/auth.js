import { login, requireAuth, COOKIE, cookieOptions, now } from '../auth.js';
import { loadOrg } from '../course.js';
import { config } from '../config.js';

export default async function (app) {
  const { db, orgId } = app;

  app.post('/api/auth/login', {
    schema: { body: { type: 'object', required: ['staffNo', 'pin'], properties: { staffNo: { type: 'string', maxLength: 40 }, pin: { type: 'string', maxLength: 12 } } } },
  }, async (req, reply) => {
    const r = await login(db, { orgId, staffNo: req.body.staffNo, pin: req.body.pin, ip: req.ip, userAgent: req.headers['user-agent'] });
    if (!r.ok) return reply.code(r.locked ? 429 : 401).send({ error: r.error, locked: !!r.locked });
    reply.setCookie(COOKIE, r.token, cookieOptions());
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.session) await req.session.ref.update({ revokedAt: now() });
    reply.clearCookie(COOKIE, cookieOptions());
    return { ok: true };
  });

  // Called by the page while someone is actively reading, so a long read doesn't count as idle.
  app.post('/api/auth/keepalive', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return { ok: true, idleSeconds: req.session.idleSeconds };
  });

  app.get('/api/me', async (req) => {
    if (!req.session) return { staff: null, expired: !!req.sessionExpired };
    const org = await loadOrg(db, orgId);
    const s = req.session.staff;
    return {
      staff: { id: s.id, name: s.name, staffNo: s.staffNo, positionId: s.positionId, role: s.role,
        positionName: org.posName(s.positionId), deptId: org.deptOf(s.positionId), deptName: org.deptName(org.deptOf(s.positionId)) },
      org: { orgName: org.orgName, courseTitle: org.courseTitle, departments: org.departments, positions: org.positions },
      idleSeconds: req.session.idleSeconds,
      features: { aiQuestions: !!config.anthropicApiKey },
    };
  });
}
