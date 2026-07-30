# BRIEF-WEEKLY-PLAYBOOK.md

Playbook for the scheduled Cowork task that produces the SF Times weekly digest, "This Week in SF." Referenced by task `brief-weekly-digest`. Update this doc to change behavior; the task prompt stays stable.

Companion to `BRIEF-COWORK-PLAYBOOK.md` (the daily Brief task). Same Path 1 editor-review model: the task drafts and stages, the editor reviews and publishes. Nothing publishes without the editor's direct approval.

Created: 2026-07-21.

## Purpose

Produce one weekly "This Week in SF" digest post. Read the week's published daily Briefs, pick the top items, add the editorial voice-add (a pattern-of-the-week note naming the through-line only we are drawing), and stage it for the editor. The task publishes nothing.

The weekly is the editorial layer on top of the daily Brief. The daily Brief is scannable news commentary. The weekly is the sense-making: what the week meant, the pattern behind the individual items, and what to watch next.

## Read first (required)

Before doing anything:
1. `/Users/eric/projects/sftimes/IDENTITY.md` — venture identity, voice, standards
2. `/Users/eric/projects/sftimes/BRIEF-MASTER-PLAN.md` sections 4 (format) and 7 (voice) — the editorial voice spec applies to the weekly too
3. `/Users/eric/projects/sftimes/BRIEF-COWORK-PLAYBOOK.md` — the daily task this builds on
4. `/Users/eric/projects/sftimes/CLAUDE.md` — project rules

## Schedule

Runs **Sunday 4:00 PM PT**, before Eric's Sunday 6 PM review. That timing means the week's digest is staged and waiting when Eric sits down for the weekly audit, and it covers the full Monday-through-Saturday publish week.

## Runtime model

Same as the daily task:
- No Vercel KV, no Anthropic API. You (the Cowork agent) do the reasoning yourself using the voice spec.
- Read/write state via git-tracked files. Full bash access.
- The task does NOT publish. It writes and commits a staging file (no push). Publishing is the editor's action in `/brief-dashboard/weekly`.

## Stage 1: Gather the week's briefs

Read every published daily Brief edition from `/Users/eric/projects/sftimes/astro/src/content/briefs/` whose `date` falls in the current week (Monday through Saturday, LOCAL date). Parse the frontmatter of each `YYYY-MM-DD.md` file.

Determine the ISO week id (`YYYY-Www`, e.g. `2026-W29`) and the week's Monday (`start_date`) and Sunday (`end_date`).

If zero published briefs fall in the week: do NOT write a staging file, do NOT notify. Log the empty state. There is no weekly without a week of briefs.

## Stage 2: Pick the top 5

Flatten every item across the week's editions. Rank by `composite_score`, highest first. Take the top 5. These become `top_stories`.

If the week has fewer than 5 total items, take what exists (3 to 5 is the target range; do not pad).

## Stage 3: Compose each top story

For each of the top 5, build the `top_stories` entry from the source brief item:
- `source_headline`, `source_outlet`, `source_url`, `source_date`, `category`: copy straight from the brief item.
- `one_line`: a single reader-facing sentence in SF Times voice. Derive it from the item's TLDR, tightened to one line. Specific: numbers, names, neighborhoods. No filler.
- `why_it_mattered`: extract the angle and backstory from the item's `editor_note` and `angle_statement`. This is the "why we bothered" line. One or two sentences, past tense (the week is over).

Do not recap the source article. The firewall from the daily Brief holds here too: the reader still clicks out to the reporter.

## Stage 4: Compose the pattern of the week

This is the reason the weekly exists. Read across all the week's items (not just the top 5) and find the cross-item connection: the structural pattern, the repeated theme, the through-line that no single daily item states on its own.

Write:
- `pattern_of_the_week.title`: a short display headline naming the pattern.
- `pattern_of_the_week.note`: 200 to 300 words in SF Times voice. State the pattern in the first sentence. Then show the evidence across the week's items. This is commentary, not summary.
- `pattern_of_the_week.connections`: a short list (2 to 5) of the specific items or threads this pattern connects. One line each.

If no honest cross-item pattern exists this week, say so plainly in a shorter note rather than forcing a connection. A weak invented pattern is worse than a modest true one.

## Stage 5: Compose coming-up

Collect the `what_to_watch` fields from across the week's items. Dedupe and tighten into `coming_up`: a short list of forward-looking bullets (specific dates, votes, deadlines, decisions). These are what next week is likely to turn on.

## Stage 6: Compose the intro

Write `intro`: two to four sentences setting up the week. Specific to what actually happened. This is the deck that shows on the landing page and in the RSS/social surfaces, so make the first two sentences stand on their own.

Set `ai_disclosure` to the collection default unless the week's process differed.

## Stage 7: Stage the weekly

Write all fields as a single staging file at:

`/Users/eric/projects/sftimes/astro/scripts/queue/YYYY-Www-staged.json`

(e.g. `2026-W29-staged.json`). One object carrying: `week_id`, `start_date`, `end_date`, `editor` ("Eric"), `intro`, `ai_disclosure`, `top_stories`, `pattern_of_the_week`, `coming_up`. This is the only artifact the task produces. The published markdown at `src/content/weeklies/YYYY-Www.md` is composed later by the editor's publish action, not here.

## Stage 8: Commit the staging file (no push)

```bash
cd /Users/eric/projects/sftimes/astro
git add scripts/queue/YYYY-Www-staged.json
git commit -m "Weekly staged YYYY-Www: digest drafted for editor review

- Top 5 items picked from the week's published briefs
- Pattern-of-the-week and coming-up composed from the week's editor notes
- No content collection file written, nothing published
- Auto-produced by scheduled Cowork task per BRIEF-WEEKLY-PLAYBOOK.md"
```

Do NOT push, and do NOT commit any file under `src/content/weeklies/`. The task's job ends at a committed staging file.

## Stage 9: Notification

Output a structured summary Cowork surfaces to the editor:

"This week's digest drafted (YYYY-Www). Top 5 items, pattern-of-the-week, and N coming-up bullets ready for review at /brief-dashboard/weekly. Task did NOT publish; editor approval required."

## The editor's action (Path 1)

Publishing is the editor's action in `/brief-dashboard/weekly`: the editor reviews the staged digest, edits the intro, the top-story lines, the pattern note, and the coming-up bullets, then hits publish. That composes `src/content/weeklies/YYYY-Www.md`, commits it via the GitHub Contents API, pushes to main, and triggers the Vercel rebuild. The weekly lands at `https://www.sftimes.com/this-week/YYYY-Www/` within 3 minutes of the editor publishing.

## Idempotency

If this week's staging file already exists (task re-ran): read it. If unchanged, exit without committing. If the digest changed, overwrite and commit with an amended message. Safe because the staging file is not the reader surface.

## Failure modes

- If a brief file fails to parse: skip it, log the failure, continue with the rest.
- If zero briefs in the week: abort cleanly, no staging file, no notification.
- If git commit fails (merge conflict from a concurrent edit): abort, log for Eric's Sunday review.

## When Eric wants to change something

- Change the top-N count: edit Stage 2 here.
- Change the schedule: `update_scheduled_task` on `brief-weekly-digest` with a new cronExpression.
- Pause: `update_scheduled_task` on `brief-weekly-digest` with enabled=false.
- Change the voice: edit BRIEF-MASTER-PLAN.md section 7 (shared with the daily task).
