// Checks every person's chain of quiz attempts, sign-offs and declarations for edits or deletions.
import { initFirebase } from '../src/firebase.js';
import { verifyChain } from '../src/evidence.js';
import { config } from '../src/config.js';

const { db } = initFirebase();
const staff = await db.collection('staff').where('orgId', '==', config.orgId).get();
let bad = 0, records = 0;
for (const s of staff.docs) {
  const r = await verifyChain(db, s.id);
  records += r.records;
  if (!r.ok) { bad++; console.log(`PROBLEM  ${s.get('staffNo')} ${s.get('name')}: ${r.problem}`); }
}
console.log(bad ? `\n${bad} of ${staff.size} people have a broken record chain.` : `All ${records} evidence records for ${staff.size} people check out.`);
process.exit(bad ? 1 : 0);
