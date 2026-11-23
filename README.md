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
| http://localhost:5050/platform | | | | `admin@example.com` / `platform-demo-only`, no code needed locally. The Library holds two sample courses to share, one showing checklists, policy sign-off and field evidence |

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
- **Library**: **Open the course builder** to build MSP Academy courses (it opens on **Courses**) (a gold banner shows you're in the library). Publish them, then **Share…** with clients.
- **Sharing**: each client gets its own copy (its own files, its own records), shown as "Provided by MSP Academy", never naming where it came from. Their manager can choose who completes it but not change it. Nothing updates by itself: share again to send a newer version.

## Building courses

Client managers: **Courses → New course** (MSP Academy's library uses the same builder). Read-and-sign documents (SOPs, policies, manuals, memos) live under **Documents**; each client can use its own word for both, e.g. "Qualifications" or "SOP library" (Platform → client → Branding → Wording). Add **modules**, then use the **Add a lesson** buttons under each module:

| Lesson | What the learner does | Settings |
|---|---|---|
| Text | Reads it | Headings, bullets, numbered steps, **bold** |
| Video | Watches an uploaded MP4, or a **YouTube video** played inside the platform | **Must watch at least** 75–100% (or optional), **no skipping ahead**, **pause when the person switches tab or app**, **chapters** (time + name), and an optional **check question** after the video. The server counts only the parts really played, never faster than real time. If the video won't play on someone's device they can say so and continue; it's recorded. **YouTube:** paste any YouTube link; the length fills in from the preview. Learners watch it inside MSP Academy with its own controls: a shield covers the YouTube player, so they can't click through to YouTube, drag the timeline ahead, or open suggested videos at the end |
| PDF | Opens and reads it | Upload the PDF |
| Checklist | Ticks every step to confirm they follow it | A summary and the steps |
| Quiz | Answers multiple-choice questions | Pass mark; marked on the server, answers never sent to the device; unlimited tries |
| Policy sign-off | Agrees to a statement and types their full name (must match their profile) | Reference and statement; the sign-off is recorded in their certificate |
| Field evidence | Describes what they did and adds a photo, for a manager to approve | Instructions, example answer, photo optional / required / none |
| SOP or policy | Reads, answers and signs one of your documents as usual | Choose the document |

- Click a lesson to edit it; ↑ ↓ reorder (and move lessons between modules); choose **who must complete it**; **Publish**.
- Publishing freezes a version. A **minor change** keeps everyone's progress; a **new version** asks everyone to take it again. Published courses can be archived, not deleted, so certificates stay valid.
- Lessons unlock in order. Field evidence waiting for review doesn't hold people up, but the certificate waits until it's approved.
- **Reviews** (manager menu, and a banner on the overview): approve evidence, or return it with a note so the person can submit again. Approving the last outstanding lesson issues the certificate.
- Finishing a course gives a printable certificate in the client's branding, recorded in the tamper-evident training record (including any policy sign-offs).

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

**A client's own web address**: Firebase console → Hosting → **Add custom domain**, follow the DNS steps, then add the address on the client's page in the platform. The small Admin button on that client's sign-in page then points to the shared platform address (`pelagos-portal.firebaseapp.com/platform`, or your own platform domain if you set `PLATFORM_URL`).

---

## Review site on Vercel

A public review and testing copy: Vercel runs the screens and server, and a **separate Firebase project** holds its data, so the live Pelagos records are never involved. It has Pelagos as client 1 (its real documents, made-up example staff), Harbour Demo, HR Demo, and the two library courses. Uploads are limited to 4 MB on this site (use YouTube links for videos).

### 1. Create the review Firebase project (once, in your browser)

1. https://console.firebase.google.com → **Add project** → name it `msp-academy-review` (Google Analytics off).
2. **Upgrade to Blaze** (bottom left, needed for file storage). Set a budget alert, e.g. $5: a review site normally costs nothing.
3. **Build → Firestore Database → Create database** → location **eur3 (Europe)** → **production mode**.
4. **Build → Storage → Get started** → same location → production mode.
5. **gear icon → Project settings → Service accounts → Generate new private key**. Move the file into `~/keys/` as before.

### 2. Set it up from your Mac (in the project folder)

Use the review key's real file name:

```
export GOOGLE_APPLICATION_CREDENTIALS=~/keys/msp-academy-review-firebase-adminsdk-xxxx.json
```

```
npx firebase login
```

```
npm run review:rules -- --project msp-academy-review
```

```
npm run review:setup -- --email you@example.com --name "Your Name"
```

Type `REVIEW`, choose a password, and add the printed setup key to your authenticator app. (It refuses to run with the live Pelagos key.)

### 3. Put it on Vercel

1. Create an account at https://vercel.com (the free Hobby plan is for non-commercial use; a business review site should use Pro).
2. In the project folder:

   ```
   npx vercel login
   ```

   ```
   npx vercel link
   ```

   Answer: set up a new project, name `msp-academy-review`, and keep the suggested settings (they come from `vercel.json`).

3. Give Vercel the review key. This copies it, encoded, to your clipboard:

   ```
   base64 -i ~/keys/msp-academy-review-firebase-adminsdk-xxxx.json | tr -d '\n' | pbcopy
   ```

   ```
   npx vercel env add FIREBASE_SERVICE_ACCOUNT_B64 production
   ```

   Paste (Cmd+V) when it asks for the value, and press Enter.

4. Deploy:

   ```
   npx vercel deploy --prod
   ```

It prints the address, e.g. `https://msp-academy-review.vercel.app`. Check `/api/healthz` shows `{"ok":true}`, then sign in.

### Signing in on the review site

| Who | How |
|---|---|
| You and other reviewers (platform) | `<address>/platform` with email, password and authenticator code |
| Pelagos | Client code `PELAGOS`: PL001 (manager) or PL002, PIN 1234 |
| Harbour Demo | Client code `HARBOUR`: HB001 PIN 123456 (manager), HB002 PIN 1234 |
| HR Demo | Client code `HRDEMO`: HR001 PIN 123456 |

Add another platform reviewer: `npm run review:admin -- --email them@example.com --name "Their Name"` (with the review key set). Update the site after changes: `npx vercel deploy --prod`. The example people are made up; don't enter real staff data on the review site.

## How clients are kept apart

- The server takes the client from the signed-in session only; every query includes it, and every record an ID points to is checked to belong to the same client.
- Each client's files live in its own storage folder; the server refuses objects outside it.
- Browsers never touch the database or storage directly (security rules deny all access).
- `npm test` proves it: a sweep over **every** route, signed in as another client (manager, staff and a support visit), checks nothing leaks and nothing changes; a new route that isn't added to the sweep fails the tests. A scan checks every record and reference stays inside its client. Other test files cover the platform, sharing, the course builder, and the Pelagos move (run on data produced by the original single-client code).

**YouTube and privacy**: YouTube videos play in YouTube's privacy-enhanced mode (youtube-nocookie.com), but the learner's device still connects to Google to play them. Uploaded videos stay entirely on the platform. Mention this in your privacy notice to clients if you use YouTube lessons.

**POPIA**: each client is the responsible party for its staff's information and MSP Academy is its operator (sections 20 and 21), so a written operator agreement with each client is advisable. Confirm with your adviser.

## Not yet in this version

Self-service Word/PDF import, AI question drafting per client, staff import, email or WhatsApp reminders, drag-and-drop in the builder, a learner preview of courses, course results in reports, Vimeo videos, billing, SSO, expiring certifications and due dates.
