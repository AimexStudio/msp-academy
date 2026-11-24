// Serves PDFs and videos from Cloud Storage with access checks and HTTP range requests (needed for
// video seeking and streaming on phones). Staff can only fetch files of documents in their own course.
import { requireAuth, isManagerish } from '../auth.js';
import { appliesTo } from '../rules.js';
import { loadPublishedDocs } from '../course.js';
import { docRef } from '../documents.js';
import { config } from '../config.js';
import { getOrg, storageKeyAllowed } from '../tenancy.js';
import { coursesFor, fileIdsOf } from '../courses.js';

// Each response is kept to 8 MB; browsers fetch videos in pieces anyway. Cloud Functions responses
// are limited to 32 MB.
const MAX_CHUNK = 8 * 1024 * 1024;
const uses = (v, id) => v && (v.pdfFileId === id || (v.videos || []).some(x => x.fileId === id));

export async function canAccessFile(db, orgId, session, fileId, file) {
  const s = session.staff;
  if (!orgId || !file || file.orgId !== orgId || file.kind === 'logo') return false;
  if (!storageKeyAllowed(await getOrg(db, orgId), file.storageKey)) return false;
  // A photo submitted as field evidence: the person who sent it, and their managers.
  if (file.kind === 'evidence' || file.kind === 'medical') return isManagerish(s.role) || file.staffId === s.id;
  if (isManagerish(s.role)) return true;
  const docs = await loadPublishedDocs(db, orgId);
  if (docs.some(d => appliesTo(d.audience, s.positionId) && uses(d, fileId))) return true;
  // Or a lesson in a published course they must complete.
  for (const c of await coursesFor(db, s)) {
    const cur = c.get('current');
    const v = await c.ref.collection('versions').doc(`${cur.major}.${cur.minor}`).get();
    if (v.exists && fileIdsOf(v.data()).includes(fileId)) return true;
  }
  // Or a version they signed in the past.
  const signed = await db.collection('signoffs').where('orgId', '==', orgId).where('staffId', '==', s.id).get();
  for (const so of signed.docs) {
    const [code, key] = so.get('versionId').split('@');
    const v = await docRef(db, orgId, code).collection('versions').doc(key).get();
    if (uses(v.data(), fileId)) return true;
  }
  return false;
}

export default async function (app) {
  const { db, storage } = app;

  app.get('/api/files/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const id = String(req.params.id);
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return reply.code(404).send({ error: 'Not found.' });
    const snap = await db.collection('files').doc(id).get();
    const f = snap.exists ? snap.data() : null;
    if (!(await canAccessFile(db, req.orgId, req.session, id, f))) return reply.code(404).send({ error: 'Not found.' });
    const size = f.size;
    reply.header('Content-Type', f.mime).header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      if (start >= size || end < start) { reply.header('Content-Range', `bytes */${size}`); return reply.code(416).send(); }
      end = Math.min(end, size - 1, start + Math.min(MAX_CHUNK, config.maxResponseBytes) - 1);
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1);
      return reply.send(storage.read(f.storageKey, { start, end }));
    }
    if (size > config.maxResponseBytes) {
      reply.removeHeader('Accept-Ranges'); reply.removeHeader('Content-Disposition');
      return reply.code(413).type('application/json').send({ error: 'This file is too large to download on the review site. It plays in the lesson as normal.' });
    }
    reply.header('Content-Length', size);
    return reply.send(storage.read(f.storageKey));
  });
}
