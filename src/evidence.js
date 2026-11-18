// Evidence records (quiz attempts, sign-offs, declarations) are written once and never updated.
// Each person's records form a chain: every record stores the fingerprint of the one before it,
// and the person's profile stores the latest fingerprint. Editing, removing or reordering any
// record breaks the chain, which `verifyChain` (and `npm run verify`) detects.
import crypto from 'node:crypto';

export const EVIDENCE = ['quizAttempts', 'signoffs', 'declarations', 'courseCompletions'];
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
const recordHash = rec => { const { hash, ...rest } = rec; return sha256(canonical(rest)); };

/**
 * Add an evidence record inside a transaction. staffSnap must have been read in the same
 * transaction (Firestore needs all reads before writes), so two records can't claim the same place.
 */
export function appendEvidence(t, db, staffSnap, collection, ref, data) {
  const st = staffSnap.data();
  const rec = { ...data, staffId: staffSnap.id, kind: collection, seq: (st.chainSeq || 0) + 1, prevHash: st.chainHead || null };
  rec.hash = recordHash(rec);
  t.create(ref || db.collection(collection).doc(), rec);
  t.update(staffSnap.ref, { chainHead: rec.hash, chainSeq: rec.seq });
  return rec;
}

/** Check one person's chain. Returns {ok, records, problem}. */
export async function verifyChain(db, staffId) {
  const st = await db.collection('staff').doc(staffId).get();
  if (!st.exists) return { ok: false, records: 0, problem: 'This person does not exist.' };
  const orgId = st.get('orgId');
  const all = [];
  for (const c of EVIDENCE) (await db.collection(c).where('staffId', '==', staffId).get()).forEach(s => all.push({ id: `${c}/${s.id}`, ...s.data() }));
  all.sort((a, b) => a.seq - b.seq);
  let prev = null;
  for (let i = 0; i < all.length; i++) {
    const r = all[i]; const { id, ...rec } = r;
    if (r.orgId !== orgId) return { ok: false, records: all.length, problem: `${id} belongs to a different client.` };
    if (r.seq !== i + 1) return { ok: false, records: all.length, problem: `Record number ${i + 1} is missing (found ${r.seq} at ${id}).` };
    if (r.prevHash !== prev) return { ok: false, records: all.length, problem: `${id} does not follow the record before it.` };
    if (recordHash(rec) !== r.hash) return { ok: false, records: all.length, problem: `${id} has been changed since it was written.` };
    prev = r.hash;
  }
  if ((st.get('chainHead') || null) !== prev) return { ok: false, records: all.length, problem: 'The latest record is missing.' };
  return { ok: true, records: all.length };
}
