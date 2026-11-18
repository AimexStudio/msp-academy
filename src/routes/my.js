// The staff journey: my course, read (with the video gate), quiz (marked here), sign, declaration.
import { requireAuth, now } from '../auth.js';
import { loadOrg, loadPublishedDocs, loadProgress, summarise } from '../course.js';
import { currentVersion, httpError } from '../documents.js';
import { appendEvidence } from '../evidence.js';
import { appliesTo, markQuiz, namesMatch, acceptSegments, verLabel, VIDEO_THRESHOLD, fillDeclaration, signoffStatement, KINDS } from '../rules.js';

export const progressRef = (db, staffId, code, major) => db.collection('progress').doc(`${staffId}__${code}__${major}`);
export const signoffRef = (db, staffId, code, major) => db.collection('signoffs').doc(`${staffId}__${code}__${major}`);

export function courseItem(i) {
  const d = i.doc;
  return {
    code: d.code, kind: d.kind, title: d.title, summary: d.summary, label: d.label, major: d.major,
    estMinutes: d.estMinutes, questionCount: d.questionCount, issueDate: d.issueDate, publishedAt: d.publishedAt,
    videoSeconds: (d.videos || []).reduce((n, v) => n + (v.duration || 0), 0), status: i.status, isNew: i.isNew,
    signoff: i.signoff ? { label: i.signoff.label, major: i.signoff.major, at: i.signoff.at, score: i.signoff.score } : null,
  };
}

/** What staff may see of a frozen version: everything except the correct answers. */
export function publicVersion(v, files = new Map()) {
  const pdf = v.pdfFileId ? files.get(v.pdfFileId) : null;
  return {
    code: v.code, kind: v.kind, kindLabel: KINDS[v.kind], title: v.title, summary: v.summary, body: v.body,
    versionId: v.versionId, major: v.major, minor: v.minor, label: verLabel(v.major, v.minor),
    issueDate: v.issueDate, appliesText: v.appliesText, estMinutes: v.estMinutes, passMark: v.passMark,
    pdf: pdf ? { id: v.pdfFileId, name: pdf.name, size: pdf.size } : null,
    videos: (v.videos || []).map(x => ({ fileId: x.fileId, title: x.title, duration: x.duration })),
    requireVideo: v.requireVideo,
    questions: (v.questions || []).map(q => ({ q: q.q, options: q.options })),
  };
}

export async function fileMeta(db, ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return new Map();
  const snaps = await db.getAll(...ids.map(id => db.collection('files').doc(id)));
  return new Map(snaps.filter(s => s.exists).map(s => [s.id, s.data()]));
}

/** Read, video, quiz and sign-off state for one person on one document's current major version. */
export function stateOf(v, p, lastSignoff) {
  p = p || {};
  const videos = {};
  for (const [id, x] of Object.entries(p.videos || {})) videos[id] = { watched: Math.round(x.watched || 0), completed: !!x.completedAt, failed: !!x.failedAt };
  const vids = v.videos || [];
  const videosDone = !v.requireVideo || vids.every(x => videos[x.fileId] && (videos[x.fileId].completed || videos[x.fileId].failed));
  const hasQ = (v.questions || []).length > 0;
  const signedCurrent = !!lastSignoff && lastSignoff.major === v.major;
  const readAt = p.readAt || null;
  return {
    readAt, videos, videosDone, hasQuestions: hasQ,
    attempts: p.attempts || 0, lastScore: p.lastScore ?? null, passed: !hasQ || !!p.passed, passScore: p.passScore ?? null,
    signoff: lastSignoff ? { id: lastSignoff.id, label: lastSignoff.label, major: lastSignoff.major, at: lastSignoff.at, score: lastSignoff.score } : null,
    signedCurrent,
    status: signedCurrent ? 'done' : lastSignoff ? 'updated' : (readAt || p.attempts) ? 'inprogress' : 'todo',
    canQuiz: !!readAt && hasQ && !p.passed && !signedCurrent,
    canSign: !!readAt && (!hasQ || !!p.passed) && !signedCurrent,
  };
}

async function lastSignoff(db, staffId, code, t = null) {
  const q = db.collection('signoffs').where('staffId', '==', staffId).where('code', '==', code);
  const snap = t ? await t.get(q) : await q.get();
  return snap.docs.map(s => ({ id: s.id, ...s.data() })).sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
}

export default async function (app) {
  const { db, orgId, storage } = app;
  const me = req => req.session.staff;
  const ctx = req => ({ ip: req.ip || null, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) });

  async function mySummary(staff) {
    const [docs, prog] = await Promise.all([loadPublishedDocs(db, orgId), loadProgress(db, orgId, [staff.id])]);
    return summarise(staff, docs, prog);
  }
  async function myDoc(staff, code, t = null) {
    const v = await currentVersion(db, orgId, code, t);
    if (!v || !appliesTo(v.audience, staff.positionId)) throw httpError(404, 'This document is not in your course.');
    return v;
  }
  async function docState(staff, v) {
    const [p, so] = await Promise.all([progressRef(db, staff.id, v.code, v.major).get(), lastSignoff(db, staff.id, v.code)]);
    return stateOf(v, p.exists ? p.data() : null, so);
  }
  const checkVersion = (v, versionId) => {
    if (versionId !== v.versionId) throw httpError(409, 'This document has just been updated. Reload it to see the latest version.', { stale: true });
  };
  const versionBody = { type: 'object', required: ['versionId'], properties: { versionId: { type: 'string', maxLength: 80 } } };

  app.get('/api/my/course', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    const [org, sum, st] = await Promise.all([loadOrg(db, orgId), mySummary(s), db.collection('staff').doc(s.id).get()]);
    return {
      courseTitle: org.courseTitle, positionName: org.posName(s.positionId),
      items: sum.items.map(courseItem), total: sum.total, done: sum.done, pct: sum.pct,
      outstanding: sum.outstanding.length, upToDate: sum.upToDate,
      declaration: sum.declaration, declarationCurrent: sum.declarationCurrent, canDeclare: sum.canDeclare,
      lastLoginAt: st.get('lastLoginAt') || null,
    };
  });

  app.get('/api/my/documents/:code', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    const [org, v] = await Promise.all([loadOrg(db, orgId), myDoc(s, req.params.code)]);
    const [files, state] = await Promise.all([fileMeta(db, [v.pdfFileId]), docState(s, v)]);
    return { doc: publicVersion(v, files), state, statement: signoffStatement(s.name, v.code, v.title, verLabel(v.major, v.minor), org.orgName), profileName: s.name };
  });

  // Video progress: the page reports the stretches it actually played; the server merges them and only
  // accepts as much new coverage as real time allows. The length comes from the file, not the page.
  app.post('/api/my/documents/:code/videos/:fileId/progress', {
    schema: { body: { type: 'object', required: ['versionId', 'segments'], properties: {
      versionId: { type: 'string', maxLength: 80 },
      segments: { type: 'array', maxItems: 200, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } } } } },
  }, async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    return db.runTransaction(async t => {
      const v = await myDoc(s, req.params.code, t);
      checkVersion(v, req.body.versionId);
      const vid = (v.videos || []).find(x => x.fileId === req.params.fileId);
      if (!vid) throw httpError(404, 'Video not found.');
      const ref = progressRef(db, s.id, v.code, v.major);
      const snap = await t.get(ref);
      const row = (snap.exists && (snap.get('videos') || {})[vid.fileId]) || {};
      const started = row.startedAt || now();
      // Firestore can't store nested arrays, so segments are kept as {a, b} pairs.
      const existing = (row.segments || []).map(x => [x.a, x.b]);
      const { segments, watched } = acceptSegments({ existing, reported: req.body.segments,
        duration: vid.duration || 0, elapsedSec: (Date.now() - new Date(row.lastReportAt || started).getTime()) / 1000 });
      const complete = (vid.duration || 0) > 0 && watched >= vid.duration * VIDEO_THRESHOLD;
      t.set(ref, { orgId, staffId: s.id, code: v.code, major: v.major, videos: { [vid.fileId]: {
        segments: segments.map(([a, b]) => ({ a, b })), watched, startedAt: started, lastReportAt: now(),
        completedAt: row.completedAt || (complete ? now() : null) } } }, { merge: true });
      return { watched: Math.round(watched), duration: vid.duration, completed: complete || !!row.completedAt };
    });
  });

  // The video would not play on this device: the person may continue (never stuck), and it is recorded.
  app.post('/api/my/documents/:code/videos/:fileId/failed', { schema: { body: versionBody } }, async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    const v = await myDoc(s, req.params.code);
    checkVersion(v, req.body.versionId);
    if (!(v.videos || []).some(x => x.fileId === req.params.fileId)) throw httpError(404, 'Video not found.');
    await progressRef(db, s.id, v.code, v.major).set({ orgId, staffId: s.id, code: v.code, major: v.major,
      videos: { [req.params.fileId]: { failedAt: now() } } }, { merge: true });
    return { ok: true };
  });

  app.post('/api/my/documents/:code/read', { schema: { body: versionBody } }, async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    const v = await myDoc(s, req.params.code);
    checkVersion(v, req.body.versionId);
    const st = await docState(s, v);
    if (!st.videosDone) throw httpError(400, 'Watch the training video to the end before you continue.');
    if (!st.readAt) await progressRef(db, s.id, v.code, v.major).set({ orgId, staffId: s.id, code: v.code, major: v.major, readAt: now(), readVersionId: v.versionId }, { merge: true });
    return { state: await docState(s, v) };
  });

  app.post('/api/my/documents/:code/attempts', {
    schema: { body: { type: 'object', required: ['versionId', 'answers'], properties: {
      versionId: { type: 'string', maxLength: 80 }, answers: { type: 'array', maxItems: 100, items: { type: ['integer', 'null'] } } } } },
  }, async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    const { r, v } = await db.runTransaction(async t => {
      const staffSnap = await t.get(db.collection('staff').doc(s.id));
      const v = await myDoc(s, req.params.code, t);
      checkVersion(v, req.body.versionId);
      const pref = progressRef(db, s.id, v.code, v.major);
      const p = await t.get(pref);
      const st = stateOf(v, p.exists ? p.data() : null, await lastSignoff(db, s.id, v.code, t));
      if (st.signedCurrent) throw httpError(400, 'You have already signed this version.');
      if (!st.readAt) throw httpError(400, 'Read the document before you answer the questions.');
      if (!st.hasQuestions) throw httpError(400, 'This document has no questions.');
      if (st.passed) throw httpError(400, 'You have already passed. Continue to sign off.');
      const qs = v.questions, answers = req.body.answers;
      if (answers.length !== qs.length || answers.some((a, i) => !Number.isInteger(a) || a < 0 || a >= qs[i].options.length)) throw httpError(400, 'Answer every question.');
      const r = markQuiz(qs, answers, v.passMark);
      appendEvidence(t, db, staffSnap, 'quizAttempts', null, { orgId, code: v.code, versionId: v.versionId, major: v.major,
        answers, correct: r.correct, total: r.total, score: r.score, passed: r.passed, ...ctx(req), at: now() });
      t.set(pref, { orgId, staffId: s.id, code: v.code, major: v.major, attempts: st.attempts + 1, lastScore: r.score,
        passed: r.passed, ...(r.passed ? { passScore: r.score, passedAt: now() } : {}) }, { merge: true });
      return { r, v };
    });
    // Wrong questions are flagged; the right answers are never sent.
    return { result: { correct: r.correct, total: r.total, score: r.score, passed: r.passed, wrong: r.passed ? [] : r.wrong, passMark: v.passMark },
      state: await docState(s, v) };
  });

  app.post('/api/my/documents/:code/signoff', {
    schema: { body: { type: 'object', required: ['versionId', 'agree', 'typedName'], properties: {
      versionId: { type: 'string', maxLength: 80 }, agree: { type: 'boolean' }, typedName: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    const org = await loadOrg(db, orgId);
    return db.runTransaction(async t => {
      const staffSnap = await t.get(db.collection('staff').doc(s.id));
      const v = await myDoc(s, req.params.code, t);
      checkVersion(v, req.body.versionId);
      const p = await t.get(progressRef(db, s.id, v.code, v.major));
      const st = stateOf(v, p.exists ? p.data() : null, await lastSignoff(db, s.id, v.code, t));
      if (st.signedCurrent) throw httpError(400, 'You have already signed this version.');
      if (!st.readAt) throw httpError(400, 'Read the document before you sign.');
      if (!st.passed) throw httpError(400, `Pass the questions (${v.passMark}%) before you sign.`);
      if (!req.body.agree) throw httpError(400, 'Tick the box to confirm you understand and agree.');
      if (!namesMatch(req.body.typedName, s.name)) throw httpError(400, `Type your full name exactly as it is on your profile: ${s.name}.`);
      const label = verLabel(v.major, v.minor);
      const ref = signoffRef(db, s.id, v.code, v.major);
      const rec = appendEvidence(t, db, staffSnap, 'signoffs', ref, { orgId, code: v.code, versionId: v.versionId, major: v.major, label,
        typedName: req.body.typedName.trim(), statement: signoffStatement(s.name, v.code, v.title, label, org.orgName),
        score: st.hasQuestions ? st.passScore : null, attempts: st.attempts, versionHash: v.contentHash, ...ctx(req), at: now() });
      return { signoff: { id: ref.id, at: rec.at, label, score: rec.score } };
    });
  });

  app.get('/api/my/declaration', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    const [org, sum] = await Promise.all([loadOrg(db, orgId), mySummary(s)]);
    return {
      courseTitle: org.courseTitle, canDeclare: sum.canDeclare, declarationCurrent: sum.declarationCurrent,
      outstanding: sum.outstanding.length, total: sum.total, profileName: s.name,
      text: fillDeclaration(org.declarationText, s.name, org.posName(s.positionId)),
      items: sum.items.map(i => ({ code: i.doc.code, title: i.doc.title, label: i.doc.label, signedAt: i.signoff && i.signoff.at })),
    };
  });

  app.post('/api/my/declaration', {
    schema: { body: { type: 'object', required: ['agree', 'typedName', 'signature'], properties: {
      agree: { type: 'boolean' }, typedName: { type: 'string', maxLength: 200 }, signature: { type: 'string', maxLength: 400000 } } } },
  }, async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    const org = await loadOrg(db, orgId);
    const png = parseSignature(req.body.signature);
    if (!req.body.agree) throw httpError(400, 'Tick the box to confirm.');
    if (!namesMatch(req.body.typedName, s.name)) throw httpError(400, `Type your full name exactly as it is on your profile: ${s.name}.`);
    const before = await mySummary(s);
    if (!before.canDeclare) throw httpError(400, before.outstanding.length ? 'Sign every document in your course first.' : 'Your declaration is already up to date.');
    const sig = await storage.putBuffer(png, 'image/png', 'signatures');
    return db.runTransaction(async t => {
      const staffSnap = await t.get(db.collection('staff').doc(s.id));
      // Checked again inside the transaction: a sign-off or declaration made meanwhile changes the staff record and forces a retry.
      const sum = await mySummary(s);
      if (!sum.canDeclare) throw httpError(400, 'Your declaration is already up to date.');
      const text = fillDeclaration(org.declarationText, s.name, org.posName(s.positionId));
      const items = sum.items.map(i => ({ code: i.doc.code, title: i.doc.title, label: i.signoff.label, signoffId: i.signoff.id, signedAt: i.signoff.at, score: i.signoff.score }));
      const ref = db.collection('declarations').doc();
      const rec = appendEvidence(t, db, staffSnap, 'declarations', ref, { orgId, staffNo: s.staffNo, name: s.name, positionId: s.positionId,
        courseTitle: org.courseTitle, text, typedName: req.body.typedName.trim(), items, signatureKey: sig.key, signatureSha256: sig.sha256, ...ctx(req), at: now() });
      return { declaration: { id: ref.id, at: rec.at } };
    });
  });

  app.get('/api/my/record', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return buildRecord(db, orgId, me(req).id);
  });

  app.get('/api/declarations/:id/signature.png', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const s = me(req);
    const d = await db.collection('declarations').doc(String(req.params.id)).get();
    let ok = d.exists && d.get('orgId') === orgId && (d.get('staffId') === s.id || ['manager', 'auditor'].includes(s.role));
    if (d.exists && !ok && s.role === 'hod' && d.get('orgId') === orgId) {
      const org = await loadOrg(db, orgId);
      ok = org.deptOf(d.get('positionId')) === org.deptOf(s.positionId);
    }
    if (!ok) return reply.code(404).send({ error: 'Not found.' });
    reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=86400');
    return reply.send(await storage.getBuffer(d.get('signatureKey')));
  });
}

/** Validate a drawn signature: a real, modest-sized PNG. */
export function parseSignature(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw httpError(400, 'Draw your signature in the box.');
  const buf = Buffer.from(m[1], 'base64');
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 200 || buf.length > 250000 || !buf.subarray(0, 8).equals(sig) || buf.toString('latin1', 12, 16) !== 'IHDR') throw httpError(400, 'Draw your signature in the box.');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w < 100 || h < 50 || w > 3000 || h > 1500) throw httpError(400, 'Draw your signature in the box.');
  return buf;
}

/** The training record (PEL-FRM-001 layout), for the staff certificate and the manager's person page. */
export async function buildRecord(db, orgId, staffId) {
  const org = await loadOrg(db, orgId);
  const st = await db.collection('staff').doc(String(staffId)).get();
  if (!st.exists || st.get('orgId') !== orgId) throw httpError(404, 'Staff member not found.');
  const x = st.data();
  const staff = { id: st.id, positionId: x.positionId };
  const [docs, prog, decls] = await Promise.all([
    loadPublishedDocs(db, orgId), loadProgress(db, orgId, [st.id]), db.collection('declarations').where('staffId', '==', st.id).get(),
  ]);
  const sum = summarise(staff, docs, prog);
  const list = decls.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.at < b.at ? 1 : -1));
  const latest = list[0] || null;
  return {
    staff: { id: st.id, staffNo: x.staffNo, name: x.name, positionId: x.positionId, positionName: org.posName(x.positionId),
      deptName: org.deptName(org.deptOf(x.positionId)), active: x.active, startDate: x.startDate || null },
    orgName: org.orgName, courseTitle: org.courseTitle,
    total: sum.total, done: sum.done, outstanding: sum.outstanding.length, upToDate: sum.upToDate,
    declarationCurrent: sum.declarationCurrent, canDeclare: sum.canDeclare,
    items: sum.items.map(i => ({
      code: i.doc.code, title: i.doc.title, currentLabel: i.doc.label, status: i.status,
      signedLabel: i.signoff ? i.signoff.label : null, signedAt: i.signoff ? i.signoff.at : null,
      score: i.signoff ? i.signoff.score : null, signedOlderMajor: !!i.signoff && i.signoff.major < i.doc.major,
      attempts: i.progress ? i.progress.attempts || 0 : 0, lastScore: i.progress ? i.progress.lastScore ?? null : null,
      videoWatched: !!(i.progress && Object.values(i.progress.videos || {}).some(v => v.completedAt)),
      videoFailed: !!(i.progress && Object.values(i.progress.videos || {}).some(v => v.failedAt)),
    })),
    declaration: latest && { id: latest.id, at: latest.at, typedName: latest.typedName, text: latest.text, items: latest.items,
      positionName: org.posName(latest.positionId), recordHash: latest.hash, signatureUrl: `/api/declarations/${latest.id}/signature.png` },
    declarations: list.map(d => ({ id: d.id, at: d.at, count: (d.items || []).length, positionName: org.posName(d.positionId) })),
  };
}
