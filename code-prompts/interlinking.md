# Code prompt: Interlink the "Work With Us" pages across the site

Eric flagged that the Partner packages / Tell us your story / Send a tip / We're hiring pages are buried in the footer and hard to find. He approved BOTH the header dropdown AND inline CTAs.

## What to read first

1. `/Users/eric/projects/mission-control/skills/voice-standards.md`
2. `/Users/eric/projects/sftimes/astro/src/components/Header.astro` (current nav structure)
3. `/Users/eric/projects/sftimes/astro/src/layouts/BaseLayout.astro` (where Header is included)
4. `/Users/eric/projects/sftimes/astro/src/layouts/ArticleImmersive.astro` (article footer placement, especially the existing `.article-footer` + `.article-read-next` sections at line ~115)
5. `/Users/eric/projects/sftimes/astro/src/pages/about.astro`
6. `/Users/eric/projects/sftimes/astro/src/pages/support.astro`

## Job 1: Header dropdown

In `src/components/Header.astro`:

The current `nav` array (line 8) has 6 flat items: stories, best of, hidden spots, quizzes, about, support. Add a 7th item that opens a small dropdown menu exposing 4 links:

- Partner packages → `/partners`
- Tell us your story → `/tell-your-story`
- Send a tip → `/submit`
- We're hiring → `/team` (or whatever the careers page is — verify by reading)

Implementation guidance:
- Use CSS hover for desktop dropdown (no JS unless absolutely necessary; if accessibility requires keyboard support, add minimal toggle JS scoped to the dropdown)
- Mobile menu also needs the new "work with us" group exposed (not as a dropdown, just as a sub-section with the 4 links)
- Don't break the current `.site-nav__link.is-active` underline logic
- Use the existing typography + color tokens; don't introduce new design language
- Test that the existing 6 items still render cleanly

The label should be lowercase to match the existing nav style: "work with us"

## Job 2: Inline CTAs at article footers

In `src/layouts/ArticleImmersive.astro`, between the existing `.article-footer` block (~line 115) and the `.article-read-next` section (~line 128), add a new section that surfaces the 4 work-with-us pages. The pattern should match the existing editorial design language (not feel like banner ads).

Suggested treatment:

```astro
<section class="article-work-with-us container container-narrow" aria-label="Work with the keepers">
  <h2 class="ui-label article-work-with-us__eyebrow">work with the keepers</h2>
  <div class="article-work-with-us__grid">
    <a href="/partners" class="article-work-with-us__card">
      <h3>Partner packages</h3>
      <p>Sponsor a saturday, a profile, a season, or a year. Real editorial firewall.</p>
    </a>
    <a href="/tell-your-story" class="article-work-with-us__card">
      <h3>Tell us your story</h3>
      <p>Operator, keeper, regular, kid with a paper route. Pitch us what you know.</p>
    </a>
    <a href="/submit" class="article-work-with-us__card">
      <h3>Send a tip</h3>
      <p>Anonymous if you want. We follow up on every one we can verify.</p>
    </a>
    <a href="/team" class="article-work-with-us__card">
      <h3>We're hiring</h3>
      <p>Student journalism roles. Paid. SF or Bay Area. See the open list.</p>
    </a>
  </div>
</section>
```

Style guidance:
- Grid: `repeat(4, 1fr)` desktop, `repeat(2, 1fr)` tablet, `1fr` mobile
- Cards have generous padding, hairline borders matching `.org` and `.tier` styles already in the codebase, hover state that drops a brand-accent underline
- Heading style matches `.section-title` in scale
- The 4 card descriptions above are placeholders, voice-clean, edit if you want sharper copy

Refresh the copy in case any of those pages have updated their stated value props since this prompt was written.

## Job 3: About + Support page cross-links

In `src/pages/about.astro` and `src/pages/support.astro`, add a "Work with us" link strip near the page footer / bottom. Same 4 destinations. Treatment can be a simpler horizontal link row, doesn't need the full card grid since the page itself is content-heavy.

## Voice rules apply to all copy you draft

- No em dashes
- No banned filler (leverage, utilize, comprehensive, robust, cutting-edge, seamlessly, vibrant, delve into, circle back, moving forward, synergy, in today's world)
- Closed compounds (onsite, online, followup, setup, startup)
- Voice: direct, operator, every word earns its place

## Voice + integration checks before commit

- `grep -c "—" src/components/Header.astro src/layouts/ArticleImmersive.astro src/pages/about.astro src/pages/support.astro` returns 0 across all
- `grep -ciE "leverage|utilize|circle back|moving forward|touch base|reach out|hope this finds|synergy|delve into|seamlessly" src/components/Header.astro src/layouts/ArticleImmersive.astro src/pages/about.astro src/pages/support.astro` returns 0
- `npm run build` runs clean
- Visual eye-test on the active-branch preview after Vercel deploys: header dropdown renders on `/`, mobile menu shows the 4 work-with-us items, every article page has the new section above Read Next, About and Support have the link strip

## Commit scope discipline (standing rule)

Per the `## COMMIT SCOPE DISCIPLINE` section in `astro/CLAUDE.md` (added 2026-06-04 commit `4dcc1b6`): before committing, run `git status` and bucket changes. If you find files outside this prompt's scope (Header.astro, ArticleImmersive.astro, about.astro, support.astro), surface them and ask before committing. Do NOT default to `git add -A`.

## What to commit + push

Single PR or single commit with a truthful subject line, e.g.:

```
Add work-with-us interlinking: header dropdown + article footer CTAs + about/support cross-links
```

Push when build is clean.
