// Manager tools. Roles:
//   manager - everything
//   hod     - head of department: their own department's overview, staff, reports and reminders; read-only
//   auditor - owner or group HR: read-only across everything, including frozen versions and the audit log
import { requireRole, hashPin, validPin, normStaffNo, revokeAllFor, clearLockout, staffNoRef, now } from '../auth.js';
import { loadOrg, loadPublishedDocs, loadProgress, loadStaff, summarise, deptRollup } from '../course.js';
import { cleanDraft, newDraft, draftFromVersion, publishDocument, checkFiles, audit, auditRecord, httpError, canonical, docRef, versionKey, sha256 } from '../documents.js';
import { draftProblems, nextCode, appliesTo, verLabel, KINDS } from '../rules.js';
import { buildRecord, fileMeta } from './my.js';
import { verifyChain } from '../evidence.js';
import { mp4Duration } from '../mp4.js';
import { config } from '../config.js';
import { storagePrefix, invalidate } from '../tenancy.js';
import { draftOf, lessonsOf, codesOf, fileIdsOf, cleanCourseDraft, courseProblems, checkCourseRefs, getCourseFor, publishCourse, issueCertificateIfDone } from '../courses.js';

// 'support' is a platform admin visiting this client: sees what an auditor sees, changes nothing.
const VIEW = ['manager', 'hod', 'auditor', 'support'];
const DOCS_VIEW = ['manager', 'auditor', 'support'];
const EDIT = ['manager'];
const ROLES = ['staff', 'hod', 'manager', 'auditor'];
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,30}$/;

export default async function (app) {
  const { db, storage } = app;
  const actor = req => req.session.staff;
  const scopeDept = (req, org) => (actor(req).role === 'hod' ? org.deptOf(actor(req).positionId) : null);
  const staffRef = id => db.collection('staff').doc(String(id));

  async function scopedRows(req, org, { includeInactive = false } = {}) {
    const orgId = req.orgId;
    const dept = scopeDept(req, org);
    const staff = await loadStaff(db, orgId, { activeOnly: !includeInactive, deptId: dept, org });
    const [docs, prog] = await Promise.all([loadPublishedDocs(db, orgId), loadProgress(db, orgId)]);
    return { docs, rows: staff.map(s => ({ staff: s, sum: summarise(s, docs, prog) })), dept };
  }
  async function staffInScope(req, org, id) {
    const orgId = req.orgId;
    const s = await staffRef(id).get();
    if (!s.exists || s.get('orgId') !== orgId) throw httpError(404, 'Staff member not found.');
    const d = scopeDept(req, org);
    if (d && org.deptOf(s.get('positionId')) !== d) throw httpError(404, 'Staff member not found.');
    return s;
  }
  async function allDocs(orgId) {
    const q = await db.collection('documents').where('orgId', '==', orgId).get();
    return q.docs.map(s => s.data());
  }

  // ---- overview -------------------------------------------------------------
  app.get('/api/admin/overview', async (req, reply) => {
    if (!requireRole(req, reply, VIEW)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const [{ docs, rows, dept }, all] = await Promise.all([scopedRows(req, org), allDocs(orgId)]);
    const behind = rows.filter(r => r.sum.outstanding.length).sort((a, b) => b.sum.outstanding.length - a.sum.outstanding.length);
    const latest = docs.slice().sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)).slice(0, 5).map(d => {
      const people = rows.filter(r => appliesTo(d.audience, r.staff.positionId));
      const done = people.filter(r => r.sum.items.find(i => i.doc.code === d.code)?.status === 'done').length;
      return { code: d.code, title: d.title, label: d.label, publishedAt: d.publishedAt, done, total: people.length };
    });
    return {
      orgName: org.orgName, scopeDept: dept ? org.deptName(dept) : null, staffCount: rows.length,
      upToDate: rows.filter(r => r.sum.upToDate).length, outstanding: rows.reduce((n, r) => n + r.sum.outstanding.length, 0),
      peopleBehind: behind.length, declarations: rows.filter(r => r.sum.declaration).length, publishedCount: docs.length,
      drafts: dept ? 0 : all.filter(d => d.status === 'draft').length,
      departments: deptRollup(org, rows),
      attention: behind.map(r => ({ id: r.staff.id, name: r.staff.name, positionName: org.posName(r.staff.positionId), lastLoginAt: r.staff.lastLoginAt,
        outstanding: r.sum.outstanding.map(i => ({ code: i.doc.code, title: i.doc.title, status: i.status })) })),
      latest,
    };
  });

  // ---- staff ----------------------------------------------------------------
  app.get('/api/admin/staff', async (req, reply) => {
    if (!requireRole(req, reply, VIEW)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const { rows } = await scopedRows(req, org, { includeInactive: true });
    const nums = (await loadStaff(db, orgId)).map(s => /^([A-Za-z]*)(\d+)$/.exec(s.staffNo)).filter(Boolean);
    const prefix = nums.length ? nums[0][1].toUpperCase() : org.staffNoPrefix;
    return {
      staff: rows.map(({ staff: s, sum }) => ({
        id: s.id, name: s.name, staffNo: s.staffNo, positionId: s.positionId, positionName: org.posName(s.positionId),
        deptId: org.deptOf(s.positionId), deptName: org.deptName(org.deptOf(s.positionId)), role: s.role, active: s.active,
        total: sum.total, done: sum.done, pct: sum.pct, outstanding: sum.outstanding.length,
        updated: sum.outstanding.filter(i => i.status === 'updated').length,
        declarationAt: sum.declaration && sum.declaration.at, lastLoginAt: s.lastLoginAt,
      })),
      nextStaffNo: prefix + String(nums.reduce((n, m) => Math.max(n, Number(m[2])), 0) + 1).padStart(3, '0'),
    };
  });

  app.get('/api/admin/staff/:id', async (req, reply) => {
    if (!requireRole(req, reply, VIEW)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const s = await staffInScope(req, org, req.params.id);
    const p = s.data();
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [record, so, ph, le, chain] = await Promise.all([
      buildRecord(db, orgId, s.id),
      db.collection('signoffs').where('orgId', '==', orgId).where('staffId', '==', s.id).get(),
      db.collection('positionHistory').where('orgId', '==', orgId).where('staffId', '==', s.id).get(),
      db.collection('loginEvents').where('orgId', '==', orgId).where('staffId', '==', s.id).get(),
      verifyChain(db, s.id),
    ]);
    const names = new Map((await loadStaff(db, orgId)).map(x => [x.id, x.name]));
    const logins = le.docs.map(d => d.data()).filter(e => e.at > since);
    return {
      person: { id: s.id, name: p.name, staffNo: p.staffNo, positionId: p.positionId, role: p.role, active: p.active,
        startDate: p.startDate || null, leftAt: p.leftAt || null, lastLoginAt: p.lastLoginAt || null, pinSetAt: p.pinSetAt },
      record,
      signoffHistory: so.docs.map(d => d.data()).sort((a, b) => (a.at < b.at ? 1 : -1))
        .map(h => ({ code: h.code, label: h.label, at: h.at, score: h.score, attempts: h.attempts, typedName: h.typedName, ip: h.ip, versionHash: h.versionHash })),
      positionHistory: ph.docs.map(d => d.data()).sort((a, b) => (a.at < b.at ? 1 : -1))
        .map(h => ({ from: h.from && org.posName(h.from), to: org.posName(h.to), at: h.at, by: h.by ? names.get(h.by) || null : null })),
      logins30d: { ok: logins.filter(e => e.success).length, failed: logins.filter(e => !e.success).length },
      evidence: chain,
    };
  });

  const staffSchema = { type: 'object', properties: {
    name: { type: 'string', maxLength: 120 }, staffNo: { type: 'string', maxLength: 30 }, positionId: { type: 'string', maxLength: 60 },
    startDate: { type: ['string', 'null'], maxLength: 10 }, role: { type: 'string', enum: ROLES }, pin: { type: 'string', maxLength: 6 } } };

  function validateStaff(org, b) {
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2) throw httpError(400, 'Enter the full name.');
    const staffNo = normStaffNo(b.staffNo);
    if (!/^[A-Z0-9-]{2,30}$/.test(staffNo)) throw httpError(400, `Staff numbers use letters and numbers only, e.g. ${org.staffNoPrefix || 'S'}014.`);
    if (!org.positions.some(p => p.id === b.positionId)) throw httpError(400, 'Choose a position.');
    const startDate = b.startDate && /^\d{4}-\d{2}-\d{2}$/.test(b.startDate) ? b.startDate : null;
    return { name, staffNo, startDate };
  }
  async function managersExcept(orgId, id) {
    const q = await db.collection('staff').where('orgId', '==', orgId).where('role', '==', 'manager').get();
    return q.docs.filter(d => d.id !== id && d.get('active')).length;
  }

  app.post('/api/admin/staff', { schema: { body: { ...staffSchema, required: ['name', 'staffNo', 'positionId', 'pin'] } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const b = req.body;
    if (!validPin(b.pin)) throw httpError(400, 'The PIN must be 4 to 6 digits.');
    const f = validateStaff(org, b);
    const pinHash = await hashPin(b.pin);
    const ref = db.collection('staff').doc();
    await db.runTransaction(async t => {
      const map = await t.get(staffNoRef(db, orgId, f.staffNo));
      if (map.exists) throw httpError(400, `Staff number ${f.staffNo} is already in use.`);
      t.create(ref, { orgId, staffNo: f.staffNo, name: f.name, positionId: b.positionId, role: b.role || 'staff', active: true,
        startDate: f.startDate, leftAt: null, pinHash, pinSetAt: now(), lastLoginAt: null, createdAt: now(), updatedAt: now(), chainHead: null, chainSeq: 0 });
      t.create(staffNoRef(db, orgId, f.staffNo), { staffId: ref.id, orgId });
      t.create(db.collection('positionHistory').doc(), { orgId, staffId: ref.id, from: null, to: b.positionId, by: actor(req).id, at: now() });
      t.create(db.collection('auditLog').doc(), auditRecord(orgId, actor(req).id, 'staff.create', 'staff', ref.id, { staffNo: f.staffNo, name: f.name, position: b.positionId, role: b.role || 'staff' }, req.ip));
    });
    return { id: ref.id };
  });

  app.patch('/api/admin/staff/:id', { schema: { body: { ...staffSchema, required: ['name', 'staffNo', 'positionId', 'role'] } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const b = req.body, f = validateStaff(org, b);
    const ref = staffRef(req.params.id);
    const others = await managersExcept(orgId, ref.id);
    const changes = await db.runTransaction(async t => {
      const cur = await t.get(ref);
      if (!cur.exists || cur.get('orgId') !== orgId) throw httpError(404, 'Staff member not found.');
      const c = cur.data();
      const newMap = f.staffNo !== c.staffNo ? await t.get(staffNoRef(db, orgId, f.staffNo)) : null;
      if (newMap && newMap.exists) throw httpError(400, `Staff number ${f.staffNo} is already in use.`);
      if (c.role === 'manager' && b.role !== 'manager' && others === 0) throw httpError(400, 'Keep at least one manager on the portal.');
      const changes = {};
      for (const [k, a, z] of [['name', c.name, f.name], ['staffNo', c.staffNo, f.staffNo], ['position', c.positionId, b.positionId], ['role', c.role, b.role], ['startDate', c.startDate || null, f.startDate]]) {
        if ((a ?? null) !== (z ?? null)) changes[k] = { from: a ?? null, to: z ?? null };
      }
      t.update(ref, { name: f.name, staffNo: f.staffNo, positionId: b.positionId, role: b.role, startDate: f.startDate, updatedAt: now() });
      if (newMap) { t.delete(staffNoRef(db, orgId, c.staffNo)); t.create(staffNoRef(db, orgId, f.staffNo), { staffId: ref.id, orgId }); }
      if (changes.position) t.create(db.collection('positionHistory').doc(), { orgId, staffId: ref.id, from: c.positionId, to: b.positionId, by: actor(req).id, at: now() });
      if (Object.keys(changes).length) t.create(db.collection('auditLog').doc(), auditRecord(orgId, actor(req).id, 'staff.update', 'staff', ref.id, changes, req.ip));
      return changes;
    });
    if (changes.role || changes.staffNo) await revokeAllFor(db, ref.id); // takes effect at the next sign-in
    return { ok: true, changed: Object.keys(changes) };
  });

  app.post('/api/admin/staff/:id/pin', { schema: { body: { type: 'object', required: ['pin'], properties: { pin: { type: 'string', maxLength: 6 } } } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    if (!validPin(req.body.pin)) throw httpError(400, 'The PIN must be 4 to 6 digits.');
    const s = await staffRef(req.params.id).get();
    if (!s.exists || s.get('orgId') !== orgId) throw httpError(404, 'Staff member not found.');
    await s.ref.update({ pinHash: await hashPin(req.body.pin), pinSetAt: now(), updatedAt: now() });
    await Promise.all([revokeAllFor(db, s.id), clearLockout(db, orgId, s.get('staffNo')), audit(db, orgId, actor(req).id, 'staff.pin_reset', 'staff', s.id, {}, req.ip)]);
    return { ok: true };
  });

  app.post('/api/admin/staff/:id/active', { schema: { body: { type: 'object', required: ['active'], properties: { active: { type: 'boolean' } } } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const s = await staffRef(req.params.id).get();
    if (!s.exists || s.get('orgId') !== orgId) throw httpError(404, 'Staff member not found.');
    if (!req.body.active) {
      if (s.id === actor(req).id) throw httpError(400, "You can't mark yourself as left.");
      if (s.get('role') === 'manager' && (await managersExcept(orgId, s.id)) === 0) throw httpError(400, 'Keep at least one active manager on the portal.');
      await s.ref.update({ active: false, leftAt: now(), updatedAt: now() });
      await revokeAllFor(db, s.id);
      await audit(db, orgId, actor(req).id, 'staff.deactivate', 'staff', s.id, {}, req.ip);
    } else {
      await s.ref.update({ active: true, leftAt: null, updatedAt: now() });
      await audit(db, orgId, actor(req).id, 'staff.reactivate', 'staff', s.id, {}, req.ip);
    }
    return { ok: true };
  });

  // ---- documents --------------------------------------------------------------
  async function getDoc(orgId, code) {
    const s = await docRef(db, orgId, code).get();
    if (!s.exists) throw httpError(404, 'Document not found.');
    return s;
  }

  app.get('/api/admin/documents', async (req, reply) => {
    if (!requireRole(req, reply, DOCS_VIEW)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const [docs, staff, pub, prog] = await Promise.all([allDocs(orgId), loadStaff(db, orgId, { activeOnly: true }), loadPublishedDocs(db, orgId), loadProgress(db, orgId)]);
    const sums = new Map(staff.map(s => [s.id, summarise(s, pub, prog)]));
    const list = docs.map(d => {
      const cur = d.current, pubd = d.status === 'published';
      const audience = pubd ? cur.audience : d.draft.audience;
      let stats = null;
      if (pubd) {
        const people = staff.filter(s => appliesTo(audience, s.positionId));
        stats = { total: people.length, done: people.filter(s => sums.get(s.id).items.find(i => i.doc.code === d.code)?.status === 'done').length };
      }
      const sv = d.startVersion;
      return {
        code: d.code, kind: d.kind, status: d.status, hold: d.hold || null, draftDirty: !!d.draftDirty, shared: d.shared ? { at: d.shared.at, provider: d.shared.provider } : null,
        title: (pubd ? cur.title : d.draft.title) || 'Untitled',
        label: cur ? verLabel(cur.major, cur.minor) : sv ? verLabel(sv.major, sv.minor) : '1.0',
        order: d.draft.order, questionCount: pubd ? cur.questionCount : (d.draft.questions || []).length,
        videoCount: pubd ? cur.videos.length : (d.draft.videos || []).length, audience,
        publishedAt: cur ? cur.publishedAt : null, firstPublishedAt: d.firstPublishedAt || null, stats,
        ready: d.status === 'draft' && !d.hold && draftProblems(d.draft).length === 0,
      };
    }).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.code.localeCompare(b.code));
    const counts = {};
    for (const p of org.positions) counts[p.id] = staff.filter(s => s.positionId === p.id).length;
    return { documents: list, activeByPosition: counts };
  });

  app.get('/api/admin/next-code', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const kind = KINDS[req.query.kind] ? req.query.kind : 'sop';
    const org = await loadOrg(db, orgId);
    return { code: nextCode(kind, (await allDocs(orgId)).map(d => d.code), org.docPrefix) };
  });

  async function docDetail(orgId, code) {
    const s = await getDoc(orgId, code), d = s.data();
    const [vs, files] = await Promise.all([
      s.ref.collection('versions').get(),
      fileMeta(db, orgId, [d.draft.pdfFileId, ...(d.draft.videos || []).map(v => v.fileId)]),
    ]);
    const names = new Map((await loadStaff(db, orgId)).map(x => [x.id, x.name]));
    const cur = d.current;
    return {
      code: d.code, kind: d.kind, status: d.status, hold: d.hold || null, draftDirty: !!d.draftDirty, draft: d.draft,
      startVersion: d.startVersion || null, shared: d.shared ? { at: d.shared.at, provider: d.shared.provider } : null,
      current: cur ? { versionId: cur.versionId, major: cur.major, minor: cur.minor, label: verLabel(cur.major, cur.minor), publishedAt: cur.publishedAt } : null,
      firstPublishedAt: d.firstPublishedAt || null,
      versions: vs.docs.map(x => x.data()).sort((a, b) => b.major - a.major || b.minor - a.minor)
        .map(v => ({ id: versionKey(v.major, v.minor), label: verLabel(v.major, v.minor), publishedAt: v.publishedAt, by: v.publishedBy ? names.get(v.publishedBy) || null : null, hash: v.contentHash })),
      files: Object.fromEntries([...files].map(([id, f]) => [id, { id, name: f.name, size: f.size, duration: f.duration, kind: f.kind }])),
      problems: draftProblems(d.draft),
    };
  }

  app.get('/api/admin/documents/:code', async (req, reply) => {
    if (!requireRole(req, reply, DOCS_VIEW)) return;
    const orgId = req.orgId;
    return docDetail(orgId, req.params.code);
  });

  app.post('/api/admin/documents', { schema: { body: { type: 'object', required: ['kind'], properties: {
    kind: { type: 'string', enum: Object.keys(KINDS) }, code: { type: 'string', maxLength: 32 } } } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const codes = (await allDocs(orgId)).map(d => d.code);
    const code = req.body.code ? String(req.body.code).trim().toUpperCase() : nextCode(req.body.kind, codes, org.docPrefix);
    if (!CODE_RE.test(code)) throw httpError(400, `Document codes use capital letters, numbers and dashes, e.g. ${org.docPrefix}-SOP-013.`);
    try {
      await docRef(db, orgId, code).create({ orgId, code, kind: req.body.kind, status: 'draft', hold: null, draft: newDraft(code, req.body.kind),
        draftDirty: false, current: null, startVersion: { major: 1, minor: 0 }, firstPublishedAt: null, createdAt: now(), updatedAt: now() });
    } catch (e) { if (e.code === 6) throw httpError(400, `${code} already exists.`); throw e; }
    await audit(db, orgId, actor(req).id, 'document.create', 'document', code, { kind: req.body.kind }, req.ip);
    return docDetail(orgId, code);
  });

  app.put('/api/admin/documents/:code', { schema: { body: { type: 'object', required: ['draft'], properties: {
    draft: { type: 'object' }, code: { type: 'string', maxLength: 32 }, kind: { type: 'string', enum: Object.keys(KINDS) } } } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const draft = cleanDraft(req.body.draft, org.positions.map(p => p.id));
    const code = await db.runTransaction(async t => {
      const ref = docRef(db, orgId, req.params.code);
      const s = await t.get(ref);
      if (!s.exists) throw httpError(404, 'Document not found.');
      const d = s.data();
      if (d.shared) {
        // Provided by MSP Academy: the content comes from the platform. The client chooses who must complete it and where it sits.
        const locked = { ...draft, audience: d.draft.audience, order: d.draft.order };
        if (canonical(locked) !== canonical({ ...d.draft })) throw httpError(400, `This document is provided by ${d.shared.provider || 'MSP Academy'}. You can choose who must complete it and its place in the course, but not change its content.`);
        if ((req.body.code && req.body.code.trim().toUpperCase() !== d.code) || (req.body.kind && req.body.kind !== d.kind)) throw httpError(400, 'The code and type of a provided document can’t be changed.');
      }
      await checkFiles(t, db, orgId, draft);
      let newCode = d.code, kind = d.kind, newRef = null;
      if (!d.current && !d.shared) {
        // Code and type can change until the first publish; after that the code is fixed in signed records.
        if (req.body.code && req.body.code.trim().toUpperCase() !== d.code) {
          newCode = req.body.code.trim().toUpperCase();
          if (!CODE_RE.test(newCode)) throw httpError(400, `Document codes use capital letters, numbers and dashes, e.g. ${org.docPrefix}-SOP-013.`);
          newRef = docRef(db, orgId, newCode);
          if ((await t.get(newRef)).exists) throw httpError(400, `${newCode} already exists.`);
        }
        if (req.body.kind) kind = req.body.kind;
      }
      let dirty = false;
      if (d.current) {
        const v = await t.get(ref.collection('versions').doc(versionKey(d.current.major, d.current.minor)));
        dirty = canonical(draft) !== canonical(draftFromVersion(v.data()));
      }
      const data = { ...d, draft, draftDirty: dirty, code: newCode, kind, updatedAt: now() };
      if (newRef) { t.delete(ref); t.create(newRef, data); } else t.set(ref, data);
      t.create(db.collection('auditLog').doc(), auditRecord(orgId, actor(req).id, 'document.save_draft', 'document', newCode, newRef ? { renamedFrom: d.code } : {}, req.ip));
      return newCode;
    });
    return docDetail(orgId, code);
  });

  app.post('/api/admin/documents/:code/publish', { schema: { body: { type: 'object', properties: { change: { type: 'string', enum: ['minor', 'major'] } } } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const result = await publishDocument(db, { orgId, code: req.params.code, change: req.body.change, actorId: actor(req).id });
    return { result, document: await docDetail(orgId, req.params.code) };
  });

  app.post('/api/admin/documents/publish-all', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const drafts = (await allDocs(orgId)).filter(d => d.status === 'draft');
    const ready = drafts.filter(d => !d.hold && draftProblems(d.draft).length === 0).sort((a, b) => a.code.localeCompare(b.code));
    const published = [];
    for (const d of ready) { await publishDocument(db, { orgId, code: d.code, actorId: actor(req).id }); published.push(d.code); }
    return { published, skipped: drafts.length - ready.length, held: drafts.filter(d => d.hold).length };
  });

  async function updateDoc(req, code, check, data, action, details = {}) {
    const orgId = req.orgId;
    await db.runTransaction(async t => {
      const ref = docRef(db, orgId, code);
      const s = await t.get(ref);
      if (!s.exists) throw httpError(404, 'Document not found.');
      check(s.data());
      t.update(ref, { ...(typeof data === 'function' ? await data(s.data(), t) : data), updatedAt: now() });
      t.create(db.collection('auditLog').doc(), auditRecord(orgId, actor(req).id, action, 'document', code, details, req.ip));
    });
    return docDetail(orgId, code);
  }

  app.post('/api/admin/documents/:code/archive', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    return updateDoc(req, req.params.code, d => { if (d.status !== 'published') throw httpError(400, 'Only published documents can be archived.'); },
      { status: 'archived' }, 'document.archive');
  });

  app.post('/api/admin/documents/:code/hold', { schema: { body: { type: 'object', properties: { reason: { type: ['string', 'null'], maxLength: 200 } } } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const reason = req.body.reason ? String(req.body.reason).trim() : null;
    return updateDoc(req, req.params.code, d => { if (d.status !== 'draft') throw httpError(400, 'Only drafts can be put on hold.'); },
      { hold: reason || null }, reason ? 'document.hold' : 'document.release_hold', { reason });
  });

  app.post('/api/admin/documents/:code/discard', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const ref = docRef(db, orgId, req.params.code);
    return updateDoc(req, req.params.code, d => { if (!d.current) throw httpError(400, 'This document has never been published.'); },
      async (d, t) => ({ draft: draftFromVersion((await t.get(ref.collection('versions').doc(versionKey(d.current.major, d.current.minor)))).data()), draftDirty: false }),
      'document.discard_changes');
  });

  app.delete('/api/admin/documents/:code', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    await db.runTransaction(async t => {
      const ref = docRef(db, orgId, req.params.code);
      const s = await t.get(ref);
      if (!s.exists) throw httpError(404, 'Document not found.');
      if (s.get('current')) throw httpError(400, 'Published documents are kept for the record. Archive it instead.');
      t.delete(ref);
      t.create(db.collection('auditLog').doc(), auditRecord(orgId, actor(req).id, 'document.delete_draft', 'document', req.params.code, {}, req.ip));
    });
    return { ok: true };
  });

  // Exactly what was published: frozen text, questions with answers, file fingerprints. For audits and hearings.
  app.get('/api/admin/documents/:code/versions/:vid', async (req, reply) => {
    if (!requireRole(req, reply, DOCS_VIEW)) return;
    const orgId = req.orgId;
    const s = await getDoc(orgId, req.params.code);
    const vs = await s.ref.collection('versions').doc(String(req.params.vid)).get();
    if (!vs.exists) throw httpError(404, 'Version not found.');
    const v = vs.data();
    const files = await fileMeta(db, orgId, [v.pdfFileId, ...(v.videos || []).map(x => x.fileId)]);
    const signed = await db.collection('signoffs').where('orgId', '==', orgId).where('versionId', '==', v.versionId).get();
    const names = new Map((await loadStaff(db, orgId)).map(x => [x.id, x.name]));
    return {
      code: v.code, kind: v.kind, label: verLabel(v.major, v.minor), title: v.title, summary: v.summary, body: v.body,
      audience: v.audience, appliesText: v.appliesText, issueDate: v.issueDate, questions: v.questions, passMark: v.passMark,
      pdf: v.pdfFileId ? { id: v.pdfFileId, name: files.get(v.pdfFileId)?.name } : null,
      videos: v.videos, requireVideo: v.requireVideo, publishedAt: v.publishedAt, publishedBy: v.publishedBy ? names.get(v.publishedBy) || null : null,
      contentHash: v.contentHash, fileHashes: Object.fromEntries([...files].map(([id, f]) => [id, f.sha256])), signoffs: signed.size,
    };
  });

  // Preview as staff: the saved draft, shaped exactly like the staff view (no answers). Nothing is recorded.
  app.get('/api/admin/documents/:code/preview', async (req, reply) => {
    if (!requireRole(req, reply, DOCS_VIEW)) return;
    const orgId = req.orgId;
    const d = (await getDoc(orgId, req.params.code)).data(), dr = d.draft;
    const files = await fileMeta(db, orgId, [dr.pdfFileId, ...(dr.videos || []).map(v => v.fileId)]);
    const sv = d.current || d.startVersion || { major: 1, minor: 0 };
    const pdf = dr.pdfFileId && files.get(dr.pdfFileId);
    return { doc: {
      code: d.code, kind: d.kind, kindLabel: KINDS[d.kind], title: dr.title, summary: dr.summary, body: dr.body,
      versionId: '', major: sv.major, minor: sv.minor, label: verLabel(sv.major, sv.minor), issueDate: dr.issueDate,
      appliesText: dr.appliesText, estMinutes: dr.estMinutes, passMark: dr.passMark,
      pdf: pdf ? { id: dr.pdfFileId, name: pdf.name, size: pdf.size } : null,
      videos: (dr.videos || []).map(v => ({ fileId: v.fileId, title: v.title || 'Training video', duration: Math.round(files.get(v.fileId)?.duration || 0) })),
      requireVideo: dr.requireVideo, questions: (dr.questions || []).map(q => ({ q: q.q, options: q.options })), status: d.status,
    } };
  });

  app.get('/api/admin/preview/:positionId', async (req, reply) => {
    if (!requireRole(req, reply, DOCS_VIEW)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const pos = req.params.positionId;
    if (!org.positions.some(p => p.id === pos)) throw httpError(404, 'Position not found.');
    const items = (await allDocs(orgId)).filter(d => d.status !== 'archived' && appliesTo(d.draft.audience, pos)).map(d => ({
      code: d.code, kind: d.kind, title: d.draft.title || 'Untitled', summary: d.draft.summary, draft: d.status === 'draft',
      estMinutes: d.draft.estMinutes, questionCount: (d.draft.questions || []).length, order: d.draft.order,
      videoCount: (d.draft.videos || []).length, status: 'todo', label: '',
    })).sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
    return { positionName: org.posName(pos), courseTitle: org.courseTitle, items };
  });

  // Optional AI help: draft 5 questions from the text. The manager always checks and edits them.
  /* ---------- courses: modules of lessons (text, video, PDF, quiz, SOP or policy) ----------
     A course is built as a draft and published as frozen versions, like documents. Who must complete it
     is set on the course. Finishing every lesson gives the person a certificate. */
  const courseOut = (s, extra = {}) => {
    const c = s.data(), d = draftOf(c), cur = c.current;
    return { id: s.id, title: d.title || c.title, description: d.description, status: c.status || 'draft', draftDirty: !!c.draftDirty,
      label: cur ? verLabel(cur.major, cur.minor) : null, publishedAt: cur ? cur.publishedAt : null, audience: (cur && !c.draftDirty ? cur.audience : d.audience),
      moduleCount: d.modules.length, lessonCount: lessonsOf(d).length,
      shared: c.shared ? { at: c.shared.at, provider: c.shared.provider } : null, ...extra };
  };
  async function courseStats(orgId, s) {
    const cur = s.get('current'); if (!cur) return null;
    const [staff, comps] = await Promise.all([loadStaff(db, orgId, { activeOnly: true }), db.collection('courseCompletions').where('orgId', '==', orgId).where('courseId', '==', s.id).get()]);
    const people = staff.filter(x => appliesTo(cur.audience, x.positionId));
    const done = new Set(comps.docs.filter(c => c.get('major') === cur.major).map(c => c.get('staffId')));
    return { total: people.length, completed: people.filter(x => done.has(x.id)).length };
  }
  app.get('/api/admin/courses', async (req, reply) => {
    if (!requireRole(req, reply, DOCS_VIEW)) return;
    const orgId = req.orgId;
    const [cs, docs] = await Promise.all([db.collection('courses').where('orgId', '==', orgId).get(), allDocs(orgId)]);
    const byCode = new Map(docs.map(d => [d.code, d]));
    const out = [];
    for (const c of cs.docs) out.push(courseOut(c, { stats: await courseStats(orgId, c),
      documents: codesOf(draftOf(c.data())).map(code => { const d = byCode.get(code); return d ? { code, title: (d.current ? d.current.title : d.draft.title) || 'Untitled', status: d.status } : { code, title: '(deleted)', status: 'missing' }; }) }));
    return { courses: out.sort((a, b) => a.title.localeCompare(b.title)) };
  });
  app.get('/api/admin/courses/:id', async (req, reply) => {
    if (!requireRole(req, reply, DOCS_VIEW)) return;
    const orgId = req.orgId, s = await getCourseFor(db, orgId, req.params.id);
    const d = draftOf(s.data());
    const [vs, files] = await Promise.all([s.ref.collection('versions').get(), fileMeta(db, orgId, fileIdsOf(d))]);
    return courseOut(s, { draft: d, problems: courseProblems(d), stats: await courseStats(orgId, s),
      versions: vs.docs.map(v => v.data()).sort((a, b) => b.major - a.major || b.minor - a.minor).map(v => ({ label: verLabel(v.major, v.minor), publishedAt: v.publishedAt })),
      files: Object.fromEntries([...files].map(([id, f]) => [id, { id, name: f.name, size: f.size, duration: f.duration, kind: f.kind }])) });
  });
  // The simple form ({title, description, codes}) makes one module of SOP lessons; the builder sends {draft}.
  async function draftFromBody(orgId, b, base = null) {
    const org = await loadOrg(db, orgId), positions = org.positions.map(p => p.id);
    if (b.draft) return cleanCourseDraft(b.draft, positions);
    const title = String(b.title || '').trim().replace(/\s+/g, ' ');
    if (title.length < 2) throw httpError(400, 'Give the course a title.');
    const codes = [...new Set((b.codes || []).map(c => String(c).trim().toUpperCase()))];
    if (codes.length > 100) throw httpError(400, 'A course can hold up to 100 documents.');
    const mine = new Set((await allDocs(orgId)).map(d => d.code));
    const missing = codes.filter(c => !mine.has(c));
    if (missing.length) throw httpError(400, missing.length === 1 ? 'One of the chosen documents isn’t in your library.' : `${missing.length} of the chosen documents aren’t in your library.`);
    const prev = base || { audience: { all: true, positions: [] }, modules: [] };
    return cleanCourseDraft({ ...prev, title, description: b.description ?? prev.description ?? '',
      modules: codes.length || !prev.modules.length ? [{ id: 'm-documents', title: 'Documents', lessons: codes.map(code => ({ id: `d-${code.toLowerCase()}`, type: 'document', code })) }] : prev.modules }, positions);
  }
  const courseSchema = { body: { type: 'object', properties: { title: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: 2000 },
    codes: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 40 } }, draft: { type: 'object' } } } };
  app.post('/api/admin/courses', { schema: courseSchema }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId, d = await draftFromBody(orgId, req.body);
    if (d.title.length < 2) throw httpError(400, 'Give the course a title.');
    await checkCourseRefs(db, orgId, d);
    const ref = db.collection('courses').doc();
    await ref.set({ orgId, title: d.title, description: d.description, codes: codesOf(d), draft: d, status: 'draft', draftDirty: false, current: null, shared: null,
      createdAt: now(), updatedAt: now(), createdBy: actor(req).id });
    await audit(db, orgId, actor(req).id, 'course.create', 'course', ref.id, { title: d.title }, req.ip);
    return { id: ref.id };
  });
  app.put('/api/admin/courses/:id', { schema: courseSchema }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId, cur = await getCourseFor(db, orgId, req.params.id);
    const c = cur.data(), before = draftOf(c);
    const d = await draftFromBody(orgId, req.body, before);
    if (c.shared && canonical({ ...d, audience: null }) !== canonical({ ...before, audience: null }))
      throw httpError(400, `This course is provided by ${c.shared.provider || 'MSP Academy'}. You can choose who must complete it, but not change its content.`);
    if (d.title.length < 2) throw httpError(400, 'Give the course a title.');
    await checkCourseRefs(db, orgId, d);
    let dirty = false;
    if (c.current) {
      const v = (await cur.ref.collection('versions').doc(`${c.current.major}.${c.current.minor}`).get()).data();
      dirty = canonical(d) !== canonical({ title: v.title, description: v.description, audience: v.audience, modules: v.modules });
    }
    await cur.ref.update({ draft: d, draftDirty: dirty, title: c.current ? c.title : d.title, description: c.current ? c.description || '' : d.description, codes: c.current ? c.codes : codesOf(d), updatedAt: now() });
    await audit(db, orgId, actor(req).id, 'course.save_draft', 'course', cur.id, { title: d.title }, req.ip);
    return { ok: true, draftDirty: dirty, problems: courseProblems(d) };
  });
  app.post('/api/admin/courses/:id/publish', { schema: { body: { type: 'object', properties: { change: { type: 'string', enum: ['minor', 'major'] } } } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const r = await publishCourse(db, { orgId: req.orgId, courseId: req.params.id, change: req.body.change, actorId: actor(req).id });
    return { result: r };
  });
  app.delete('/api/admin/courses/:id', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId, cur = await getCourseFor(db, orgId, req.params.id);
    if (cur.get('current')) {
      // Published once: people may hold certificates for it, so it's withdrawn rather than deleted.
      await cur.ref.update({ status: 'archived', updatedAt: now() });
      await audit(db, orgId, actor(req).id, 'course.archive', 'course', cur.id, { title: cur.get('title') }, req.ip);
      return { ok: true, archived: true };
    }
    await cur.ref.delete();
    await audit(db, orgId, actor(req).id, 'course.delete', 'course', cur.id, { title: cur.get('title') }, req.ip);
    return { ok: true };
  });

  /* ---------- field evidence: what staff submitted for a course lesson, waiting for a manager ---------- */
  app.get('/api/admin/evidence', async (req, reply) => {
    if (!requireRole(req, reply, VIEW)) return;
    const orgId = req.orgId, org = await loadOrg(db, orgId);
    const want = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'pending';
    const [q, staff] = await Promise.all([db.collection('courseEvidence').where('orgId', '==', orgId).get(), loadStaff(db, orgId, {})]);
    const byId = new Map(staff.map(x => [x.id, x]));
    const dept = scopeDept(req, org);
    const items = q.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(e => want === 'all' || e.status === want)
      .filter(e => { const p = byId.get(e.staffId); return p && (!dept || org.deptOf(p.positionId) === dept); })
      .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)).slice(0, 200)
      .map(e => { const p = byId.get(e.staffId); return { id: e.id, status: e.status, text: e.text, fileId: e.fileId, note: e.note, submittedAt: e.submittedAt, reviewedAt: e.reviewedAt,
        courseId: e.courseId, courseTitle: e.courseTitle, lessonTitle: e.lessonTitle, staffId: e.staffId, staffName: p.name, staffNo: p.staffNo, positionName: org.posName(p.positionId) }; });
    return { items, pending: q.docs.filter(d => d.get('status') === 'pending').length };
  });
  app.post('/api/admin/evidence/:id/review', { schema: { body: { type: 'object', required: ['decision'], properties: {
    decision: { type: 'string', enum: ['approve', 'reject'] }, note: { type: ['string', 'null'], maxLength: 1000 } } } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId, note = String(req.body.note || '').trim();
    if (req.body.decision === 'reject' && note.length < 3) throw httpError(400, 'Say what needs to change, so they can submit again.');
    const ev = await db.runTransaction(async t => {
      const ref = db.collection('courseEvidence').doc(String(req.params.id));
      const e = await t.get(ref);
      if (!e.exists || e.get('orgId') !== orgId) throw httpError(404, 'Not found.');
      if (e.get('status') !== 'pending') throw httpError(400, 'This evidence has already been reviewed.');
      const x = e.data();
      t.update(ref, { status: req.body.decision === 'approve' ? 'approved' : 'rejected', note: note || null, reviewedAt: now(), reviewedBy: actor(req).id });
      if (req.body.decision === 'approve') t.set(db.collection('courseProgress').doc(`${x.staffId}__${x.courseId}__${x.major}`),
        { orgId, staffId: x.staffId, courseId: x.courseId, major: x.major, lessons: { [x.lessonId]: now() } }, { merge: true });
      t.create(db.collection('auditLog').doc(), auditRecord(orgId, actor(req).id, req.body.decision === 'approve' ? 'evidence.approve' : 'evidence.reject', 'staff', x.staffId,
        { course: x.courseTitle, lesson: x.lessonTitle, note: note || null }, req.ip));
      return x;
    });
    if (req.body.decision === 'approve') {
      const st = await db.collection('staff').doc(ev.staffId).get();
      // The last step may have been this one: issue the certificate if everything is now done.
      try { await issueCertificateIfDone(db, { id: st.id, orgId, positionId: st.get('positionId') }, ev.courseId, { ip: null, userAgent: null }); } catch {}
    }
    return { ok: true };
  });

  app.post('/api/admin/documents/:code/draft-questions', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    if (!config.anthropicApiKey) throw httpError(400, 'AI question drafting is not switched on for this portal.');
    const d = (await getDoc(orgId, req.params.code)).data();
    const org = await loadOrg(db, orgId);
    const body = String(d.draft.body || '').slice(0, 60000);
    if (body.trim().length < 200) throw httpError(400, 'Save the document text first. There is not enough content to draft questions from.');
    const prompt = `You write short staff-training quiz questions for ${org.orgName}.\n\nFrom the document below, write exactly 5 multiple-choice questions that check whether a staff member understood the practical rules they must follow. Each question has 4 options and exactly one correct answer. Use plain, simple English. Avoid trick questions and "all of the above".\n\nReply with JSON only, no other text, in this shape:\n[{"q": "question", "options": ["a","b","c","d"], "correct": 0}]\n\nDocument: ${d.draft.title}\n\n${body}`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.anthropicModel, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw httpError(502, 'The question drafting service did not respond. Try again later, or write the questions yourself.');
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').replace(/```json|```/g, '').trim();
    let qs; try { qs = JSON.parse(text); } catch { throw httpError(502, 'The drafted questions could not be read. Try again.'); }
    const clean = (Array.isArray(qs) ? qs : []).slice(0, 5).map(q => ({ q: String(q.q || ''), options: (q.options || []).slice(0, 5).map(String), correct: Number.isInteger(q.correct) ? q.correct : 0 }))
      .filter(q => q.q && q.options.length >= 2);
    await audit(db, orgId, actor(req).id, 'document.ai_questions', 'document', d.code, { count: clean.length }, req.ip);
    return { questions: clean };
  });

  // ---- file upload --------------------------------------------------------------
  app.post('/api/admin/files', async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const part = await req.file();
    if (!part) throw httpError(400, 'Choose a file to upload.');
    const name = String(part.filename || 'file').replace(/[\\/\0]/g, '_').slice(0, 200);
    const isPdf = part.mimetype === 'application/pdf' || /\.pdf$/i.test(name);
    const isMp4 = ['video/mp4', 'video/quicktime'].includes(part.mimetype) || /\.(mp4|m4v|mov)$/i.test(name);
    if (!isPdf && !isMp4) { part.file.resume(); throw httpError(400, 'Upload a PDF document or an MP4 video.'); }
    let buf;
    const tooLarge = () => httpError(413, config.vercel ? `That file is too large for the review site (limit ${config.maxUploadMb} MB). For videos, use a YouTube link instead.` : `That file is too large. The limit is ${config.maxUploadMb} MB; compress the video and try again.`);
    try { buf = await part.toBuffer(); } catch { throw tooLarge(); }
    // The size-limit error can arrive after the cut-off file was handed over: never store a shortened file.
    if (part.file.truncated || buf.length >= config.maxUploadMb * 1024 * 1024) throw tooLarge();
    let duration = null;
    if (isPdf && buf.toString('latin1', 0, 5) !== '%PDF-') throw httpError(400, "That file isn't a valid PDF.");
    if (isMp4) {
      if (buf.toString('latin1', 4, 8) !== 'ftyp') throw httpError(400, "That file isn't a valid MP4 video.");
      duration = mp4Duration(buf);
      if (!duration) throw httpError(400, "The video's length could not be read. Export it as an MP4 (H.264) and try again.");
    }
    const kind = isPdf ? 'pdf' : 'video';
    const stored = await storage.putBuffer(buf, isPdf ? 'application/pdf' : 'video/mp4', storagePrefix(orgId, 'files'));
    const ref = db.collection('files').doc();
    await ref.create({ orgId, kind, name, mime: isPdf ? 'application/pdf' : 'video/mp4', size: stored.size, sha256: stored.sha256,
      storageKey: stored.key, duration: duration && Math.round(duration), uploadedBy: actor(req).id, createdAt: now() });
    await audit(db, orgId, actor(req).id, 'file.upload', 'file', ref.id, { name, size: stored.size, sha256: stored.sha256 }, req.ip);
    return { id: ref.id, name, size: stored.size, kind, duration: duration && Math.round(duration) };
  });

  // ---- reports ----------------------------------------------------------------
  app.get('/api/admin/reports', async (req, reply) => {
    if (!requireRole(req, reply, VIEW)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const all = await scopedRows(req, org);
    const deptFilter = scopeDept(req, org) || (org.departments.some(d => d.id === req.query.dept) ? req.query.dept : null);
    const departments = deptRollup(org, all.rows);
    const tot = departments.reduce((o, r) => ({ staff: o.staff + r.staff, required: o.required + r.required, done: o.done + r.done, upToDate: o.upToDate + r.upToDate, declarations: o.declarations + r.declarations }),
      { staff: 0, required: 0, done: 0, upToDate: 0, declarations: 0 });
    const rows = all.rows.filter(r => !deptFilter || org.deptOf(r.staff.positionId) === deptFilter)
      .sort((a, b) => org.deptOf(a.staff.positionId).localeCompare(org.deptOf(b.staff.positionId)) || a.staff.name.localeCompare(b.staff.name));
    return {
      asAt: now(), departments, total: { ...tot, pct: tot.required ? Math.round((tot.done / tot.required) * 100) : null },
      documents: all.docs.map(d => ({ code: d.code, title: d.title })),
      matrix: rows.map(r => ({ id: r.staff.id, name: r.staff.name, positionName: org.posName(r.staff.positionId), done: r.sum.done, total: r.sum.total,
        cells: all.docs.map(d => r.sum.items.find(i => i.doc.code === d.code)?.status || 'na') })),
      scopeDept: scopeDept(req, org),
    };
  });

  app.get('/api/admin/reports/register.csv', async (req, reply) => {
    if (!requireRole(req, reply, VIEW)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const { rows } = await scopedRows(req, org, { includeInactive: true });
    const statusText = { done: 'Signed', updated: 'Updated, sign again', inprogress: 'In progress', todo: 'Not started' };
    const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const dt = v => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '');
    const lines = [['Staff number', 'Name', 'Position', 'Department', 'Employment', 'Document', 'Title', 'Type', 'Current version',
      'Sign-off status', 'Version signed', 'Signed on', 'Quiz score', 'Attempts', 'Declaration signed'].join(',')];
    for (const { staff: s, sum } of rows.sort((a, b) => a.staff.name.localeCompare(b.staff.name))) {
      for (const i of sum.items) {
        const d = i.doc;
        lines.push([s.staffNo, s.name, org.posName(s.positionId), org.deptName(org.deptOf(s.positionId)), s.active ? 'Active' : 'Left',
          d.code, d.title, KINDS[d.kind], d.label, statusText[i.status], i.signoff ? i.signoff.label : '', dt(i.signoff && i.signoff.at),
          i.signoff && i.signoff.score != null ? i.signoff.score + '%' : '', i.signoff ? i.signoff.attempts : (i.progress ? i.progress.attempts || 0 : 0),
          dt(sum.declaration && sum.declaration.at)].map(cell).join(','));
      }
    }
    await audit(db, orgId, actor(req).id, 'report.export_csv', 'report', 'register', { rows: lines.length - 1 }, req.ip);
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${orgId}-training-register-${now().slice(0, 10)}.csv"`);
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  });

  // ---- settings ---------------------------------------------------------------
  app.get('/api/admin/config', async (req, reply) => {
    if (!requireRole(req, reply, DOCS_VIEW)) return;
    const orgId = req.orgId;
    const org = await loadOrg(db, orgId);
    const used = [...new Set((await loadStaff(db, orgId)).map(s => s.positionId))];
    return { orgName: org.orgName, courseTitle: org.courseTitle, declarationText: org.declarationText, departments: org.departments, positions: org.positions, usedPositions: used,
      docPrefix: org.docPrefix, staffNoPrefix: org.staffNoPrefix, loginCode: org.raw.loginCode || null, clientNo: org.raw.clientNo || null, domains: org.raw.domains || [] };
  });

  app.put('/api/admin/config', { schema: { body: { type: 'object', required: ['orgName', 'courseTitle', 'declarationText', 'departments', 'positions'], properties: {
    orgName: { type: 'string', maxLength: 120 }, courseTitle: { type: 'string', maxLength: 200 }, declarationText: { type: 'string', maxLength: 4000 },
    departments: { type: 'array', maxItems: 50, items: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string', maxLength: 60 }, name: { type: 'string', maxLength: 80 } } } },
    positions: { type: 'array', maxItems: 200, items: { type: 'object', required: ['id', 'name', 'dept'], properties: { id: { type: 'string', maxLength: 60 }, name: { type: 'string', maxLength: 80 }, dept: { type: 'string', maxLength: 60 } } } },
  } } } }, async (req, reply) => {
    if (!requireRole(req, reply, EDIT)) return;
    const orgId = req.orgId;
    const b = req.body;
    if (!b.orgName.trim() || !b.courseTitle.trim()) throw httpError(400, 'Enter the business name and the course name.');
    if (!b.declarationText.includes('{name}')) throw httpError(400, 'Keep {name} in the declaration text so each person’s name is filled in.');
    const org = await loadOrg(db, orgId);
    const used = new Set((await loadStaff(db, orgId)).map(s => s.positionId));
    const slug = (s, taken) => { const base = s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'item'; let id = base, n = 2; while (taken.has(id)) id = base + n++; taken.add(id); return id; };
    const oldD = new Set(org.departments.map(d => d.id)), oldP = new Set(org.positions.map(p => p.id));
    const takenD = new Set(oldD), takenP = new Set(oldP), dMap = new Map();
    const departments = b.departments.map(d => {
      if (!d.name.trim()) throw httpError(400, 'Every department needs a name.');
      const id = oldD.has(d.id) ? d.id : slug(d.name, takenD); dMap.set(d.id, id); return { id, name: d.name.trim() };
    });
    const positions = b.positions.map(p => {
      if (!p.name.trim()) throw httpError(400, 'Every position needs a name.');
      const dept = dMap.get(p.dept); if (!dept) throw httpError(400, `Position ${p.name} is in a department that no longer exists.`);
      return { id: oldP.has(p.id) ? p.id : slug(p.name, takenP), name: p.name.trim(), dept };
    });
    const keepP = new Set(positions.map(p => p.id));
    for (const id of oldP) if (!keepP.has(id) && used.has(id)) throw httpError(400, 'A position with staff in it cannot be removed. Move those staff first.');
    for (const d of org.departments) if (!departments.some(x => x.id === d.id) && positions.some(p => p.dept === d.id)) throw httpError(400, 'Remove or move the positions in a department before removing it.');
    await db.collection('orgs').doc(orgId).update({ name: b.orgName.trim(), courseTitle: b.courseTitle.trim(), declarationText: b.declarationText.trim(), departments, positions, updatedAt: now() });
    invalidate(db);
    await audit(db, orgId, actor(req).id, 'settings.update', 'organisation', orgId, { declarationChanged: org.declarationText !== b.declarationText.trim(), departments: departments.map(d => d.name), positions: positions.length }, req.ip);
    return { ok: true };
  });

  // ---- audit log --------------------------------------------------------------
  app.get('/api/admin/audit', async (req, reply) => {
    if (!requireRole(req, reply, DOCS_VIEW)) return;
    const orgId = req.orgId;
    const limit = Math.min(500, Number(req.query.limit) || 200);
    const q = await db.collection('auditLog').where('orgId', '==', orgId).orderBy('at', 'desc').limit(limit).get();
    const names = new Map((await loadStaff(db, orgId)).map(x => [x.id, x.name]));
    return { entries: q.docs.map(s => { const a = s.data(); return { id: s.id, action: a.action, entity: a.entity, entity_id: a.entityId, details: a.details, at: a.at, actor: a.actorName || (a.actorId ? names.get(a.actorId) || null : null) }; }) };
  });
}
