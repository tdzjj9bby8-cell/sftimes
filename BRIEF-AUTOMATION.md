# BRIEF-AUTOMATION.md

> **THIS DESCRIBES THE DORMANT API PATH. It is not how the Brief publishes today.**
>
> Unattended weekday publishing requires model calls from a GitHub Actions
> runner, which requires an Anthropic API key. SF Times does not buy API credit,
> so the schedule in `daily-brief.yml` is commented out and this document
> describes a capability that is built, tested, and switched off.
>
> **The live path is manual and local. See [BRIEF-DAILY-PLAYBOOK.md](./BRIEF-DAILY-PLAYBOOK.md).**
> Editorial judgment comes from Claude Code on the operator's machine; every
> safeguard described below still runs, in the same code, on that path.
>
> Everything here remains accurate and working. Re-enabling unattended
> publishing is one repository secret plus three uncommented lines.

How the SF Times Daily Brief publishes itself. Written for an operator who did
not build this system.

---

## 1. What changed and why

The Brief used to publish only when a human triggered it from a laptop. Before
that, an automated task ran inside a virtualized environment whose filesystem
would not let git clean up its own lock files, so one crashed run left a stale
`.git/index.lock` that silently blocked every later run for days.

The Brief now runs on GitHub Actions. A GitHub-hosted runner gets a brand new
filesystem and a fresh clone every run, so **a stale lock from a previous run
cannot exist**. The old failure class is designed out, not defended against.

The laptop is no longer part of normal publication.

---

## 2. The pipeline in one picture

```
Weekday 13:07 UTC (GitHub Actions cron)
  -> weekday gate        (America/Los_Angeles, not UTC)
  -> idempotency gate    (does today's edition file already exist?)
  -> Stage 1 ingest      11 RSS feeds + 3 subreddits, dedupe, cap
  -> Stage 2 score       Claude, composite >= 7.0 and uniqueness >= 6
  -> Stage 2b FULL ARTICLE FETCH   <-- mandatory, 500-word floor
  -> Stage 2c draft      grounded only in the fetched body
  -> Stage 2d audit      6 checks incl. source fidelity
  -> Stage 3 firewall    deterministic: numbers/quotes must exist in source
  -> compose edition markdown
  -> commit + push       (single sequential git step)
  -> Vercel builds and deploys
  -> publication-status.json records the outcome

Weekday 16:07 UTC (separate workflow)
  -> watchdog            fetches the LIVE site and verifies the edition exists
  -> alert if missing
```

---

## 3. Schedule and timezone

| What | When | Notes |
|---|---|---|
| Publish | `7 13 * * 1-5` UTC | 06:07 PDT summer, 05:07 PST winter |
| Watchdog | `7 16 * * 1-5` UTC | ~3 hours later, allows for build + CDN |

**The cron is UTC. The edition date is always America/Los_Angeles.** Those are
deliberately separate. The hour drifts by one across daylight saving, which does
not matter. The *date* never drifts, because every stage calls
`scripts/lib/sf-date.ts` rather than `toISOString()`. This prevents the
off-by-one where a late run publishes tomorrow's edition.

No weekend editions. The cron is Monday to Friday, and `brief-run.ts` re-checks
the weekday in San Francisco time so a manual run cannot publish a weekend
edition by accident.

---

## 4. Required secrets

Set these in GitHub: **Settings → Secrets and variables → Actions**.

| Secret | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Scoring, drafting, and the audit pass. Without it every run is RED. |
| `BRIEF_MAX_USD` (variable, not secret) | Recommended | Hard per-run spend ceiling. Default 0.35. |
| `BRIEF_MAX_DRAFTS` (variable) | Optional | Cap on expensive draft+audit items. Default 10. |
| `ALERT_WEBHOOK_URL` | Recommended | Slack or Discord incoming webhook for failure alerts. If unset, you still get GitHub's failure emails. |
| `INDEXNOW_KEY` | Optional | Search-engine ping after publish. |

Also required, once: **Settings → Actions → General → Workflow permissions →
"Read and write permissions"**, so the workflow can push the edition.

`GITHUB_TOKEN` is provided automatically by Actions. Do not create one.

Never paste secret values into the repo, a log, or an issue.

---

## 5. Cost and budget control

Measured 2026-09 against the real prompts and a representative 7,100-character
article body. Model is Claude Haiku 4.5 at **$1.00/M input, $5.00/M output**.

| Candidates | Drafted | API calls | Input tok | Output tok | Cost |
|---|---|---|---|---|---|
| 22 (light) | 6 | 34 | ~52k | ~5.3k | **$0.079** |
| 40 (typical) | 10 | 60 | ~75k | ~10k | **$0.135** |
| 60 (capped max) | 10 | 80 | ~86k | ~11k | **$0.162** |

At 22 weekday runs: **roughly $1.70 to $3.60 a month.**

An earlier version of this document said $10 to $17 a month. That was wrong. It
repeated a stale comment in the original source rather than a measurement.

### Where the calls go, and what was removed

Scoring is cheap (no article body). Drafting and auditing are ~20x more
expensive because each carries the full body. The pipeline is ordered so the
expensive calls only touch stories that can actually reach the edition:

1. **Weekday, idempotency and source-health gates run before any API call.** A
   rerun of a published day costs exactly $0.00.
2. **Free deterministic dedupe before scoring.** Duplicate headlines are removed
   at zero cost.
3. **Draft cap.** Only the top `BRIEF_MAX_DRAFTS` (default 10) candidates by
   composite score get drafted and audited. An edition publishes five or six,
   so drafting every survivor spends money on output the firewall and diversity
   cap discard.
4. **Article fetch happens before drafting.** An unreachable article costs zero
   additional tokens.
5. **The category call was eliminated.** Category now comes back from the draft
   call, which already has the article. That removed one round trip per item.

No story is ever sent to Claude twice for the same purpose.

### The two spend limits (configure both)

**1. In-run ceiling.** `BRIEF_MAX_USD`, default `0.35`, set as a repository
variable. Real usage is read from each API response and accumulated; crossing
the ceiling aborts the run immediately with outcome `budget_exceeded`. This
stops a runaway loop mid-flight.

**2. Anthropic Console spend limit (do this before enabling publishing).**
The in-run ceiling only helps if this code runs correctly. The Console limit is
the backstop that cannot be bypassed by a bug here.

- Go to <https://console.anthropic.com> → **Settings → Limits** (or Billing →
  Usage limits).
- Set a **monthly spend limit**. Start at **$5**. That is more than the measured
  worst case, and low enough that any surprise is trivial.
- Set an **email alert threshold** below the cap (for example $2), so you get
  warned before anything stops.
- Optionally create a dedicated **workspace** for SF Times with its own limit,
  so this project can never consume budget belonging to anything else.

With both in place there is no path to an unexpected bill: the run stops itself
at $0.35, and the account stops at $5 regardless.

### Observing actual usage

Every run records real usage in `publication-status.json` and prints it:

```
API calls         : 34
API tokens        : 52,140 in / 5,310 out
API cost          : $0.0787 of $0.35 ceiling
```

A dry run makes real scoring and drafting calls, so its reported usage is real,
and it additionally prints a projected cost for the equivalent full run.

---

## 6. Editorial safeguards (do not weaken these)

These exist because of the 2026-07-15 fabrication incident, when items were
drafted from RSS snippets and the model invented vote counts, a court case, and
statistics to fill the gaps.

1. **Full-article fetch, 500-word floor** (`scripts/lib/fetch-article.ts`).
   An item cannot be drafted unless the real article body was retrieved. Paywalls,
   short posts, and photo essays are dropped, not summarized from the headline.
2. **Grounding instruction** in the drafting prompt: every fact must come from
   the fetched body.
3. **Six-check model audit**, including a source-fidelity check.
4. **Deterministic editorial firewall** (`scripts/lib/editorial-firewall.ts`),
   which runs at publish time and is not a model call:
   - every number in the TLDR or editor's note must appear in the source body
   - every quotation must appear in the source body
   - source URL must be real, outlet present, body attached
   - byline must not be an invented placeholder
   - the story must not have run in a previous edition
5. **Failing items are removed, never repaired.** If all items fail, no edition
   publishes.

The deterministic firewall specifically checks:

| Class | What it catches |
|---|---|
| Numbers | Invented vote counts, money, percentages, quantities, ages, small counts with units, month-day dates. Month abbreviations are normalized so "Sept. 7" satisfies "September 7". |
| Quotes | Any quoted span of 5+ words that does not appear in the source body |
| Attribution | "police said", "according to the Chronicle", "the mayor announced" when that party is absent from the article, or the article contains no reported speech |
| Certainty | A source that is substantially hedged (alleged, reportedly, preliminary, pending) rendered as settled fact. Requires two or more hedge markers in the source before firing, so one incidental "proposed" does not remove a good item. |
| Duplication | The same source URL in a previous edition |

**A missed edition is always preferable to a fabricated one.** If you are
tempted to relax a floor to improve cadence, do not.

---

## 6b. Editorial quality (is it a Brief, not just a feed?)

Accuracy is not sufficiency. `scripts/lib/editorial-quality.ts` enforces:

- **Near-duplicate removal.** Two outlets running the same story with reworded
  headlines collapse to the higher-scoring one. A hard guard prevents merging
  items in different categories, because "Supervisors approve housing plan" and
  "Supervisors approve transit plan" score 0.60 on headline overlap and are
  genuinely different stories.
- **Source diversity.** No single outlet may supply more than 60% of an edition
  of four or more items. This is what stops the Brief becoming "whatever
  Mission Local published today."
- **Ordering.** Highest composite score leads.

### The quality floor: when we publish nothing

| Condition | Why |
|---|---|
| Fewer than 3 verified items | Reads as an accident, not a publication |
| Fewer than 4 of 14 sources responded | A partial outage would misrepresent the day |
| Every item from one outlet (4+ item edition) | That is a feed digest, not a brief |
| Systemic model failure (50%+ candidates errored) | Infrastructure fault, not a quiet day |
| Composed edition fails structural validation | Would break the site build |

---

## 7. Run status and failure colours

Every run writes `publication-status.json` at the repo root.

| Colour | Meaning | Alerts? | Job result |
|---|---|---|---|
| GREEN | Published, or safely skipped (weekend, already published, dry run) | No | pass |
| YELLOW | Ran correctly but produced nothing worth publishing | No | pass |
| RED | Infrastructure or publication failure | Yes | fail |

Key outcomes you will see: `published`, `idempotent_skip`, `weekend_skip`,
`no_candidates`, `no_items_cleared`, `empty_after_firewall`, `pipeline_errors`,
`failed`.

`pipeline_errors` specifically means the model calls themselves failed
(bad or missing API key, Anthropic outage). It is RED on purpose: a systemic
API failure must never be mistaken for a quiet news day.

---

## 8. The watchdog

The publishing job cannot certify its own success. It can exit 0 while the push
failed, the Vercel build broke, or the site served a stale page.

`scripts/brief-watchdog.ts` runs as a separate workflow, imports none of the
pipeline, and checks the public site:

1. `https://sftimes.com/brief/<date>/` returns 200
2. that page renders the expected date (catches a stale build)
3. that page contains real item structure (catches an empty edition)
4. `https://sftimes.com/brief/` references today (catches a stale index)

Weekends return healthy with no alert, so the alert stays meaningful.

---

## 9. Alerts

Alerts fire only on failure: a RED publish run, or a missing edition at watchdog
time. A healthy day is silent.

Format:

```
SF Times Daily Brief MISSING
Edition: 2026-09-07
Stage: publication verification
Reason: expected edition was not found on the live site
Failed checks: edition_page_live, brief_index_current
Run: https://github.com/tdzjj9bby8-cell/sftimes/actions/runs/<id>
```

If `ALERT_WEBHOOK_URL` is unset you still get GitHub's own workflow-failure
email, so failures are never fully silent.

---

## 10. Manual operations

**Trigger a run by hand**
GitHub → Actions → "Daily Brief" → Run workflow. Optional inputs: `date`,
`dry_run`, `force`.

### The three run modes

| Mode | Runs | Publishes | Cost | Use it to |
|---|---|---|---|---|
| `dry_run` | ingest, score, fetch, draft, audit | No | ~$0.08-0.14 | Prove the plumbing and measure real cost |
| `review_only` | everything above **plus** firewall, deduper, diversity cap, quality floor, composition, structural validation | No | ~$0.08-0.14 | Read the actual edition before trusting it |
| normal | everything, then commit, build, push, verify live | **Yes** | ~$0.08-0.17 | Real publication |

**Important:** a dry run stops BEFORE the editorial gates. It does not exercise
the firewall, the deduper, the diversity cap, or edition composition. Those are
the components whose thresholds need calibrating against real copy, so
`review_only` is the mode that actually tells you whether the editorial output
is good.

```
npm run brief:dry                          # cheapest check
npm run brief:review                       # supervised: composes a real edition
npm run brief:review -- --date=2026-09-07
```

A `review_only` run writes `review-edition-YYYY-MM-DD.md`, uploads it as a CI
artifact, and prints the whole edition plus the run report into the GitHub job
summary so it can be read on the run page without downloading anything. The file
is gitignored and never committed.

### Recommended rollout sequence

Do not go from zero to automatic weekday publishing. Order:

1. Set the Anthropic Console monthly limit ($5) and alert ($2).
2. Add `ANTHROPIC_API_KEY`; set workflow permissions to read/write.
3. Run once with `dry_run: true`. Confirm cost and that the plumbing works.
4. Run once with `review_only: true`. **Read the composed edition.** This is
   where the editorial thresholds get calibrated.
5. Adjust thresholds if needed, then run once normally, supervised, and check
   the live page.
6. Only then leave the weekday schedule enabled.

**Run locally for real**
```
export ANTHROPIC_API_KEY=...      # never commit this
npm run brief:run
npm run brief:run -- --date=2026-09-07
```

**Check whether an edition is live**
```
npm run brief:watchdog
npm run brief:watchdog -- --date=2026-09-07
```

**Republish a date** (only after deliberately deleting its edition file)
```
npm run brief:run -- --date=2026-09-07 --force
```
`--force` bypasses the idempotency gate. Never use it in automation.

**Pause automation**
GitHub → Actions → "Daily Brief" → `...` → Disable workflow. Re-enable the same
way. Do not delete the file to pause it.

---

## 11. Troubleshooting

**No edition today and the watchdog alerted**
Open the "Daily Brief" run for that day. Read `publication-status.json` in the
run artifacts. The `outcome` field names the stage.

**`pipeline_errors`** — check `ANTHROPIC_API_KEY` is set and valid, and check
Anthropic status. Rerun via workflow dispatch.

**`no_items_cleared` or `empty_after_firewall`** — not a bug. Nothing met the
editorial bar. Check the log for how many were dropped at the full-article
guardrail; a very high number can mean a source changed its markup.

**Edition committed but not live** — the push succeeded and Vercel failed.
Check the Vercel dashboard for a failed build.

**Published under the wrong date** — should be impossible now, but verify the
run used `sf-date.ts` and was not invoked with a stale `--date`.

**Recovering a failed publication**
1. Confirm no edition file exists for that date.
2. Re-run via workflow dispatch with that `date`.
3. If an edition exists but is wrong, delete it, commit the deletion, then
   re-run with `--force`.

---

## 12. Changing the automation safely

- Test with `npm run brief:dry` before touching the schedule.
- Change the publish time in `.github/workflows/daily-brief.yml` only. Never
  compute dates from UTC anywhere in the code.
- Keep the two workflows separate. Merging the watchdog into the publishing job
  would recreate the "job certifies itself" problem.
- Leave `concurrency` in place. It is what prevents a manual run from racing the
  schedule.

---

## 13. Files

| File | Role |
|---|---|
| `.github/workflows/daily-brief.yml` | Weekday schedule, runs the pipeline, commits, pushes, alerts |
| `.github/workflows/brief-watchdog.yml` | Independent live-site verification and alert |
| `scripts/brief-run.ts` | Orchestrator. The single entrypoint CI runs |
| `scripts/brief-watchdog.ts` | Live-site health check |
| `scripts/lib/sf-date.ts` | All San Francisco date logic |
| `scripts/lib/fetch-article.ts` | Full-article retrieval and word floor |
| `scripts/lib/editorial-firewall.ts` | Deterministic fact validation |
| `scripts/lib/run-status.ts` | `publication-status.json` |
| `scripts/brief-ingest.ts` | Stage 1 (modified: SF dates) |
| `scripts/brief-ai.ts` | Stage 2 (modified: full-body fetch, 6th audit check) |
| `scripts/brief-publish.ts` | Stage 3 (modified: idempotency gate, firewall) |
| `publication-status.json` | Written each run, committed with the edition |
