// Business rules from spec section 5, as pure functions. No database, no HTTP:
// everything that decides who owes what lives here so it can be tested directly.

export const KINDS = { sop: 'SOP', manual: 'Manual', policy: 'Policy', memo: 'Staff memo' };
export const PREFIX = { sop: 'PEL-SOP', manual: 'PEL-MAN', policy: 'PEL-POL', memo: 'PEL-MEM' };
export const BASE_ORDER = { sop: 100, manual: 200, policy: 300, memo: 400 };
export const VIDEO_THRESHOLD = 0.85;

/** Who gets a document: "all staff" or a list of positions. */
export const appliesTo = (audience, positionId) =>
  !!audience && (!!audience.all || (audience.positions || []).includes(positionId));

export const verLabel = (major, minor) => `${major}.${minor || 0}`;

/** Typed name must match the profile name, ignoring capitals and extra spaces. */
export const normName = s => String(s || '')
  .normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export const namesMatch = (typed, profile) => normName(typed) !== '' && normName(typed) === normName(profile);

/**
 * Status of one document for one person.
 *  done       - signed at the current major version
 *  updated    - signed an earlier major version; must sign again
 *  inprogress - has read or attempted the quiz at the current major
 *  todo       - nothing yet
 */
export function docStatus({ currentMajor, signedMajor, active }) {
  if (signedMajor != null && signedMajor === currentMajor) return 'done';
  if (signedMajor != null && signedMajor < currentMajor) return 'updated';
  if (active) return 'inprogress';
  return 'todo';
}

/** "New": first published after the person's most recent declaration. */
export const isNewFor = (firstPublishedAt, lastDeclarationAt) =>
  !!(firstPublishedAt && lastDeclarationAt && new Date(firstPublishedAt) > new Date(lastDeclarationAt));

/** Mark a quiz on the server. answers: array of chosen option indexes. */
export function markQuiz(questions, answers, passMark) {
  const total = questions.length;
  const wrong = [];
  let correct = 0;
  questions.forEach((q, i) => {
    if (Number.isInteger(answers[i]) && answers[i] === q.correct) correct++;
    else wrong.push(i);
  });
  const score = total ? Math.round((correct / total) * 100) : 100;
  return { correct, total, score, passed: score >= passMark, wrong };
}

/** Merge [start,end] intervals (seconds). */
export function mergeSegments(segs) {
  const s = segs
    .filter(x => Array.isArray(x) && x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > x[0])
    .map(([a, b]) => [Math.max(0, a), b])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.5) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
export const coverage = segs => segs.reduce((n, [a, b]) => n + (b - a), 0);

/**
 * Accept newly reported played segments for a video, but no faster than real time allows:
 * coverage can grow by at most (wall-clock seconds since the last report × 2) + 3 seconds,
 * which allows 2× playback speed and network jitter but not a faked "I watched it all" report.
 * Returns the new merged segments and coverage.
 */
export function acceptSegments({ existing, reported, duration, elapsedSec }) {
  const clip = mergeSegments(reported.map(([a, b]) => [a, Math.min(b, duration)]));
  const before = coverage(existing);
  let merged = mergeSegments(existing.concat(clip));
  const allowed = Math.max(0, elapsedSec) * 2 + 3;
  if (coverage(merged) - before > allowed) {
    // Only take as much of the new material as real time allows, earliest first.
    let budget = allowed;
    const accepted = [];
    for (const [a, b] of clip) {
      if (budget <= 0) break;
      const end = Math.min(b, a + budget);
      accepted.push([a, end]);
      budget -= end - a;
    }
    merged = mergeSegments(existing.concat(accepted));
  }
  return { segments: merged, watched: coverage(merged) };
}

export function nextCode(kind, codes) {
  const p = PREFIX[kind] || 'PEL-SOP';
  const ns = codes.filter(c => c.startsWith(p + '-')).map(c => parseInt(c.slice(p.length + 1), 10)).filter(n => !isNaN(n));
  return `${p}-${String((ns.length ? Math.max(...ns) : 0) + 1).padStart(3, '0')}`;
}

/** A draft is ready to publish when it has content, a title and an audience, and is not on hold. */
export function draftProblems(d) {
  const p = [];
  if (!String(d.title || '').trim()) p.push('Add a title.');
  if (!String(d.body || '').trim() && !d.pdfFileId) p.push('Add the document text or a PDF.');
  const a = d.audience || {};
  if (!a.all && !(a.positions || []).length) p.push('Choose who must complete it.');
  (d.questions || []).forEach((q, i) => {
    if (!String(q.q || '').trim()) p.push(`Question ${i + 1} has no wording.`);
    const opts = (q.options || []).map(o => String(o || '').trim());
    if (opts.length < 2 || opts.some(o => !o)) p.push(`Question ${i + 1} needs at least two filled-in options.`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= opts.length) p.push(`Question ${i + 1} has no correct answer marked.`);
  });
  const pm = Number(d.passMark);
  if (!(pm >= 60 && pm <= 100)) p.push('Pass mark must be between 60 and 100%.');
  return p;
}

export const fillDeclaration = (text, name, position) =>
  String(text).replace(/\{name\}/g, name).replace(/\{position\}/g, position);

export const signoffStatement = (name, code, title, label, orgName) =>
  `I, ${name}, confirm that I have read and understood ${code} ${title} (version ${label}), and I agree to follow it in my work at ${orgName}.`;
