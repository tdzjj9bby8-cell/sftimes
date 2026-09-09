---
name: brief
description: Write and publish today's SF Times Daily Brief end to end. Use when Eric types /brief or asks to run, write, or publish the Daily Brief.
---

Publish today's SF Times Daily Brief. Do the whole job. Do not stop to ask me anything.

**Run every command from `~/projects/sftimes/astro`.** That directory is the git root and holds package.json; the npm scripts below do not exist anywhere else. `cd` there first if you are not already.

## Step 1 — gather

Run `npm run brief:prep`.

If it stops, stop and tell me why in one line. A stop here is a legitimate outcome: a weekend, a day already published, feeds down, or too few full articles retrieved. Do not work around it. Do not lower the 500-word floor.

## Step 2 — read

Read `brief-workpacket.md` completely, including the full text of every article. Not the headlines. The articles.

## Step 3 — write

Write `brief-drafts.json` in the schema the packet specifies.

Judge every candidate on merit. There is no regional quota and no requirement that San Francisco lead. The best story wins wherever in the Bay Area it happened.

Include every candidate id in the file. Ones you are not writing get `brief_worthy: false` and a real `reject_reason`.

**Rules that are enforced by code after you, so working around them only wastes the pass:**

- Every number in your copy must appear in the article body. Every quotation must appear verbatim. Every attribution must be one the article actually makes.
- Do not escalate certainty. If the article says proposed, alleged, or tentative, you say so too.
- Editor's notes are 90 to 165 words. **Use the range.** Some items deserve 95 words and some deserve 160. Do not write eight notes of the same length.
- Do not start more than two notes in an edition with the same word. Historically 62 percent of all notes have started with "The" or "San". Vary the opening.
- Vary the construction. The house move is to state a tension in one line and then support it. It is a good move and it has been used a hundred times. Some items should open with the concrete detail, the number, the scene, or the plain fact.
- One item per story. If two outlets have the same story, pick the better report and reject the other by id.
- **A missed edition is better than a padded one.** If only four stories are worth writing, write four. If none are, publish nothing and tell me.

Watch for stories that are not Bay Area news. Some national outlets in the feed carry out-of-region content that passes the domain filter.

## Step 4 — ship

Run `npm run brief:ship`.

That runs every editorial gate, builds the site to prove the edition compiles, commits, pushes, waits for Vercel, and checks the live URL. It stops at the first problem and says what happened.

If it stops, tell me the reason in one line and stop. Do not retry, do not edit the safeguards, do not push by hand.

## Step 5 — report

When it is live, tell me in this shape and nothing more:

- The live URL
- One line per published item: outlet, and the angle in a few words
- What you rejected and why, one line each
- Anything that looked wrong, in one line

No preamble. No summary of what you did. I watched.
