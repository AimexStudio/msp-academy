// Creates a platform admin: someone who can create and manage clients, build library courses and share them.
//   npm run platform-admin -- --email you@example.com --name "Your Name"          (live)
//   npm run platform-admin:local -- --email you@example.com --name "Your Name"    (local emulators)
//   npm run review:admin -- --email you@example.com --name "Your Name"            (the Vercel review site)
// It asks for a password (at least 12 characters; typing is hidden) and prints a setup key for an
// authenticator app. Sign-in needs the password and the 6-digit code from the app.
import { connect, connectReview, arg, ask, stop, flag } from './connect.js';
import { createPlatformAdmin, otpauthUri, validPassword, validEmail } from '../src/platform.js';

const email = arg('email'), name = arg('name');
if (!validEmail(email) || !name) stop('Usage: npm run platform-admin -- --email you@example.com --name "Your Name"');
const review = flag('review');
const { db, live } = review ? { ...(await connectReview({ what: `create the platform admin ${email}` })), live: true } : await connect({ what: `create the platform admin ${email}` });
const pw = await ask('Choose a password (at least 12 characters, typing is hidden): ', { hidden: true });
if (!validPassword(pw)) stop('The password must be at least 12 characters. Nothing was changed.');
if (await ask('Type it again: ', { hidden: true }) !== pw) stop("The two passwords don't match. Nothing was changed.");
try {
  const r = await createPlatformAdmin(db, { email, name, password: pw });
  console.log(`\nPlatform admin ${email} created${live ? ' in the live project' : ' locally'}.\n`);
  console.log('Now set up the authenticator app on your phone:');
  console.log('  1. In the app, choose "Add account" / "+", then "Enter a setup key" (not "Scan QR code").');
  console.log(`  2. Account name: ${email}`);
  console.log(`  3. Key: ${r.totpSecret.match(/.{1,4}/g).join(' ')}`);
  console.log('  4. Type: time-based. Save.\n');
  console.log(`(Some apps accept this link instead: ${otpauthUri(r.totpSecret, email)})\n`);
  console.log("Keep the key private and clear this terminal afterwards (Cmd+K in VS Code's terminal).\n");
  process.exit(0);
} catch (e) { stop(e.message); }
