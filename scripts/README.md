# Brief pipeline scripts

The four-stage daily Brief pipeline as defined in `BRIEF-MASTER-PLAN.md` section 6. Each script is standalone and runnable from the CLI. In production they run as Vercel cron jobs.

## Files

- `brief-ingest.ts` — Stage 1: pull 12 RSS feeds + 3 Reddit subs, dedupe, write candidate queue
- `brief-ai.ts` — Stages 2 and 3: scoring + category + draft + auditor against Claude Haiku, write audited queue
- `brief-publish.ts` — Stage 4: write content collection entry, trigger Vercel deploy, ping indexing APIs

## Install dependencies

```
npm install rss-parser @anthropic-ai/sdk
```

## Environment

Set in `.env.local` (locally) or Vercel dashboard (production):

```
ANTHROPIC_API_KEY=sk-ant-...
VERCEL_DEPLOY_HOOK_URL=https://api.vercel.com/v1/integrations/deploy/...
INDEXNOW_KEY=...                 # optional
GOOGLE_INDEXING_API_KEY=...      # optional
```

## Run locally

```
# Stage 1: 3 AM ingest
npm run brief:ingest

# Stage 2 and 3: 5 AM AI pass + auditor
npm run brief:ai

# Stage 4: 7 AM publish (writes content collection + deploys)
npm run brief:publish

# Specific date
npm run brief:ingest -- --date 2026-06-14

# Dry-run publish: print the markdown but don't write or deploy
npm run brief:publish -- --date 2026-06-14 --dry-run

# Write the markdown but skip deploy + indexing
npm run brief:publish -- --date 2026-06-14 --skip-deploy
```

## Vercel cron

In `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/brief-ingest",  "schedule": "0 11 * * *" },
    { "path": "/api/cron/brief-ai",      "schedule": "30 13 * * *" }
  ]
}
```

Cron times are UTC. 11:00 UTC = 3:00 AM PT; 13:30 UTC = 5:30 AM PT.

The publish step does not run on cron. It runs when the editor clicks the PUBLISH button in `/brief-dashboard/`, which calls a serverless function that invokes `brief-publish.ts`.

## Hard gate (7:30 AM PT)

If no decisions file is present by 7:30 AM PT (15:30 UTC):

- A scheduled function calls `brief-publish.ts` directly.
- The script publishes only the auto-passing batch.
- Held items are dropped silently.
- The brief publishes shorter than usual but ships on time.

## Cost budget

See `BRIEF-COST-MODEL.md`. Roughly $0.40 to $0.80 per day at 40 to 60 candidates. Alert thresholds at $50, $100, $200 per month.

## Manual override

To skip a day:

```
echo '{"accepted_held":[],"rejected_held":[],"removed_auto":[],"editor":"Eric","edition":0,"published_at":"2026-06-14T00:00:00Z"}' > scripts/queue/2026-06-14-decisions.json
```

The publish script will see "Empty brief" and abort with non-zero exit. The /brief/ canonical will continue redirecting to the previous edition.

To force-publish a single item only:

```
# Hand-craft the decisions file with just that item's id in accepted_held,
# all auto-passing items in removed_auto.
```

## Audit trail

`scripts/queue/audit-log/<date>.json` is written on every publish. Contains:

- Counts (audited, auto-passing, held, accepted, rejected, removed)
- Edit count (how many items the editor revised)
- Editor name
- Publish timestamp

These logs feed the monthly prompt-quality dashboard.

## Adding a new RSS source

Edit `RSS_SOURCES` in `brief-ingest.ts`. The `hostMustInclude` filter is the safety net for syndicated stories that slip into the feed.

## Failure modes

See BRIEF-MASTER-PLAN.md section 6.6 for the failure-mode matrix. Each script logs to stdout and exits non-zero on fatal errors. Vercel will retry the cron once; if both fail, the manual override is the path forward.
