// Clients (organisations) on one platform. Every record carries orgId; this module decides which
// client a request belongs to and holds the per-client settings that aren't business rules.
//
//   orgs/{orgId}            the client: name, status, client number, sign-in code, branding, prefixes
//   orgCodes/{CODE}         sign-in code -> orgId (keeps codes unique)
//   orgDomains/{hostname}   web address -> orgId (keeps addresses unique)
//   counters/platform       the next client number
//
// Which client a request belongs to:
//   - signed in: the client of the session, always. Nothing in the request can change it.
//   - not signed in: the web address if it is registered to a client, otherwise the client code typed
//     on the shared sign-in page. The web address is only a hint for the sign-in page: a session
//     for client A is never accepted on client B's address.

export const ORG_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const CLIENT_CODE_RE = /^[A-Z0-9]{3,20}$/;
export const DOC_PREFIX_RE = /^[A-Z][A-Z0-9]{1,7}$/;
export const STAFF_PREFIX_RE = /^[A-Z]{0,6}$/;
export const HOST_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const normCode = s => String(s || '').trim().toUpperCase().replace(/[\s-]+/g, '');
export const normHost = s => String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');

export const codeRef = (db, code) => db.collection('orgCodes').doc(normCode(code));
export const domainRef = (db, host) => db.collection('orgDomains').doc(normHost(host));
export const orgRef = (db, orgId) => db.collection('orgs').doc(orgId);
export const isActive = org => !!org && org.status !== 'suspended';

/** The address the person typed. Firebase Hosting passes it on as X-Forwarded-Host. */
export function requestHost(req) {
  const h = req.headers['x-forwarded-host'] || req.headers.host || '';
  return normHost(String(h).split(',')[0]);
}

/* ---------- a short-lived cache, per database, so each request doesn't re-read the client ---------- */
const TTL_MS = 10_000;
const caches = new WeakMap();
function cacheFor(db) { let c = caches.get(db); if (!c) caches.set(db, c = new Map()); return c; }
async function cached(db, key, load) {
  const c = cacheFor(db), hit = c.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await load();
  c.set(key, { at: Date.now(), value });
  return value;
}
/** Call after changing a client, its code or its addresses, so this server instance sees it at once. */
export function invalidate(db) { cacheFor(db).clear(); }

export const getOrg = (db, orgId) => cached(db, `org:${orgId}`, async () => {
  if (!orgId) return null;
  const s = await orgRef(db, orgId).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
});
export const orgIdForHost = (db, host) => cached(db, `host:${host}`, async () => {
  if (!host || !HOST_RE.test(host)) return null;
  const s = await domainRef(db, host).get();
  return s.exists ? s.get('orgId') : null;
});
export const orgIdForCode = (db, code) => cached(db, `code:${normCode(code)}`, async () => {
  const c = normCode(code);
  if (!CLIENT_CODE_RE.test(c)) return null;
  const s = await codeRef(db, c).get();
  return s.exists ? s.get('orgId') : null;
});

/* ---------- branding ---------- */
export const FONTS = {
  audiowide: { label: 'Audiowide (rounded, wide)', stack: '"Audiowide", "Trebuchet MS", system-ui, sans-serif' },
  figtree: { label: 'Figtree (clean, modern)', stack: '"Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  serif: { label: 'Classic serif', stack: 'Georgia, "Iowan Old Style", "Times New Roman", serif' },
  system: { label: "The device's own font", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A new client's starting look: MSP Academy's palette, until the client is given its own. */
export const DEFAULT_BRANDING = {
  wordmark: '', subtitle: '', tagline: '', pitch: 'Your SOPs, manuals and policies', pitchAccent: 'in one place', cornerText: '',
  colors: { primary: '#26292D', accent: '#A3461C', highlight: '#DD6E3E', background: '#F2F0ED' },
  headingFont: 'figtree', bodyFont: 'figtree', headingCaps: false, loginArt: 'none', logoFileId: null,
  announcement: '', terms: { course: 'Course', courses: 'Courses', module: 'Module', modules: 'Modules' },
};

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
/** Keep only known branding fields with safe values. */
export function cleanBranding(input = {}, base = DEFAULT_BRANDING) {
  const c = input.colors || {}, bc = base.colors || DEFAULT_BRANDING.colors;
  const color = k => (HEX.test(c[k] || '') ? c[k].toUpperCase() : bc[k]);
  const font = (v, d) => (FONTS[v] ? v : d);
  const ti = input.terms || {}, tb = { ...DEFAULT_BRANDING.terms, ...(base.terms || {}) };
  const term = k => str(ti[k] ?? tb[k], 24) || DEFAULT_BRANDING.terms[k];
  return {
    wordmark: str(input.wordmark ?? base.wordmark, 24), subtitle: str(input.subtitle ?? base.subtitle, 60),
    tagline: str(input.tagline ?? base.tagline, 80), pitch: str(input.pitch ?? base.pitch, 80),
    pitchAccent: str(input.pitchAccent ?? base.pitchAccent, 40), cornerText: str(input.cornerText ?? base.cornerText, 40),
    colors: { primary: color('primary'), accent: color('accent'), highlight: color('highlight'), background: color('background') },
    headingFont: font(input.headingFont, base.headingFont || 'figtree'), bodyFont: font(input.bodyFont, base.bodyFont || 'figtree'),
    headingCaps: input.headingCaps === undefined ? !!base.headingCaps : !!input.headingCaps,
    loginArt: ['arches', 'none'].includes(input.loginArt) ? input.loginArt : (base.loginArt || 'none'),
    logoFileId: input.logoFileId === undefined ? (base.logoFileId || null) : (input.logoFileId || null),
    announcement: str(input.announcement ?? base.announcement, 240),
    terms: { course: term('course'), courses: term('courses'), module: term('module'), modules: term('modules') },
  };
}

/** What the sign-in page and every screen may know about a client. Nothing private. */
export function publicBranding(org) {
  const b = cleanBranding(org.branding || {});
  return {
    orgId: org.id, name: org.name, courseTitle: org.courseTitle, docPrefix: org.docPrefix || 'DOC', staffNoPrefix: org.staffNoPrefix ?? '',
    ...b, wordmark: b.wordmark || String(org.name || '').split(/\s+/)[0].toUpperCase(),
    logoUrl: b.logoFileId ? `/api/branding/logo/${b.logoFileId}` : null,
    fonts: { heading: FONTS[b.headingFont].stack, body: FONTS[b.bodyFont].stack },
  };
}

/* ---------- storage ---------- */
/** Where a client's files go in Cloud Storage. Every client has its own folder. */
export const storagePrefix = (orgId, kind) => `orgs/${orgId}/${kind}`;
/**
 * May this client's record point at this stored object? New files always live in the client's own
 * folder. Pelagos's files from before the move stay where they are (their keys are part of signed
 * records), so only Pelagos may use keys outside a client folder.
 */
export function storageKeyAllowed(org, key) {
  if (!org || typeof key !== 'string') return false;
  if (key.startsWith(`orgs/${org.id}/`)) return true;
  return !!org.legacyStorage && /^(files|signatures)\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(key);
}

/** A new client's starting set-up. The client's manager changes all of it in Settings. */
export function starterConfig(name) {
  return {
    courseTitle: `${name} SOPs and Policies`,
    declarationText: `I, {name} ({position}), confirm that I have received, read and understood the following Standard Operating Procedures (SOPs), manuals, policies and staff memos, and that I will follow the standards and policies they set out. Where I did not understand something, I asked my manager to explain it.`,
    departments: [{ id: 'mgmt', name: 'Management' }, { id: 'general', name: 'General' }],
    positions: [{ id: 'manager', name: 'Manager', dept: 'mgmt' }, { id: 'staff', name: 'Staff member', dept: 'general' }],
  };
}

/* ---------- the MSP Academy library ----------
   A built-in organisation with no staff, where the MSP Academy team builds courses to share with clients.
   It never appears as a client, has no sign-in code, and is only reached from the platform. */
export const LIBRARY_ORG_ID = 'msp-academy-library';
export async function ensureLibrary(db) {
  const ref = orgRef(db, LIBRARY_ORG_ID);
  if ((await ref.get()).exists) return LIBRARY_ORG_ID;
  const start = starterConfig('MSP Academy');
  await ref.set({ name: 'MSP Academy library', library: true, courseTitle: 'MSP Academy courses', declarationText: start.declarationText,
    departments: start.departments, positions: start.positions, status: 'active', statusReason: null, clientNo: null, loginCode: null,
    docPrefix: 'MSPA', staffNoPrefix: '', domains: [], legacyStorage: false, groupId: null,
    branding: cleanBranding({ wordmark: 'ACADEMY', subtitle: 'Library' }), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  invalidate(db);
  return LIBRARY_ORG_ID;
}
