# SF Times — current state

Written 2026-09-11. Read this first in a new session, then `BRIEF-DAILY-PLAYBOOK.md` for how the daily run works.

---

## What SF Times is

An independent San Francisco news publication run by one person, Eric. Two products:

1. **The Daily Brief** — a weekday edition of 4 to 7 short items. Each item is one source article plus an angle the source coverage did not have. Live at `/brief/<date>/`.
2. **Features** — occasional 900 to 1,400 word original pieces at `/stories/<slug>/`. 64 published.

Astro static site, Vercel, repo `tdzjj9bby8-cell/sftimes`. **The `astro/` folder IS the git root.**

---

## The one rule everything else bends to

**A missed edition is better than a fabricated one.**

On 2026-07-15 the system drafted items from 600-character RSS snippets instead of real articles and produced an invented vote count, an invented quotation and an invented dollar figure. It all looked completely normal.

Every safeguard in this repository exists because of that day. **Do not weaken one to make a run succeed.** If a gate produces a false positive, fix the gate and add a test. Never lower a floor.

If only four stories are worth writing, publish four. If none are, publish nothing and say so. Never pad.

---

## How it is built, and why

Three stages for both products. The shape is the point:

```
code    gather, fetch and VERIFY source text     (no judgment)
agent   read the sources and write              (judgment only)
code    check the writing against the sources   (no judgment)
```

The agent never supplies its own evidence. It cannot tell the checker that a number was in the article, because the checker has the article and reads it. Rules live in code, not in prose an agent is asked to remember. That distinction was learned the hard way: the earlier design was a playbook, and it got skipped.

---

## Daily Brief

**Eric runs this each morning in Claude Code:**

```
cd ~/projects/sftimes/astro && read .claude/commands/brief.md and do exactly what it says, start to finish. Don't ask me anything.
```

Under it:

| Command | Does |
|---|---|
| `npm run brief:prep` | gates, ingests 32 Bay Area feeds, screens out-of-region, fetches real article bodies, writes `brief-workpacket.md` |
| *(agent writes `brief-drafts.json`)* | the only judgment step |
| `npm run brief:review` | every gate, publishes nothing |
| `npm run brief:ship` | gates, build, commit, push, verify live. One command. |

**Gates, in order:** weekday → idempotency → source health (60% of feeds) → out-of-region screen → **500-word floor per article** → editorial firewall (numbers, quotes, attribution, certainty, duplicate URLs) → near-duplicate removal → 60% single-outlet cap → 3-item floor → frontmatter validation → build → live check.

Expect roughly two thirds of candidates to be dropped. That is the system working.

**Coverage is the core Bay Area**, 32 feeds: SF 11, East Bay 8, South Bay 4, Peninsula 1, Bay Area wide 8. **No regional quota** — best story wins wherever it happened. `npm run brief:sources` checks they are all alive. San Mateo County is thin (one outlet) and Marin has none; Mercury News, East Bay Times, Marin IJ, SF Chronicle and SF Examiner all block automated reading and are listed as deliberately absent in `brief-ingest.ts`.

**Watchdog:** GitHub Actions, 11:07 PT weekdays, no API key. Its real job is catching mornings the prompt was never run.

---

## Features

**Scheduled Cowork task, 7am weekdays**, `sftimes-morning-articles`. It picks two subjects from `scripts/queue/articles/topics.json`, researches them with web search, and drafts. It stops for Eric's approval.

| Command | Does |
|---|---|
| `npm run article:prep -- --subject="..." --slug=... --urls=<file>` | fetches full text, enforces 500-word floor, 3-source floor, 2-load-bearing-source floor |
| *(agent writes `article-draft.json`)* | judgment |
| `npm run article:publish -- --slug=... --review` | firewall, writes to `article-review/`, publishes nothing |
| `npm run article:publish -- --slug=...` | writes the real article file |

**Source quality is the control that matters.** Sources are classified journalism / primary / supporting. Travel guides, listicles, Yelp, Wikipedia and content farms are supporting and **cannot carry a piece**; two load-bearing sources are required. This exists because the first real run cleared the three-source floor with four travel guides and would have published a tourist blog post under the masthead.

**Per-paragraph source mapping** is the long-form primitive. Every paragraph names the sources it came from. An invented sentence with no numbers and no quotations passes every other check; this is what catches synthesis turning into invention. It is a mitigation, not a guarantee.

Articles never auto-publish. Eric approves, then a human builds and pushes.

---

## Voice

Read `src/content/stories/2026-08-20-hunters-point-victorian-plaster.md` for the register. Specific, unhurried, no promotional language, no "nestled" or "hidden gem", the subject taken seriously.

**Measured across 18 editions, the Brief had drifted:** 49 of 102 editor's notes opened with "The", another 14 with "San". Notes clustered at 127 words inside a 90 to 165 range. Same rhetorical move — state a tension, then support it — roughly a hundred times. The daily prompt now carries explicit variety rules. Keep using the full range; keep varying the opening.

---

## Conventions

**Two Claudes commit here.** Claude Code (terminal) and Cowork (desktop app). Neither sees the other's session. Cowork commits locally and cannot push; Eric pushes.

Use the repo's own git identity. **Do not override it with `-c`.** Cowork commits carry:

```
Co-Authored-By: Claude (Cowork) <cowork@sftimes.local>
```

`astro/CLAUDE.md` documents this and lists the seven pre-convention commits. Claude Code flagged unattributed commits three sessions running; that flag is now answered, and re-raising it for trailer-carrying commits costs Eric attention he should spend on real ones.

**Never print secret values.** No API keys in logs or commits.

---

## State as of 2026-09-11

- **Editions live:** 2026-09-08, 09-09, 09-11. 09-10 was missed and deliberately not backfilled — publishing yesterday's news under yesterday's date today would be dating something that did not happen.
- **3 commits committed locally, not pushed.** Eric runs `git push origin main`.
- **Two feature drafts are waiting for Eric's approval** in `article-review/`: SF Neon, and the San Francisco Columbarium caretaker. Topics 2 and 3 are marked `drafted`. Nobody has read them yet.
- **Topic queue:** 27 open, 2 drafted, 1 dropped. Topic 1 (fortune cookie factory) was dropped for having no load-bearing sources; do not retry it without new reporting.
- **Feeds:** 31 of 32 healthy; NBC Bay Area was down on 09-11. Watch whether that persists.
- **Tests:** 40, all passing. `npm run brief:test`. Run after touching anything in `scripts/lib/`.

---

## Bugs already found and fixed, so they are not rediscovered

Each has a regression test.

| Bug | Why it mattered |
|---|---|
| Frontmatter date from the machine clock | Any run after 5pm Pacific dated the edition tomorrow |
| "67 percent" did not match a source printing "67%" | Removed true items |
| Unscoped range collapse rewrote "stories" as "s-ries" | Removed true items |
| A draft hedged with "may" read as certainty escalation | Removed a true item |
| A quote ending a sentence with a period did not match a source ending it mid-sentence with a comma | Removed three true items from three outlets in one run |
| `uniqueness_score: 0` passed validation, broke the Astro build | Green publish, red build, stale site |
| Volume cap sliced in source-list order | Adding feeds would have made coverage narrower, not wider |
| Fixed source-health floor of 4 | Every feed added made the check weaker |
| Topic queue claimed subjects before doing the work | A crashed run orphaned two subjects permanently |

**The pattern worth internalizing:** most of these were false positives, not missed fabrications. A check that fires on correct work does not make the publication safer. It teaches the operator to override it.

---

## What is deliberately not built

- **The Anthropic API path.** `.github/workflows/daily-brief.yml` is complete and tested with its schedule commented out. Unattended weekday publishing is one repository secret plus three uncommented lines, at roughly $2 to $4.50 a month. Eric chose subscription-only. Do not re-enable without asking.
- **A variety check** in assemble, flagging editions where notes cluster in length or opening. Offered, not built.
- **A regional floor.** Deliberately absent.
