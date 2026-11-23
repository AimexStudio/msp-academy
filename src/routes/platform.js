// The platform admin area: clients, their status, branding, web addresses, support visits, groups,
// sharing and the MSP Academy library. Only reachable with a platform admin session, and only on the
// shared address (never on a client's own).
import { requirePlatform, COOKIE, cookieOptions, now, sha, hashPin, validPin, normStaffNo, staffNoRef, revokeAllFor, clearLockout } from '../auth.js';
import { httpError } from '../documents.js';
import { config } from '../config.js';
import { platformLogin, createClient, platformAuditRecord, clientAuditFromPlatform, SUPPORT_MAX_MINUTES } from '../platform.js';
import { shareCourse, coursesWithShares } from '../sharing.js';
import { CLIENT_CODE_RE, DOC_PREFIX_RE, STAFF_PREFIX_RE, HOST_RE, FONTS, normCode, normHost, codeRef, domainRef, orgRef,
  cleanBranding, publicBranding, invalidate, storagePrefix, LIBRARY_ORG_ID, ensureLibrary } from '../tenancy.js';

export default async function (app) {
  const { db, storage } = app;
  const admin = req => req.platform;
  const writeBoth = (t, req, orgId, action, details, entity = 'organisation') => {
    t.create(db.collection('platformAudit').doc(), platformAuditRecord(admin(req), action, details, { orgId, ip: req.ip }));
    if (orgId) t.create(db.collection('auditLog').doc(), clientAuditFromPlatform(orgId, admin(req), action, entity, orgId, details, req.ip));
  };
  async function getClient(orgId) {
    const s = await orgRef(db, String(orgId)).get();
    if (!s.exists) throw httpError(404, 'Client not found.');
    return s;
  }

  /* ---------- sign-in ---------- */
  app.post('/api/platform/login', { schema: { body: { type: 'object', required: ['email', 'password'], properties: {
    email: { type: 'string', maxLength: 254 }, password: { type: 'string', maxLength: 200 } } } } }, async (req, reply) => {
    if (req.hostOrgId) return reply.code(404).send({ error: 'Platform sign-in only works on the shared address, not on a client’s own web address.' });
    const r = await platformLogin(db, { email: req.body.email, password: req.body.password, ip: req.ip, userAgent: req.headers['user-agent'] });
    if (!r.ok) return reply.code(r.locked ? 429 : 401).send({ error: r.error });
    const old = req.cookies[COOKIE];
    if (old) await db.collection('sessions').doc(sha(old)).update({ revokedAt: now() }).catch(() => {});
    reply.setCookie(COOKIE, r.token, cookieOptions());
    return { ok: true };
  });

  app.get('/api/platform/me', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const a = admin(req), sup = a.support && new Date(a.support.until) > new Date() ? a.support : null;
    return { admin: { id: a.id, name: a.name, email: a.email }, support: sup, fonts: FONTS, local: !config.production };
  });

  /* ---------- clients ---------- */
  app.get('/api/platform/clients', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const [orgs, groups] = await Promise.all([db.collection('orgs').get(), db.collection('groups').get()]);
    const gname = new Map(groups.docs.map(g => [g.id, g.get('name')]));
    const out = [];
    for (const o of orgs.docs.filter(o => !o.get('library'))) {
      const [staff, docs, courses] = await Promise.all([db.collection('staff').where('orgId', '==', o.id).get(), db.collection('documents').where('orgId', '==', o.id).get(),
        db.collection('courses').where('orgId', '==', o.id).get()]);
      const active = staff.docs.filter(s => s.get('active'));
      const last = active.map(s => s.get('lastLoginAt')).filter(Boolean).sort().pop() || null;
      const d = o.data();
      out.push({ orgId: o.id, clientNo: d.clientNo ?? null, name: d.name, loginCode: d.loginCode || null, status: d.status || 'active',
        groupId: d.groupId && gname.has(d.groupId) ? d.groupId : null, groupName: gname.get(d.groupId) || null,
        domains: d.domains || [], staff: active.length, published: docs.docs.filter(x => x.get('status') === 'published').length,
        courses: courses.docs.filter(x => x.get('status') === 'published').length, lastSignInAt: last,
        colors: cleanBranding(d.branding || {}).colors, wordmark: publicBranding({ id: o.id, ...d }).wordmark, logoUrl: publicBranding({ id: o.id, ...d }).logoUrl });
    }
    return { clients: out.sort((a, b) => (a.clientNo ?? 1e9) - (b.clientNo ?? 1e9)),
      groups: groups.docs.map(g => ({ id: g.id, name: g.get('name') })).sort((a, b) => a.name.localeCompare(b.name)) };
  });

  const managerSchema = { type: 'object', required: ['name', 'staffNo', 'pin'], properties: { name: { type: 'string', maxLength: 120 }, staffNo: { type: 'string', maxLength: 30 }, pin: { type: 'string', maxLength: 6 } } };
  app.post('/api/platform/clients', { schema: { body: { type: 'object', required: ['name', 'loginCode', 'docPrefix', 'manager'], properties: {
    name: { type: 'string', maxLength: 120 }, loginCode: { type: 'string', maxLength: 30 }, docPrefix: { type: 'string', maxLength: 10 },
    staffNoPrefix: { type: 'string', maxLength: 10 }, manager: managerSchema, branding: { type: 'object' }, groupId: { type: ['string', 'null'], maxLength: 60 } } } } }, async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    if (req.body.groupId && !(await db.collection('groups').doc(req.body.groupId).get()).exists) throw httpError(400, 'That group no longer exists.');
    return createClient(db, admin(req), req.body, { ip: req.ip });
  });

  app.get('/api/platform/clients/:orgId', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const s = await getClient(req.params.orgId), d = s.data();
    const [audit, grants, managers, courses, received, groups] = await Promise.all([
      db.collection('platformAudit').where('orgId', '==', s.id).get(),
      db.collection('supportGrants').where('orgId', '==', s.id).get(),
      db.collection('staff').where('orgId', '==', s.id).where('role', '==', 'manager').get(),
      coursesWithShares(db, s.id),
      db.collection('shares').where('targetOrgId', '==', s.id).get(),
      db.collection('groups').get(),
    ]);
    const logo = d.branding && d.branding.logoFileId ? await db.collection('files').doc(d.branding.logoFileId).get() : null;
    return {
      client: { orgId: s.id, clientNo: d.clientNo ?? null, name: d.name, courseTitle: d.courseTitle, loginCode: d.loginCode || null, status: d.status || 'active',
        statusReason: d.statusReason || null, docPrefix: d.docPrefix || '', staffNoPrefix: d.staffNoPrefix ?? '', domains: d.domains || [], library: !!d.library,
        legacyStorage: !!d.legacyStorage, createdAt: d.createdAt || null, branding: cleanBranding(d.branding || {}), groupId: d.groupId || null,
        logo: logo && logo.exists ? { name: logo.get('name'), size: logo.get('size') } : null, preview: publicBranding({ id: s.id, ...d }) },
      groups: groups.docs.map(g => ({ id: g.id, name: g.get('name') })).sort((a, b) => a.name.localeCompare(b.name)),
      courses,
      received: received.docs.map(r => r.data()).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30)
        .map(r => ({ at: r.at, courseTitle: r.courseTitle, fromName: r.sourceName, by: r.adminName, published: r.publish, documents: r.documents, course: r.course })),
      managers: managers.docs.map(m => ({ staffNo: m.get('staffNo'), name: m.get('name'), active: m.get('active'), lastLoginAt: m.get('lastLoginAt') || null })),
      supportVisits: grants.docs.map(g => ({ id: g.id, ...g.data() })).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 20),
      audit: audit.docs.map(a => a.data()).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50),
    };
  });

  app.put('/api/platform/clients/:orgId', { schema: { body: { type: 'object', properties: {
    name: { type: 'string', maxLength: 120 }, loginCode: { type: 'string', maxLength: 30 }, docPrefix: { type: 'string', maxLength: 10 },
    staffNoPrefix: { type: 'string', maxLength: 10 }, branding: { type: 'object' }, groupId: { type: ['string', 'null'], maxLength: 60 } } } } }, async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const b = req.body;
    const group = b.groupId ? await db.collection('groups').doc(b.groupId).get() : null;
    if (b.groupId && !group.exists) throw httpError(400, 'That group no longer exists.');
    await db.runTransaction(async t => {
      const ref = orgRef(db, String(req.params.orgId));
      const s = await t.get(ref);
      if (!s.exists) throw httpError(404, 'Client not found.');
      const d = s.data(), upd = {}, changes = {};
      if (b.name !== undefined) { const n = b.name.trim().replace(/\s+/g, ' '); if (n.length < 2) throw httpError(400, 'Enter the client’s name.'); if (n !== d.name) { upd.name = n; changes.name = { from: d.name, to: n }; } }
      if (b.docPrefix !== undefined) {
        const p = b.docPrefix.trim().toUpperCase();
        if (!DOC_PREFIX_RE.test(p)) throw httpError(400, 'The document code prefix is 2 to 8 capital letters or numbers, starting with a letter.');
        if (p !== d.docPrefix) { upd.docPrefix = p; changes.docPrefix = { from: d.docPrefix || null, to: p }; }
      }
      if (b.staffNoPrefix !== undefined) {
        const p = b.staffNoPrefix.trim().toUpperCase();
        if (!STAFF_PREFIX_RE.test(p)) throw httpError(400, 'The staff number prefix is up to 6 letters.');
        if (p !== (d.staffNoPrefix ?? '')) { upd.staffNoPrefix = p; changes.staffNoPrefix = { from: d.staffNoPrefix ?? null, to: p }; }
      }
      let newCode = null;
      if (b.loginCode !== undefined && !d.library) {
        const c = normCode(b.loginCode);
        if (!CLIENT_CODE_RE.test(c)) throw httpError(400, 'The client code is 3 to 20 letters and numbers.');
        if (c !== d.loginCode) {
          const taken = await t.get(codeRef(db, c));
          if (taken.exists) throw httpError(400, `The client code ${c} is already used by another client.`);
          newCode = c; upd.loginCode = c; changes.loginCode = { from: d.loginCode || null, to: c };
        }
      }
      if (b.branding !== undefined) {
        const nb = cleanBranding({ ...b.branding, logoFileId: (d.branding || {}).logoFileId || null }, d.branding || undefined);
        if (JSON.stringify(nb) !== JSON.stringify(cleanBranding(d.branding || {}))) { upd.branding = nb; changes.branding = true; }
      }
      if (b.groupId !== undefined && !d.library && (b.groupId || null) !== (d.groupId || null)) { upd.groupId = b.groupId || null; changes.group = group ? group.get('name') : null; }
      if (!Object.keys(upd).length) return;
      if (newCode) { if (d.loginCode) t.delete(codeRef(db, d.loginCode)); t.create(codeRef(db, newCode), { orgId: s.id }); }
      t.update(ref, { ...upd, updatedAt: now() });
      writeBoth(t, req, s.id, 'client.update', changes);
    });
    invalidate(db);
    return { ok: true };
  });

  app.post('/api/platform/clients/:orgId/status', { schema: { body: { type: 'object', required: ['status'], properties: {
    status: { type: 'string', enum: ['active', 'suspended'] }, reason: { type: ['string', 'null'], maxLength: 300 } } } } }, async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const reason = String(req.body.reason || '').trim();
    if (req.body.status === 'suspended' && reason.length < 5) throw httpError(400, 'Say why the client is being suspended. The reason is recorded.');
    await db.runTransaction(async t => {
      const ref = orgRef(db, String(req.params.orgId));
      const s = await t.get(ref);
      if (!s.exists) throw httpError(404, 'Client not found.');
      if ((s.get('status') || 'active') === req.body.status) throw httpError(400, req.body.status === 'active' ? 'This client is already active.' : 'This client is already suspended.');
      t.update(ref, { status: req.body.status, statusReason: req.body.status === 'suspended' ? reason : null, statusChangedAt: now(), updatedAt: now() });
      writeBoth(t, req, s.id, req.body.status === 'suspended' ? 'client.suspend' : 'client.reactivate', { reason: reason || null });
    });
    invalidate(db);
    return { ok: true };
  });

  /* ---------- web addresses ---------- */
  app.post('/api/platform/clients/:orgId/domains', { schema: { body: { type: 'object', required: ['host'], properties: { host: { type: 'string', maxLength: 260 } } } } }, async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const host = normHost(req.body.host);
    if (!HOST_RE.test(host)) throw httpError(400, 'Enter a web address like training.example.co.za (no https://, no slashes).');
    await db.runTransaction(async t => {
      const ref = orgRef(db, String(req.params.orgId));
      const [s, taken] = await Promise.all([t.get(ref), t.get(domainRef(db, host))]);
      if (!s.exists) throw httpError(404, 'Client not found.');
      if (taken.exists) throw httpError(400, taken.get('orgId') === s.id ? `${host} is already this client’s address.` : `${host} already belongs to another client.`);
      t.create(domainRef(db, host), { orgId: s.id, addedAt: now() });
      t.update(ref, { domains: [...new Set([...(s.get('domains') || []), host])], updatedAt: now() });
      writeBoth(t, req, s.id, 'client.domain_add', { host });
    });
    invalidate(db);
    return { ok: true, host };
  });

  app.delete('/api/platform/clients/:orgId/domains/:host', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const host = normHost(req.params.host);
    await db.runTransaction(async t => {
      const ref = orgRef(db, String(req.params.orgId));
      const [s, m] = await Promise.all([t.get(ref), t.get(domainRef(db, host))]);
      if (!s.exists) throw httpError(404, 'Client not found.');
      if (!m.exists || m.get('orgId') !== s.id) throw httpError(404, 'That address is not registered to this client.');
      t.delete(domainRef(db, host));
      t.update(ref, { domains: (s.get('domains') || []).filter(h => h !== host), updatedAt: now() });
      writeBoth(t, req, s.id, 'client.domain_remove', { host });
    });
    invalidate(db);
    return { ok: true };
  });

  /* ---------- logo ---------- */
  app.post('/api/platform/clients/:orgId/logo', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const org = await getClient(req.params.orgId);
    const part = await req.file();
    if (!part) throw httpError(400, 'Choose an image to upload.');
    let buf; try { buf = await part.toBuffer(); } catch { throw httpError(413, 'That file is too large.'); }
    if (part.file.truncated) throw httpError(413, 'That file is too large.');
    if (buf.length > 512 * 1024) throw httpError(400, 'Keep the logo under 512 KB. Export it as a PNG about 600 pixels wide.');
    const mime = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
      : buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? 'image/jpeg'
      : buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!mime) throw httpError(400, 'Upload the logo as a PNG, JPEG or WebP image.'); // no SVG: it can carry scripts
    const name = String(part.filename || 'logo').replace(/[\\/\0]/g, '_').slice(0, 200);
    const stored = await storage.putBuffer(buf, mime, storagePrefix(org.id, 'branding'));
    const fref = db.collection('files').doc();
    await db.runTransaction(async t => {
      const s = await t.get(org.ref);
      t.create(fref, { orgId: org.id, kind: 'logo', name, mime, size: stored.size, sha256: stored.sha256, storageKey: stored.key, uploadedBy: null, platformAdminId: admin(req).id, createdAt: now() });
      t.update(org.ref, { branding: { ...cleanBranding(s.get('branding') || {}), logoFileId: fref.id }, updatedAt: now() });
      writeBoth(t, req, org.id, 'client.logo_upload', { name, size: stored.size, sha256: stored.sha256 });
    });
    invalidate(db);
    return { ok: true, logoUrl: `/api/branding/logo/${fref.id}` };
  });

  app.delete('/api/platform/clients/:orgId/logo', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const org = await getClient(req.params.orgId);
    await db.runTransaction(async t => {
      const s = await t.get(org.ref);
      t.update(org.ref, { branding: { ...cleanBranding(s.get('branding') || {}), logoFileId: null }, updatedAt: now() });
      writeBoth(t, req, org.id, 'client.logo_remove', {});
    });
    invalidate(db);
    return { ok: true };
  });

  /* ---------- a manager who can't get in ---------- */
  app.post('/api/platform/clients/:orgId/manager', { schema: { body: { type: 'object', required: ['staffNo', 'pin', 'reason'], properties: {
    staffNo: { type: 'string', maxLength: 30 }, name: { type: 'string', maxLength: 120 }, pin: { type: 'string', maxLength: 6 }, reason: { type: 'string', maxLength: 300 } } } } }, async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const b = req.body, staffNo = normStaffNo(b.staffNo), reason = String(b.reason || '').trim();
    if (!validPin(b.pin) || b.pin.length !== 6) throw httpError(400, 'Use a 6-digit PIN.');
    if (reason.length < 5) throw httpError(400, 'Say why. The reason is recorded in the client’s audit log.');
    const org = await getClient(req.params.orgId);
    const pinHash = await hashPin(b.pin);
    const result = await db.runTransaction(async t => {
      const map = await t.get(staffNoRef(db, org.id, staffNo));
      const st = map.exists ? await t.get(db.collection('staff').doc(map.get('staffId'))) : null;
      if (st && st.exists) {
        if (st.get('orgId') !== org.id) throw httpError(404, 'Staff member not found.');
        if (st.get('role') !== 'manager') throw httpError(400, `${staffNo} is not a manager. Ask the client to change their access, or add a new manager with a different staff number.`);
        t.update(st.ref, { pinHash, pinSetAt: now(), active: true, leftAt: null, updatedAt: now() });
        writeBoth(t, req, org.id, 'staff.pin_reset_by_platform', { staffNo, reason }, 'staff');
        return { id: st.id, created: false };
      }
      const name = String(b.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 2) throw httpError(400, `${staffNo} doesn't exist yet. Enter the new manager’s full name to add them.`);
      const positions = org.get('positions') || [];
      const pos = (positions.find(p => p.dept === 'mgmt') || positions[0] || {}).id;
      if (!pos) throw httpError(400, 'This client has no positions yet.');
      const ref = db.collection('staff').doc();
      t.create(ref, { orgId: org.id, staffNo, name, positionId: pos, role: 'manager', active: true, startDate: null, leftAt: null, pinHash, pinSetAt: now(),
        lastLoginAt: null, createdAt: now(), updatedAt: now(), chainHead: null, chainSeq: 0 });
      t.create(staffNoRef(db, org.id, staffNo), { staffId: ref.id, orgId: org.id });
      t.create(db.collection('positionHistory').doc(), { orgId: org.id, staffId: ref.id, from: null, to: pos, by: null, at: now() });
      writeBoth(t, req, org.id, 'staff.manager_add_by_platform', { staffNo, name, reason }, 'staff');
      return { id: ref.id, created: true };
    });
    await Promise.all([revokeAllFor(db, result.id), clearLockout(db, org.id, staffNo)]);
    return { ok: true, created: result.created };
  });

  /* ---------- support visits ---------- */
  app.post('/api/platform/support', { schema: { body: { type: 'object', required: ['orgId', 'reason'], properties: {
    orgId: { type: 'string', maxLength: 60 }, reason: { type: 'string', maxLength: 300 }, minutes: { type: 'integer', minimum: 5, maximum: SUPPORT_MAX_MINUTES } } } } }, async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const reason = req.body.reason.trim();
    if (reason.length < 10) throw httpError(400, 'Describe why you need to look at this client’s portal (at least a few words). It is shown in their audit log.');
    const org = await getClient(req.body.orgId);
    if (org.get('library')) throw httpError(400, 'Open the library from the Library page instead.');
    const minutes = req.body.minutes || 30;
    const grantRef = db.collection('supportGrants').doc();
    const until = new Date(Date.now() + minutes * 60000).toISOString();
    await db.runTransaction(async t => {
      const sess = await t.get(admin(req).sessionRef);
      const prev = sess.get('support');
      if (prev && prev.grantId) {
        const g = db.collection('supportGrants').doc(prev.grantId);
        if ((await t.get(g)).exists) t.update(g, { endedAt: now(), endedBy: 'switched' });
      }
      t.create(grantRef, { orgId: org.id, orgName: org.get('name'), adminId: admin(req).id, adminName: admin(req).name, reason, startedAt: now(), until, endedAt: null, ip: req.ip || null });
      t.update(admin(req).sessionRef, { support: { grantId: grantRef.id, orgId: org.id, until, reason } });
      writeBoth(t, req, org.id, 'support.start', { by: admin(req).name, reason, until, minutes });
    });
    return { ok: true, until };
  });

  app.post('/api/platform/support/end', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const sup = admin(req).support;
    if (!sup) return { ok: true };
    if (sup.mode === 'author') {
      await admin(req).sessionRef.update({ support: null });
      await db.collection('platformAudit').add(platformAuditRecord(admin(req), 'library.close', {}, { orgId: sup.orgId, ip: req.ip }));
      return { ok: true };
    }
    const requests = (await db.collection('supportLog').where('grantId', '==', sup.grantId).get()).size;
    await db.runTransaction(async t => {
      const g = db.collection('supportGrants').doc(sup.grantId);
      const gs = await t.get(g);
      if (gs.exists && !gs.get('endedAt')) t.update(g, { endedAt: now(), endedBy: 'admin', requests });
      t.update(admin(req).sessionRef, { support: null });
      writeBoth(t, req, sup.orgId, 'support.end', { by: admin(req).name, requests });
    });
    return { ok: true };
  });

  /* ---------- the MSP Academy library ---------- */
  app.get('/api/platform/library', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    await ensureLibrary(db);
    return { orgId: LIBRARY_ORG_ID, courses: await coursesWithShares(db, LIBRARY_ORG_ID) };
  });
  // Open the library in the course builder (the same screens client managers use), for up to 8 hours.
  app.post('/api/platform/library/open', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    await ensureLibrary(db);
    const until = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
    await admin(req).sessionRef.update({ support: { mode: 'author', grantId: null, orgId: LIBRARY_ORG_ID, until, reason: 'Building MSP Academy courses' } });
    await db.collection('platformAudit').add(platformAuditRecord(admin(req), 'library.open', {}, { orgId: LIBRARY_ORG_ID, ip: req.ip }));
    return { ok: true };
  });

  /* ---------- groups of clients ---------- */
  const nameOf = b => { const n = String(b.name || '').trim().replace(/\s+/g, ' '); if (n.length < 2) throw httpError(400, 'Give the group a name.'); return n.slice(0, 80); };
  const groupSchema = { body: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 120 } } } };
  async function groupNameFree(name, exceptId = null) {
    const all = await db.collection('groups').get();
    if (all.docs.some(g => g.id !== exceptId && g.get('name').toLowerCase() === name.toLowerCase())) throw httpError(400, `There is already a group called ${name}.`);
  }
  app.get('/api/platform/groups', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const [groups, orgs] = await Promise.all([db.collection('groups').get(), db.collection('orgs').get()]);
    return { groups: groups.docs.map(g => ({ id: g.id, name: g.get('name'), clients: orgs.docs.filter(o => o.get('groupId') === g.id).map(o => ({ orgId: o.id, name: o.get('name') })) }))
      .sort((a, b) => a.name.localeCompare(b.name)) };
  });
  app.post('/api/platform/groups', { schema: groupSchema }, async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const name = nameOf(req.body); await groupNameFree(name);
    const ref = db.collection('groups').doc();
    await ref.set({ name, createdAt: now(), createdBy: admin(req).id });
    await db.collection('platformAudit').add(platformAuditRecord(admin(req), 'group.create', { name }, { ip: req.ip }));
    return { id: ref.id, name };
  });
  app.put('/api/platform/groups/:id', { schema: groupSchema }, async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const g = await db.collection('groups').doc(String(req.params.id)).get();
    if (!g.exists) throw httpError(404, 'Group not found.');
    const name = nameOf(req.body); await groupNameFree(name, g.id);
    await g.ref.update({ name });
    await db.collection('platformAudit').add(platformAuditRecord(admin(req), 'group.rename', { from: g.get('name'), to: name }, { ip: req.ip }));
    return { ok: true };
  });
  app.delete('/api/platform/groups/:id', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const g = await db.collection('groups').doc(String(req.params.id)).get();
    if (!g.exists) throw httpError(404, 'Group not found.');
    const members = await db.collection('orgs').where('groupId', '==', g.id).get();
    if (!members.empty) throw httpError(400, `Move the ${members.size === 1 ? 'client' : members.size + ' clients'} out of ${g.get('name')} first.`);
    await g.ref.delete();
    await db.collection('platformAudit').add(platformAuditRecord(admin(req), 'group.delete', { name: g.get('name') }, { ip: req.ip }));
    return { ok: true };
  });

  /* ---------- sharing a course with other clients ---------- */
  app.post('/api/platform/share', { schema: { body: { type: 'object', required: ['sourceOrgId', 'courseId', 'targetOrgIds'], properties: {
    sourceOrgId: { type: 'string', maxLength: 60 }, courseId: { type: 'string', maxLength: 60 }, targetOrgIds: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 60 } },
    publish: { type: 'boolean' }, change: { type: 'string', enum: ['minor', 'major'] } } } } }, async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    return shareCourse(db, storage, admin(req), req.body, { ip: req.ip });
  });

  app.get('/api/platform/audit', async (req, reply) => {
    if (!requirePlatform(req, reply)) return;
    const q = await db.collection('platformAudit').orderBy('at', 'desc').limit(300).get();
    return { entries: q.docs.map(s => ({ id: s.id, ...s.data() })) };
  });
}
