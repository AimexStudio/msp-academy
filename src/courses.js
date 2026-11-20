// Courses built from modules and lessons.
//
//   courses/{id}                 orgId, status (draft | published | archived), draft, draftDirty, current, shared, codes (SOP lessons, for lists)
//   courses/{id}/versions/{M.m}  each published version, frozen: what learners take
//   courseProgress/{staff__course__major}  which lessons a person has finished in that version
//   courseCompletions/{id}       the certificate: evidence, in the person's tamper-evident chain
//
// Lesson types: text, video (with watch rules, chapters and an optional check question), pdf, checklist
// (tick every step), quiz, signoff (agree to a statement and type your name), evidence (submit proof for a
// manager to approve), and document (an SOP or policy, read and signed in its own flow).
// Lessons unlock in order. Finishing every lesson issues a certificate. A new version (major change)
// asks people to take the course again; a minor change keeps their progress.
import crypto from 'node:crypto';
import { httpError, now, sha256, canonical, docRef, auditRecord } from './documents.js';
import { appliesTo, verLabel, markQuiz } from './rules.js';
import { appendEvidence } from './evidence.js';

export const LESSON_TYPES = { text: 'Text', video: 'Video', pdf: 'PDF', checklist: 'Checklist', quiz: 'Quiz', signoff: 'Policy sign-off', evidence: 'Field evidence', document: 'SOP or policy' };
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

/** The 11-character YouTube video ID from any usual link (watch, youtu.be, shorts, embed, live), or null. */
export function youtubeId(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (['youtube.com', 'youtube-nocookie.com'].includes(host)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/); if (m) id = m[2]; }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
/** How long a video lesson is, in seconds: the uploaded file's length, or the length entered for a YouTube video. */
export async function videoDuration(db, lesson, t = null) {
  if (lesson.source === 'youtube') return lesson.durationSec || 0;
  const r = db.collection('files').doc(lesson.fileId);
  const f = await (t ? t.get(r) : r.get());
  return (f.exists && f.get('duration')) || 0;
}

const cleanQuestion = q => ({ q: str(q.q, 500), options: (Array.isArray(q.options) ? q.options : []).slice(0, 6).map(o => str(o, 300)),
  correct: Number.isInteger(q.correct) ? q.correct : -1 });
const questionOk = q => q.q.trim() && q.options.filter(o => o.trim()).length >= 2 && q.correct >= 0 && q.correct < q.options.length && q.options[q.correct].trim();

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
      if (l.type === 'pdf') return { ...base, fileId: l.fileId ? str(l.fileId, 60) : null };
      if (l.type === 'video') {
        const cp = l.checkpoint && typeof l.checkpoint === 'object' ? cleanQuestion(l.checkpoint) : null;
        const yt = l.source === 'youtube';
        const ytId = yt ? youtubeId(l.youtubeUrl || l.youtubeId) : null;
        return { ...base, source: yt ? 'youtube' : 'upload', fileId: !yt && l.fileId ? str(l.fileId, 60) : null,
          youtubeUrl: yt ? str(l.youtubeUrl, 300).trim() : null, youtubeId: ytId, durationSec: yt ? clampInt(l.durationSec, 0, 36000, 0) : null,
          // How much must really be watched (0 = optional), no skipping ahead, pause when the tab is hidden.
          minWatchPct: l.minWatchPct === undefined ? 90 : [0, 75, 80, 85, 90, 100].includes(Number(l.minWatchPct)) ? Number(l.minWatchPct) : 90,
          noSkipAhead: l.noSkipAhead === undefined ? true : !!l.noSkipAhead, pauseWhenHidden: l.pauseWhenHidden === undefined ? true : !!l.pauseWhenHidden,
          chapters: (Array.isArray(l.chapters) ? l.chapters : []).slice(0, 30).map(c => ({ at: clampInt(c.at, 0, 36000, 0), label: str(c.label, 80).trim() })).filter(c => c.label).sort((a, b) => a.at - b.at),
          checkpoint: cp };
      }
      if (l.type === 'checklist') return { ...base, summary: str(l.summary, 500).trim(), steps: (Array.isArray(l.steps) ? l.steps : []).slice(0, 30).map(x => str(x, 300)) };
      if (l.type === 'signoff') return { ...base, code: str(l.code, 40).trim(), statement: str(l.statement, 3000) };
      if (l.type === 'evidence') return { ...base, prompt: str(l.prompt, 1000), placeholder: str(l.placeholder, 200), photo: ['none', 'optional', 'required'].includes(l.photo) ? l.photo : 'optional' };
      if (l.type === 'document') return { ...base, code: l.code ? str(l.code, 40).trim().toUpperCase() : null };
      return { ...base, passMark: clampInt(l.passMark, 50, 100, 80), questions: (Array.isArray(l.questions) ? l.questions : []).slice(0, 50).map(cleanQuestion) };
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
    if (l.type === 'pdf' && !l.fileId) p.push(`${name} needs its PDF uploaded.`);
    if (l.type === 'video' && l.source !== 'youtube' && !l.fileId) p.push(`${name} needs its video uploaded, or a YouTube link.`);
    if (l.type === 'video' && l.source === 'youtube' && !l.youtubeId) p.push(`${name}: paste a YouTube link, e.g. https://www.youtube.com/watch?v=…`);
    if (l.type === 'video' && l.source === 'youtube' && l.youtubeId && !l.durationSec) p.push(`${name}: enter the video's length (it fills in by itself once the video has loaded).`);
    if (l.type === 'document' && !l.code) p.push(`${name}: choose the SOP or policy.`);
    if (l.type === 'quiz') {
      if (!l.questions.length) p.push(`${name} has no questions.`);
      l.questions.forEach((q, qi) => { if (!questionOk(q)) p.push(`${name}, question ${qi + 1}: write the question, at least two answers, and tick the correct one.`); });
    }
    if (l.type === 'video' && l.checkpoint && !questionOk(l.checkpoint)) p.push(`${name}: finish the check question (the question, at least two answers, and the correct one ticked), or remove it.`);
    if (l.type === 'checklist' && !l.steps.some(x => x.trim())) p.push(`${name} needs at least one step.`);
    if (l.type === 'checklist' && l.steps.some(x => !x.trim())) p.push(`${name} has an empty step. Fill it in or remove it.`);
    if (l.type === 'signoff' && !l.statement.trim()) p.push(`${name} needs the statement people agree to.`);
    if (l.type === 'evidence' && !l.prompt.trim()) p.push(`${name} needs instructions: what must people submit?`);
  });
  return p;
}

/** Every file and SOP a course points to must belong to the same client (and be the right kind). */
export async function checkCourseRefs(db, orgId, d, t = null) {
  const get = r => (t ? t.get(r) : r.get());
  for (const l of lessonsOf(d)) {
    if ((l.type === 'video' || l.type === 'pdf') && l.fileId && l.source !== 'youtube') {
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
      if (ds.get('status') !== 'published') throw httpError(400, `Publish ${code} first (under Documents): it's part of this course.`);
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
  // Field evidence: the latest submission per lesson, for this version.
  const eq = db.collection('courseEvidence').where('orgId', '==', staff.orgId).where('staffId', '==', staff.id).where('courseId', '==', v.courseId);
  const evid = new Map();
  for (const e of (await (t ? t.get(eq) : eq.get())).docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.major === v.major).sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1))) evid.set(e.lessonId, e);
  const out = []; let open = true;
  for (const m of v.modules) for (const l of m.lessons) {
    let done = !!(prog.lessons || {})[l.id], extra = {};
    if (l.type === 'document') { extra = await documentDone(db, staff, l.code, t); done = extra.done; }
    if (l.type === 'video') { const w = (prog.video || {})[l.id] || {}; extra = { watched: Math.round(w.watched || 0), failed: !!w.failed, checkpointTries: w.checkpointTries || 0 }; }
    if (l.type === 'evidence') { const e = evid.get(l.id); extra = { evidence: e ? { id: e.id, status: e.status, note: e.note || null, text: e.text, fileId: e.fileId || null, submittedAt: e.submittedAt, reviewedAt: e.reviewedAt || null } : null }; }
    const status = done ? 'done' : open ? 'open' : 'locked';
    // Waiting for a manager's review doesn't hold people up: the next lesson opens, but the certificate waits.
    if (!done && !(l.type === 'evidence' && extra.evidence && extra.evidence.status === 'pending')) open = false;
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
      lessons: st.total, acknowledgements: await acknowledgementsOf(db, staff, v, t), ...ctx, at: now() });
    return { id: ref.id, ...rec };
  });
}

/** The policy sign-offs given in this course version, recorded in the certificate (and so in the evidence chain). */
async function acknowledgementsOf(db, staff, v, t) {
  const p = await t.get(progressRef(db, staff.id, v.courseId, v.major));
  const so = (p.exists ? p.get('signoffs') : null) || {};
  return lessonsOf(v).filter(l => l.type === 'signoff' && so[l.id]).map(l => ({ lessonId: l.id, title: l.title, code: l.code || null, statementHash: so[l.id].statementHash, typedName: so[l.id].name, at: so[l.id].at }));
}

/** A lesson as the learner sees it: never the quiz or check-question answers. */
export function lessonForLearner(l) {
  if (l.type === 'quiz') return { ...l, questions: l.questions.map(q => ({ q: q.q, options: q.options })) };
  if (l.type === 'video' && l.checkpoint) return { ...l, checkpoint: { q: l.checkpoint.q, options: l.checkpoint.options } };
  return l;
}
export { markQuiz };
