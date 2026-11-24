// Leave tracking: managers record annual, sick, family responsibility, special and unpaid leave (with notes and
// medical certificates) and set each person's yearly leave; staff see their balances today and on any future date.
// Switched on per client from the platform (orgs.features.leave).
import { requireRole, requireStaff, now } from '../auth.js';
import { httpError, audit } from '../documents.js';
import { loadOrg, loadStaff } from '../course.js';
import { getOrg, storagePrefix, invalidate } from '../tenancy.js';
import { config } from '../config.js';
import { LEAVE_TYPES, DEFAULT_PROFILE, balancesOn, cleanProfile, workingDays, validDate, today } from '../leave.js';

const VIEW = ['manager', 'hod', 'auditor', 'support'];
const EDIT = ['manager'];

export default async function (app) {
  const { db, storage } = app;
  const actor = req => req.session.staff;
  async function enabled(orgId) { const o = await getOrg(db, orgId); return !!(o && o.features && o.features.leave); }
  async function needLeave(req, reply) {
    if (await enabled(req.orgId)) return true;
    reply.code(404).send({ error: 'Leave tracking isn’t switched on for this organisation.' }); return false;
  }
  const profileOf = async (orgId, staffId) => {
    const s = await db.collection('leaveProfiles').doc(staffId).get();
    return s.exists && s.get('orgId') === orgId ? s.data() : null;
  };
  const entriesOf = async (orgId, staffId) => (await db.collection('leaveEntries').where('orgId', '==', orgId).where('staffId', '==', staffId).get())
    .docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.deletedAt).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const atDate = q => (validDate(q) ? q : today());
  async function personInScope(req, org, staffId) {
    const s = await db.collection('staff').doc(String(staffId)).get();
    if (!s.exists || s.get('orgId') !== req.orgId) throw httpError(404, 'Staff member not found.');
    if (actor(req).role === 'hod' && org.deptOf(s.get('positionId')) !== org.deptOf(actor(req).positionId)) throw httpError(404, 'Staff member not found.');
    return s;
  }
  const entryOut = (e, withNote) => ({ id: e.id, type: e.type, typeName: LEAVE_TYPES[e.type], startDate: e.startDate, endDate: e.endDate, days: e.days,
    certificateFileId: e.certificateFileId || null, ...(withNote ? { note: e.note || '', createdAt: e.createdAt, updatedAt: e.updatedAt || null } : {}) });

  /* ---------- staff: my leave ---------- */
  app.get('/api/my/leave', async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    if (!(await enabled(req.orgId))) return { enabled: false };
    const s = actor(req), [p, entries] = await Promise.all([profileOf(s.orgId, s.id), entriesOf(s.orgId, s.id)]);
    const d = today(), at = atDate(req.query.date);
    return { enabled: true, configured: !!p, today: d, profile: { ...DEFAULT_PROFILE, ...(p || {}) }, now: balancesOn(p, entries, d), at: balancesOn(p, entries, at),
      entries: entries.map(e => entryOut(e, false)), types: LEAVE_TYPES };
  });

  /* ---------- managers ---------- */
  app.get('/api/admin/leave-days', async (req, reply) => {
    if (!requireRole(req, reply, VIEW)) return;
    return { days: workingDays(String(req.query.from || ''), String(req.query.to || '')) };
  });

  app.get('/api/admin/leave', async (req, reply) => {
    if (!requireRole(req, reply, VIEW)) return;
    if (!(await needLeave(req, reply))) return;
    const orgId = req.orgId, org = await loadOrg(db, orgId), d = today();
    const dept = actor(req).role === 'hod' ? org.deptOf(actor(req).positionId) : null;
    const [staff, profs, ents] = await Promise.all([loadStaff(db, orgId, { activeOnly: true }), db.collection('leaveProfiles').where('orgId', '==', orgId).get(),
      db.collection('leaveEntries').where('orgId', '==', orgId).get()]);
    const pmap = new Map(profs.docs.map(x => [x.id, x.data()]));
    const byStaff = new Map();
    for (const e of ents.docs.map(x => ({ id: x.id, ...x.data() })).filter(e => !e.deletedAt)) { if (!byStaff.has(e.staffId)) byStaff.set(e.staffId, []); byStaff.get(e.staffId).push(e); }
    const rows = staff.filter(s => !dept || org.deptOf(s.positionId) === dept).map(s => {
      const es = byStaff.get(s.id) || [], b = balancesOn(pmap.get(s.id), es, d);
      const onLeave = es.find(e => e.type !== 'adjustment' && e.startDate <= d && e.endDate >= d) || null;
      const next = es.filter(e => e.type !== 'adjustment' && e.startDate > d).sort((a, c) => (a.startDate < c.startDate ? -1 : 1))[0] || null;
      return { id: s.id, name: s.name, staffNo: s.staffNo, positionName: org.posName(s.positionId), deptName: org.deptName(org.deptOf(s.positionId)), configured: pmap.has(s.id),
        annual: b.annual.balance, sickLeft: b.sick.left, familyLeft: b.family.left, onLeave: onLeave && entryOut(onLeave, false), next: next && entryOut(next, false) };
    });
    return { today: d, staff: rows.sort((a, b) => a.name.localeCompare(b.name)), types: LEAVE_TYPES };
  });

  app.get('/api/admin/leave/:staffId', async (req, reply) => {
    if (!requireRole(req, reply, VIEW)) return;
    if (!(await needLeave(req, reply))) return;
    const orgId = req.orgId, org = await loadOrg(db, orgId), s = await personInScope(req, org, req.params.staffId);
    const [p, entries] = await Promise.all([profileOf(orgId, s.id), entriesOf(orgId, s.id)]);
    const d = today(), at = atDate(req.query.date);
    return { person: { id: s.id, name: s.get('name'), staffNo: s.get('staffNo'), positionName: org.posName(s.get('positionId')), startDate: s.get('startDate') || null },
      configured: !!p, profile: { ...DEFAULT_PROFILE, accrualStart: s.get('startDate') || null, ...(p || {}) }, today: d,
      now: balancesOn(p, entries, d), at: balancesOn(p, entries, at), entries: entries.map(e => entryOut(e, true)), types: LEAVE_TYPES };
  });

  app.put('/api/admin/leave/:staffId/profile', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    if (!(await needLeave(req, reply))) return;
    const orgId = req.orgId, org = await loadOrg(db, orgId), s = await personInScope(req, org, req.params.staffId);
    const p = cleanProfile(req.body || {});
    if (!p.accrualStart) throw httpError(400, 'Choose the date leave starts building up from (usually their start date).');
    await db.collection('leaveProfiles').doc(s.id).set({ orgId, staffId: s.id, ...p, updatedAt: now(), updatedBy: actor(req).id });
    await audit(db, orgId, actor(req).id, 'leave.settings', 'staff', s.id, { name: s.get('name'), ...p }, req.ip);
    return { ok: true };
  });

  async function cleanEntry(req, orgId, staffId, b) {
    if (!LEAVE_TYPES[b.type]) throw httpError(400, 'Choose the type of leave.');
    if (!validDate(b.startDate)) throw httpError(400, 'Choose the first day.');
    const endDate = b.type === 'adjustment' ? b.startDate : b.endDate;
    if (!validDate(endDate) || endDate < b.startDate) throw httpError(400, 'The last day must be on or after the first day.');
    let days = b.days === '' || b.days === null || b.days === undefined ? (b.type === 'adjustment' ? NaN : workingDays(b.startDate, endDate)) : Number(b.days);
    if (!Number.isFinite(days)) throw httpError(400, 'Enter the number of days.');
    days = Math.round(days * 100) / 100;
    if (b.type === 'adjustment' ? days === 0 || Math.abs(days) > 200 : days <= 0 || days > 366) throw httpError(400, b.type === 'adjustment' ? 'An adjustment is a number of days to add (e.g. 2) or take away (e.g. -2).' : 'Enter the number of leave days (more than 0).');
    const note = String(b.note || '').trim().slice(0, 2000);
    if (b.type === 'adjustment' && note.length < 3) throw httpError(400, 'Say why the balance is being adjusted.');
    let certificateFileId = b.certificateFileId || null;
    if (certificateFileId) {
      const f = await db.collection('files').doc(String(certificateFileId)).get();
      if (!f.exists || f.get('orgId') !== orgId || f.get('kind') !== 'medical' || f.get('staffId') !== staffId) throw httpError(400, 'Upload the medical certificate again.');
    }
    return { type: b.type, startDate: b.startDate, endDate, days, note, certificateFileId };
  }
  const entrySchema = { body: { type: 'object', properties: { type: { type: 'string', maxLength: 20 }, startDate: { type: 'string', maxLength: 10 }, endDate: { type: ['string', 'null'], maxLength: 10 },
    days: { type: ['number', 'string', 'null'] }, note: { type: ['string', 'null'], maxLength: 4000 }, certificateFileId: { type: ['string', 'null'], maxLength: 60 } } } };

  app.post('/api/admin/leave/:staffId/entries', { schema: entrySchema }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    if (!(await needLeave(req, reply))) return;
    const orgId = req.orgId, org = await loadOrg(db, orgId), s = await personInScope(req, org, req.params.staffId);
    const e = await cleanEntry(req, orgId, s.id, req.body || {});
    const ref = db.collection('leaveEntries').doc();
    await ref.set({ orgId, staffId: s.id, ...e, createdAt: now(), createdBy: actor(req).id, updatedAt: null, deletedAt: null });
    await audit(db, orgId, actor(req).id, 'leave.record', 'staff', s.id, { name: s.get('name'), type: e.type, from: e.startDate, to: e.endDate, days: e.days, certificate: !!e.certificateFileId }, req.ip);
    return { id: ref.id };
  });

  async function entryInScope(req, id) {
    const r = db.collection('leaveEntries').doc(String(id)), x = await r.get();
    if (!x.exists || x.get('orgId') !== req.orgId || x.get('deletedAt')) throw httpError(404, 'Leave record not found.');
    return x;
  }
  app.put('/api/admin/leave/entries/:id', { schema: entrySchema }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    if (!(await needLeave(req, reply))) return;
    const x = await entryInScope(req, req.params.id);
    const e = await cleanEntry(req, req.orgId, x.get('staffId'), req.body || {});
    await x.ref.update({ ...e, updatedAt: now(), updatedBy: actor(req).id });
    await audit(db, req.orgId, actor(req).id, 'leave.change', 'staff', x.get('staffId'), { before: { type: x.get('type'), from: x.get('startDate'), to: x.get('endDate'), days: x.get('days') }, after: { type: e.type, from: e.startDate, to: e.endDate, days: e.days } }, req.ip);
    return { ok: true };
  });
  app.delete('/api/admin/leave/entries/:id', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    if (!(await needLeave(req, reply))) return;
    const x = await entryInScope(req, req.params.id);
    await x.ref.update({ deletedAt: now(), deletedBy: actor(req).id }); // kept, so the audit trail can show what was removed
    await audit(db, req.orgId, actor(req).id, 'leave.remove', 'staff', x.get('staffId'), { type: x.get('type'), from: x.get('startDate'), to: x.get('endDate'), days: x.get('days') }, req.ip);
    return { ok: true };
  });

  // A medical certificate (PDF, JPEG or PNG), kept in the client's own storage folder, visible to the person and their managers.
  app.post('/api/admin/leave/:staffId/certificate', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    if (!(await needLeave(req, reply))) return;
    const orgId = req.orgId, org = await loadOrg(db, orgId), s = await personInScope(req, org, req.params.staffId);
    const part = await req.file();
    if (!part) throw httpError(400, 'Choose the certificate to upload.');
    const tooLarge = () => httpError(413, `That file is too large (limit ${config.maxUploadMb} MB). A photo or a scan is fine.`);
    let buf; try { buf = await part.toBuffer(); } catch { throw tooLarge(); }
    if (part.file.truncated || buf.length >= config.maxUploadMb * 1024 * 1024) throw tooLarge();
    const mime = buf.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg'
      : buf.subarray(1, 4).toString('latin1') === 'PNG' ? 'image/png' : null;
    if (!mime) throw httpError(400, 'Upload the certificate as a PDF, or a JPEG or PNG photo.');
    const stored = await storage.putBuffer(buf, mime, storagePrefix(orgId, 'medical'));
    const ref = db.collection('files').doc();
    await ref.set({ orgId, kind: 'medical', staffId: s.id, name: String(part.filename || 'certificate').replace(/[\\/\0]/g, '_').slice(0, 200), mime, size: stored.size,
      sha256: stored.sha256, storageKey: stored.key, uploadedBy: actor(req).id, createdAt: now() });
    return { id: ref.id, name: part.filename, mime };
  });
}
