# CLAUDE.md · Astro project handoff

This file is read automatically when you run `claude` from `/Users/eric/projects/sftimes/astro/`. It bridges Cowork (the planning/design agent) and Claude Code (you, the iterative file-edit agent).

---

## What this project is

Static publication built with Astro 4.16. Content is 57+ markdown story files plus best-of categories, hidden-spots, and personality quizzes. Deployed via git push to Vercel; lives at sftimes.com.

**The Exhibition Magazine design IS the production tree.** As of 2026-06, the redesign was promoted from `/exhibition/*` to root paths. Legacy keepers files are archived under `src/pages/_legacy/` and excluded from routing by the underscore-prefix convention.

| State | Files | Status |
|---|---|---|
| Exhibition system (production) | `src/pages/*.astro`, `src/layouts/ExhibitionLayout.astro`, `src/components/ExhibitionMasthead.astro`, `Placeholder.astro` | Active. This is what ships when Eric pushes. |
| Keepers system (legacy archive) | `src/pages/_legacy/*` | Excluded from routing. Kept for rollback safety. Don't import from here. |

`vercel.json` includes 301 redirects from old `/exhibition/*` URLs to root paths so any inbound links keep resolving during the transition.

---

## The master spec

`/Users/eric/projects/sftimes/MASTER-EXHIBITION.md` is the single source of truth for the Exhibition design system. Read it before making design changes. If the spec contradicts the code, fix the spec first then align the code.

There used to be a kitchen-sink template page (`exhibition/_template.astro`) — Astro's underscore-prefix convention excludes it from routing. Copy any block from it into a new page. The file is at `src/pages/_template.astro` post-migration; view its source for reference, not via URL.

---

## Division of labor

### Cowork handles
- Design system architecture (tokens, type scale, block library)
- New block design (when a reference shape doesn't have a recipe yet)
- Master spec updates
- Large multi-page refactors
- Audits + reports
- Branding decisions (palette, type family, voice)
- Editorial copy beyond simple swap-ins

### You (Claude Code) handle
- Filling content placeholders in template clones
- Building a new page from a copied template
- Bug fixes (broken links, wrong scope CSS, layout breaks)
- Adding/removing fields in content collection schemas
- Running `npm run dev` / `npm run build` and reading errors
- Photo wiring (matching markdown `hero_filename_hint` to actual `/public/heroes/*.jpg`)
- Per-page content edits when Eric drops text into chat
- Anything that benefits from `Read`/`Edit`/`Bash` in the actual repo

When in doubt: if it's a 1-file edit Eric describes in plain language, you do it. If it's an architecture call or a new block design, escalate to Cowork.

---

## Common tasks (recipes)

### 1. Build a new page

```bash
# Open the kitchen-sink template for reference (do NOT visit a URL — it's not routed)
src/pages/_template.astro

# Create new page at the desired path
cp src/pages/_template.astro src/pages/<new-slug>.astro
```

Then edit the new file:
- Update the `<ExhibitionLayout title=… active=…>` props
- Update the `<ExhibitionMasthead title=… subscript=…>` props
- Delete the blocks you don't need
- Fill in `[BRACKETED PLACEHOLDERS]` with real content
- Add the new route to the section nav in `ExhibitionLayout.astro` if it's a top-level page

Verify in dev mode at `http://localhost:4321/<new-slug>`.

### 2. Swap content on an existing page

Read the page file, find the visible English strings, edit in place. Most copy is hardcoded in the .astro file. Story/best-of content comes from `src/content/*/*.md`.

### 3. Add a new story

```bash
# Create the markdown file with required frontmatter (see src/content/config.ts for the schema)
src/content/stories/<YYYY-MM-DD>-<slug>.md

# Drop the hero photo
public/heroes/<YYYY-MM-DD>-<slug>.jpg

# That's it. The collection picks it up on next build.
```

If the story is part of a paid partnership, set the `sponsor` field in frontmatter:
```yaml
sponsor:
  name: "Local Coffee Co."
  url: "https://localcoffeeco.com"
```
The article page will auto-render the "IN COLLABORATION WITH" treatment + editorial firewall disclosure blocks.

### 4. Run the dev server

```bash
npm install   # if first time or after pulling
npm run dev   # serves on http://localhost:4321
```

### 5. Build for production

```bash
npm run build  # runs pre-guard → generate-responsive-heroes → astro build → post-guard
```

The post-guard fails if any neon-green `data-placeholder="true"` markers leak into rendered HTML. If it fails, real photos haven't been wired for some Placeholder usage. Look at the offending file listed in the error.

### 6. Photo wiring rule

Stories reference photos via `hero_filename_hint: "heroes/<YYYY-MM-DD>-<slug>.jpg"`. The `Placeholder.astro` component checks if `public/heroes/<that-name>` exists at build time. If yes → renders `<img>`. If no → renders the neon-green block and the guard fails. Match the names exactly.

### 7. Per-image focal points

When a hero photo crops awkwardly (subject out of frame), set the focal point in story frontmatter:
```yaml
hero_focal: "30% 40%"   # 30% from left, 40% from top
hero_focal: "right top"
hero_focal: "center 25%"
```
Default is `"center 25%"` which favors faces in the upper third. Use the dev-only page at `http://localhost:4321/focal-audit` to walk every photo at its current focal setting with a red crosshair overlay — handy for spotting bad crops at a glance. That page has `noindex` + robots disallow so it doesn't leak to production search.

---

## The commercial layer

`src/pages/partners.astro` is the conversion page. Nine packages across three sections:

| Section | Packages | Price range |
|---|---|---|
| Saturday Underwriting | Classified, Patron, Co-Presented | $149–$900 / saturday |
| Sponsored Articles | Profile, Feature, Bespoke | $1,500–$5,500 |
| Ongoing Partnerships | Quarterly, Founding Bundle, Pillar | $1,400–$18,000 / year |

Slot availability counts are hardcoded; update as real bookings come in. The live countdown to the first of next month is computed client-side from `Date()` so it always shows real numbers.

Homepage sponsor surfaces:
- **Presented-By strip** at the top — single line, links to `/partners#saturday`
- **Sponsored Article slot** — dynamic, pulls the most recent story with `sponsor` frontmatter set
- **Classifieds strip** at the bottom — six text-only slot lines

When sponsor slots are empty, copy promotes `/partners` instead of going dark.

---

## Cowork standing rules (apply to you too)

From `/Users/eric/projects/sftimes/cowork-rules.md`:

- No fabricated progress. "Nothing to report" is valid.
- Done means verified, not assumed. For deployed apps, done means live and verified.
- Secrets in env/.webhook files only. Never print values.
- Status reflects real work. Never "busy" without a real item count.
- Eric's voice: no em dashes, closed compounds (onsite, setup, followup, startup), no AI filler, direct operator tone.
- Decide the repeatable stuff. Bring Eric the calls that need a human.

End-of-session report format (when you do a chunk of work, summarize like this):

```
Status — one line: project, % complete, current phase
TL;DR — 2–4 lines, what got done this turn
Progress moved — what % was, what % is, why
Cowork next — short prompt for what Cowork should pick up
Code next — ready-to-run prompt for the next code task, or "no Code needed"
For you — anything Eric needs to do (ranked, urgent first)
```

---

## COMMIT SCOPE DISCIPLINE

Before any git commit, run `git status` and read every file listed. If the working tree contains files outside the explicitly-authorized scope (e.g., user said "commit the photos" but `git status` shows schema/content/route changes too), STOP. Surface the wider scope to the user with a 3-bucket proposal:

(a) all in one truthful commit with a comprehensive message,
(b) split into scope-bounded commits user approves per bucket,
(c) stash the unrelated changes and commit only the authorized scope.

Do NOT default to `git add -A` with a narrow message.

The pattern of scope-narrow message + scope-wide diff recurred 4 times in the 2026-06-04 session before this rule was written.

---

## Gotchas (things that will bite you)

1. **Local sandbox can't always run sharp.** Some environments fail to load the platform-specific sharp binary. The responsive image generator script catches this and exits 0 so build still passes; just no responsive variants get generated locally. Vercel handles it fine.

2. **Rollup arm64 module missing.** Mac with arm64 (M-series) sometimes hits `Cannot find module @rollup/rollup-darwin-arm64` or `linux-arm64`. Fix: `npm install @rollup/rollup-darwin-arm64 --no-save` (or `linux-arm64` if you're somehow on linux). Vercel doesn't hit this.

3. **CSS scope leaks.** Astro scopes `<style>` per component. If you write `.foo img { ... }` but `img` is rendered by a child component (like `Placeholder`), the rule won't apply. Use `:global(img)` to pierce the scope.

4. **The newsletter form has fixed IDs (`exNewsletter`, `exNlForm`, `exNlThanks`).** The inline JS at the bottom of `ExhibitionLayout.astro` finds them by ID. Don't rename without updating the script.

5. **Cutouts are disabled by design call.** `ExhibitionMasthead` still accepts a `cutouts` prop but always pass `cutouts={[]}`. Don't add photo cutouts to mastheads without checking with Eric first.

6. **The `active` prop on ExhibitionLayout** controls which section nav item is underlined. Valid values: `home`, `stories`, `best-of`, `hidden-spots`, `quizzes`, `about`, `support`. Pages outside those sections (like `/submit`) pass `active="home"` or just don't pass it.

7. **Underscore-prefixed pages are not routed.** `_template.astro`, anything in `_legacy/*`. To make something a real route, drop the underscore.

8. **Drawer label vs URL gap.** The drawer/section nav uses marketing labels ("Features", "Top Tier", "Unpublished", "Checkups", "Who We Are", "Keep It Alive"), but URLs still use the original slugs (`/stories`, `/best-of`, `/hidden-spots`, `/quizzes`, `/about`, `/support`). Labels and URLs are deliberately separable. Renaming URLs is a separate coordinated move.

---

## File map (most useful)

```
src/
├── layouts/
│   └── ExhibitionLayout.astro     ← Chrome + global CSS for the whole site
├── components/
│   ├── ExhibitionMasthead.astro   ← Giant Anton wordmark
│   └── Placeholder.astro           ← Image-or-fallback renderer with focal-point support
├── content/
│   ├── config.ts                   ← Zod schemas (stories, best-of)
│   ├── stories/*.md                ← 57+ stories (sponsored ones have `sponsor:` field)
│   └── best-of/*.md                ← Best Of categories
├── pages/
│   ├── index.astro                 ← Homepage (Exhibition design)
│   ├── partners.astro              ← Commercial page, nine packages
│   ├── about.astro, stories.astro, best-of.astro, ...   ← Top-level pages
│   ├── focal-audit.astro           ← Dev tool, noindex'd
│   ├── _template.astro             ← Kitchen-sink reference, not routed
│   ├── _legacy/                    ← Archived keepers system, not routed
│   ├── stories/[slug].astro        ← Dynamic article route (sponsored articles auto-disclose)
│   ├── best-of/[slug].astro        ← Dynamic best-of detail
│   └── quizzes/[slug].astro        ← Dynamic quiz route (uses legacy engine)
└── public/
    ├── heroes/                     ← All story photos here
    ├── best-of/                    ← Best-of category photos
    ├── team/                       ← Author headshots (eric.jpg, nicholas.jpg, daisy.jpg, kiwi.jpg)
    ├── fonts/anton/, fonts/inter-tight/   ← Self-hosted fonts
    └── quizzes/                    ← Legacy quiz engine JS + per-quiz configs
```

---

## When you finish a task

1. Build to verify: `npm run build` (or `npm run dev` then check the URL)
2. Update `/Users/eric/projects/sftimes/PROGRESS.md` if you shipped something meaningful
3. Report in the format above
4. Don't push to Vercel unless Eric explicitly says "push" or "deploy"

---

## Where to ask Cowork for help

If you hit something that's an architecture call, a brand decision, or needs a new block design, pause, report what you found, and ask Eric to escalate to Cowork. Don't invent design language. Don't introduce new tokens. Don't pick fonts.
