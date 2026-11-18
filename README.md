# MSP Academy

![MSP Academy](public/brand/msp-academy.svg)

MSP Academy is a multi-client training platform from the MSP Condev group. Each client organisation has its own staff, positions, look and records. Staff read SOPs and policies, pass a short quiz and sign; they take courses built from modules and lessons and earn a certificate. Every quiz attempt, sign-off, declaration and certificate is kept in a tamper-evident record per person.

**Pelagos Langebaan is client number 1.** It looks and works exactly as before.

It runs on Firebase: Firestore for data, Cloud Storage for files, one Cloud Function for the server, Hosting for the screens. Europe: Firestore in eur3, the function in europe-west1.

---

## Run it on your Mac (VS Code)

### Install once

1. **VS Code**: https://code.visualstudio.com
2. **Node.js 22**: https://nodejs.org
3. **Java 21** (the Firebase emulators need it): the macOS installer from https://adoptium.net. Close and reopen the terminal afterwards; `java -version` should show 21.

### First time

Open the project folder in VS Code (**File → Open Folder…**), then **Terminal → New Terminal**, and run these one at a time:

```
npm install
```

```
npm run setup
```

Wait for **Ready.**

### Every time

```
npm start
```

Open **http://localhost:5050**. Press **Ctrl+C** in that terminal to stop (always stop it this way before closing the terminal, otherwise it keeps running in the background and blocks the next start).

### Who to sign in as (all made up)

| Where | Client code | Staff number | PIN | Who |
|---|---|---|---|---|
| http://localhost:5050 | `PELAGOS` | PL001 | 1234 | Pelagos manager (PL002 to PL008: other example staff) |
| | `HARBOUR` | HB001 | 123456 | Harbour Demo manager |
| | `HARBOUR` | HB002 | 1234 | Harbour Demo staff |
| | `HRDEMO` | HR001 | 123456 | HR Demo manager, with an "HR Essentials" course to share |
| http://localhost:5050/platform | | | | `admin@example.com` / `platform-demo-only`, no code needed locally |

To switch client on one browser: sign out, then **Change client** under the sign-in button.

### Other commands

| Command | What it does |
|---|---|
| `npm run demo` | A quick look without Java at http://localhost:3000. Nothing is saved |
| `npm test` | All automated checks (about 20 seconds) |
| `npm run update` | Update from the newest `msp-academy` zip in your Downloads folder (backs up your local data first) |
| `npm run reset` | Wipe local data and set up again |
| `npm run verify` | With `npm start` running in another terminal: check every evidence record |

### If something doesn't work

- **"Port taken" or "Could not start Firestore Emulator"**: an earlier run is still going. Run this line to stop it, then try again:
  `for p in 8080 9199 4000 4400 4500 5001 5050; do lsof -ti tcp:$p -sTCP:LISTEN; done | xargs kill`
- **"Java is needed"**: install Java 21, then reopen the terminal.
- **`npm install` mentions vulnerabilities**: they come from tools that only run on your computer. Don't run `npm audit fix --force`.

---

## Using the platform

Everything below is at `/platform`, for the MSP Academy team.

- **Clients**: shown as cards in their own colours, grouped. **Add a client** creates it with its first manager; the next screen shows the client code, staff number and PIN to hand over (once).
- **A client's page**: details, group, branding (logo, colours, fonts, wording such as "Qualification" instead of "Course", an announcement for staff home screens) with a live preview, own web addresses, managers (including **Help a manager who can't get in**), support visits, and the client's platform log.
- **Suspend / reactivate**: with a reason. Suspended clients can't sign in; nothing is deleted.
- **Visit as support**: read-only, time-limited, with a reason. A striped banner shows on every screen, and the client sees the visit and every page opened in their audit log.
- **Groups**: e.g. HR, Hospitality. Share a course with a whole group at once.
- **Library**: **Open the course builder** to build MSP Academy courses (a gold banner shows you're in the library). Publish them, then **Share…** with clients.
- **Sharing**: each client gets its own copy (its own files, its own records), shown as "Provided by MSP Academy", never naming where it came from. Their manager can choose who completes it but not change it. Nothing updates by itself: share again to send a newer version.

## Building courses

Client managers: **SOP library → Courses → New course** (the library uses the same builder).

- Add **modules**, then **lessons**: text, video (MP4), PDF, quiz, or one of your SOPs and policies (read and signed as usual).
- Click a lesson to edit it; ↑ ↓ reorder (and move lessons between modules); choose **who must complete it**; **Publish**.
- Publishing freezes a version. A **minor change** keeps everyone's progress; a **new version** asks everyone to take it again. Published courses can be archived, not deleted, so certificates stay valid.
- Staff see courses on **My training**; lessons unlock in order; quizzes are marked on the server; finishing gives a printable certificate in the client's branding.

---

## Moving the live Pelagos portal onto the platform

Do this once, **before** deploying this version. The move only adds information the old version ignores, so the live portal keeps working in between.

1. **Backup**: Google Cloud console → Firestore → **Disaster recovery** → turn on Point-in-time recovery.
2. **Key**: Firebase console → Project settings → Service accounts → Generate new private key. Save it outside the project folder, e.g. `~/keys/`.
3. In the project's terminal:

   ```
   export GOOGLE_APPLICATION_CREDENTIALS=~/keys/your-key-file.json
   ```

   ```
   npm run migrate
   ```

   This is a dry run: it checks every record and evidence chain and prints a fingerprint. It ends with "Dry run: nothing was changed."

   ```
   npm run migrate -- --apply
   ```

   Type `LIVE` when asked. It confirms "fingerprint unchanged".

4. Deploy, then create your platform admin (it prints a setup key for your phone's authenticator app):

   ```
   npx firebase login
   ```

   ```
   npm run deploy
   ```

   ```
   npm run platform-admin -- --email you@example.com --name "Your Name"
   ```

5. Check: `npm run verify:live`. Pelagos staff keep using **pelagos-portal.web.app** without a code; the shared page and `/platform` are at **pelagos-portal.firebaseapp.com**. Delete the key file afterwards.

**A client's own web address**: Firebase console → Hosting → **Add custom domain**, follow the DNS steps, then add the address on the client's page in the platform.

---

## How clients are kept apart

- The server takes the client from the signed-in session only; every query includes it, and every record an ID points to is checked to belong to the same client.
- Each client's files live in its own storage folder; the server refuses objects outside it.
- Browsers never touch the database or storage directly (security rules deny all access).
- `npm test` proves it: a sweep over **every** route, signed in as another client (manager, staff and a support visit), checks nothing leaks and nothing changes; a new route that isn't added to the sweep fails the tests. A scan checks every record and reference stays inside its client. Other test files cover the platform, sharing, the course builder, and the Pelagos move (run on data produced by the original single-client code).

**POPIA**: each client is the responsible party for its staff's information and MSP Academy is its operator (sections 20 and 21), so a written operator agreement with each client is advisable. Confirm with your adviser.

## Not yet in this version

Self-service Word/PDF import, AI question drafting per client, staff import, email or WhatsApp reminders, drag-and-drop in the builder, a learner preview of courses, course results in reports, server-side tracking of course videos, billing, SSO, expiring certifications and due dates.
