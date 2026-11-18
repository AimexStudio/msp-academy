# Pelagos Training Portal

The production version of the Pelagos Langebaan staff training and SOP sign-off portal. Staff sign in with their staff number and PIN, read the SOPs, manuals, policies and memos for their position, pass a short quiz, sign each one, and sign a final declaration. Managers follow progress by department, publish new versions and export the register.

It follows the developer pack of 19 October 2026 (same screens, wording, look and business rules as the prototype) and runs on **Firebase**: Firestore for the data, Cloud Storage for PDFs, videos and signatures, Cloud Functions for the server, and Hosting for the screens. On your computer, the Firebase Emulator Suite runs all of it locally; nothing touches a real Firebase project.

## Run it on your Mac (VS Code)

### Install once

1. **VS Code**: https://code.visualstudio.com
2. **Node.js 22**: https://nodejs.org (or `nvm install 22` if you use nvm).
3. **Java 21**, which the Firebase emulators need: download the macOS installer (.pkg) from https://adoptium.net, or run `brew install --cask temurin@21`. Close and reopen the terminal afterwards. Check with `java -version`.

You don't need to install the Firebase CLI separately or sign in to Firebase: the project brings its own copy and runs offline under the made-up project name `demo-pelagos`.

### First time

If you have an earlier copy of this project, delete that folder first (it was built for a different database).

1. Unzip the project and open the `pelagos-portal` folder in VS Code (**File → Open Folder…**).
2. In VS Code's terminal (**Terminal → New Terminal**), run these one at a time:

   ```
   npm install
   npm run setup
   ```

   `npm run setup` starts the emulators (the first time it downloads them, a minute or two), loads all 21 Pelagos documents with their questions, PDFs and the Steps of Service video, publishes 20 of them (PEL-MAN-002 stays on hold), adds the example staff, and saves everything in the `emulator-data` folder. It ends with **Ready.**

### Every time

```
npm start
```

Open **http://localhost:5050**. Leave the terminal running; press Ctrl+C to stop. Changes you make in the portal are saved when you stop it.

The Firebase Emulator UI at **http://localhost:4000** lets you look inside Firestore and Storage.

Sign in with any of the example staff. The PIN is **1234** for all of them; they are made up.

| Staff number | Who | Access |
|---|---|---|
| PL001 | Example Manager (General Manager) | Manager |
| PL002 | Example Waitron | Staff |
| PL003 | Example Bartender | Staff |
| PL004 | Example Chef | Staff |
| PL005 | Example Housekeeper (smallest course, 6 documents) | Staff |
| PL006 | Example Duty Manager | Staff |
| PL007 | Example Head Chef | Head of department (Kitchen only, read-only) |
| PL008 | Example Auditor | Owner / auditor (reads everything, changes nothing) |

To try it on a phone or the training tablet on the same Wi-Fi, use your Mac's local IP address instead of `localhost`, e.g. `http://192.168.1.20:5050` (System Settings → Wi-Fi → Details shows it).

### Other commands

| Command | What it does |
|---|---|
| `npm start` | The full Firebase setup: Hosting, Functions, Firestore, Storage, at http://localhost:5050 |
| `npm run demo` | A quick look without Java or emulators, at http://localhost:3000. Everything is in memory: nothing is saved |
| `npm run emulators`, then **F5** | Firestore and Storage only, with the portal running from VS Code at http://localhost:3000 so you can set breakpoints |
| `npm test` | The automated checks (in memory, fast) |
| `npm run test:emulator` | The same checks against the real Firestore and Storage emulators |
| `npm run reset` | Wipe your local data and load it fresh from the content |
| `npm run verify` | Check every person's sign-off records for edits or deletions (with the emulators running) |

These are also under **Terminal → Run Task…** and in the Run and Debug panel.

### If something doesn't work

- **"Java is needed for the Firebase emulators"**: install Java 21 (see above), then reopen the terminal.
- **"There is no local data yet"**: run `npm run setup` once.
- **Port already in use** (5050, 5001, 8080, 9199 or 4000): another program or an earlier run is using it. Close other terminals running the portal, or change the port in `firebase.json` under `emulators`.
- **The training video won't play**: some browsers lack H.264 support. Chrome, Edge and Safari on desktop, Android and iPhone all play it. If a video can't play, staff may continue and their record shows "Video did not play on their device".
- **`npm install` reports vulnerabilities**: these come from the Firebase CLI's own tools, which only run on your computer. Don't run `npm audit fix --force`; it can install versions that break things.

## What's different from the prototype

The screens work the same. Underneath, everything that decides who owes what runs on the server (developer pack, section 8):

- **No direct database access from browsers.** Firestore and Storage security rules deny all browser access; every read and write goes through the server code, which checks who is asking.
- **Sign-in**: PINs are stored with Argon2id; sessions are checked on the server and end after 10 minutes without activity (30 for managers). Wrong PINs: 5 pause sign-in for a minute, 10 for 15 minutes, 15 block it until a manager resets the PIN.
- **Quiz answers never leave the server**, and quizzes are marked there. Heads of department see only their own department.
- **Evidence you can rely on**: quiz attempts, sign-offs and declarations are written once and never updated. Each person's records are chained together with fingerprints (SHA-256), so editing, removing or reordering any record is detected. The person page shows the result of that check, and `npm run verify` checks everyone. Each sign-off also records the time, IP address, device and the fingerprint of the exact version signed.
- **Frozen versions**: every published version is kept exactly as staff saw it (text, PDF, video, questions and answers) and can be opened from the document editor.
- **Video gate**: the server knows each video's length and only accepts as much watched time as has really passed, so skipping ahead or faking it doesn't count.
- **Editing published documents**: changes can be saved without publishing; staff keep seeing the current version until you publish a minor change or a new version.
- **Declarations**: after someone signs new or updated documents, they're offered an updated declaration that covers them.
- **Roles**: Staff, Head of department, Manager, and Owner / auditor.
- **Audit log** of every manager action, and **no outside services**: fonts are served by the portal itself.

## How it's built

Node.js 22 with Fastify inside one Cloud Function, Firestore, Cloud Storage, and a front end in plain HTML, CSS and JavaScript (no build step) served by Firebase Hosting.

```
firebase.json           Hosting, Functions, rules, and emulator ports
firestore.rules         no browser access to Firestore
storage.rules           no browser access to Storage
src/
  functions.js          Cloud Functions entry point (the `api` function)
  server.js             the same app as a plain Node server, for F5 debugging
  app.js                web server setup and security headers
  rules.js              the business rules from section 5 (pure functions)
  course.js             works out each person's course and status
  documents.js          drafts, publishing, frozen versions and fingerprints
  evidence.js           the chained, write-once evidence records
  auth.js               sign-in, sessions, lockouts, roles
  routes/               the API: auth, my (staff journey), admin (manager tools), files
  memory-firestore.js   an in-memory stand-in for Firestore (tests and the quick-look demo)
public/                 the screens
content/                the Pelagos content from the developer pack (2-content)
scripts/                setup, demo, first manager, record check
test/                   every acceptance check in section 9, Appendix B, and the Functions adapter
```

### Firestore collections

`orgs` (settings, departments, positions) · `staff` · `staffNumbers` (keeps staff numbers unique) · `documents` with a `versions` subcollection (frozen) · `files` · `progress` (reading and video state) · `quizAttempts`, `signoffs`, `declarations` (evidence) · `auditLog` · `positionHistory` · `sessions` · `loginEvents`, `loginState`, `ipState` (sign-in and lockouts). Every record carries `orgId`, so other Spectrum Collection properties can share the project later.

## Going live on Firebase (project `pelagos-portal`)

The live portal runs in Europe: Firestore in **eur3** (Belgium and the Netherlands), Cloud Functions in **europe-west1** (Belgium), next to it. Once deployed it is at **https://pelagos-portal.web.app**.

### 1. In the Firebase console (once)

1. **Upgrade to the Blaze plan** (bottom-left of the console). Cloud Functions needs it. At Pelagos's size the cost should be very small; setting a budget alert in Google Cloud Billing is still a good idea.
2. **Firestore Database → Create database**: choose **production mode** and the location **eur3 (Europe)**. The location can't be changed later.
3. **Storage → Get started**: choose **production mode** and a European location (EU multi-region, or europe-west1). Note the bucket name it shows; for a new project it is `pelagos-portal.firebasestorage.app`. If yours is different, put `STORAGE_BUCKET=your-bucket-name` in `.env`.

You don't need to switch on Firebase Authentication: the portal has its own staff number and PIN sign-in.

### 2. Deploy (from VS Code's terminal)

```
npx firebase login
npm run deploy
```

Sign in with the Google account that owns the project. The first deploy takes several minutes and switches on the Google Cloud services it needs (Cloud Build, Cloud Run, Artifact Registry). If it stops with a permissions or "API not enabled" message the first time, wait two minutes and run `npm run deploy` again.

It deploys the screens (Hosting), the server (the `api` function), and the Firestore and Storage rules and indexes.

### 3. Load the content and create the first real manager (once)

This needs a service account key, which lets the script write to the live project:

1. Console → **Project settings → Service accounts → Generate new private key**. Save the file **outside** the project folder, e.g. in a `keys` folder in your home folder. Never put it in the project or email it.
2. In the terminal:

   ```
   export GOOGLE_APPLICATION_CREDENTIALS=~/keys/pelagos-portal-key.json
   npm run load-live -- --staff-no PL001 --name "Your Full Name" --position gm --pin 482913
   ```

   Use your real name, staff number and position, and a PIN only you know. It asks you to type `LIVE` to confirm. It loads all 21 documents **as drafts** and creates you as the manager. It never adds the example staff.
3. Delete the key file afterwards (and you can delete the key under Service accounts too). Make a new one if you need it again.

### 4. Open the portal

Go to **https://pelagos-portal.web.app**, sign in, check the drafts in the SOP library and publish them, then add the staff on the Staff page.

### Notes

- **Where data is stored**: staff names, signatures and training records are personal information under POPIA. Storing them in the EU is allowed for transfers to countries with adequate protection (POPIA section 72); confirm this with whoever advises Pelagos on POPIA, and tell staff where their records are kept.
- **Uploads**: Cloud Functions accepts requests up to 32 MB, so training videos must be under 30 MB (the Steps of Service video is 13 MB). Larger videos would need direct uploads to Storage, which can be added.
- **Still to decide** (section 10 of the developer pack): notification channel, record retention, the labour lawyer's view on the e-signatures, and whether a second person must approve before publishing.
