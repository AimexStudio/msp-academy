// Courses built from modules and lessons.
//
//   courses/{id}                 orgId, status (draft | published | archived), draft, draftDirty, current, shared, codes (SOP lessons, for lists)
//   courses/{id}/versions/{M.m}  each published version, frozen: what learners take
//   courseProgress/{staff__course__major}  which lessons a person has finished in that version
//   courseCompletions/{id}       the certificate: evidence, in the person's tamper-evident chain
//
// Lesson types: text, video, pdf, quiz, document (an SOP or policy, read and signed in its own flow).
// Lessons unlock in order. Finishing every lesson issues a certificate. A new version (major change)
// asks people to take the course again; a minor change keeps their progress.
import crypto from 'node:crypto';
import { httpError, now, sha256, canonical, docRef, auditRecord } from './documents.js';
import { appliesTo, verLabel, markQuiz } from './rules.js';
import { appendEvidence } from './evidence.js';

export const LESSON_TYPES = { text: 'Text', video: 'Video', pdf: 'PDF', quiz: 'Quiz', document: 'SOP or policy' };
export const newId = (p = 'l') => `${p}-${crypto.randomBytes(5).toString('hex')}`;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const str = (v, max) => String(v ?? '').replace(/\u0000/g, '').slice(0, max);
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** The editable course. Courses made before the builder (a list of documents) become one module of SOP lessons. */
export function draftOf(c) {
  if (c.draft) return c.draft;
  return { title: c.title || '', description: c.description || '', audience: { all: true, positions: [] },
    modules: (c.codes || []).length ? [{ id: 'm-documents', title: 'Documents', lessons: c.codes.map(code => ({ id: `d-${code.toLowerCase()}`, type: 'document', title: '', code })) }] : [] };
}
export const lessonsOf = d => (d.modules || []).flatMap(m => m.lessons);
export const codesOf = d => [...new Set(lessonsOf(d).filter(l => l.type === 'document' && l.code).map(l => l.code))];
export const fileIdsOf = d => [...new Set(lessonsOf(d).filter(l => (l.type === 'video' || l.type === 'pdf') && l.fileId).map(l => l.fileId))];

/** Keep only known fields with sane values; give every module and lesson a stable, unique id. */
export function cleanCourseDraft(input = {}, positionIds = []) {
  const valid = new Set(positionIds), seen = new Set();
  const uid = (id, p) => { let x = ID_RE.test(String(id || '')) ? String(id) : newId(p); while (seen.has(x)) x = newId(p); seen.add(x); return x; };
  const a = input.audience || {};
  const modules = (Array.isArray(input.modules) ? input.modules : []).slice(0, 50).map(m => ({
    id: uid(m.id, 'm'), title: str(m.title, 200).trim(),
    lessons: (Array.isArray(m.lessons) ? m.lessons : []).slice(0, 100).filter(l => LESSON_TYPES[l.type]).map(l => {
      const base = { id: uid(l.id, 'l'), type: l.type, title: str(l.title, 200).trim() };
      if (l.type === 'text') return { ...base, body: str(l.body, 200000) };
      if (l.type === 'video' || l.type === 'pdf') return { ...base, fileId: l.fileId ? str(l.fileId, 60) : null };
      if (l.type === 'document') return { ...base, code: l.code ? str(l.code, 40).trim().toUpperCase() : null };
      return { ...base, passMark: clampInt(l.passMark, 50, 100, 80),
        questions: (Array.isArray(l.questions) ? l.questions : []).slice(0, 50).map(q => ({
          q: str(q.q, 500), options: (Array.isArray(q.options) ? q.options : []).slice(0, 6).map(o => str(o, 300)),
          correct: Number.isInteger(q.correct) ? q.correct : -1 })) };
    }),
  }));
  return { title: str(input.title, 120).trim(), description: str(input.description, 1000).trim(),
    audience: { all: !!a.all, positions: [...new Set((a.positions || []).map(String))].filter(p => valid.has(p)) }, modules };
}

/** What still has to be done before a course can be published. */
export function courseProblems(d) {
  const p = [];
  if (d.title.length < 2) p.push('Give the course a title.');
  const lessons = lessonsOf(d);
  if (!lessons.length) p.push('Add at least one lesson.');
  if (!d.audience.all && !d.audience.positions.length) p.push('Choose who must complete the course.');
  d.modules.forEach((m, mi) => { if (!m.title) p.push(`Module ${mi + 1} needs a title.`); });
  lessons.forEach((l, i) => {
    const name = l.title || `Lesson ${i + 1}`;
    if (l.type !== 'document' && !l.title) p.push(`Lesson ${i + 1} needs a title.`);
    if (l.type === 'text' && !l.body.trim()) p.push(`${name} has no text yet.`);
    if ((l.type === 'video' || l.type === 'pdf') && !l.fileId) p.push(`${name} needs its ${l.type === 'video' ? 'video' : 'PDF'} uploaded.`);
    if (l.type === 'document' && !l.code) p.push(`${name}: choose the SOP or policy.`);
    if (l.type === 'quiz') {
      if (!l.questions.length) p.push(`${name} has no questions.`);
      l.questions.forEach((q, qi) => {
        if (!q.q.trim() || q.options.filter(o => o.trim()).length < 2 || q.correct < 0 || q.correct >= q.options.length || !q.options[q.correct].trim())
          p.push(`${name}, question ${qi + 1}: write the question, at least two answers, and tick the correct one.`);
      });
    }
  });
  return p;
}

/** Every file and SOP a course points to must belong to the same client (and be the right kind). */
export async function checkCourseRefs(db, orgId, d, t = null) {
  const get = r => (t ? t.get(r) : r.get());
  for (const l of lessonsOf(d)) {
    if ((l.type === 'video' || l.type === 'pdf') && l.fileId) {
      const f = await get(db.collection('files').doc(l.fileId));
      if (!f.exists || f.get('orgId') !== orgId || f.get('kind') !== (l.type === 'video' ? 'video' : 'pdf')) throw httpError(400, `${l.title || 'A lesson'}: the ${l.type === 'video' ? 'video' : 'PDF'} is missing. Upload it again.`);
    }
    if (l.type === 'document' && l.code) {
      const s = await get(docRef(db, orgId, l.code));
      if (!s.exists) throw httpError(400, 'One of the chosen SOPs or policies isn’t in your library.');
    }
  }
}

export function courseRef(db, id) { return db.collection('courses').doc(String(id)); }
export async function getCourseFor(db, orgId, id, t = null) {
  const r = courseRef(db, id);
  const s = t ? await t.get(r) : await r.get();
  if (!s.exists || s.get('orgId') !== orgId) throw httpError(404, 'Course not found.');
  return s;
}

/** Publish the draft as a new frozen version. change: 'minor' (progress kept) or 'major' (everyone takes it again). */
export async function publishCourse(db, { orgId, courseId, change, actorId = null, actorName = null }) {
  return db.runTransaction(async t => {
    const s = await getCourseFor(db, orgId, courseId, t);
    const c = s.data(), d = draftOf(c), cur = c.current || null;
    const problems = courseProblems(d);
    if (problems.length) throw httpError(400, problems[0], { problems });
    await checkCourseRefs(db, orgId, d, t);
    for (const code of codesOf(d)) {
      const ds = await t.get(docRef(db, orgId, code));
      if (ds.get('status') !== 'published') throw httpError(400, `Publish ${code} in the SOP library first: it's part of this course.`);
    }
    if (cur && !c.draftDirty && c.status === 'published') throw httpError(400, 'There are no changes to publish.');
    let major, minor;
    if (!cur) { major = 1; minor = 0; }
    else if (change === 'major') { major = cur.major + 1; minor = 0; }
    else if (change === 'minor') { major = cur.major; minor = cur.minor + 1; }
    else throw httpError(400, 'Choose whether this is a minor change or a new version.');
    const versionId = `${s.id}@${major}.${minor}`, publishedAt = now();
    const frozen = { title: d.title, description: d.description, audience: d.audience, modules: d.modules };
    const version = { orgId, courseId: s.id, versionId, major, minor, ...frozen, contentHash: sha256(canonical(frozen)), publishedAt, publishedBy: actorId };
    t.create(s.ref.collection('versions').doc(`${major}.${minor}`), version);
    t.update(s.ref, { status: 'published', draftDirty: false, title: d.title, description: d.description, codes: codesOf(d), updatedAt: now(),
      current: { versionId, major, minor, title: d.title, audience: d.audience, lessonCount: lessonsOf(d).length, publishedAt } });
    t.create(db.collection('auditLog').doc(), { ...auditRecord(orgId, actorId, 'course.publish', 'course', s.id, { title: d.title, version: verLabel(major, minor), change: cur ? change : 'first' }), ...(actorName ? { actorName } : {}) });
    return { versionId, major, minor, label: verLabel(major, minor) };
  });
}

/* ---------- learners ---------- */
export const progressRef = (db, staffId, courseId, major) => db.collection('courseProgress').doc(`${staffId}__${courseId}__${major}`);

/** The published courses this person must complete. */
export async function coursesFor(db, staff) {
  const q = await db.collection('courses').where('orgId', '==', staff.orgId).get();
  return q.docs.filter(s => s.get('status') === 'published' && s.get('current') && appliesTo(s.get('current').audience, staff.positionId));
}
export async function currentCourseVersion(db, staff, courseId, t = null) {
  const s = await getCourseFor(db, staff.orgId, courseId, t);
  const cur = s.get('current');
  if (s.get('status') !== 'published' || !cur || !appliesTo(cur.audience, staff.positionId)) throw httpError(404, 'This course is not in your training.');
  const vr = s.ref.collection('versions').doc(`${cur.major}.${cur.minor}`);
  const v = t ? await t.get(vr) : await vr.get();
  return v.data();
}

/** Has this person signed the current version of an SOP (or does it not apply to them)? */
async function documentDone(db, staff, code, t) {
  const d = await (t ? t.get(docRef(db, staff.orgId, code)) : docRef(db, staff.orgId, code).get());
  const cur = d.exists && d.get('status') === 'published' ? d.get('current') : null;
  if (!cur) return { done: false, missing: true };
  if (!appliesTo(cur.audience, staff.positionId)) return { done: true, notRequired: true };
  const q = db.collection('signoffs').where('orgId', '==', staff.orgId).where('staffId', '==', staff.id).where('code', '==', code);
  const so = await (t ? t.get(q) : q.get());
  const best = so.docs.map(x => x.get('major')).sort((a, b) => b - a)[0];
  return { done: best != null && best >= cur.major, signedOlder: best != null && best < cur.major };
}

/** Each lesson's state for this person: done, open (the next one), or locked. */
export async function courseState(db, staff, v, t = null) {
  const p = await (t ? t.get(progressRef(db, staff.id, v.courseId, v.major)) : progressRef(db, staff.id, v.courseId, v.major).get());
  const prog = p.exists ? p.data() : { lessons: {} };
  const cq = db.collection('courseCompletions').where('orgId', '==', staff.orgId).where('staffId', '==', staff.id).where('courseId', '==', v.courseId);
  const comps = (await (t ? t.get(cq) : cq.get())).docs.map(d => ({ id: d.id, ...d.data() }));
  const completion = comps.filter(c => c.major === v.major).sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
  const earlier = comps.filter(c => c.major < v.major).length > 0;
  const out = []; let open = true;
  for (const m of v.modules) for (const l of m.lessons) {
    let done = !!(prog.lessons || {})[l.id], extra = {};
    if (l.type === 'document') { extra = await documentDone(db, staff, l.code, t); done = extra.done; }
    const status = done ? 'done' : open ? 'open' : 'locked';
    if (!done) open = false;
    out.push({ id: l.id, moduleId: m.id, status, ...(l.type === 'quiz' ? { attempts: ((prog.quiz || {})[l.id] || {}).attempts || 0, lastScore: ((prog.quiz || {})[l.id] || {}).lastScore ?? null } : {}), ...extra });
  }
  const doneCount = out.filter(x => x.status === 'done').length;
  return { lessons: out, done: doneCount, total: out.length, allDone: doneCount === out.length && out.length > 0, completion, retake: earlier && !completion };
}

/** Issue the certificate once every lesson is done. Recorded in the person's evidence chain. */
export async function issueCertificateIfDone(db, staff, courseId, ctx = {}) {
  return db.runTransaction(async t => {
    const staffSnap = await t.get(db.collection('staff').doc(staff.id));
    const v = await currentCourseVersion(db, staff, courseId, t);
    const st = await courseState(db, staff, v, t);
    if (!st.allDone || st.completion) return st.completion;
    const ref = db.collection('courseCompletions').doc();
    const rec = appendEvidence(t, db, staffSnap, 'courseCompletions', ref, { orgId: staff.orgId, courseId: v.courseId, versionId: v.versionId, major: v.major, minor: v.minor,
      title: v.title, contentHash: v.contentHash, staffNo: staffSnap.get('staffNo'), name: staffSnap.get('name'), positionId: staffSnap.get('positionId'),
      lessons: st.total, ...ctx, at: now() });
    return { id: ref.id, ...rec };
  });
}

/** A lesson as the learner sees it: never the quiz answers. */
export function lessonForLearner(l) {
  if (l.type !== 'quiz') return l;
  return { ...l, questions: l.questions.map(q => ({ q: q.q, options: q.options })) };
}
export { markQuiz };
