#!/usr/bin/env bash
#
# scripts/brief-ship.sh
#
# Everything mechanical between "the drafts are written" and "it is live on the
# site", in one command. No model calls. No judgment.
#
#   npm run brief:ship
#
# WHY THIS EXISTS
# The operator was doing five things by hand every morning: assemble, read,
# approve, build, push, verify. Five steps is four too many for something that
# has to happen before coffee every weekday, and the steps most likely to get
# skipped are the last two, which are the ones that decide whether readers
# actually see anything.
#
# ORDER, AND WHY IT IS THIS ORDER
#   1. assemble   every editorial gate. Nothing ships that fails one.
#   2. build      proves the edition compiles BEFORE it can reach the repo.
#                 Vercel builds after the push, so without this a malformed
#                 edition pushes clean, the push looks fine, the build breaks,
#                 and the site quietly serves yesterday. That is the exact
#                 incident this publication kept having.
#   3. commit     only after the build proves it is safe.
#   4. push
#   5. verify     fetch the real public URL. A script exiting 0 is not evidence
#                 that anyone can read the Brief.
#
# It stops at the first failure and says what happened. A stop is a normal
# outcome, not a malfunction: a weekend, an already-published day, or an
# edition that did not clear the quality floor all end here on purpose.
#
# EXIT CODES
#   0  live and verified, or safely skipped
#   1  stopped. The reason is the last thing printed.

set -uo pipefail
cd "$(dirname "$0")/.."

# Stale git locks from a crashed run used to block this repository for days at
# a time. A lock with no git process behind it is debris, not a mutex. Clearing
# it here is safe precisely because this script is the only thing touching git
# at this point in the morning.
for lock in .git/index.lock .git/HEAD.lock; do
  if [ -f "$lock" ] && ! pgrep -x git >/dev/null 2>&1; then
    echo "Clearing stale $lock (no git process running)."
    rm -f "$lock"
  fi
done

DATE_ARG="${1:-}"
EXTRA=""
[ -n "$DATE_ARG" ] && EXTRA="--date=$DATE_ARG"

echo "=============================================="
echo " SF Times Brief - shipping"
echo "=============================================="

# ---- 1. EVERY EDITORIAL GATE ----
echo ""
echo "[1/5] Editorial gates and composition"
if ! npx tsx scripts/brief-assemble.ts --skip-deploy $EXTRA; then
  echo ""
  echo "STOPPED at the editorial gates. Nothing was published, nothing was pushed."
  echo "The RUN REPORT above says which gate stopped it. Do not override it."
  exit 1
fi

OUTCOME=$(node -p "require('./publication-status.json').outcome" 2>/dev/null || echo unknown)
EDITION=$(node -p "require('./publication-status.json').edition_date" 2>/dev/null || echo unknown)

# Skips are correct outcomes, not failures. Exit clean and say so plainly.
case "$OUTCOME" in
  weekend_skip)
    echo ""
    echo "Weekend in San Francisco. The Brief is a weekday publication. Nothing to do."
    exit 0
    ;;
  idempotent_skip)
    echo ""
    echo "$EDITION has already been published. Nothing to do."
    exit 0
    ;;
  published) ;;
  *)
    echo ""
    echo "STOPPED: run ended '$OUTCOME'. Nothing was pushed."
    exit 1
    ;;
esac

# ---- 2. PROVE IT COMPILES ----
echo ""
echo "[2/5] Building the site (proving the edition compiles before it can ship)"
if ! npm run build; then
  echo ""
  echo "STOPPED: the site does not build with this edition. Nothing was pushed."
  echo "The edition file is on disk at src/content/briefs/$EDITION.md so the error can be read."
  exit 1
fi

# ---- 3. COMMIT ----
echo ""
echo "[3/5] Committing"
git add src/content/briefs/ scripts/queue/ publication-status.json
if git diff --cached --quiet; then
  echo "Nothing staged. The edition may already be committed."
else
  ITEMS=$(node -p "require('./publication-status.json').counts.published_items" 2>/dev/null || echo "?")
  git commit -q -m "Brief $EDITION: $ITEMS items" || { echo "STOPPED: commit failed."; exit 1; }
  echo "Committed."
fi

# ---- 4. PUSH ----
echo ""
echo "[4/5] Pushing to main"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if ! git pull --rebase --autostash origin "$BRANCH"; then
  echo "STOPPED: could not rebase on origin/$BRANCH. Resolve it, then run npm run brief:ship again."
  exit 1
fi
if ! git push origin "HEAD:$BRANCH"; then
  echo ""
  echo "STOPPED: push failed. The edition is committed locally and safe."
  echo "Fix the remote, then run: git push origin $BRANCH"
  exit 1
fi
echo "Pushed."

# ---- 5. VERIFY IT IS ACTUALLY LIVE ----
# Vercel builds after the push. Until that finishes and the CDN catches up, the
# edition is committed but unreadable. Waiting here is what turns "the command
# succeeded" into "a reader can see it".
echo ""
echo "[5/5] Waiting for Vercel, then checking the live site"
for attempt in $(seq 1 12); do
  sleep 20
  if npx tsx scripts/brief-watchdog.ts --date="$EDITION" >/dev/null 2>&1; then
    echo ""
    npx tsx scripts/brief-watchdog.ts --date="$EDITION"
    echo ""
    echo "=============================================="
    echo " LIVE: https://www.sftimes.com/brief/$EDITION/"
    echo "=============================================="
    exit 0
  fi
  echo "  not live yet ($attempt of 12)"
done

echo ""
echo "STOPPED: pushed successfully, but $EDITION is not live after four minutes."
echo "The content is safely in the repository. Check the Vercel deployment log."
npx tsx scripts/brief-watchdog.ts --date="$EDITION" || true
exit 1
