#!/bin/bash
# Updates this project from the newest msp-academy zip in your Downloads folder, then starts it.
#
# Run it from inside the project folder (the one with package.json in it):
#   bash scripts/update-from-zip.sh             update, set up and start
#   bash scripts/update-from-zip.sh --no-start  update and install only
#
# Your local data (emulator-data), settings (.env), Git history (.git, linked to GitHub) and installed packages are kept, and your local
# data is backed up first to emulator-data-backup-<date>.
set -e
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
stop() { printf '\n\033[31m%s\033[0m\n\n' "$1"; exit 1; }

# 1. Are we in the project folder?
[ -f package.json ] && grep -qE '"name": "(msp-academy|pelagos-training-portal)"' package.json \
  || stop "Run this from inside your project folder (the one that has package.json in it). In VS Code: File → Open Folder…, then Terminal → New Terminal."

# 2. The newest download.
ZIP="$(ls -t "$HOME"/Downloads/msp-academy*.zip 2>/dev/null | head -1 || true)"
[ -n "$ZIP" ] || stop "No msp-academy zip found in your Downloads folder. Download it first."
say "Updating from: $(basename "$ZIP")  (downloaded $(date -r "$ZIP" '+%d %b %Y %H:%M'))"

# 3. Stop the portal if it's still running somewhere.
PIDS="$(for p in 8080 9199 4000 4400 4500 5001 5050 3000; do lsof -ti tcp:$p -sTCP:LISTEN 2>/dev/null; done | sort -u)"
if [ -n "$PIDS" ]; then say "Stopping the portal that is still running…"; kill $PIDS 2>/dev/null || true; sleep 2; fi

# 4. Unpack into a temporary folder and check it.
TMP="$(mktemp -d)"
unzip -q "$ZIP" -d "$TMP"
# The project is the training-portal folder inside the zip, or else the zip's only folder. Never anything else.
SRC="$TMP/training-portal"
if [ ! -d "$SRC" ]; then
  TOP=("$TMP"/*/)
  [ ${#TOP[@]} -eq 1 ] && [ -d "${TOP[0]}" ] && SRC="${TOP[0]%/}" || SRC=""
fi
[ -n "$SRC" ] && [ "$SRC" != "." ] && [ "$(cd "$SRC" 2>/dev/null && pwd)" != "$(pwd)" ] || stop "That zip doesn't contain the MSP Academy project, so nothing was changed."
[ -f "$SRC/package.json" ] && [ -f "$SRC/src/app.js" ] && [ -f "$SRC/public/index.html" ] \
  || stop "That zip doesn't contain the whole MSP Academy project, so nothing was changed. Download it again, or ask for a fresh copy."

# 5. Back up local data.
if [ -d emulator-data ]; then
  B="emulator-data-backup-$(date '+%Y%m%d-%H%M')"
  cp -R emulator-data "$B"
  say "Backed up your local data to $B"
fi

# 6. Copy the new code over, keeping data, settings and installed packages.
say "Copying the new version in…"
# (tar is on every Mac; it copies everything except your data, settings and installed packages.)
(cd "$SRC" && tar cf - --exclude ./node_modules --exclude ./emulator-data --exclude './emulator-data-backup-*' --exclude ./.env --exclude ./.env.local --exclude ./.vercel --exclude ./.git .) | tar xf -
rm -rf "$TMP"

# 7. Install, set up, start.
say "Installing (this can take a minute)…"
npm install --no-audit --no-fund --loglevel=error
if [ "$1" = "--no-start" ]; then say "Updated. Start it with: npm run setup, then npm start"; exit 0; fi
say "Updating your local data…"
npm run setup
say "Starting. Open http://localhost:5050 (press Ctrl+C here to stop)."
exec npm start
