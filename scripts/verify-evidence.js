// Checks every person's chain of quiz attempts, sign-offs, declarations and certificates, for every client.
//   npm run verify        (with npm start running in another terminal)
//   npm run verify:live   (live project; needs the service account key)
if (process.argv.includes('--local')) {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199';
}
const { connect } = await import('./connect.js');
const { verifyChain } = await import('../src/evidence.js');
const { db } = await connect({ what: 'read (not change) every evidence record', confirm: false });
const orgs = await db.collection('orgs').get();
let bad = 0, records = 0, people = 0;
for (const o of orgs.docs) {
  const staff = await db.collection('staff').where('orgId', '==', o.id).get();
  let n = 0;
  for (const s of staff.docs) {
    const r = await verifyChain(db, s.id);
    n += r.records;
    if (!r.ok) { bad++; console.log(`PROBLEM  ${o.get('name')} · ${s.get('staffNo')} ${s.get('name')}: ${r.problem}`); }
  }
  console.log(`${o.get('name')}: ${n} evidence records for ${staff.size} people.`);
  records += n; people += staff.size;
}
console.log(bad ? `\n${bad} of ${people} people have a broken record chain.` : `\nAll ${records} evidence records for ${people} people, across ${orgs.size} organisations, check out.`);
process.exit(bad ? 1 : 0);
