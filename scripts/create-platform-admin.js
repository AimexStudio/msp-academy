// Creates a platform admin (someone who can create and manage clients, build library courses and share
// them), or sets a new password for an existing one. Sign-in is email and password.
//   npm run platform-admin -- --email you@example.com --name "Your Name"          (live)
//   npm run platform-admin:local -- --email you@example.com --name "Your Name"    (local emulators)
//   npm run review:admin -- --email you@example.com --name "Your Name"            (the Vercel review site)
import { connect, connectReview, arg, ask, stop, flag } from './connect.js';
import { createPlatformAdmin, setPlatformAdminPassword, validPassword, validEmail, normEmail } from '../src/platform.js';

const email = normEmail(arg('email')), name = arg('name');
if (!validEmail(email)) stop('Usage: npm run platform-admin -- --email you@example.com --name "Your Name"');
const review = flag('review');
const { db, live } = review ? { ...(await connectReview({ what: `set up the platform admin ${email}` })), live: true } : await connect({ what: `set up the platform admin ${email}` });
const exists = (await db.collection('platformAdminEmails').doc(email).get()).exists;
if (exists) {
  const ok = await ask(`\n${email} is already a platform admin. Set a new password? Type YES to continue: `);
  if (ok.trim().toUpperCase() !== 'YES') stop('Nothing was changed.');
} else if (!name) stop('Add the name too: --name "Your Name"');
const pw = await ask('Password (at least 12 characters; nothing shows while you type): ', { hidden: true });
if (!validPassword(pw)) stop(`That was ${pw.length} characters; at least 12 are needed. Nothing was changed.`);
if (await ask('Type it again: ', { hidden: true }) !== pw) stop("The two passwords don't match. Nothing was changed.");
try {
  if (exists) await setPlatformAdminPassword(db, { email, password: pw });
  else await createPlatformAdmin(db, { email, name, password: pw });
  console.log(`\n${exists ? 'New password set for' : 'Platform admin created:'} ${email}${live ? '' : ' (locally)'}. Sign in at <address>/platform with this email and password.\n`);
  process.exit(0);
} catch (e) { stop(e.message); }
