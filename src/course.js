// Loads what's needed to work out every person's course and status, then applies the rules.
// At Pelagos scale (tens of staff, tens of documents) loading it all per request is fast and cheap.
import { appliesTo, docStatus, isNewFor, verLabel } from './rules.js';
import { httpError } from './documents.js';

export async function loadOrg(db, orgId) {
  const s = await db.collection('orgs').doc(orgId).get();
  if (!s.exists) throw httpError(503, 'The portal has not been set up yet. Run the setup first.');
  const o = s.data();
  const posById = new Map(o.positions.map(x => [x.id, x]));
  const deptById = new Map(o.departments.map(x => [x.id, x]));
  return {
    id: orgId, orgName: o.name, courseTitle: o.courseTitle, declarationText: o.declarationText,
    departments: o.departments, positions: o.positions,
    posName: id => posById.get(id)?.name || 'No position',
    deptOf: id => posById.get(id)?.dept || '',
    deptName: id => deptById.get(id)?.name || 'Unassigned',
  };
}

/** Published documents with a summary of their current version (no text, no answers). */
export async function loadPublishedDocs(db, orgId) {
  const q = await db.collection('documents').where('orgId', '==', orgId).get();
  return q.docs.map(s => s.data()).filter(d => d.status === 'published' && d.current)
    .map(d => ({ id: d.code, code: d.code, kind: d.kind, status: d.status, firstPublishedAt: d.firstPublishedAt,
      ...d.current, label: verLabel(d.current.major, d.current.minor) }))
    .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
}

const byAtDesc = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);

/** Sign-offs, progress and declarations for the given staff ids (or everyone in the org). */
export async function loadProgress(db, orgId, staffIds = null) {
  const one = staffIds && staffIds.length === 1;
  const q = c => one ? db.collection(c).where('staffId', '==', staffIds[0]).get() : db.collection(c).where('orgId', '==', orgId).get();
  const keep = staffIds ? new Set(staffIds) : null;
  const [so, pr, de] = await Promise.all([q('signoffs'), q('progress'), q('declarations')]);
  const rows = snap => snap.docs.map(s => ({ id: s.id, ...s.data() })).filter(r => !keep || keep.has(r.staffId));
  const k = (...a) => a.join(':');
  const signoffs = new Map();
  for (const r of rows(so).sort(byAtDesc)) if (!signoffs.has(k(r.staffId, r.code))) signoffs.set(k(r.staffId, r.code), r);
  const progress = new Map(rows(pr).map(r => [k(r.staffId, r.code, r.major), r]));
  const declarations = new Map();
  for (const r of rows(de).sort(byAtDesc)) if (!declarations.has(r.staffId)) declarations.set(r.staffId, r);
  return { signoffs, progress, declarations, k };
}

/** One person's course: every published document whose audience includes their position. */
export function summarise(staff, docs, prog) {
  const { k } = prog;
  const decl = prog.declarations.get(staff.id) || null;
  const items = [];
  for (const d of docs) {
    if (!appliesTo(d.audience, staff.positionId)) continue;
    const so = prog.signoffs.get(k(staff.id, d.code)) || null;
    const p = prog.progress.get(k(staff.id, d.code, d.major)) || null;
    const status = docStatus({ currentMajor: d.major, signedMajor: so ? so.major : null, active: !!(p && (p.readAt || p.attempts)) });
    items.push({ doc: d, status, signoff: so, progress: p, isNew: status !== 'done' && isNewFor(d.firstPublishedAt, decl && decl.at) });
  }
  const done = items.filter(i => i.status === 'done').length;
  const outstanding = items.filter(i => i.status !== 'done');
  const covered = new Set(((decl && decl.items) || []).map(i => String(i.signoffId)));
  const declarationCurrent = !!decl && items.length > 0 && !outstanding.length && items.every(i => covered.has(String(i.signoff.id)));
  return {
    items, total: items.length, done, outstanding,
    pct: items.length ? Math.round((done / items.length) * 100) : 100,
    upToDate: items.length > 0 && !outstanding.length,
    declaration: decl ? { id: decl.id, at: decl.at } : null,
    declarationCurrent,
    canDeclare: items.length > 0 && !outstanding.length && !declarationCurrent,
  };
}

export const shapeStaff = s => {
  const r = s.data();
  return { id: s.id, staffNo: r.staffNo, name: r.name, positionId: r.positionId, role: r.role, isManager: r.role === 'manager',
    active: r.active, startDate: r.startDate || null, leftAt: r.leftAt || null, lastLoginAt: r.lastLoginAt || null, createdAt: r.createdAt, pinSetAt: r.pinSetAt };
};

export async function loadStaff(db, orgId, { activeOnly = false, deptId = null, org = null } = {}) {
  const q = await db.collection('staff').where('orgId', '==', orgId).get();
  let list = q.docs.map(shapeStaff).filter(s => !activeOnly || s.active).sort((a, b) => a.name.localeCompare(b.name));
  if (deptId && org) list = list.filter(s => org.deptOf(s.positionId) === deptId);
  return list;
}

export function deptRollup(org, rows) {
  return org.departments.map(d => {
    const rs = rows.filter(x => org.deptOf(x.staff.positionId) === d.id);
    const req = rs.reduce((n, x) => n + x.sum.total, 0), done = rs.reduce((n, x) => n + x.sum.done, 0);
    return { id: d.id, name: d.name, staff: rs.length, required: req, done, pct: req ? Math.round((done / req) * 100) : null,
      upToDate: rs.filter(x => x.sum.upToDate).length, declarations: rs.filter(x => x.sum.declaration).length };
  }).filter(r => r.staff > 0);
}
