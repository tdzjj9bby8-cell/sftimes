# How to publish the Brief each morning

You run one prompt. Claude Code does the reading and writing. You approve. It goes live.

No API key. No cost.

---

## What you do

Open Claude Code in the `sftimes/astro` folder. Paste this:

```
Publish today's SF Times Daily Brief. Follow BRIEF-DAILY-PLAYBOOK.md.

1. Run: npm run brief:prep
2. Read brief-workpacket.md in full, including every article.
3. Write brief-drafts.json using the schema in the packet.
4. Run: npm run brief:assemble -- --review-only
5. Show me the edition and the run report. Stop there.

Do not publish. Do not commit. Do not push. I read it first.
```

It comes back with a draft edition. Read it.

If it's good, reply:

```
Publish it. Then build, commit, push, and verify with npm run brief:watchdog.
```

That's the whole job. Ten minutes on a normal day.

---

## What's actually happening

Three steps. Two of them are automatic.

**Step 1, automatic.** The computer collects today's news from 32 Bay Area sources, throws out anything already published, and then goes and downloads the actual full articles. Not the headlines. Not the little preview blurb. The real article text.

**Step 2, Claude Code.** It reads those articles and writes the Brief items. This is the only part that involves judgment, and it's the only part a person or an AI does.

**Step 3, automatic.** The computer checks every single thing Claude wrote against the real article text. Then it publishes.

---

## Why it's built this way

The old version was a list of rules written in a document, and Claude Code was asked to please follow them. It didn't always. Rules in a document are suggestions.

Now the rules are code. Claude Code doesn't get to decide whether the fact checking runs. It gets handed real articles, it writes, and the checks run on what it wrote whether it likes it or not.

It also can't cheat. It never gets to say "trust me, that number was in the article." The checker has the article and reads it directly.

---

## What gets caught

Step 3 kills an item if any of this is true:

- A number in the writeup isn't in the article. Dollar amounts, vote counts, percentages, dates.
- A quote isn't in the article word for word.
- It says someone said something the article doesn't say they said.
- The article says "proposed" and the writeup says "approved." Or "may" became "will."
- The writeup is about a story that was never downloaded in step 1. This is the big one. It means the story was made up.
- The editor's note is shorter than 90 words or longer than 165.
- Two items are about the same thing.
- More than 60% of the edition came from one outlet.
- The story already ran in a previous edition.

If fewer than 3 items survive, nothing publishes. That's on purpose.

---

## The rule everything else bends to

**A missed day is better than a made up day.**

On July 15 the system wrote an item off a 600 character preview snippet instead of the real article. It invented a vote count, invented a quote, and invented a dollar figure. All of it looked completely normal.

That's why step 1 downloads real articles, and why step 3 exists.

So: if only four stories are worth writing about, publish four. If none are, publish none. Never pad it out to look full.

---

## Where the news comes from

32 outlets across the core Bay Area, checked live and all working:

- **San Francisco (11):** Mission Local, SF Standard, SFist, 48 Hills, SF Public Press, The Frisc, Eater SF, Hoodline, SF Bay View, Streetsblog SF, SF YIMBY
- **East Bay (8):** Berkeleyside, Berkeley Scanner, The Oaklandside, Oakland North, Richmondside, Alameda Post, Pleasanton Weekly, Contra Costa Herald
- **South Bay (4):** San José Spotlight, Palo Alto Online, Mountain View Voice, Palo Alto Daily Post
- **Peninsula (1):** The Almanac
- **Bay Area wide (8):** KQED, ABC7, NBC Bay Area, KTVU, KRON4, SFGate, Local News Matters, CalMatters

**There's no regional quota.** Best story wins wherever it happened. The prep report shows you the day's spread so you can see it, but nothing enforces a balance.

**Two known gaps.** San Mateo County is thin, one outlet. Marin has none. The Mercury News, East Bay Times, Marin IJ, SF Chronicle and SF Examiner all block automated reading, so they're absent on purpose rather than by oversight. If a working feed shows up for any of them, add it.

Run `npm run brief:sources` any time to check every feed is still alive. Feeds die quietly, and a dead feed doesn't announce itself.

---

## Things that will look like problems but aren't

**"It threw out most of the stories."** Expect that. Today it kept 14 out of 49 tried. Articles under 500 words get dropped because there isn't enough text to check the writeup against. Short wire copy, photo galleries, and paywalled stories all fail. This is the system working.

**"It only found four items."** Fine. Publish four.

**"It refused to publish."** Read the reason in the run report. Don't override it.

Do not lower the 500 word floor to get more stories through. That floor is the thing that stops July 15 from happening again.

---

## When something breaks

| What you see | What it means | What to do |
|---|---|---|
| "only N of M feeds responded" | The news sources are down, not the news | Run `npm run brief:sources` to see which. Don't publish. |
| "Only N articles could be retrieved" | Not enough material today | Try `--max=20`, or skip the day |
| "quality floor not met" | Too much got filtered out | Read which check killed it. Don't override. |
| "No prepared candidate with this id" | Claude Code wrote about a story it was never given | Redo step 2. If it repeats, tell me. |
| "Drafts file is for [older date]" | Yesterday's file is still sitting there | Delete `brief-drafts.json`, redo step 2 |
| A number got flagged that IS in the article | The checker made a mistake | Tell me. I'll fix the checker, not loosen it. |

---

## The safety net

Every weekday at 11:07am, GitHub checks the live site and asks one question: is today's Brief there?

If it isn't, you get an alert.

This costs nothing and needs no key. On a manual setup its real job isn't checking the site, it's **catching the mornings you forgot**. That's the thing that's actually been hurting the publication. Now you find out by 11am instead of three days later.

---

## The automatic version

There's a fully automatic version already built and tested. It publishes every weekday at 6am with nobody touching it.

It needs an Anthropic API key, roughly $2 to $4.50 a month. You said no, so it's switched off, not deleted. Turning it on is one setting plus uncommenting three lines. Nothing else would need to change.

It's in `.github/workflows/daily-brief.yml` if you ever want it.

---

## Files, if you're curious

| File | Kept in git? | What it is |
|---|---|---|
| `brief-workpacket.md` | No | Today's stories and their full text |
| `brief-drafts.json` | No | What Claude Code wrote |
| `review-edition-*.md` | No | The draft edition you read |
| `src/content/briefs/*.md` | Yes | The published edition |

The first three get rebuilt every morning. Nothing to manage.

---

## One more thing

If you ever change anything in `scripts/lib/`, run `npm run brief:test` afterward. It's 25 tests that take two seconds, covering the fact checking and the source fairness logic. Four real bugs have already been caught there.
