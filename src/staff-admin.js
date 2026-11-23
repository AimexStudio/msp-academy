// Creating staff outside the web screens: the first manager, demo staff and the tests.
import { hashPin, normStaffNo, staffNoRef, now } from './auth.js';

export async function createStaff(db, orgId, { staffNo, name, positionId, role = 'staff', pin, pinHash, startDate = null }) {
  staffNo = normStaffNo(staffNo);
  pinHash ||= await hashPin(pin);
  const ref = db.collection('staff').doc();
  const created = await db.runTransaction(async t => {
    const map = await t.get(staffNoRef(db, orgId, staffNo));
    if (map.exists) return null;
    t.create(ref, { orgId, staffNo, name, positionId, role, active: true, startDate, leftAt: null, pinHash, pinSetAt: now(),
      lastLoginAt: null, createdAt: now(), updatedAt: now(), chainHead: null, chainSeq: 0 });
    t.create(staffNoRef(db, orgId, staffNo), { staffId: ref.id, orgId });
    t.create(db.collection('positionHistory').doc(), { orgId, staffId: ref.id, from: null, to: positionId, by: null, at: now() });
    return ref.id;
  });
  return created;
}

export const DEMO_STAFF = [
  ['PL001', 'Example Manager', 'gm', 'manager'], ['PL002', 'Example Waitron', 'waitron', 'staff'],
  ['PL003', 'Example Bartender', 'bartender', 'staff'], ['PL004', 'Example Chef', 'chef', 'staff'],
  ['PL005', 'Example Housekeeper', 'housekeeper', 'staff'], ['PL006', 'Example Duty Manager', 'dm', 'staff'],
  ['PL007', 'Example Head Chef', 'headchef', 'hod'], ['PL008', 'Example Auditor', 'gm', 'auditor'],
];
export async function seedDemoStaff(db, orgId) {
  const pinHash = await hashPin('1234');
  const ids = {};
  for (const [staffNo, name, positionId, role] of DEMO_STAFF) {
    const id = await createStaff(db, orgId, { staffNo, name, positionId, role, pinHash, startDate: '2026-01-15' });
    if (id) ids[staffNo] = id;
  }
  return ids;
}

/* ---------- demo data for trying the platform locally (never used live) ---------- */
import { createClient, createPlatformAdmin } from './platform.js';
import { docRef, publishDocument } from './documents.js';
import { ensureLibrary, LIBRARY_ORG_ID } from './tenancy.js';
import { publishCourse } from './courses.js';

export const DEMO_CLIENT = { orgId: 'harbour-demo', loginCode: 'HARBOUR' };
export const DEMO_HR = { orgId: 'hr-demo', loginCode: 'HRDEMO' };
export const DEMO_ADMIN = { email: 'admin@example.com', password: 'platform-demo-only' };

/** Harbour Demo (client code HARBOUR) with staff and one published SOP, plus a platform admin. */
export async function seedDemoPlatform(db, { demoAdmin = true } = {}) {
  if ((await db.collection('orgs').doc(DEMO_CLIENT.orgId).get()).exists) return false;
  await createClient(db, null, { orgId: DEMO_CLIENT.orgId, name: 'Harbour Demo', loginCode: DEMO_CLIENT.loginCode, docPrefix: 'HBR', staffNoPrefix: 'HB',
    manager: { name: 'Demo Harbour Manager', staffNo: 'HB001', pin: '123456' },
    branding: { wordmark: 'HARBOUR', subtitle: 'Demo', tagline: 'A made-up second client', pitch: 'Your standards', pitchAccent: 'on every shift',
      colors: { primary: '#1F3A4D', accent: '#2F6F8F', highlight: '#C9A227', background: '#ECEFF1' }, headingFont: 'serif', bodyFont: 'system',
      announcement: 'New this month: the Guest Arrival SOP. Please complete it before your next shift.' } });
  const pinHash = await hashPin('1234');
  await createStaff(db, DEMO_CLIENT.orgId, { staffNo: 'HB002', name: 'Demo Harbour Porter', positionId: 'staff', pinHash });
  await createStaff(db, DEMO_CLIENT.orgId, { staffNo: 'PL002', name: 'Demo Harbour Waitron', positionId: 'staff', pinHash }); // same number as at Pelagos, on purpose
  await docRef(db, DEMO_CLIENT.orgId, 'HBR-SOP-001').create({ orgId: DEMO_CLIENT.orgId, code: 'HBR-SOP-001', kind: 'sop', status: 'draft', hold: null, draftDirty: false, current: null,
    startVersion: { major: 1, minor: 0 }, firstPublishedAt: null, createdAt: now(), updatedAt: now(),
    draft: { title: 'Guest Arrival', summary: 'How every guest is welcomed.', body: '## Arrival\n\nGreet every guest within 30 seconds, by name if you know it.\n\n## Luggage\n\nOffer help with luggage before showing the room.',
      estMinutes: 3, order: 101, audience: { all: true, positions: [] }, appliesText: 'All staff', issueDate: '', passMark: 80, pdfFileId: null, videos: [], requireVideo: true,
      questions: [{ q: 'How soon should a guest be greeted?', options: ['Within 30 seconds', 'Within 5 minutes', 'When they ask'], correct: 0 },
        { q: 'When do you offer help with luggage?', options: ['After showing the room', 'Before showing the room', 'Never'], correct: 1 }] } });
  await publishDocument(db, { orgId: DEMO_CLIENT.orgId, code: 'HBR-SOP-001', actorId: null });
  if (demoAdmin && !(await db.collection('platformAdminEmails').doc(DEMO_ADMIN.email).get()).exists) await createPlatformAdmin(db, { ...DEMO_ADMIN, name: 'Demo Platform Admin' });
  return true;
}

/** HR Demo (client code HRDEMO, HR group) with an "HR Essentials" course; Pelagos and Harbour Demo in Hospitality. */
export async function seedDemoSharing(db, pelagosOrgId) {
  if ((await db.collection('orgs').doc(DEMO_HR.orgId).get()).exists) return false;
  const groups = {};
  for (const name of ['HR', 'Hospitality']) {
    const existing = (await db.collection('groups').get()).docs.find(g => g.get('name') === name);
    groups[name] = existing ? existing.id : (await db.collection('groups').add({ name, createdAt: now(), createdBy: null })).id;
  }
  await createClient(db, null, { orgId: DEMO_HR.orgId, name: 'HR Demo', loginCode: DEMO_HR.loginCode, docPrefix: 'HRD', staffNoPrefix: 'HR', groupId: groups.HR,
    manager: { name: 'Demo HR Manager', staffNo: 'HR001', pin: '123456' } });
  for (const id of [pelagosOrgId, DEMO_CLIENT.orgId]) {
    const o = db.collection('orgs').doc(id);
    if ((await o.get()).exists) await o.update({ groupId: groups.Hospitality });
  }
  const docs = [
    ['HRD-POL-001', 'policy', 'Leave Policy', 'How to apply for annual, sick and family leave.',
      '## Annual leave\n\nApply in writing at least two weeks ahead. Your manager confirms within three working days.\n\n## Sick leave\n\nTell your manager before your shift starts. From the third day, bring a medical certificate.',
      [['How far ahead do you apply for annual leave?', ['Two weeks', 'Two days', 'No need to apply'], 0], ['When do you need a medical certificate?', ['From the third day', 'Never', 'Only for one day'], 0]]],
    ['HRD-POL-002', 'policy', 'Code of Conduct', 'How we treat each other and our guests.',
      '## Respect\n\nTreat colleagues and guests with respect at all times.\n\n## Reporting\n\nReport harassment to your manager or HR. Reports are handled in confidence.',
      [['Who can you report harassment to?', ['Your manager or HR', 'Nobody', 'Only a guest'], 0]]],
  ];
  for (const [code, kind, title, summary, body, qs] of docs) {
    await docRef(db, DEMO_HR.orgId, code).create({ orgId: DEMO_HR.orgId, code, kind, status: 'draft', hold: null, draftDirty: false, current: null,
      startVersion: { major: 1, minor: 0 }, firstPublishedAt: null, createdAt: now(), updatedAt: now(),
      draft: { title, summary, body, estMinutes: 4, order: 300 + parseInt(code.slice(-3), 10), audience: { all: true, positions: [] }, appliesText: 'All staff', issueDate: '',
        passMark: 80, pdfFileId: null, videos: [], requireVideo: true, questions: qs.map(([q, options, correct]) => ({ q, options, correct })) } });
    await publishDocument(db, { orgId: DEMO_HR.orgId, code, actorId: null });
  }
  await db.collection('courses').add({ orgId: DEMO_HR.orgId, title: 'HR Essentials', description: 'Leave and conduct, for every employee.',
    codes: docs.map(d => d[0]), shared: null, createdAt: now(), updatedAt: now(), createdBy: null });
  return true;
}

/** A published sample course in the MSP Academy library, ready to share. */
export async function seedDemoLibrary(db) {
  await ensureLibrary(db);
  if (!(await db.collection('courses').where('orgId', '==', LIBRARY_ORG_ID).get()).empty) return false;
  const ref = db.collection('courses').doc();
  const draft = { title: 'Customer Service Fundamentals', description: 'A short starter course for every new employee.', audience: { all: true, positions: [] }, modules: [
    { id: 'm-welcome', title: 'Welcome', lessons: [
      { id: 'l-why', type: 'text', title: 'Why service matters', body: '## Every guest, every time\n\nPeople remember how you made them feel.\n\n- Greet within 30 seconds\n- Use their name if you know it\n- Thank them as they leave' }] },
    { id: 'm-practice', title: 'In practice', lessons: [
      { id: 'l-listen', type: 'text', title: 'Listening to a complaint', body: '1. Listen without interrupting.\n2. Apologise for how they feel.\n3. Fix it, or find someone who can.\n4. Follow up.' },
      { id: 'l-check', type: 'quiz', title: 'Quick check', passMark: 80, questions: [
        { q: 'How soon should you greet a guest?', options: ['Within 30 seconds', 'Within 5 minutes', 'When they ask for help'], correct: 0 },
        { q: 'What comes first when a guest complains?', options: ['Explain the policy', 'Listen without interrupting', 'Call the manager'], correct: 1 }] }] }] };
  await ref.set({ orgId: LIBRARY_ORG_ID, title: draft.title, description: draft.description, codes: [], draft, status: 'draft', draftDirty: false, current: null, shared: null, createdAt: now(), updatedAt: now(), createdBy: null });
  await publishCourse(db, { orgId: LIBRARY_ORG_ID, courseId: ref.id, actorName: 'MSP Academy' });
  return true;
}

/** A second sample library course showing the richer lesson types (checklist, policy sign-off, field evidence). */
export async function seedDemoLibraryLessons(db) {
  await ensureLibrary(db);
  const all = await db.collection('courses').where('orgId', '==', LIBRARY_ORG_ID).get();
  if (all.docs.some(d => d.get('title') === 'Workplace Safety Starter')) return false;
  const ref = db.collection('courses').doc();
  const draft = { title: 'Workplace Safety Starter', description: 'Checklist, sign-off and a photo of your work area.', audience: { all: true, positions: [] }, modules: [
    { id: 'm-daily', title: 'Every shift', lessons: [
      { id: 'l-start', type: 'checklist', title: 'Start-of-shift checks', summary: 'Do these before you start work.', steps: ['Sign the attendance register', 'Put on the right safety gear', 'Check the first aid box is stocked', 'Report anything broken to your supervisor'] },
      { id: 'l-why', type: 'text', title: 'Why it matters', body: '## Safety first\n\nMost injuries at work happen in the first minutes of a shift, when people rush. The checks take two minutes.' }] },
    { id: 'm-commit', title: 'Your commitment', lessons: [
      { id: 'l-quiz', type: 'quiz', title: 'Quick check', passMark: 100, questions: [{ q: 'Who do you report broken equipment to?', options: ['Your supervisor', 'Nobody', 'A guest'], correct: 0 }] },
      { id: 'l-sign', type: 'signoff', title: 'Safety policy', code: 'SAFE-01', statement: 'I will complete the start-of-shift checks every shift and report anything unsafe straight away.' },
      { id: 'l-ev', type: 'evidence', title: 'Show your work area', prompt: 'Take a photo of your work area after your start-of-shift checks and describe anything you reported.', placeholder: 'e.g. All clear, first aid box restocked', photo: 'optional' }] }] };
  await ref.set({ orgId: LIBRARY_ORG_ID, title: draft.title, description: draft.description, codes: [], draft, status: 'draft', draftDirty: false, current: null, shared: null, createdAt: now(), updatedAt: now(), createdBy: null });
  await publishCourse(db, { orgId: LIBRARY_ORG_ID, courseId: ref.id, actorName: 'MSP Academy' });
  return true;
}
