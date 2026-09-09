# Publishing the Brief

## What you do

Open Claude Code in `~/projects/sftimes/astro`. Type:

```
/brief
```

That's it. It gathers the news, reads the articles, writes the items, runs every check, publishes, pushes, and confirms the site is live. It reports back when it's done.

If something is wrong, it stops and tells you in one line. A stop is normal, not a breakage.

---

## What it does while you wait

**Gathers.** Pulls today's news from 32 Bay Area outlets, throws out anything already published, then downloads the actual full articles. Not headlines. Not preview blurbs.

**Writes.** Claude reads those articles and writes the items. This is the only part that involves judgment.

**Checks.** Every number, quote, and attribution in the writing gets checked against the real article text. Anything that fails is removed, not fixed.

**Ships.** Builds the site to prove the edition works, commits, pushes, waits for Vercel, then loads the live page to confirm a reader can actually see it.

Only step two involves Claude's judgment. The rest is code, so it can't be talked out of a rule.

---

## When it stops

| What it says | What it means |
|---|---|
| Weekend | The Brief is weekdays. Nothing to do. |
| Already published | Today's edition is out. Nothing to do. |
| Only N of M feeds responded | The news sources are down, not the news. Run `npm run brief:sources`. |
| Only N articles retrieved | Not enough material today. Skip the day. |
| Quality floor not met | The checks removed too much. Read the reason. Don't override. |
| Site does not build | Nothing was pushed. The error names the problem. |
| Push failed | The edition is committed and safe. Fix the remote, run `/brief` again. |
| Not live after four minutes | Pushed fine, Vercel is slow or broken. Check the Vercel log. |

**Never lower the 500-word floor to get more stories through.** That floor is why items can be fact-checked at all.

---

## The rules it works under

**A missed day is better than a made up day.**

On July 15 the system wrote an item from a 600-character preview snippet instead of the real article. It invented a vote count, a quote, and a dollar figure. All of it looked normal. That's why full articles get downloaded, and why everything written gets checked against them.

So: if only four stories are worth writing, it publishes four. If none are, it publishes nothing and says so. It never pads.

**Expect most stories to be dropped.** Roughly two thirds fail the word floor — short wire copy, photo galleries, paywalled pieces. That's the system working.

---

## Where the news comes from

32 outlets, core Bay Area:

- **San Francisco (11):** Mission Local, SF Standard, SFist, 48 Hills, SF Public Press, The Frisc, Eater SF, Hoodline, SF Bay View, Streetsblog SF, SF YIMBY
- **East Bay (8):** Berkeleyside, Berkeley Scanner, The Oaklandside, Oakland North, Richmondside, Alameda Post, Pleasanton Weekly, Contra Costa Herald
- **South Bay (4):** San José Spotlight, Palo Alto Online, Mountain View Voice, Palo Alto Daily Post
- **Peninsula (1):** The Almanac
- **Bay Area wide (8):** KQED, ABC7, NBC Bay Area, KTVU, KRON4, SFGate, Local News Matters, CalMatters

No regional quota. Best story wins wherever it happened.

**Known gaps.** San Mateo County has one outlet, Marin has none. Mercury News, East Bay Times, Marin IJ, SF Chronicle and SF Examiner all block automated reading, so they're absent on purpose. Add them if a working feed appears.

`npm run brief:sources` checks all 32. Feeds die quietly.

---

## The safety net

GitHub checks the live site at 11:07 every weekday and emails you if the Brief isn't there. Costs nothing, needs no key.

Its real job isn't checking deploys. It's catching the mornings you didn't run `/brief`.

---

## If you want to read it before it goes out

```
npm run brief:prep      then let Claude draft, then:
npm run brief:review    composes it through every gate, publishes nothing
npm run brief:ship      publishes
```

`/brief` skips the middle step. Use these on a day where you want to see it first.

---

## Other commands

| Command | What it does |
|---|---|
| `npm run brief:sources` | Check all 32 feeds are alive |
| `npm run brief:test` | 33 tests covering the fact checking |
| `npm run brief:watchdog` | Is today's Brief live right now? |

Run `brief:test` after touching anything in `scripts/lib/`. Six real bugs have been caught there.

---

## The automatic version

A fully automatic version is built and tested. It publishes every weekday at 6am with nobody touching it, and needs an Anthropic API key at roughly $2 to $4.50 a month. It's switched off, not deleted. Turning it on is one setting plus uncommenting three lines in `.github/workflows/daily-brief.yml`.
