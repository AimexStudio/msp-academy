// Sharing a course from one client (or the MSP Academy library) to others. Only platform admins share.
//
// Sharing COPIES the course into each receiving client: the course with its modules and lessons, its
// own copies of every video and PDF in its own storage folder, and any SOP lessons as documents numbered
// with its own prefix. The receiving client's sign-offs and evidence stay in its own records, and no
// client ever reads another client's data. Sharing again sends the source's current version as an
// update, keeping the receiving client's choice of who must complete each item.
//
// The receiving client sees "Provided by MSP Academy", never the name of the client it came from.
//
//   groups/{id}         groups of clients (platform only)
//   sharedLinks/{id}    <source>__<code>__<target> -> the receiving client's document code
//   sharedCourses/{id}  <source>__<courseId>__<target> -> the receiving client's course id
//   shares/{id}         every share: who, what, from, to, which versions, the result per item
import { docRef, versionKey, draftFromVersion, newDraft, publishDocument, httpError, now, auditRecord, canonical } from './documents.js';
import { nextCode, draftProblems, verLabel } from './rules.js';
import { getOrg, storagePrefix, storageKeyAllowed } from './tenancy.js';
import { platformAuditRecord } from './platform.js';
import { draftOf, codesOf, lessonsOf, publishCourse } from './courses.js';

export const PROVIDER = 'MSP Academy';
const linkId = (src, code, tgt) => `${src}__${code}__${tgt}`;

/**
 * A course ready to share: its published version (modules and lessons) and, for its SOP lessons, each
 * document's current published version. Courses made before the builder (a list of documents) share
 * their documents as one module.
 */
export async function loadShareableCourse(db, orgId, courseId) {
  const c = await db.collection('courses').doc(String(courseId)).get();
  if (!c.exists || c.get('orgId') !== orgId) throw httpError(404, 'Course not found.');
  const x = c.data();
  let content, label = null;
  if (x.current) {
    if (x.status !== 'published') throw httpError(400, 'This course isn’t published at the moment, so it can’t be shared.');
    const v = (await c.ref.collection('versions').doc(versionKey(x.current.major, x.current.minor)).get()).data();
    content = { title: v.title, description: v.description, modules: v.modules };
    label = verLabel(v.major, v.minor);
  } else if (x.draft && lessonsOf(x.draft).some(l => l.type !== 'document')) {
    throw httpError(400, 'Publish this course at its client first, so a finished version is shared.');
  } else content = draftOf(x);
  const docs = [];
  for (const code of codesOf(content)) {
    const d = await docRef(db, orgId, code).get();
    if (!d.exists) throw httpError(400, `${code} is in the course but no longer exists. Ask the client to update the course.`);
    const cur = d.get('current');
    if (!cur || d.get('status') !== 'published') throw httpError(400, `${code} isn't published at this client, so it can't be shared yet.`);
    const v = (await d.ref.collection('versions').doc(versionKey(cur.major, cur.minor)).get()).data();
    docs.push({ code, kind: d.get('kind'), version: v, label: verLabel(cur.major, cur.minor) });
  }
  if (!lessonsOf(content).length) throw httpError(400, 'This course has no lessons.');
  return { id: c.id, title: content.title || x.title, description: content.description || '', modules: content.modules, label, built: !!x.current, docs };
}

/** Copy one stored file into the receiving client's own folder (re-using an identical copy it already has). */
async function copyFile(db, storage, source, target, fileId, cache) {
  if (cache.has(fileId)) return cache.get(fileId);
  const f = await db.collection('files').doc(fileId).get();
  if (!f.exists || f.get('orgId') !== source.id || !storageKeyAllowed(source, f.get('storageKey'))) throw httpError(400, 'A file in this course is missing at the source client.');
  const x = f.data();
  const existing = await db.collection('files').where('orgId', '==', target.id).where('sha256', '==', x.sha256).get();
  const same = existing.docs.find(d => d.get('kind') === x.kind);
  let id;
  if (same) id = same.id;
  else {
    const stored = await storage.putBuffer(await storage.getBuffer(x.storageKey), x.mime, storagePrefix(target.id, 'files'));
    const ref = db.collection('files').doc();
    await ref.set({ orgId: target.id, kind: x.kind, name: x.name, mime: x.mime, size: stored.size, sha256: stored.sha256, storageKey: stored.key,
      duration: x.duration ?? null, uploadedBy: null, sharedCopy: true, createdAt: now() });
    id = ref.id;
  }
  cache.set(fileId, id);
  return id;
}

/** Share one course to one client. Returns what happened to the course and each document. */
async function shareToOne(db, storage, admin, source, course, target, { publish, change }) {
  const results = [], cache = new Map();
  const targetDocs = await db.collection('documents').where('orgId', '==', target.id).get();
  const codes = targetDocs.docs.map(d => d.get('code'));
  const targetCodes = [];
  for (const sd of course.docs) {
    const v = sd.version;
    const pdfFileId = v.pdfFileId ? await copyFile(db, storage, source, target, v.pdfFileId, cache) : null;
    const videos = [];
    for (const vid of v.videos || []) videos.push({ fileId: await copyFile(db, storage, source, target, vid.fileId, cache), title: vid.title });
    const content = { ...draftFromVersion(v), pdfFileId, videos };

    const linkRef = db.collection('sharedLinks').doc(linkId(source.id, sd.code, target.id));
    const link = await linkRef.get();
    let code = link.exists ? link.get('targetCode') : null;
    let ref = code ? docRef(db, target.id, code) : null;
    let existing = ref ? await ref.get() : null;
    if (existing && !existing.exists) { existing = null; code = null; } // the client deleted its copy: make a new one

    let result;
    if (existing) {
      const d = existing.data();
      // Keep the receiving client's choice of who must complete it, and where it sits in their course.
      const draft = { ...content, audience: d.draft.audience, order: d.draft.order };
      let same = false;
      if (d.current) {
        const cv = (await ref.collection('versions').doc(versionKey(d.current.major, d.current.minor)).get()).data();
        same = canonical(draft) === canonical(draftFromVersion(cv));
      }
      if (same && !d.draftDirty && d.status === 'published') result = 'unchanged';
      else {
        await ref.update({ draft, draftDirty: !!d.current && !same, shared: { at: now(), provider: PROVIDER }, updatedAt: now() });
        result = 'updated';
      }
    } else {
      code = nextCode(sd.kind, codes, target.docPrefix || 'DOC');
      codes.push(code);
      ref = docRef(db, target.id, code);
      const draft = { ...newDraft(code, sd.kind), ...content, audience: { all: true, positions: [] }, order: v.order };
      await ref.create({ orgId: target.id, code, kind: sd.kind, status: 'draft', hold: null, draft, draftDirty: false, current: null,
        startVersion: { major: 1, minor: 0 }, firstPublishedAt: null, shared: { at: now(), provider: PROVIDER }, createdAt: now(), updatedAt: now() });
      await linkRef.set({ sourceOrgId: source.id, sourceCode: sd.code, targetOrgId: target.id, targetCode: code, createdAt: now() });
      result = 'new';
    }

    let published = null;
    if (publish && result !== 'unchanged') {
      const d = (await ref.get()).data();
      // Nothing new to publish if the client's live version already has this content.
      if (!(d.status === 'published' && !d.draftDirty)) {
        if (draftProblems(d.draft).length) throw httpError(400, `${sd.code} can't be published at ${target.name}: ${draftProblems(d.draft)[0]}`);
        published = (await publishDocument(db, { orgId: target.id, code, change: d.current ? change : undefined, actorId: null })).label;
      }
    }
    results.push({ sourceCode: sd.code, sourceLabel: sd.label, targetCode: code, result, published });
    targetCodes.push(code);
  }

  // The receiving client's own course: the same modules and lessons, pointing at its own copies.
  const codeMap = new Map(results.map(r => [r.sourceCode, r.targetCode]));
  const modules = [];
  for (const m of course.modules) {
    const lessons = [];
    for (const l of m.lessons) {
      if (l.type === 'document') lessons.push({ ...l, code: codeMap.get(l.code) });
      else if ((l.type === 'video' || l.type === 'pdf') && l.fileId) lessons.push({ ...l, fileId: await copyFile(db, storage, source, target, l.fileId, cache) });
      else lessons.push({ ...l });
    }
    modules.push({ ...m, lessons });
  }
  const cl = db.collection('sharedCourses').doc(`${source.id}__${course.id}__${target.id}`);
  const cls = await cl.get();
  let courseRef = cls.exists ? db.collection('courses').doc(cls.get('targetCourseId')) : null;
  let existingCourse = courseRef ? await courseRef.get() : null;
  if (existingCourse && !existingCourse.exists) { existingCourse = null; courseRef = null; }
  const prev = existingCourse ? draftOf(existingCourse.data()) : null;
  const draft = { title: course.title, description: course.description || '', audience: prev ? prev.audience : { all: true, positions: [] }, modules };
  const base = { title: course.title, description: course.description || '', codes: targetCodes, shared: { at: now(), provider: PROVIDER }, updatedAt: now() };
  let courseResult = 'new';
  if (existingCourse) {
    const c = existingCourse.data();
    let same = false;
    if (c.current) {
      const v = (await courseRef.collection('versions').doc(`${c.current.major}.${c.current.minor}`).get()).data();
      same = canonical(draft) === canonical({ title: v.title, description: v.description, audience: v.audience, modules: v.modules });
    } else same = canonical(draft) === canonical(prev);
    courseResult = same ? 'unchanged' : 'updated';
    await courseRef.update({ ...base, draft, draftDirty: !!c.current && !same, ...(c.current ? { title: c.title, codes: c.codes } : {}) });
  } else {
    courseRef = db.collection('courses').doc();
    await courseRef.set({ orgId: target.id, ...base, draft, status: 'draft', draftDirty: false, current: null, createdAt: now(), createdBy: null });
    await cl.set({ sourceOrgId: source.id, courseId: course.id, targetOrgId: target.id, targetCourseId: courseRef.id });
  }
  let coursePublished = null;
  if (publish && course.built) {
    const c = (await courseRef.get()).data();
    if (!c.current || c.draftDirty) coursePublished = (await publishCourse(db, { orgId: target.id, courseId: courseRef.id, change: c.current ? change : undefined, actorName: PROVIDER })).label;
  }
  return { targetOrgId: target.id, targetName: target.name, courseId: courseRef.id, course: courseResult, coursePublished, documents: results };
}

/**
 * Share a course from one client to others.
 * publish: true publishes straight away (to all staff for new items); false leaves drafts for
 * the receiving client's manager to check, choose who must complete them, and publish.
 * change: for items the client already has and publishes now, 'minor' (signatures stay) or 'major' (everyone again).
 */
export async function shareCourse(db, storage, admin, { sourceOrgId, courseId, targetOrgIds, publish = false, change = 'major' }, { ip = null } = {}) {
  const source = await getOrg(db, sourceOrgId);
  if (!source) throw httpError(404, 'Client not found.');
  const targets = [...new Set((targetOrgIds || []).map(String))].filter(id => id !== source.id);
  if (!targets.length) throw httpError(400, 'Choose at least one other client to share with.');
  if (!['minor', 'major'].includes(change)) throw httpError(400, 'Choose whether updates are a minor change or a new version.');
  const course = await loadShareableCourse(db, source.id, courseId);
  const out = [];
  for (const tid of targets) {
    const target = await getOrg(db, tid);
    if (!target) throw httpError(404, 'One of the receiving clients no longer exists.');
    if (target.library) continue;
    const r = await shareToOne(db, storage, admin, source, course, target, { publish, change });
    const counts = { new: r.documents.filter(d => d.result === 'new').length, updated: r.documents.filter(d => d.result === 'updated').length };
    await db.collection('shares').add({ sourceOrgId: source.id, sourceName: source.name, courseId: course.id, courseTitle: course.title, courseLabel: course.label,
      targetOrgId: target.id, targetName: target.name, targetCourseId: r.courseId, adminId: admin ? admin.id : null, adminName: admin ? admin.name : null,
      publish: !!publish, change, course: r.course, documents: r.documents, at: now() });
    // The receiving client's audit log: what arrived, from the platform, without naming the source client.
    await db.collection('auditLog').add({ ...auditRecord(target.id, null, 'course.shared_in', 'course', r.courseId,
      { title: course.title, provider: PROVIDER, course: r.course, documents: r.documents.map(d => `${d.targetCode} (${d.result}${d.published ? `, published v${d.published}` : ''})`), ...counts, published: !!publish }, ip), actorName: PROVIDER });
    await db.collection('platformAudit').add(platformAuditRecord(admin, 'course.share',
      { course: course.title, from: source.name, to: target.name, ...counts, published: !!publish }, { orgId: target.id, ip }));
    out.push(r);
  }
  await db.collection('platformAudit').add(platformAuditRecord(admin, 'course.share_out', { course: course.title, to: out.map(r => r.targetName) }, { orgId: source.id, ip }));
  return { course: { id: course.id, title: course.title }, results: out };
}

/** For the platform: each course of a client, with where it has been shared and whether those copies are behind. */
export async function coursesWithShares(db, orgId) {
  const [cs, shares, docs] = await Promise.all([
    db.collection('courses').where('orgId', '==', orgId).get(),
    db.collection('shares').where('sourceOrgId', '==', orgId).get(),
    db.collection('documents').where('orgId', '==', orgId).get(),
  ]);
  const byCode = new Map(docs.docs.map(d => [d.get('code'), d.data()]));
  return cs.docs.map(c => {
    const x = c.data(), d = draftOf(x), cur = x.current;
    const items = codesOf(d).map(code => {
      const dd = byCode.get(code), dc = dd && dd.current;
      return { code, title: dd ? (dc ? dc.title : dd.draft.title) || 'Untitled' : '(deleted)', status: dd ? dd.status : 'missing', label: dc ? verLabel(dc.major, dc.minor) : null };
    });
    const label = cur ? verLabel(cur.major, cur.minor) : null;
    const lessonCount = lessonsOf(d).length;
    const built = !!cur || lessonsOf(d).some(l => l.type !== 'document');
    const latest = new Map();
    for (const s of shares.docs.map(s => s.data()).filter(s => s.courseId === c.id).sort((a, b) => (a.at < b.at ? -1 : 1))) latest.set(s.targetOrgId, s);
    const sharedTo = [...latest.values()].map(s => {
      const sent = new Map(s.documents.map(d => [d.sourceCode, d.sourceLabel]));
      const behind = items.some(i => i.label && sent.get(i.code) !== i.label) || (!!label && s.courseLabel !== label);
      return { targetOrgId: s.targetOrgId, targetName: s.targetName, at: s.at, by: s.adminName, published: s.publish, behind };
    });
    const docsReady = items.every(i => i.status === 'published');
    return { id: c.id, title: (cur && cur.title) || d.title || x.title, description: d.description || '', receivedCopy: !!x.shared, documents: items, label, lessonCount,
      status: x.status || 'draft', shareable: !x.shared && lessonCount > 0 && docsReady && (built ? x.status === 'published' : true),
      notShareableReason: x.shared ? null : !lessonCount ? 'Add lessons first' : !docsReady ? 'Publish all its SOPs and policies first' : built && x.status !== 'published' ? 'Publish the course first' : null,
      sharedTo };
  });
}
