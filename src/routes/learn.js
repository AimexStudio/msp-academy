// Taking a course: lessons in order, quizzes marked on the server, a certificate at the end.
import { requireStaff, now } from '../auth.js';
import { httpError, sha256 } from '../documents.js';
import { verLabel, acceptSegments, namesMatch } from '../rules.js';
import { storagePrefix } from '../tenancy.js';
import { loadOrg } from '../course.js';
import { coursesFor, currentCourseVersion, courseState, progressRef, issueCertificateIfDone, lessonForLearner, markQuiz, lessonsOf, videoDuration } from '../courses.js';

export default async function (app) {
  const { db } = app;
  const me = req => req.session.staff;
  const ctx = req => ({ ip: req.ip || null, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) });

  app.get('/api/my/courses', async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const s = me(req), out = [];
    for (const c of await coursesFor(db, s)) {
      const v = await currentCourseVersion(db, s, c.id);
      const st = await courseState(db, s, v);
      out.push({ id: c.id, title: v.title, description: v.description, label: verLabel(v.major, v.minor), total: st.total, done: st.done,
        modules: v.modules.length, completedAt: st.completion ? st.completion.at : null, retake: st.retake, shared: !!c.get('shared') });
    }
    return { courses: out.sort((a, b) => (!!a.completedAt - !!b.completedAt) || a.title.localeCompare(b.title)) };
  });

  async function view(s, id) {
    const v = await currentCourseVersion(db, s, id);
    const st = await courseState(db, s, v);
    const byId = new Map(st.lessons.map(l => [l.id, l]));
    return { course: { id, versionId: v.versionId, title: v.title, description: v.description, label: verLabel(v.major, v.minor),
      modules: v.modules.map(m => ({ id: m.id, title: m.title, lessons: m.lessons.map(l => ({ ...lessonForLearner(l), state: byId.get(l.id) })) })) },
      progress: { done: st.done, total: st.total, allDone: st.allDone, completion: st.completion ? { id: st.completion.id, at: st.completion.at } : null, retake: st.retake } };
  }
  app.get('/api/my/courses/:id', async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    return view(me(req), req.params.id);
  });

  // Find the lesson, check the version is the one shown, and that it's open (every lesson before it is done).
  async function openLesson(t, s, courseId, lessonId, versionId) {
    const v = await currentCourseVersion(db, s, courseId, t);
    if (v.versionId !== versionId) throw httpError(409, 'This course was updated. Reload the page to continue.');
    const lesson = lessonsOf(v).find(l => l.id === lessonId);
    if (!lesson) throw httpError(404, 'Lesson not found.');
    const st = await courseState(db, s, v, t);
    const ls = st.lessons.find(l => l.id === lessonId);
    if (ls.status === 'locked') throw httpError(400, 'Finish the lessons before this one first.');
    return { v, lesson, ls };
  }

  // Finish a lesson. What "finished" needs depends on the lesson:
  //   text, pdf   nothing more
  //   video       the minimum share really watched (tracked below), and the check question answered correctly
  //   checklist   every step ticked
  //   signoff     agree, and type the name on your profile
  app.post('/api/my/courses/:id/lessons/:lessonId/done', { schema: { body: { type: 'object', required: ['versionId'], properties: {
    versionId: { type: 'string', maxLength: 100 }, checked: { type: 'array', maxItems: 30, items: { type: 'integer' } },
    agree: { type: 'boolean' }, typedName: { type: 'string', maxLength: 200 }, checkpoint: { type: ['integer', 'null'] } } } } }, async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const s = me(req), b = req.body;
    await db.runTransaction(async t => {
      const { v, lesson, ls } = await openLesson(t, s, req.params.id, req.params.lessonId, b.versionId);
      if (lesson.type === 'quiz') throw httpError(400, 'Answer the questions to finish this lesson.');
      if (lesson.type === 'document') throw httpError(400, 'Read and sign the SOP or policy to finish this lesson.');
      if (lesson.type === 'evidence') throw httpError(400, 'Submit your evidence. Your manager approves it.');
      if (ls.status === 'done') return;
      const ref = progressRef(db, s.id, v.courseId, v.major);
      const base = { orgId: s.orgId, staffId: s.id, courseId: v.courseId, major: v.major };
      const extra = {};
      if (lesson.type === 'video') {
        const p = await t.get(ref), w = ((p.exists ? p.get('video') : null) || {})[lesson.id] || {};
        const duration = await videoDuration(db, lesson, t);
        const need = (lesson.minWatchPct || 0) / 100;
        if (need > 0 && !w.failed && !(duration > 0 && (w.watched || 0) >= duration * need - 0.5))
          throw httpError(400, `Watch at least ${lesson.minWatchPct}% of the video first. Skipped parts don't count.`);
        if (lesson.checkpoint) {
          if (b.checkpoint !== lesson.checkpoint.correct) {
            t.set(ref, { ...base, video: { [lesson.id]: { ...w, checkpointTries: (w.checkpointTries || 0) + 1 } } }, { merge: true });
            return { wrong: true };
          }
        }
      }
      if (lesson.type === 'checklist') {
        const want = lesson.steps.map((_, k) => k), got = new Set(b.checked || []);
        if (!want.every(k => got.has(k))) throw httpError(400, 'Tick every step to confirm you follow it.');
        extra.checklists = { [lesson.id]: { at: now(), steps: want.length } };
      }
      if (lesson.type === 'signoff') {
        const st = await t.get(db.collection('staff').doc(s.id));
        if (!b.agree) throw httpError(400, 'Tick the box to agree.');
        if (!namesMatch(b.typedName, st.get('name'))) throw httpError(400, 'Type your full name exactly as it appears on your profile.');
        extra.signoffs = { [lesson.id]: { name: String(b.typedName).trim().replace(/\s+/g, ' '), at: now(), statementHash: sha256(lesson.statement) } };
      }
      t.set(ref, { ...base, lessons: { [lesson.id]: now() }, ...extra }, { merge: true });
    }).then(r => { if (r && r.wrong) throw httpError(400, "That's not the right answer. Watch the video again and try once more.", { wrongCheckpoint: true }); });
    await issueCertificateIfDone(db, s, req.params.id, ctx(req));
    return view(s, req.params.id);
  });

  // Watching a video lesson: the browser reports the parts actually played; the server merges them and
  // caps them by the real time that has passed, so skipping ahead never counts. If the video won't play
  // on this device, the person can say so and continue (it's recorded), so nobody is ever stuck.
  app.post('/api/my/courses/:id/lessons/:lessonId/video', { schema: { body: { type: 'object', required: ['versionId'], properties: {
    versionId: { type: 'string', maxLength: 100 }, failed: { type: 'boolean' },
    segments: { type: 'array', maxItems: 200, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } } } } } }, async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const s = me(req);
    return db.runTransaction(async t => {
      const { v, lesson } = await openLesson(t, s, req.params.id, req.params.lessonId, req.body.versionId);
      if (lesson.type !== 'video') throw httpError(400, 'This lesson has no video.');
      const duration = await videoDuration(db, lesson, t);
      const ref = progressRef(db, s.id, v.courseId, v.major);
      const p = await t.get(ref), row = ((p.exists ? p.get('video') : null) || {})[lesson.id] || {};
      const started = row.startedAt || now();
      // Firestore can't store nested arrays, so segments are kept as {a, b} pairs.
      const existing = (row.segments || []).map(x => [x.a, x.b]);
      const { segments, watched } = acceptSegments({ existing, reported: req.body.segments || [], duration,
        elapsedSec: (Date.now() - new Date(row.lastReportAt || started).getTime()) / 1000 });
      t.set(ref, { orgId: s.orgId, staffId: s.id, courseId: v.courseId, major: v.major, video: { [lesson.id]: { ...row,
        segments: segments.map(([a, b]) => ({ a, b })), watched, startedAt: started, lastReportAt: now(), ...(req.body.failed ? { failed: true, failedAt: now() } : {}) } } }, { merge: true });
      return { watched: Math.round(watched), duration, needed: Math.ceil(duration * (lesson.minWatchPct || 0) / 100), failed: !!(req.body.failed || row.failed) };
    });
  });

  // Field evidence: what the person did, in words and optionally a photo, for their manager to approve.
  app.post('/api/my/courses/:id/lessons/:lessonId/evidence', { bodyLimit: 7 * 1024 * 1024, schema: { body: { type: 'object', required: ['versionId', 'text'], properties: {
    versionId: { type: 'string', maxLength: 100 }, text: { type: 'string', maxLength: 4000 }, photo: { type: ['string', 'null'], maxLength: 7 * 1024 * 1024 } } } } }, async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const s = me(req), text = req.body.text.trim();
    let photo = null;
    if (req.body.photo) {
      const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(req.body.photo);
      if (!m) throw httpError(400, 'The photo must be a JPEG or PNG image.');
      photo = { mime: `image/${m[1]}`, buf: Buffer.from(m[2], 'base64') };
      if (photo.buf.length > 5 * 1024 * 1024) throw httpError(400, 'The photo is too large. Take it again at a lower resolution.');
      const sig = photo.buf.subarray(0, 3);
      if (!(photo.mime === 'image/jpeg' ? sig[0] === 0xff && sig[1] === 0xd8 : sig.toString('latin1', 1, 3) === 'PN')) throw httpError(400, 'The photo must be a JPEG or PNG image.');
    }
    // Check the lesson before storing anything.
    const pre = await db.runTransaction(async t => {
      const { v, lesson, ls } = await openLesson(t, s, req.params.id, req.params.lessonId, req.body.versionId);
      if (lesson.type !== 'evidence') throw httpError(400, 'This lesson doesn’t take evidence.');
      if (ls.status === 'done') throw httpError(400, 'Your evidence for this lesson was already approved.');
      if (ls.evidence && ls.evidence.status === 'pending') throw httpError(400, 'Your evidence is waiting for your manager’s review.');
      if (text.length < 3) throw httpError(400, 'Describe what you did.');
      if (lesson.photo === 'required' && !photo) throw httpError(400, 'Add a photo as well.');
      if (lesson.photo === 'none') photo = null;
      return { v, lesson };
    });
    let fileId = null;
    if (photo) {
      const stored = await app.storage.putBuffer(photo.buf, photo.mime, storagePrefix(s.orgId, 'evidence'));
      const fref = db.collection('files').doc();
      await fref.set({ orgId: s.orgId, kind: 'evidence', staffId: s.id, name: `evidence-${pre.lesson.id}.${photo.mime === 'image/png' ? 'png' : 'jpg'}`, mime: photo.mime,
        size: stored.size, sha256: stored.sha256, storageKey: stored.key, uploadedBy: s.id, createdAt: now() });
      fileId = fref.id;
    }
    await db.collection('courseEvidence').add({ orgId: s.orgId, staffId: s.id, courseId: pre.v.courseId, versionId: pre.v.versionId, major: pre.v.major,
      lessonId: pre.lesson.id, lessonTitle: pre.lesson.title, courseTitle: pre.v.title, text, fileId, status: 'pending', note: null,
      submittedAt: now(), reviewedAt: null, reviewedBy: null, ...ctx(req) });
    return view(s, req.params.id);
  });

  app.post('/api/my/courses/:id/lessons/:lessonId/quiz', { schema: { body: { type: 'object', required: ['versionId', 'answers'], properties: {
    versionId: { type: 'string', maxLength: 100 }, answers: { type: 'array', maxItems: 100, items: { type: ['integer', 'null'] } } } } } }, async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const s = me(req);
    const r = await db.runTransaction(async t => {
      const { v, lesson, ls } = await openLesson(t, s, req.params.id, req.params.lessonId, req.body.versionId);
      if (lesson.type !== 'quiz') throw httpError(400, 'This lesson has no questions.');
      if (ls.status === 'done') throw httpError(400, 'You have already passed this quiz.');
      const qs = lesson.questions, a = req.body.answers;
      if (a.length !== qs.length || a.some((x, i) => !Number.isInteger(x) || x < 0 || x >= qs[i].options.length)) throw httpError(400, 'Answer every question.');
      const r = markQuiz(qs, a, lesson.passMark);
      const ref = progressRef(db, s.id, v.courseId, v.major);
      const p = await t.get(ref), prev = ((p.exists ? p.get('quiz') : null) || {})[lesson.id] || {};
      t.set(ref, { orgId: s.orgId, staffId: s.id, courseId: v.courseId, major: v.major,
        quiz: { [lesson.id]: { attempts: (prev.attempts || 0) + 1, lastScore: r.score, lastAt: now() } }, ...(r.passed ? { lessons: { [lesson.id]: now() } } : {}) }, { merge: true });
      return { ...r, passMark: lesson.passMark };
    });
    if (r.passed) await issueCertificateIfDone(db, s, req.params.id, ctx(req));
    // Wrong questions are flagged; the right answers are never sent.
    return { result: { correct: r.correct, total: r.total, score: r.score, passed: r.passed, wrong: r.passed ? [] : r.wrong, passMark: r.passMark }, ...(await view(s, req.params.id)) };
  });

  // For when the last lesson was an SOP signed in its own flow: issue the certificate now.
  app.post('/api/my/courses/:id/certificate', async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const c = await issueCertificateIfDone(db, me(req), req.params.id, ctx(req));
    if (!c) throw httpError(400, 'Finish every lesson first.');
    return view(me(req), req.params.id);
  });

  app.get('/api/my/courses/:id/certificate', async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const s = me(req);
    const q = await db.collection('courseCompletions').where('orgId', '==', s.orgId).where('staffId', '==', s.id).where('courseId', '==', String(req.params.id)).get();
    const c = q.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    if (!c) throw httpError(404, 'You don’t have a certificate for this course yet.');
    const org = await loadOrg(db, s.orgId);
    return { certificate: { id: c.id, title: c.title, label: verLabel(c.major, c.minor), name: c.name, staffNo: c.staffNo, positionName: org.posName(c.positionId),
      orgName: org.orgName, at: c.at, lessons: c.lessons, reference: c.hash.slice(0, 12).toUpperCase() } };
  });
}
