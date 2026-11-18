// Imports the developer pack content folder (2-content): settings, departments, positions, documents
// with their questions, PDFs and training videos. Safe to run again: existing document codes are left alone.
import fs from 'node:fs';
import path from 'node:path';
import { mp4Duration } from './mp4.js';
import { publishDocument, docRef, audit, now } from './documents.js';
import { draftProblems } from './rules.js';

export async function importContent({ db, storage, dir, orgId, publish = false, log = console }) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  const orgRef = db.collection('orgs').doc(orgId);
  if (!(await orgRef.get()).exists) {
    await orgRef.set({ name: cfg.orgName, courseTitle: cfg.courseTitle, declarationText: cfg.declarationText,
      departments: cfg.departments.map(d => ({ id: d.id, name: d.name })), positions: cfg.positions.map(p => ({ id: p.id, name: p.name, dept: p.dept })), updatedAt: now() });
  }
  async function storeFile(file, kind, name) {
    const buf = fs.readFileSync(file);
    const s = await storage.putBuffer(buf, kind === 'pdf' ? 'application/pdf' : 'video/mp4');
    const ex = await db.collection('files').where('sha256', '==', s.sha256).get();
    const same = ex.docs.find(d => d.get('orgId') === orgId && d.get('kind') === kind);
    if (same) return same.id;
    const ref = db.collection('files').doc();
    await ref.create({ orgId, kind, name, mime: kind === 'pdf' ? 'application/pdf' : 'video/mp4', size: s.size, sha256: s.sha256,
      storageKey: s.key, duration: kind === 'video' ? Math.round(mp4Duration(buf) || 0) : null, uploadedBy: null, createdAt: now() });
    return ref.id;
  }
  const docsDir = path.join(dir, 'documents'), filesDir = path.join(dir, 'files');
  const added = [], skipped = [];
  for (const f of fs.readdirSync(docsDir).filter(f => f.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(docsDir, f), 'utf8'));
    const ref = docRef(db, orgId, j.code);
    if ((await ref.get()).exists) { skipped.push(j.code); continue; }
    const pdfPath = path.join(filesDir, `${j.code}.pdf`);
    const pdfFileId = fs.existsSync(pdfPath) ? await storeFile(pdfPath, 'pdf', (j.pdf && j.pdf.name) || `${j.code}.pdf`) : null;
    const videos = [];
    for (const [i, v] of (j.videos || []).entries()) {
      const vp = path.join(filesDir, i === 0 ? `${j.code}-video.mp4` : `${j.code}-video-${i + 1}.mp4`);
      if (!fs.existsSync(vp)) { log.warn(`  ${j.code}: video file ${path.basename(vp)} not found, skipped`); continue; }
      videos.push({ fileId: await storeFile(vp, 'video', v.name || path.basename(vp)), title: v.title || 'Training video' });
    }
    const draft = {
      title: j.title, summary: j.summary || '', body: j.body || '', estMinutes: j.estMinutes || 5, order: j.order ?? 999,
      audience: { all: !!(j.audience && j.audience.all), positions: (j.audience && j.audience.positions) || [] },
      appliesText: j.appliesText || '', issueDate: j.issueDate || '',
      questions: (j.questions || []).map(q => ({ q: q.q, options: q.options, correct: q.correct })),
      passMark: j.passMark || 80, pdfFileId, videos, requireVideo: j.requireVideo !== false,
    };
    await ref.create({ orgId, code: j.code, kind: j.kind, status: 'draft', hold: j.hold || null, draft, draftDirty: false, current: null,
      startVersion: { major: j.version || 1, minor: j.minor || 0 }, firstPublishedAt: null, createdAt: now(), updatedAt: now() });
    await audit(db, orgId, null, 'document.import', 'document', j.code, { source: f, hold: j.hold || null });
    added.push(j.code);
  }
  const published = [];
  if (publish) {
    const q = await db.collection('documents').where('orgId', '==', orgId).get();
    for (const s of q.docs.sort((a, b) => a.get('code').localeCompare(b.get('code')))) {
      const d = s.data();
      if (d.status !== 'draft' || d.hold) continue;
      const p = draftProblems(d.draft);
      if (p.length) { log.warn(`  ${d.code} not published: ${p[0]}`); continue; }
      await publishDocument(db, { orgId, code: d.code, actorId: null });
      published.push(d.code);
    }
  }
  return { added, skipped, published };
}
