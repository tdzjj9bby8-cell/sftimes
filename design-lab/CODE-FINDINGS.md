# CODE-FINDINGS.md — Exhibition sample audit

Walked the rendered `/exhibition/*` routes against MASTER-EXHIBITION.md. Findings only, no fixes applied.

**Method note (honest limitation):** the Playwright browser bridge isn't available in this environment, so I could not do a pixel-level visual walk. Findings come from the **rendered HTML served by `npm run dev`** (Astro renders full server-side HTML in dev, including resolved `Placeholder` components) cross-checked against the MASTER spec and source. Purely visual breaks (overflow, z-index, spacing, font fallback flashes) would NOT be caught by this method. A human or a working browser pass is still needed for that layer.

**Coverage:** 16 of 17 routes returned 200 and were analyzed. `/exhibition/_template` returns 404 (see P2 below) — that's the only route not walked, and it's a dev-only reference page.

**Good news (no findings):** zero neon-green photo-not-loading placeholders on any page (all photos wired). Zero leaked legacy visual tokens (no Fraunces, no WONK, no terracotta) in any rendered page. Interior section-nav `active` states all correct.

---

## Pass 2 resolution log (Cowork-directed, verified against `npm run dev` on :4324)

**✓ RESOLVED this pass:**
- **P0 homepage refactor.** `exhibition.astro` now uses `<ExhibitionLayout active="home">` + `<ExhibitionMasthead>`. Rendered chrome matches the 15 interior pages exactly (utility bar, drawer, section nav with Home active, `#exNewsletter`, dark footer). Compiles clean, HTTP 200.
- **P0/P1 homepage legacy links.** All chrome + content links now resolve to `/exhibition/*`. Zero legacy keepers routes remain (the 10 `/stories/<slug>` article links are intentionally kept, since the Exhibition article page isn't ported).
- **P1 homepage title.** Now `THE KEEPERS · SF TIMES` (was `the keepers. — sf times (exhibition preview)`).
- **P1 title-separator em-dashes.** Every `/exhibition/*` page title now uses ` · ` (middot). MASTER-EXHIBITION.md + astro/CLAUDE.md instructional em-dashes also cleaned (the report-format template block in CLAUDE.md was left as Cowork's canonical format).
- **P2 `_template` route.** Renamed `_template.astro` → `template.astro`; routes at `/exhibition/template` (HTTP 200).

**Still open (next pass):** the items below NOT struck through — body-copy em-dashes, story/best-of/quiz legacy card links, the shared-footer dead link, and the attribution case mismatch.

### Pass 3 resolution log (Cowork tasks D–H, verified against `npm run dev` on :4324)

**✓ RESOLVED this pass:**
- **D — body-copy em-dashes gone.** `grep -rn ' — '` across all exhibition pages + `ExhibitionLayout` + `ExhibitionMasthead` returns zero. Vbar attribution + story/article cites cleaned.
- **E — footer FOLLOW wired.** `mailto:hello@sftimes.com` in shared layout footer.
- **F — dynamic article route built.** `src/pages/exhibition/stories/[slug].astro` (getStaticPaths over the stories collection, `<Content />` from `s.render()`). Verified: `/exhibition/stories/mrs-kim-tofu-house` + `/ocean-beach-lifeguard` render HTTP 200 with full chrome, hero, deck, real markdown body (31 paragraphs), pull quote, and read-next strip.
- **G — story cards repointed.** Homepage (10), `/exhibition/stories` (57), `/exhibition/story` read-next (3) → `/exhibition/stories/<slug>`. Zero legacy `/stories/<slug>` links left.
- **H — attribution case normalized** to UPPERCASE (done as part of D).

**Still open (next pass):** best-of category detail (`/best-of/<slug>`) and quiz detail (`/quizzes/<slug>`) cards still point to legacy — no Exhibition detail route exists for either yet, so repointing would 404. Also: `/exhibition/story.astro` is now a redundant static demo (the dynamic route supersedes it) — candidate for deletion, Cowork call.

### Pass 4 resolution log (Cowork tasks I–K — sample now feature-complete; verified on :4324)

**✓ RESOLVED this pass:**
- **I — Best Of detail route.** `src/pages/exhibition/best-of/[slug].astro` (getStaticPaths over `best-of`). Hero + `.ex-prose` intro + editorial-firewall callout + in-progress empty-state (`DROPS Q3 2026`) + dual CTA (strip pattern: "SEND A PICK" mailto / "KNOW WHEN IT LANDS" → newsletter) + `<Content />` long-form body (renders when markdown is added; categories are currently empty so the empty-state shows) + 3-up read-next. All 4 slugs (korean-bbq-sf, date-night, family-owned, peninsula-coffee) render HTTP 200 with full chrome.
- **J — Quiz route.** `src/pages/exhibition/quizzes/[slug].astro` (5 slugs). Loads `/quizzes/<slug>.config.js` then `/quizzes/quiz-engine.js`, mounts into `#quiz-root`. All 5 render HTTP 200; engine + config + quiz.css all serve 200; config sets `window.SFTIMES_QUIZ`, engine targets `#quiz-root` + renders the Begin button. Live click-through not browser-tested this session (no Playwright bridge), but the full runtime chain is present and reachable.
  - Required a one-line layout enhancement: added `<slot name="head" />` to `ExhibitionLayout`'s `<head>` so pages can inject head elements (the quiz CSS link). Safe + reusable; no effect on pages that don't use it.
- **K — repoints + cleanup.** `best-of.astro` cards → `/exhibition/best-of/<slug>`; `quizzes.astro` tiles → `/exhibition/quizzes/<slug>`. Deleted the redundant `src/pages/exhibition/story.astro` (dynamic route supersedes it; `/exhibition/story` now 404, no inbound links). Zero legacy page links remain across exhibition pages.

**Note on Cowork's acceptance grep:** `grep -rn 'href="/stories\|href="/best-of\|href="/quizzes' …` returns exactly **1 hit** — the `<link href="/quizzes/quiz.css">` stylesheet asset in the quiz route. That's a legitimate static asset (the legacy engine's CSS lives at `/public/quizzes/quiz.css`), not a navigation link. All actual card/nav links are zero. Not changed, since the asset path is correct.

**Remaining open (all minor, no longer blocking a feature-complete sample):** best-of categories have no markdown body yet (empty-state shows by design); quiz UI uses the legacy engine's own classes inside `#quiz-root` (acceptable for sample, restyle on production migration).

---

## P0 — ESCALATE TO COWORK

- **✓ RESOLVED (pass 2).** ~~**`/exhibition` (homepage) does not use the Exhibition design system at all.**~~ Now refactored onto `ExhibitionLayout`; see resolution log above.
  Original finding: **`/exhibition` (homepage) does not use the Exhibition design system at all.** `src/pages/exhibition.astro` is a standalone HTML document — it writes its own `<html><head><body>`, imports only `getCollection` + `Placeholder`, and never imports `ExhibitionLayout` or `ExhibitionMasthead`. Consequences, all confirmed in render: no utility bar, no drawer menu, no section nav, no shared masthead component, own unprefixed `.masthead`/`.ft` CSS classes (outside the `.ex-` convention), and a newsletter form using `id="newsletter"` instead of the system's `id="exNewsletter"`. Every other page (15/15) uses `ExhibitionLayout`. The most important page is an island that won't inherit any future layout/spec change. **ESCALATE TO COWORK:** rebuilding the homepage onto `ExhibitionLayout` is a large multi-block refactor (Cowork territory per CLAUDE.md). Decision needed before I touch it: rebuild homepage onto the layout, or leave standalone? Stopping here on this item.

---

## P1

- **✓ RESOLVED (pass 2).** ~~**`/exhibition` — all homepage links point to legacy routes, not `/exhibition/*`.**~~ Every card, grid item, the "MORE KEEPERS" colmark, the "57 ISSUES" strip, the calendar, and the implied nav resolve to `/stories` (10x), `/stories/<slug>`, `/about`, `/best-of`, `/hidden-spots`, `/quizzes`, `/standards`, `/partners`, `/support`. Clicking anything on the exhibition homepage drops the user out of the preview into the old keepers site. (Subset of the P0 root cause, but independently real.)
- **✓ RESOLVED (pass 2).** ~~**`/exhibition` — homepage `<title>` is still old keepers voice.**~~ Renders `the keepers. — sf times (exhibition preview)`: lowercase, em dash, and a "(exhibition preview)" label. Every other page uses `UPPERCASE — The Keepers · SF Times`. Inconsistent and not production-ready.
- **✓ RESOLVED (pass 2 + pass 3).** Title separators are ` · ` (pass 2). Body-copy em-dashes killed (pass 3, task D): homepage vbar attribution now `{ATTR.toUpperCase()} · ISSUE №X →` (no leading dash, comma→middot, uppercased); `/exhibition/story` and the new `/exhibition/stories/[slug]` cites drop the leading dash. `grep -rn ' — '` across all exhibition pages + layout + masthead returns zero.

---

## P2

- **✓ RESOLVED (pass 2).** ~~**`/exhibition/_template` returns 404 — docs claim it renders.**~~ Renamed to `template.astro`; routes at `/exhibition/template`.
  Original finding: **`/exhibition/_template` returns 404 — docs claim it renders.** Astro excludes `_`-prefixed files from routing, so the kitchen-sink reference page is not reachable at `http://localhost:4321/exhibition/_template`. CLAUDE.md (line 26), MASTER-EXHIBITION.md (file map), and the `_template.astro` header comment all state it routes there. Either rename to drop the underscore (e.g. `template-reference.astro`) or fix the three docs to say "open the source file directly."
- **✓ RESOLVED (pass 3 + pass 4).** Story cards → `/exhibition/stories/<slug>` (pass 3, dynamic route via `s.render()`). Best-of cards → `/exhibition/best-of/<slug>` and quiz tiles → `/exhibition/quizzes/<slug>` (pass 4, tasks I–K): both detail routes now exist and all cards repointed. Zero legacy `/stories`, `/best-of`, `/quizzes` page links remain. The Exhibition sample is now feature-complete (all listing → detail flows work within `/exhibition/*`).
- **✓ RESOLVED (pass 3, task E).** ~~Stray dead `href="#"` footer "FOLLOW" link.~~ Now `mailto:hello@sftimes.com` in `ExhibitionLayout`'s shared footer — opens an email composer on every page.
- **✓ RESOLVED (pass 3, tasks D+H).** ~~Voice/case inconsistency in attributions.~~ Homepage vbar attribution is now uppercased to match the `BY ERIC` / `MRS. KIM · OWNER` pattern used everywhere else. No remaining sentence-case attributions/bylines spotted in the exhibition pages.

---

## Top 3 for Eric to decide before fixing

1. **Homepage: rebuild onto `ExhibitionLayout`, or leave standalone?** (P0) This is the big one. It's a multi-block refactor and it's why the homepage has no nav, wrong newsletter id, and legacy links. Cowork-sized. Everything else on the homepage flows from this call.
2. **Em-dash title convention** (P1) — the spec mandates ` — ` separators, which breaks your no-em-dash rule. Approve a replacement separator (`·`, `|`, or comma) and I'll fix the spec then every page title.
3. **`_template` reference page** (P2) — rename it so it actually routes, or keep it source-only and fix the docs? Quick either way, just need the call.
