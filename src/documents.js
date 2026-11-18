// Documents: the editable draft, and publishing it as a frozen, fingerprinted version.
// Firestore layout:
//   documents/{orgId}__{code}                 the register entry: status, hold, draft, and a summary of the current version
//   documents/{orgId}__{code}/versions/{2.1}  every published version, frozen: text, questions with answers, file hashes
import crypto from 'node:crypto';
import { draftProblems, verLabel, BASE_ORDER } from './rules.js';
import { canonical } from './evidence.js';
export { canonical };

export const now = () => new Date().toISOString();
export const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
export const docRef = (db, orgId, code) => db.collection('documents').doc(`${orgId}__${code}`);
export const versionKey = (major, minor) => `${major}.${minor}`;
export const versionIdOf = (code, major, minor) => `${code}@${major}.${minor}`;
export function httpError(code, msg, extra) { return Object.assign(new Error(msg), { statusCode: code, expose: true, ...extra }); }

const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max = 200) => String(v ?? '').slice(0, max);

/** Clean a draft from the editor so only known fields with sane values are stored. */
export function cleanDraft(input, positionIds) {
  const a = input.audience || {};
  const valid = new Set(positionIds);
  return {
    title: str(input.title, 200).trim(),
    summary: str(input.summary, 1000),
    body: str(input.body, 700000), // Firestore documents are limited to 1 MiB
    estMinutes: clampInt(input.estMinutes, 1, 600, 5),
    order: clampInt(input.order, 0, 100000, 999),
    audience: { all: !!a.all, positions: [...new Set((a.positions || []).map(String))].filter(p => valid.has(p)) },
    appliesText: str(input.appliesText, 300),
    issueDate: str(input.issueDate, 60),
    questions: (Array.isArray(input.questions) ? input.questions : []).slice(0, 50).map(q => ({
      q: str(q.q, 500),
      options: (Array.isArray(q.options) ? q.options : []).slice(0, 6).map(o => str(o, 300)),
      correct: Number.isInteger(q.correct) ? q.correct : -1,
    })),
    passMark: clampInt(input.passMark, 60, 100, 80),
    pdfFileId: input.pdfFileId ? String(input.pdfFileId) : null,
    videos: (Array.isArray(input.videos) ? input.videos : []).slice(0, 10)
      .filter(v => v && v.fileId).map(v => ({ fileId: String(v.fileId), title: str(v.title, 200) })),
    requireVideo: input.requireVideo !== false,
  };
}

export const draftFromVersion = v => ({
  title: v.title, summary: v.summary, body: v.body, estMinutes: v.estMinutes, order: v.order, audience: v.audience,
  appliesText: v.appliesText, issueDate: v.issueDate, questions: v.questions, passMark: v.passMark, pdfFileId: v.pdfFileId,
  videos: (v.videos || []).map(x => ({ fileId: x.fileId, title: x.title })), requireVideo: v.requireVideo,
});

export function newDraft(code, kind) {
  return {
    title: '', summary: '', body: '', estMinutes: 5, order: (BASE_ORDER[kind] || 100) + (parseInt(code.slice(-3), 10) || 0),
    audience: { all: false, positions: [] }, appliesText: '', issueDate: '', questions: [], passMark: 80,
    pdfFileId: null, videos: [], requireVideo: true,
  };
}

/** Load referenced files and check they exist, are the right kind and belong to this org. */
export async function checkFiles(t, db, orgId, draft) {
  const ids = [...new Set([draft.pdfFileId, ...draft.videos.map(v => v.fileId)].filter(Boolean))];
  const m = new Map();
  if (!ids.length) return m;
  const snaps = await t.getAll(...ids.map(id => db.collection('files').doc(id)));
  snaps.forEach(s => { if (s.exists && s.get('orgId') === orgId) m.set(s.id, s.data()); });
  if (draft.pdfFileId && m.get(draft.pdfFileId)?.kind !== 'pdf') throw httpError(400, 'The PDF attachment is missing. Upload it again.');
  for (const v of draft.videos) if (m.get(v.fileId)?.kind !== 'video') throw httpError(400, 'A training video is missing. Upload it again.');
  return m;
}

export function auditRecord(orgId, actorId, action, entity, entityId, details = {}, ip = null) {
  return { orgId, actorId: actorId || null, action, entity, entityId: entityId == null ? null : String(entityId), details, ip, at: now() };
}
export const audit = (db, ...a) => db.collection('auditLog').add(auditRecord(...a));

/** Publish a document's draft as a new frozen version. change: 'minor' or 'major'. */
export async function publishDocument(db, { orgId, code, change, actorId, force = false }) {
  return db.runTransaction(async t => {
    const ref = docRef(db, orgId, code);
    const snap = await t.get(ref);
    if (!snap.exists) throw httpError(404, 'Document not found.');
    const doc = snap.data();
    const draft = doc.draft;
    const problems = draftProblems(draft);
    if (problems.length) throw httpError(400, problems[0], { problems });
    const cur = doc.current;
    const files = await checkFiles(t, db, orgId, draft);

    if (doc.status === 'archived' && cur && !doc.draftDirty && !force) {
      t.update(ref, { status: 'published', updatedAt: now() });
      t.create(db.collection('auditLog').doc(), auditRecord(orgId, actorId, 'document.restore', 'document', code, { version: verLabel(cur.major, cur.minor) }));
      return { restored: true, label: verLabel(cur.major, cur.minor) };
    }
    if (doc.status === 'published' && !doc.draftDirty && !force) throw httpError(400, 'There are no changes to publish.');

    let major, minor;
    if (!cur) ({ major, minor } = doc.startVersion || { major: 1, minor: 0 });
    else if (change === 'major') { major = cur.major + 1; minor = 0; }
    else if (change === 'minor') { major = cur.major; minor = cur.minor + 1; }
    else throw httpError(400, 'Choose whether this is a minor change or a new version.');

    const videos = draft.videos.map(v => ({ fileId: v.fileId, title: v.title || 'Training video', duration: Math.round(files.get(v.fileId).duration || 0) }));
    const frozen = {
      code, kind: doc.kind, major, minor, title: draft.title, summary: draft.summary, body: draft.body, audience: draft.audience,
      appliesText: draft.appliesText, issueDate: draft.issueDate, questions: draft.questions, passMark: draft.passMark,
      requireVideo: draft.requireVideo, pdf: draft.pdfFileId ? files.get(draft.pdfFileId).sha256 : null,
      videos: videos.map(v => ({ sha256: files.get(v.fileId).sha256, title: v.title })),
    };
    const contentHash = sha256(canonical(frozen));
    const publishedAt = now();
    const versionId = versionIdOf(code, major, minor);
    const version = {
      orgId, code, kind: doc.kind, versionId, major, minor, title: draft.title, summary: draft.summary, body: draft.body,
      estMinutes: draft.estMinutes, order: draft.order, audience: draft.audience, appliesText: draft.appliesText,
      issueDate: draft.issueDate, questions: draft.questions, passMark: draft.passMark, pdfFileId: draft.pdfFileId,
      videos, requireVideo: draft.requireVideo, contentHash, publishedAt, publishedBy: actorId || null,
    };
    t.create(ref.collection('versions').doc(versionKey(major, minor)), version);
    t.update(ref, {
      status: 'published', hold: null, draftDirty: false, startVersion: null, updatedAt: now(),
      firstPublishedAt: doc.firstPublishedAt || publishedAt, current: summaryOf(version),
    });
    const label = verLabel(major, minor);
    t.create(db.collection('auditLog').doc(), auditRecord(orgId, actorId, 'document.publish', 'document', code, { version: label, change: cur ? change : 'first', hash: contentHash }));
    return { versionId, major, minor, label, hash: contentHash };
  });
}

/** What the course screens need about the current version, without the text or the answers. */
export function summaryOf(v) {
  return {
    versionId: v.versionId, major: v.major, minor: v.minor, title: v.title, summary: v.summary, estMinutes: v.estMinutes,
    order: v.order, audience: v.audience, appliesText: v.appliesText, issueDate: v.issueDate, questionCount: v.questions.length,
    passMark: v.passMark, pdfFileId: v.pdfFileId, videos: v.videos, requireVideo: v.requireVideo, publishedAt: v.publishedAt,
    contentHash: v.contentHash,
  };
}

/** The full current version of a published document (server use only: it includes the answers). */
export async function currentVersion(db, orgId, code, t = null) {
  const ref = docRef(db, orgId, code);
  const snap = t ? await t.get(ref) : await ref.get();
  if (!snap.exists || snap.get('status') !== 'published') return null;
  const cur = snap.get('current');
  const vref = ref.collection('versions').doc(versionKey(cur.major, cur.minor));
  const v = t ? await t.get(vref) : await vref.get();
  return { ...v.data(), firstPublishedAt: snap.get('firstPublishedAt') };
}
