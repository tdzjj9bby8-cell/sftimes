# SF Times rebuild: visual review checklist

Use this while walking the live preview at `http://localhost:4321` after `npm install && npm run dev`. Judge the bones, not the beauty. Neon-green blocks are intentional placeholders, ignore them.

Five page types. Spend 3-5 minutes per page. Note anything that bugs you on first look. Don't fix anything live, just write it down.

---

## What to ignore on every page (universal)

- Every neon-green block. That is a placeholder, by design. The label inside it tells you what the real photo will be.
- The fonts may look slightly off until you drop the woff2 files into `public/fonts/`. The shape is right, the type personality lands once Fraunces and Newsreader load.
- Empty states (Hidden Spots has no entries, Best Of category pages show two demo entries). Real data lands in v1.1.
- The neon-green "PHOTO MISSING" label visible on heroes is intentional and goes away when real images arrive.

---

## 1. Homepage (`/`)

**What it does.** Lead the reader into this week's feature, give them the archive to browse, point them at Best Of and Hidden Spots, capture an email.

**Check.**

- Hero feels like one thing. Big image, big title, deck, byline. Atavist-influenced.
- Title size on desktop: does the headline have room to breathe, or does it crash into the deck?
- Archive grid below: 3 columns desktop, 1 column mobile. The two slight vertical offsets (`cell--1` and `cell--3` push down by a few rems) should feel intentional, not broken.
- Best Of strip (4 cards in a row): aligned, equal heights.
- Hidden Spots block on paper-tinted background: empty state copy reads right.
- Newsletter form at the bottom: field + button on one line desktop, stacked mobile.
- Mobile (resize to ~380px): nav collapses to burger, sections stack cleanly, type stays readable.
- Animation: hover any archive card. The neon-green image should scale ~1.03 over ~400ms. Smooth, not jumpy.
- Animation: scroll. Cards fade in as they enter view. Once only, no re-trigger.

**Pass if.** Restrained, image-first feel. Plenty of white space. Nothing fights for attention.

---

## 2. Immersive article (`/stories/mrs-kim-tofu-house`)

**What it does.** Atavist-style long-scroll feature. Full-bleed hero, reading column, pull quote, end-of-story support CTA, three "read next" cards.

**Check.**

- Hero is roughly 92vh on desktop. Title sits on the hero, restrained.
- The italicized accent word in the title (e.g., "Geary Street") uses Fraunces italic with the wonky variation axis. Should feel deliberate.
- Reading progress bar at the very top: as you scroll, the terracotta fill grows left to right.
- Drop cap on the first paragraph (the `It` in "It is 5:48 in the morning..."). Big Fraunces letter floats left of the rest.
- Reading column max-width feels like a book column, not the full page width.
- Pull quote (mid-article): full-width break, big Fraunces type, ornament lines above and below.
- End-of-article support block on paper-tinted background.
- Three "read next" cards at the bottom: same hover scale as the archive cards.
- Mobile: hero scales down, title shrinks gracefully, drop cap still works.

**Pass if.** The reading experience feels calm. The eye moves down the column without effort.

**Toggle test (optional).** If you want to see the Standard layout, edit any `src/content/stories/*.md` frontmatter and set `immersive: false`. That story will switch templates on next dev reload. Revert when done.

---

## 3. Standard article (set `immersive: false` on any story to test)

**What it does.** Lighter, faster-reading template for routine pieces. Same content, no full-bleed hero, no parallax.

**Check.**

- Hero is now a normal image block inside the column (5:4 aspect), not full-bleed.
- Headline above the hero, deck above the hero. Reads more like a newspaper page than a magazine cover.
- Drop cap still works.
- Pull quote still works.
- Caption appears below the hero in caps.

**Pass if.** Reads faster than the immersive version. Same voice, less ceremony.

---

## 4. Best Of category (`/best-of/korean-bbq-sf`)

**What it does.** A curated list with the editorial firewall front and center. Differentiator vs. Infatuation / Eater / Hoodline.

**Check.**

- Header: category title in Fraunces, intro paragraph, last refreshed date + named editor.
- Editorial firewall block: paper-tinted, terracotta left border, copy explains the rules. This is the brand-defining moment for this page.
- Filter chips row: pill-shaped, "All" chip is active by default. Click another chip, active state should crossfade.
- Two demo entries below: numbered "1" and "2" in big Fraunces gray numerals, image left, body right (3-col grid on desktop, single column mobile).
- Promoted entry (#2) carries a small terracotta "Promoted" pill. Same visual treatment otherwise.
- Sponsor slot below entries: full-width neon-green block with label, shows where ad inventory lands.

**Pass if.** The editorial firewall reads obvious. The promoted entry is clearly labeled but not visually demoted.

---

## 5. Quiz (`/quizzes/mbti`)

**What it does.** Interactive personality inventory. JavaScript driven. Renders into `#quiz-root` once the page loads.

**Check.**

- Page loads with the intro (title, eyebrow, intro paragraph, time estimate, start button).
- Click start. First page of 10 Likert statements appears.
- Each item is a single statement with 5 radio buttons (Hard no, Not really, Sometimes, Sounds like me, That is exactly me).
- "Next page" button copy varies per page (Keep going, You are doing great, Halfway-ish, etc.).
- After all 60 items, results screen renders: type name, blurb in SF Times voice, three "reads" linking to stories or Best Of.
- Try clicking one of the "reads" links. It should land you on a real article page (e.g., `/stories/mrs-kim-tofu-house`).
- Hit refresh on the result screen: result should persist via URL hash so a friend can open the same link and see the same type.

**Pass if.** The whole flow works, the result voice sounds like SF Times, and the reads links go to real pages.

---

## What to write down as you review

Use this template per issue you spot:

```
[page] [issue]
  - severity: critical / important / polish
  - what i see:
  - what i expected:
```

When you finish, drop the list back here and the agent picks it up.

Hold pattern until then. No template edits in this turn.
