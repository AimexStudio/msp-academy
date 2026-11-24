// Staff leave: settings per person, leave records, and balances on any date (today or in the future).
//
//   leaveProfiles/{staffId}  orgId, staffId, annualDays (per year), accrualStart, openingBalance,
//                            sickDays (per 36-month cycle), familyDays (per year)
//   leaveEntries/{id}        orgId, staffId, type, startDate, endDate, days, note (managers only),
//                            certificateFileId (a medical certificate), deletedAt (corrections keep a trace)
//
// Annual leave builds up day by day: openingBalance + annualDays × days since accrualStart ÷ 365, minus annual
// leave taken (counted on its start date), plus adjustments. Sick leave runs in 36-month cycles and family
// responsibility leave in yearly cycles, both from accrualStart (the BCEA defaults). Dates are YYYY-MM-DD.

export const LEAVE_TYPES = { annual: 'Annual leave', sick: 'Sick leave', family: 'Family responsibility', special: 'Special leave', unpaid: 'Unpaid leave', adjustment: 'Adjustment' };
export const DEFAULT_PROFILE = { annualDays: 15, openingBalance: 0, sickDays: 30, familyDays: 3 };
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ms = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const iso = t => new Date(t).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / 86400000);
export const validDate = d => DATE_RE.test(String(d || '')) && iso(ms(d)) === d;
export const today = () => new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10); // South African time
const addMonths = (d, n) => { const t = new Date(ms(d)); t.setUTCMonth(t.getUTCMonth() + n); return iso(t); };
const round = n => Math.round(n * 100) / 100;

/* ---------- South African public holidays (a Sunday holiday moves to the Monday) ---------- */
function easter(y) { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}
const holidayCache = new Map();
export function publicHolidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const set = new Set();
  for (const md of ['01-01', '03-21', '04-27', '05-01', '06-16', '08-09', '09-24', '12-16', '12-25', '12-26']) {
    const d = `${y}-${md}`; set.add(d);
    if (new Date(ms(d)).getUTCDay() === 0) set.add(iso(ms(d) + 86400000));
  }
  const e = easter(y); set.add(iso(e - 2 * 86400000)); set.add(iso(e + 86400000)); // Good Friday, Family Day
  holidayCache.set(y, set);
  return set;
}
/** Working days (Monday to Friday, not a public holiday) from a to b inclusive: the suggested length of a leave period. */
export function workingDays(a, b) {
  if (!validDate(a) || !validDate(b) || b < a) return 0;
  let n = 0;
  for (let t = ms(a); t <= ms(b); t += 86400000) {
    const d = iso(t), wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6 && !publicHolidays(+d.slice(0, 4)).has(d)) n++;
  }
  return n;
}

/* ---------- balances ---------- */
/** The start of the cycle (every `months` months from start) that `date` falls in. */
function cycleStart(start, date, months) {
  let s = start, n = 0;
  while (addMonths(start, (n + 1) * months) <= date) n++;
  return n ? addMonths(start, n * months) : s;
}
/**
 * Balances on `date` for one person. entries: their leave records (deleted ones are ignored).
 * Returns annual (built up, taken, adjustments, balance), sick and family (allowance, used, left, cycle).
 */
export function balancesOn(profile, entries, date) {
  const p = { ...DEFAULT_PROFILE, ...(profile || {}) };
  const live = (entries || []).filter(e => !e.deletedAt);
  const start = p.accrualStart && validDate(p.accrualStart) ? p.accrualStart : null;
  const built = start && date >= start ? p.annualDays * (daysBetween(start, date) + 1) / 365 : 0;
  const upTo = live.filter(e => e.startDate <= date);
  const taken = upTo.filter(e => e.type === 'annual').reduce((n, e) => n + e.days, 0);
  const adj = upTo.filter(e => e.type === 'adjustment').reduce((n, e) => n + e.days, 0);
  const cyc = (type, months, allowance) => {
    if (!start || date < start) return { allowance, used: 0, left: allowance, cycleStart: start, cycleEnd: start ? iso(ms(addMonths(start, months)) - 86400000) : null };
    const cs = cycleStart(start, date, months), ce = iso(ms(addMonths(cs, months)) - 86400000);
    const used = live.filter(e => e.type === type && e.startDate >= cs && e.startDate <= date).reduce((n, e) => n + e.days, 0);
    return { allowance, used: round(used), left: round(allowance - used), cycleStart: cs, cycleEnd: ce };
  };
  return {
    date,
    annual: { opening: round(p.openingBalance), builtUp: round(built), taken: round(taken), adjustments: round(adj), balance: round(p.openingBalance + built - taken + adj), perYear: p.annualDays, from: start },
    sick: cyc('sick', 36, p.sickDays),
    family: cyc('family', 12, p.familyDays),
  };
}

/** Clean a profile from a form. */
export function cleanProfile(b) {
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : d; };
  return { annualDays: num(b.annualDays, 0, 60, 15), openingBalance: num(b.openingBalance, -100, 200, 0), sickDays: num(b.sickDays, 0, 120, 30), familyDays: num(b.familyDays, 0, 30, 3),
    accrualStart: validDate(b.accrualStart) ? b.accrualStart : null };
}
