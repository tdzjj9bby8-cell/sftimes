# Code prompt: Interlink the "Work With Us" pages across the site

**SHIPPED 2026-06-04 in commit `f88f2da`.** This document is preserved as a reference for the pattern + as a template for future similar interlinking work. File references below reflect the post-migration Exhibition tree (not the legacy Keepers layout that the original draft referenced).

## Why this exists

Eric flagged that the Partner packages / Tell us your story / Send a tip / We're hiring pages were buried in the footer and hard to find. He approved both a header surface and inline CTAs. This prompt was the spec Code executed.

## What to read first if running again

1. `/Users/eric/projects/mission-control/skills/voice-standards.md`
2. `/Users/eric/projects/sftimes/astro/src/layouts/ExhibitionLayout.astro` (the current header / drawer surface; the legacy `components/Header.astro` is the older Keepers layout, NOT what production uses)
3. `/Users/eric/projects/sftimes/astro/src/pages/stories/[slug].astro` (story page template; the legacy `layouts/ArticleImmersive.astro` is the older Keepers article layout, NOT what production uses)
4. `/Users/eric/projects/sftimes/astro/src/pages/about.astro`
5. `/Users/eric/projects/sftimes/astro/src/pages/support.astro`
6. `/Users/eric/projects/sftimes/astro/src/pages/team.astro` (confirm the `id="hiring"` anchor is present for the `/team#hiring` link target)

## Job 1: Drawer subgroup (post-migration equivalent of "header dropdown")

In `src/layouts/ExhibitionLayout.astro`:

The Exhibition system uses a drawer (hamburger-triggered) rather than a flat header nav. Add a labeled subgroup inside the drawer with the heading "WORK WITH US" and 4 sub-links underneath. Pure CSS, no JS required.

The 4 destinations:
- Partner packages → `/partners`
- Tell us your story → `/tell-your-story`
- Send a tip → `/submit`
- We're hiring → `/team#hiring`

Implementation guidance:
- Use the existing `.ex-*` token system (not legacy Keepers tokens like `.ui-label` or `.container-narrow`)
- Color via `var(--rule)` / `var(--paper-2)` etc., not the legacy palette
- Keep the existing drawer hierarchy intact, just add the WORK WITH US subgroup
- Subgroup label lowercase to match Exhibition tone: "work with us"

## Job 2: Article footer CTA cards (post-migration equivalent of "ArticleImmersive footer addition")

In `src/pages/stories/[slug].astro`, add a `.work-with-keepers` 4-card section between the optional sponsor-foot block and the existing READ NEXT section.

Suggested treatment:

```astro
<section class="work-with-keepers" aria-label="Work with the keepers">
  <h2 class="work-with-keepers__eyebrow">work with the keepers</h2>
  <div class="work-with-keepers__grid">
    <a href="/partners" class="work-with-keepers__card">
      <h3>Partner packages</h3>
      <p>Sponsor a saturday, a profile, a season, or a year. Real editorial firewall.</p>
    </a>
    <a href="/tell-your-story" class="work-with-keepers__card">
      <h3>Tell us your story</h3>
      <p>Operator, keeper, regular, kid with a paper route. Pitch us what you know.</p>
    </a>
    <a href="/submit" class="work-with-keepers__card">
      <h3>Send a tip</h3>
      <p>Anonymous if you want. We follow up on every one we can verify.</p>
    </a>
    <a href="/team#hiring" class="work-with-keepers__card">
      <h3>We're hiring</h3>
      <p>Student journalism roles. Paid. SF or Bay Area. See the open list.</p>
    </a>
  </div>
</section>
```

Style guidance:
- Grid: `repeat(4, 1fr)` desktop, `repeat(2, 1fr)` tablet, `1fr` mobile
- Card borders use `var(--rule)` matching the `.org` and `.tier` patterns elsewhere in the codebase
- Hover state: brand-accent underline drop
- Heading uses the `.ex-*` type scale
- Place the section AFTER any optional sponsor-foot block and BEFORE the READ NEXT grid

Refresh card descriptions before shipping if the destination pages have updated their stated value props.

## Job 3: About + Support page link strips

In `src/pages/about.astro` and `src/pages/support.astro`, add a `.work-with-strip` horizontal link row near the page footer. Same 4 destinations. Doesn't need the full card grid since these pages are content-heavy.

## Voice rules apply to all draft copy

- No em dashes anywhere
- No banned filler: leverage, utilize, comprehensive, robust, cutting-edge, seamlessly, vibrant, delve into, circle back, moving forward, synergy, in today's world
- Closed compounds: onsite, online, followup, setup, startup
- Voice: direct, operator, every word earns its place

## Pre-push verification checks

Updated for the post-migration architecture:
- `grep -c "—" src/layouts/ExhibitionLayout.astro src/pages/stories/\[slug\].astro src/pages/about.astro src/pages/support.astro` returns 0
- `grep -ciE "leverage|utilize|circle back|moving forward|touch base|reach out|hope this finds|synergy|delve into|seamlessly" src/layouts/ExhibitionLayout.astro src/pages/stories/\[slug\].astro src/pages/about.astro src/pages/support.astro` returns 0
- `npm run build` clean (98 pages, placeholder guard exit 0)
- Visual eye-test on Vercel preview: drawer subgroup opens with 4 sub-links, article footer 4-card section above READ NEXT, About + Support link strips visible near foot

## Commit scope discipline

Per the `## COMMIT SCOPE DISCIPLINE` section in `astro/CLAUDE.md` (added 2026-06-04 commit `4dcc1b6`): before committing, run `git status` and bucket changes. If you find files outside this prompt's scope, surface them and ask before committing. Do NOT default to `git add -A`.

For this specific prompt's scope, the 4 named files are:
- `src/layouts/ExhibitionLayout.astro`
- `src/pages/stories/[slug].astro`
- `src/pages/about.astro`
- `src/pages/support.astro`

If `support.astro` carries an unrelated pre-existing change (it did in the first run because of an entangled supporter-slot edit), surface it in the commit message rather than hiding it.

## Suggested commit message

```
Interlink Work With Us: drawer subgroup + article footer cards + about/support strips
```

If `support.astro` is entangled, append a parenthetical noting the entangled change.

## Historical note

The original draft of this prompt referenced legacy Keepers tokens (`.article-footer`, `.article-read-next`, `.ui-label`, `.container-narrow`, `components/Header.astro`, `layouts/ArticleImmersive.astro`). Those don't exist in the post-migration Exhibition tree. Code adapted on the fly in the 2026-06-04 run and shipped `f88f2da` cleanly. This refresh aligns the spec with what actually works in production.
