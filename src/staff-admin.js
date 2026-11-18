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
