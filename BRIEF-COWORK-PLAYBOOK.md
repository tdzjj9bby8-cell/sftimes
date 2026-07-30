# BRIEF-COWORK-PLAYBOOK.md

Playbook for the scheduled Cowork task that produces the SF Times Daily Brief. Referenced by task `brief-daily`. Update this doc to change pipeline behavior; task prompt stays stable.

Last regenerated: 2026-06-21.

## Purpose

Produce one Daily Brief edition per weekday. Ingest SF news RSS feeds, score, draft, audit, publish audit-passing items automatically, stage audit-failing items for editor review. Auto-publish is gated by the 5-check firewall audit; the full-body source-fetch guardrail at Stage 4 blocks the 2026-07-15 fabrication failure mode.

Replaces the previous Vercel API + Claude Haiku pipeline. Same editorial spec, different runtime: this playbook runs inside a Cowork scheduled task using the agent's own reasoning (Sonnet/Opus), which rides Eric's Max subscription. No Anthropic API charges.

## Non-negotiable rules

- Full article bodies fetched before any drafting. Snippets are not sufficient.
- Audit-passing items auto-publish. Audit-failing items are staged for editor review only, never published by the task.
- The task never edits `src/content/briefs/YYYY-MM-DD.md` for a past date. Auto-publish is today-only. Editor handles retroactive edits.

## Read first (required)

Before doing anything:
1. `/Users/eric/projects/sftimes/IDENTITY.md` — venture identity, voice, standards
2. `/Users/eric/projects/sftimes/BRIEF-MASTER-PLAN.md` sections 6 (pipeline architecture) and 7 (AI prompts). The prompts in section 7 are your instruction set for scoring, category, brief-worthy check, drafting, and auditor stages. Apply them faithfully.
3. `/Users/eric/projects/sftimes/CLAUDE.md` — project rules

## Runtime deltas from the API version

- No Vercel KV. Read/write state via git-tracked files.
- No Anthropic API calls. You (the agent) do the reasoning yourself using the prompts from BRIEF-MASTER-PLAN.md section 7.
- No cron endpoints. This task IS the cron.
- The task auto-publishes audit-passing items. It composes the edition markdown, commits it to `src/content/briefs/YYYY-MM-DD.md`, and pushes. Audit-failing items are staged to `scripts/queue/YYYY-MM-DD-staged.json` for editor review at /brief-dashboard. Publishing an edition is the task's job for the clean case; the editor's job for the flagged case. You have full bash access.
- Output writes directly to the file system (Eric's machine, no Vercel EROFS).

## Stage 1: Ingest

Fetch overnight news. Sources (reference `/Users/eric/projects/sftimes/astro/scripts/brief-ingest.ts` for the current authoritative list; if it drifts from what's below, trust brief-ingest.ts):

- Mission Local: https://missionlocal.org/feed/
- SF Standard: https://sfstandard.com/feed/
- SFist: https://sfist.com/feed/
- KQED News: https://ww2.kqed.org/news/feed/
- SF Public Press: https://www.sfpublicpress.org/feed/
- SF Chronicle SF section: https://www.sfchronicle.com/rss/feed/bay-area-news-3.xml
- NBC Bay Area SF: https://www.nbcbayarea.com/?rss=y&scope=section&sectionname=San%20Francisco
- Optional: r/sanfrancisco top posts (last 24h) via https://www.reddit.com/r/sanfrancisco/top.json?t=day (JSON, not RSS)

Use bash `curl` to fetch. Parse feed XML for `<item>` entries. For each item extract: title, link, pubDate, description/summary, source outlet. Deduplicate by URL.

Filter to items published in the last 24 hours (based on today's LOCAL date). Cap at 60 candidates max (per BRIEF-MASTER-PLAN.md Phase E). If more, keep the newest.

## Stage 2: Score

For each candidate, apply the scoring prompt from BRIEF-MASTER-PLAN.md section 7.1. Output: composite score (0 to 10), uniqueness score (0 to 10), one-line reason, outlets covering it.

Hard reject: composite < 7.0 OR uniqueness < 6. Log rejected items with reason.

## Stage 3: Category

For each surviving candidate, apply the category prompt from BRIEF-MASTER-PLAN.md section 7.2. Choose one from the 13-value taxonomy: TRANSIT, HOUSING, FOOD, POLITICS, TECH, CULTURE, ARTS, BUSINESS, PUBLIC SAFETY, OPENINGS, CLOSINGS, WEATHER, SPORTS.

## Stage 4: Brief-worthy check + Draft

**Full-body source-fetch requirement (mandatory).** Before drafting any item, fetch the FULL article body via curl or WebFetch. RSS descriptions and first paragraphs are NOT sufficient. If body fetch fails or returns less than 500 words of substantive content, reject the item at this stage rather than draft from snippets. Drafting from headlines and ledes is how fabricated facts get past the audit's voice check while failing on verifiable claims. This is not optional. The 2026-07-15 quarantine event was exactly this failure mode.

For each categorized candidate, apply the brief-worthy check + draft prompt from BRIEF-MASTER-PLAN.md section 7.3.

- Three yes/no questions: missed angle, missed connection, missing backstory. All-no = auto-reject with one-line reason.
- If passes: draft the angle statement, TLDR (25 to 30 words), editor's note (100 to 150 words starting with explicit angle statement), what_to_watch (one-liner), brief_signal tag (first-to-connect | underreported | missing-context | structural-pattern).

## Stage 5: Audit

For each drafted candidate, apply the auditor prompt from BRIEF-MASTER-PLAN.md section 7.4. Five firewall checks:
1. check_1_recap: does editor's note recap the source? (fail = recap)
2. check_2_angle: does first sentence state a real editorial angle? (fail if not)
3. check_3_specificity: does TLDR include specific number or named entity? (fail if generic)
4. check_4_word_count: is note 100 to 150 words? (fail if outside)
5. check_5_voice: does it sound like SF Times voice? (fail if generic/AI-flat)

audit_pass = all 5 checks pass. Path 3 branch: audit_pass=true items go to Stage 6a (auto-publish). audit_pass=false items go to Stage 6b (stage for editor). The audit result is a hard gate on auto-publish.

## Stage 6a: Auto-publish audit-passing items

For all items where audit_pass=true, compose the edition markdown at `/Users/eric/projects/sftimes/astro/src/content/briefs/YYYY-MM-DD.md`. Frontmatter fields:

- `date`: today's LOCAL Pacific date
- `edition`: auto-increment (scan `src/content/briefs/` for highest existing edition number, add 1)
- `editor`: `Eric`
- `intro`: 2-3 sentence summary of the day's items, task-generated. No em dashes.
- `ai_disclosure`: canonical Path 3 boilerplate: "Produced by a scheduled Cowork task using Claude Sonnet reasoning on the editor's personal subscription. Every item's TLDR and editor's note passed a 5-check firewall audit before publishing. Items that fail the audit are quarantined for editor review and do not appear here. Full pipeline at /brief/methodology."
- `items`: the full array with all draft fields

Body content after frontmatter: 2-3 sentence editorial framing of the day, task-generated.

If no items passed audit (all failed or zero drafted): do NOT write an edition file. Skip to Stage 6b.

## Stage 6b: Stage audit-failing items for editor

For all items where audit_pass=false, write to `/Users/eric/projects/sftimes/astro/scripts/queue/YYYY-MM-DD-staged.json` with the same canonical AuditedItem shape as before. Each entry carries the draft, the audit result, and the specific fail_reasons. If zero items failed audit: do NOT write a staging file. This file exists only when the editor has something to review.

## Stage 8: Empty-brief safety

If zero drafted items after the full pipeline: do NOT write an edition file, do NOT write a staging file, do NOT notify the editor. Log the empty state in the run report. No commit.

If zero audit-passing items but some audit-failing items exist: do NOT publish an edition (the day has no cleared content). Do write the staging file with the flagged items for editor cleanup. The editor may promote a flagged item after review; that's their call in /brief-dashboard.

## Stage 9: Commit and push

If Stage 6a wrote an edition, or Stage 6b wrote a staging file, or both:

```bash
cd /Users/eric/projects/sftimes/astro

# Stale-lock guard: crashed prior runs leave .lock files behind. Git creates
# .lock files for index writes (index.lock), HEAD updates (HEAD.lock),
# per-branch ref updates (refs/heads/*.lock), and packed refs
# (packed-refs.lock). Remove any stale one ONLY when no git process is
# running, so a genuinely concurrent operation is never disturbed. Extended
# 2026-07-30 after HEAD.lock silently blocked commits for two days despite
# the original index.lock-only guard.
if ! pgrep -x git >/dev/null 2>&1; then
  for lock in .git/index.lock .git/HEAD.lock .git/packed-refs.lock .git/refs/heads/*.lock; do
    [ -f "$lock" ] && { echo "Removing stale lock: $lock"; rm -f "$lock"; }
  done
fi

# Commit whatever was written this run. Either or both may exist.
if [ -f src/content/briefs/YYYY-MM-DD.md ]; then
  git add src/content/briefs/YYYY-MM-DD.md
fi
if [ -f scripts/queue/YYYY-MM-DD-staged.json ]; then
  git add scripts/queue/YYYY-MM-DD-staged.json
fi

# Only commit if something is staged
if ! git diff --cached --quiet; then
  git commit -m "Brief YYYY-MM-DD: P auto-published, F flagged for editor review

- P items cleared 5-check audit and auto-published to /brief/YYYY-MM-DD/
- F items flagged; staged for editor at /brief-dashboard
- Auto-produced by scheduled Cowork task per BRIEF-COWORK-PLAYBOOK.md"
  git push origin main
fi
```

Push is required for both artifacts. The edition markdown only reaches readers after Vercel rebuilds on the push. Vercel bundles `scripts/queue/**` into the serverless function at deploy time (per vercel.json includeFiles), so the /brief-dashboard endpoint only sees the staged file after a push triggers a rebuild. The auto-published brief lands at https://www.sftimes.com/brief/YYYY-MM-DD/ within about 3 minutes of the push.

The stale-lock guard above is deliberately conservative: it deletes `.git/index.lock` only when `pgrep` finds no running git process, so it clears a crash leftover without ever racing a live git operation. If a lock exists AND a git process is running, the guard leaves it alone and the commit fails loudly, which is the correct behavior (see Stage 9 failure handling and the failure-modes section).

The editor's action in /brief-dashboard now covers the flagged set only: review each quarantined item, then promote (edit and accept) or reject. Promoted items are merged into that day's already-live edition rather than replacing it, so the auto-published items are never dropped by a later promote.

## Stage 10: Notification

The task ends by outputting a structured summary that Cowork surfaces to the editor:

"Today's Brief published. P items cleared the audit and are live at /brief/YYYY-MM-DD/. F items were flagged and are waiting for review at /brief-dashboard."

Include the date and the audit split (how many cleared all five checks, how many the auditor flagged and why) so the editor knows what is live and what needs their attention. When F is zero, say so plainly: nothing needs the editor that day. When P is zero, say that no edition published and the day's items are all flagged.

## Idempotency

If today's edition file already exists (e.g., task re-ran): do NOT recompose or overwrite it. The edition is the live reader surface and may already carry editor-promoted items merged in after publish. Log that the edition exists and skip Stage 6a.

If today's staging file already exists (e.g., task re-ran):
- Read the existing staging file
- If the flagged set is identical, exit without committing
- If the flagged set changed, overwrite the staging file and commit with an amended message

Idempotency is safe for the staging file because it is not the reader surface. It is NOT safe for the edition file, which is why re-runs skip Stage 6a rather than rewriting it.

## Success report

At end of run, output a structured summary:

```
Brief YYYY-MM-DD
- Ingested: X candidates
- Rejected at scoring: Y
- Rejected at brief-worthy: Z
- Drafted: N
- Audit split: P cleared all five checks (auto-published), F flagged (staged)
- Edition: №E at https://www.sftimes.com/brief/YYYY-MM-DD/ (or "none, zero items cleared audit")
- Elapsed: MMm SSs
- Git commit: SHA (edition and/or staging file, committed and pushed)
- Flagged items to review at: https://www.sftimes.com/brief-dashboard (or "nothing flagged")
```

## Failure modes

If any bash command fails, log the exact error and stop. Do NOT attempt aggressive recovery. Eric reviews the failure the next morning. Options:
- If RSS fetch fails on 1 source: continue with others. Log the failure.
- If RSS fetch fails on all sources: abort. No brief today.
- If git commit fails on `.git/index.lock` (a prior run crashed mid-commit): the Stage 9 stale-lock guard clears it automatically when no git process is running. If the commit still fails on the lock, a git process really is running: abort and log; do not force-remove the lock.
- If git commit fails for another reason (e.g., merge conflict from concurrent Eric edit): abort. Log for morning review.
- If git push fails (e.g., auth): commit locally, log for Eric to push manually.
- If audit-passing edition markdown composition fails (e.g., LLM output malformed, edition number collision): abort auto-publish for the day, downgrade all items to the staging file (audit result attached), notify editor. Never push a broken edition.

## Cost expectations

Each run consumes:
- Cowork agent reasoning quota (60 candidates × 4 stages, but stages 2-5 are only for the ~10-15 that survive scoring). Total: roughly 40-80 reasoning turns per run.
- Zero Anthropic API charges.
- Vercel: build minutes on push (typically 60-90 seconds).
- GitHub: negligible commit + push.

At Sonnet on Max, ~500-1000 tokens per turn, that's ~30-60k tokens per run. Well within Max's daily allowance.

## When Eric wants to change something

- Change RSS sources: edit Stage 1 list here AND scripts/brief-ingest.ts (kept in sync as authoritative source)
- Change AI prompts: edit BRIEF-MASTER-PLAN.md section 7
- Change publish time: `update_scheduled_task` on `brief-daily` with new cronExpression
- Pause the pipeline: `update_scheduled_task` on `brief-daily` with enabled=false
- Change what the audit flags: edit the Stage 5 checks here. In Path 3 the audit is a hard gate, not advisory: loosening a check widens what auto-publishes with no human in the loop, so treat any Stage 5 edit as a change to the publishing standard itself.

## Rollback

If the Cowork pipeline breaks or Eric wants the old API-based pipeline back:
- Re-enable Vercel crons (Settings → Cron Jobs → toggle on)
- Re-provision ANTHROPIC_API_KEY if rotated
- Ensure KV database still exists (or reprovision)
- Set `enabled: false` on the `brief-daily` scheduled task via update_scheduled_task
- API pipeline resumes autonomous operation

Both pipelines can coexist; only one should be active at a time to avoid duplicate publishes.
