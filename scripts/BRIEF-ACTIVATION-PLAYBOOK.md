# BRIEF-ACTIVATION-PLAYBOOK.md

Operational runbook for activating the Daily Brief cron pipeline on Vercel.
Read top to bottom before setting any env vars in production.

---

## TL;DR

The Brief pipeline has 4 stages: ingest (3 AM PT) → AI scoring + draft + audit (5:30 AM PT) → editorial review in the dashboard (6:30 AM PT) → publish or hard-gate fire at 7:30 AM PT. Cost projection: ~$30/mo. Hard rule: editor reviews held items every morning, no fully-autonomous publish.

**Phase B v2 grading verdict passed 6 of 6 (`BRIEF-PHASE-B-V2-GRADE.md`). This unblocks env var wiring.**

But two architectural blockers must be resolved BEFORE the cron pipeline can actually publish end-to-end on Vercel. See **Section 7: Known Blockers** below. The dry-run endpoint, source-health monitor, and pre-flight check script all work today regardless of those blockers.

---

## 1. Pre-flight: local dry-run test

Before touching Vercel env vars, prove the pipeline works locally.

### 1a. Create `astro/.env.local`

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Pull the key from https://console.anthropic.com/settings/keys. Create a dedicated key for this project (so usage tracking and revocation are clean). Tag it `sftimes-brief-prod` in the console.

### 1b. Run the smoke test

```bash
cd astro
npm run brief:check
```

Expected output (success path): 4 stages of structured JSON, ending in either `auto-publish eligible` or `held for editor`. Total elapsed: roughly 8-15 seconds for the full pipeline at Haiku 4.5 speed.

Acceptable alternative outcomes:
- Scoring rejection (composite < 7.0 or uniqueness < 6). Pipeline works; the test article just did not pass the brief-worthy bar.
- Brief-worthy rejection (the draft prompt returned `brief_worthy: false`). Pipeline works.

Failure modes:
- `ANTHROPIC_API_KEY not set` → `.env.local` was not loaded. Check it exists at `astro/.env.local` (NOT `astro/scripts/.env.local`).
- `401 from Anthropic` → key is invalid, revoked, or has insufficient permissions. Regenerate.
- `429 from Anthropic` → rate limited. Wait a minute, retry. Should not happen on first run.
- `failed to load brief-ai.ts via tsx/esm/api` → `npm install` first.

### 1c. Hit the dry-run endpoint (optional, post-deploy)

After env vars are wired in Vercel (Section 2), test the live endpoint:

```bash
curl -X POST "https://www.sftimes.com/api/brief/dry-run?secret=$CRON_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "article_url": "https://missionlocal.org/2026/06/example-article",
    "headline": "Real recent SF news headline from Mission Local",
    "outlet": "Mission Local",
    "byline": "Reporter Name",
    "published_date": "2026-06-20",
    "first_paragraph": "Paste the actual lede from the article here for best results."
  }'
```

Response should mirror the local check. The `verdict` field tells you whether the pipeline would auto-publish, hold for editor, or reject.

What to look for that indicates a problem:
- 503 → `ANTHROPIC_API_KEY` not set in Vercel env (wire it in Section 2).
- 401 → wrong `?secret=` value. Check Vercel env `CRON_SECRET` matches what you're passing.
- 500 with `Anthropic returned 401` hint → key in Vercel is invalid. Regenerate and replace.
- 400 with field list → request body is malformed. Re-check JSON.
- Empty `verdict` or pipeline silently completes with all-zeros scoring → model output parsing failed. Inspect Vercel function logs for the raw response.

---

## 2. Vercel env vars

All env vars are set in **Vercel dashboard → Project → Settings → Environment Variables**. Scope each to all three environments (Production, Preview, Development) unless noted.

### 2a. Required for cron pipeline to run at all

| Variable | Source | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys → create new → name it `sftimes-brief-prod` | `scripts/brief-ai.ts`, `/api/brief/dry-run` |
| `CRON_SECRET` | Generate locally: `openssl rand -hex 32` (or any 32-char random string). Save in 1Password. | All 3 cron handlers (Bearer auth) and `/api/brief/dry-run` (?secret= query) |

### 2b. Required for publish stage to actually deploy + index

| Variable | Source | Used by |
|---|---|---|
| `VERCEL_DEPLOY_HOOK_URL` | Vercel dashboard → Project → Settings → Git → Deploy Hooks → Create Hook (name: `brief-publish`, branch: `main`). Copy the URL. | `scripts/brief-publish.ts` |
| `INDEXNOW_KEY` | Any 32-char random hex string. ALSO requires serving `https://www.sftimes.com/<INDEXNOW_KEY>.txt` containing the same key value (Bing's ownership proof). Generate via `openssl rand -hex 16`, drop the corresponding `.txt` file in `public/`. | `scripts/brief-publish.ts` (IndexNow ping) |

### 2c. Optional / defer until needed

| Variable | Source | Used by |
|---|---|---|
| `DASHBOARD_TOKEN` | Generate: `openssl rand -hex 32`. Defer until basic auth is wired on `/brief-dashboard`. Defaults to dev-mode (allow) if unset. | `/api/brief/candidates`, `/api/brief/publish`, `/api/brief/source-health` |
| `GOOGLE_INDEXING_API_KEY` | Google Cloud Console → service account JSON. Defer; brief-publish.ts already no-ops gracefully when unset. | `scripts/brief-publish.ts` |

### 2d. Verify env wiring

After saving in Vercel: trigger a redeploy (push any commit, or `vercel --prod`). Then hit `https://www.sftimes.com/api/brief/dry-run?secret=<your-secret>` with a POST + sample body. If it returns 503 with the ANTHROPIC_API_KEY message, the env var didn't propagate — check Vercel deploy logs.

---

## 3. Cost monitoring

### 3a. Where to watch

- **Anthropic usage**: https://console.anthropic.com/usage
  - Daily, weekly, monthly view
  - Per-API-key breakdown (use the dedicated `sftimes-brief-prod` key so usage isolates cleanly)
- **Vercel function execution time**: Project → Logs (filter by `/api/cron/`) shows invocation duration + cold-start frequency

### 3b. Budget alerts (set BEFORE first cron run)

Anthropic console → Settings → Usage limits:
- **Soft cap warning at $50/mo** (1.5× projected $30/mo per `BRIEF-MASTER-PLAN.md` section 13)
- **Hard cap pause at $100/mo** (3× projection — pull-plug threshold)

Email alerts go to the address on the Anthropic account. Confirm that address is monitored daily.

### 3c. What "normal" looks like

Per `BRIEF-MASTER-PLAN.md` Phase E cost model:
- 40-60 ingest candidates per day
- Each runs 3 to 4 Haiku calls (scoring → category → draft, plus auditor if draft clears)
- Token totals: ~600 input + 100 output (scoring), ~300 + 10 (category), ~1500 + 400 (draft), ~700 + 200 (auditor)
- Per-day cost: $0.40-$0.80
- Per-month cost: $12-$25
- Annual cost: $150-$300

Daily cost above $1.50 (rolling 7-day average) is a yellow flag. Above $3.00 is a red flag and you should pause the cron immediately (Section 5).

---

## 4. First-week monitoring

### 4a. What success looks like

In Vercel function logs (Project → Logs, filter `/api/cron/`):
- `/api/cron/brief-ingest` fires at 11:00 UTC. Logs end with `[ingest] Wrote N candidates to ...`. N is typically 25-50 after dedupe.
- `/api/cron/brief-ai` fires at 13:30 UTC. Logs show `[ai] Processing N candidates against claude-haiku-4-5-...`. Ends with `[ai] Auto-publishing: X / Held for editor: Y / Dropped: Z`. Typical: X=9-12, Y=3-6, Z=10-25.
- `/api/cron/brief-hard-gate` fires at 15:30 UTC Monday-Saturday. Either `action: 'skipped'` (Eric published in the dashboard before 7:30 AM) or `action: 'force-published auto-batch'`.

In `src/content/briefs/<YYYY-MM-DD>.md`: a new dated file appears each morning. Open it; it should look structurally identical to the 4 sample editions Eric already approved.

In Anthropic usage dashboard: daily cost line trends flat in the $0.40-$0.80 range. No outlier spikes.

### 4b. What failure looks like

- Cron handler returns 500 → check the `error` field in the Vercel function log. Typical causes: rss-parser HTTP timeout (one feed went down — pipeline handles this gracefully via Promise.allSettled), Anthropic 429 (rate limit), JSON parse error (model returned malformed JSON — `parseJson` in brief-ai.ts strips code fences but can't fix everything).
- No new `src/content/briefs/<date>.md` file at 8:00 AM PT → check the hard-gate log. If it says `Empty brief: refusing to publish a zero-item edition`, the pipeline ran but found nothing brief-worthy. Acceptable as a one-off; pattern over 3+ days means the scoring threshold is too tight.
- Vercel deploy hook didn't trigger after publish → check `VERCEL_DEPLOY_HOOK_URL` is set. The script logs a warning and continues if missing.
- Anthropic daily cost spikes to $5+ → likely a model parsing failure causing retry loops, OR a surge-week candidate volume. Inspect the audit log at `scripts/queue/audit-log/<date>.json` for the audit counts.

### 4c. When to pull the plug vs. wait it out

| Symptom | Action |
|---|---|
| One source feed down for one day | Wait. Pipeline degrades gracefully. |
| One day no brief published | Wait. Check tomorrow's run. |
| Two consecutive days no brief published | Investigate. Run `npm run brief:check` locally to confirm Anthropic is responding. |
| Three consecutive days no brief published | Pull plug (Section 5). Diagnose offline. |
| Anthropic cost > $2/day for one day | Investigate. Check audit log for retry loops. |
| Anthropic cost > $2/day for two consecutive days | Pull plug. |
| Editor's note in a published brief recaps the source article (firewall violation) | Pull plug immediately. Audit the auditor prompt. |

---

## 5. Manual override (pause the cron)

If anything goes wrong and you need to stop the pipeline immediately:

1. Vercel dashboard → Project → Settings → Crons
2. Find each of the three cron entries (`brief-ingest`, `brief-ai`, `brief-hard-gate`)
3. Click each → toggle "Enabled" off

This stops the cron from firing on the next scheduled tick. In-flight invocations complete; queued ones get cancelled.

To re-enable, flip each toggle back on. Schedule resumes at the next scheduled tick.

Alternative (more surgical): rotate `CRON_SECRET` in Vercel env vars. The cron handlers return 401 on every invocation until you set it back. This pauses without touching the schedules.

---

## 6. Rollback

The 4 sample brief editions in `src/content/briefs/2026-06-13.md` (and any future ones Eric has hand-curated) stay untouched by the cron pipeline. The `/brief/` reader surface continues to render the most recent edition, whether that's a cron-published one or a hand-curated one.

So "rollback" is really "stop letting cron publish" + "delete any bad editions cron produced":

1. **Stop cron** (Section 5).
2. **Identify bad editions**: any `src/content/briefs/<date>.md` file that cron wrote and you want to revert. Git history shows which commits the cron triggered (look for "[Vercel deploy hook]" or similar in `git log`).
3. **Delete or revert**:
   ```bash
   cd astro
   git rm src/content/briefs/2026-06-21.md   # example
   git commit -m "Rollback: revert bad cron-published brief edition for 2026-06-21"
   git push origin main
   ```
4. **Verify**: hit `https://www.sftimes.com/brief/` and confirm it now resolves to the most recent good edition.

The reader surface never goes dark. The hand-curated sample editions are the safety net.

---

## 7. KNOWN BLOCKERS (read before activation)

Two architectural issues surfaced during the pre-flight audit. Both prevent the cron pipeline from completing end-to-end on Vercel, but neither prevents the dry-run endpoint, source-health monitor, or pre-flight check from working.

### Blocker 1: Vercel cron stages cannot share filesystem state

All three cron handlers write/read `scripts/queue/<date>-*.json` via `process.cwd()`. Vercel Functions are stateless with a read-only filesystem outside `/tmp`, and `/tmp` is per-invocation only. The 3 AM ingest cron writes a queue file that the 5:30 AM AI cron will never see.

**Fix options (both are separate scope-bounded commits, not in this one):**

- **(a) Wire Vercel KV** for the queue. Cleanest. ~20-line swap per file: replace `readFile`/`writeFile` with KV `get`/`set`. Vercel KV is one-click provision from the dashboard, has a free tier, and adds no architecture complexity. Set `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars after provisioning.
- **(b) Collapse 3 crons into 1**. At 5:30 AM, run ingest → AI → audit in a single Vercel function invocation. Store the final queue in KV or Blob. Drops the 3 AM ingest separation but keeps the publish gate intact.

Recommended: option (a). Smaller diff, preserves the 3-stage separation the master plan prescribes, easier to reason about.

**Until this blocker is resolved:** the cron pipeline cannot publish end-to-end on Vercel. The dry-run endpoint at `/api/brief/dry-run` still works (single invocation, no cross-stage state), and is sufficient to validate AI quality. The 4 hand-curated sample editions in `src/content/briefs/` keep the reader surface live.

### Blocker 2: Dashboard does not consume `/api/brief/candidates`

`src/pages/brief-dashboard.astro` line 46 uses a hardcoded sample-data `candidates` array. The API endpoint exists and is correct (verified during audit), but the dashboard frontend never calls `fetch('/api/brief/candidates')`. Even if Blocker 1 is fixed and the queue is properly persisted, the dashboard would still render the same hardcoded sample data and Eric would never see real candidates.

**Fix:** add a client-side fetch in the dashboard's inline script, replace the hardcoded `candidates` array with the response, add a loading state, handle errors. ~40-line frontend commit. Out of scope here.

**Until this is fixed:** the dashboard renders the static Phase C paper prototype. It cannot be used to publish real cron-generated briefs.

---

## 8. Activation sequence (when both blockers are fixed)

In order:

1. ✅ Phase B v2 grading passes (`BRIEF-PHASE-B-V2-GRADE.md` verdict: 6 of 6 — DONE).
2. ✅ Pre-flight smoke test passes locally (`npm run brief:check` — this commit ships the script).
3. ☐ Blocker 1 resolved (queue persistence on Vercel — separate commit).
4. ☐ Blocker 2 resolved (dashboard fetches real candidates — separate commit).
5. ☐ Set Vercel env vars per Section 2.
6. ☐ Deploy. Hit `/api/brief/dry-run?secret=<CRON_SECRET>` with a real recent SF article. Confirm structured response.
7. ☐ Wait for the next scheduled cron tick (3 AM PT for ingest, 5:30 AM PT for AI). Monitor Vercel logs.
8. ☐ Open dashboard at 6:30 AM PT, review held items, publish.
9. ☐ Verify `https://www.sftimes.com/brief/` shows the new edition.
10. ☐ Watch the first 7 days closely per Section 4. Adjust scoring thresholds if needed.

---

## 9. References

- `BRIEF-MASTER-PLAN.md` — full pipeline spec, prompts, success criteria
- `BRIEF-PHASE-B-V2-GRADE.md` — grading verdict (passed 6 of 6)
- `GOOGLE-NEWS-90-DAY-PLAN.md` — strategic context (Phase 1.2 of the 90-day plan)
- `scripts/brief-ingest.ts` — Stage 1 source
- `scripts/brief-ai.ts` — Stages 2 + 3 source
- `scripts/brief-publish.ts` — Stage 4 source
- `api/cron/*.ts` — Vercel cron handler shims
- `api/brief/dry-run.ts` — single-article test endpoint
- `api/brief/source-health.ts` — feed liveness monitor at `/brief-dashboard/health`
- `scripts/check-brief-pipeline.mjs` — local pre-flight smoke test (`npm run brief:check`)
