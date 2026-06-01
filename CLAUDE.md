# CLAUDE.md · Astro project handoff

This file is read automatically when you run `claude` from `/Users/eric/projects/sftimes/astro/`. It bridges Cowork (the planning/design agent) and Claude Code (you, the iterative file-edit agent).

---

## What this project is

Static publication built with Astro 4.16. Content is 57 markdown story files plus 4 best-of categories. Deployed via git push to Vercel; lives at sftimes.com.

The site is mid-pivot from the original keepers design (lowercase Fraunces, terracotta accents, italic WONK) to a new Exhibition Magazine design (Anton gothic ALL CAPS, cream paper, hairline borders, dark footer). Both systems currently coexist:

| State | Files | Status |
|---|---|---|
| Keepers system (legacy) | `src/pages/*.astro` at root, `src/components/Header.astro`, `Footer.astro`, `PageMasthead.astro`, `src/styles/global.css` | Currently in production source. Eric has not pushed to Vercel yet. |
| Exhibition system (new) | `src/pages/exhibition.astro` + `src/pages/exhibition/*.astro`, `src/layouts/ExhibitionLayout.astro`, `src/components/ExhibitionMasthead.astro` | Sample preview. Lives at `/exhibition/*` routes. Goal is to swap this into production. |

Eric is reviewing the Exhibition sample locally (`npm run dev`). Don't push to Vercel without explicit approval.

---

## The master spec

`/Users/eric/projects/sftimes/MASTER-EXHIBITION.md` is the single source of truth for the Exhibition design system. Read it before making design changes. If the spec contradicts the code, fix the spec first then align the code.

The kitchen-sink reference page that shows every block with `[BRACKETED PLACEHOLDERS]` is at `src/pages/exhibition/template.astro`. Render it at `http://localhost:4321/exhibition/_template` after `npm run dev`. Copy any block from it into a new page.

---

## Division of labor

### Cowork handles
- Design system architecture (tokens, type scale, block library)
- New block design (when an Exhibition reference shape doesn't have a recipe yet)
- Master spec updates
- Large multi-page refactors
- Audits + reports
- Branding decisions (palette, type family, voice)

### You (Claude Code) handle
- Filling content placeholders in `template.astro` clones
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

### 1. Build a new Exhibition page

```bash
cp src/pages/exhibition/template.astro src/pages/exhibition/<new-slug>.astro
```

Then edit the new file:
- Update the `<ExhibitionLayout title=… active=…>` props
- Replace the `<ExhibitionMasthead title=… subscript=…>` props
- Delete the blocks you don't need
- Fill in `[BRACKETED PLACEHOLDERS]` with real content
- Add the new route to the section nav in `ExhibitionLayout.astro` if it's a top-level page

Verify in dev mode at `http://localhost:4321/exhibition/<new-slug>`.

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

---

## Production migration path (when Eric blesses it)

1. Diff `src/pages/exhibition/*.astro` against the current `src/pages/*.astro` to confirm content parity
2. Move files: `mv src/pages/exhibition/*.astro src/pages/`
3. Rename: `mv src/pages/exhibition.astro src/pages/index.astro`
4. Delete legacy: `rm src/components/Header.astro src/components/Footer.astro src/components/PageMasthead.astro`
5. Update `src/layouts/BaseLayout.astro` to point at the new chrome OR delete it if every new page uses `ExhibitionLayout` directly
6. `npm run build` and verify guard passes
7. `git add -A && git commit -m "ship exhibition design"`
8. Stop and confirm with Eric before `git push`

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

## Gotchas (things that will bite you)

1. **Local sandbox can't always run sharp.** Some environments fail to load the platform-specific sharp binary. The responsive image generator script catches this and exits 0 so build still passes; just no responsive variants get generated locally. Vercel handles it fine.

2. **Rollup arm64 module missing.** Mac with arm64 (M-series) sometimes hits `Cannot find module @rollup/rollup-darwin-arm64` or `linux-arm64`. Fix: `npm install @rollup/rollup-darwin-arm64 --no-save` (or `linux-arm64` if you're somehow on linux). Vercel doesn't hit this.

3. **CSS scope leaks.** Astro scopes `<style>` per component. If you write `.foo img { ... }` but `img` is rendered by a child component (like `Placeholder`), the rule won't apply. Use `:global(img)` to pierce the scope.

4. **Two collisions of CSS class names.** Old keepers system uses unprefixed names (`.page-head`, `.tier`, etc.). Exhibition uses `.ex-` prefix. Keep them separate. Don't mix.

5. **The exhibition newsletter form has fixed IDs (`exNewsletter`, `exNlForm`, `exNlThanks`).** The inline JS at the bottom of `ExhibitionLayout.astro` finds them by ID. Don't rename without updating the script.

6. **Cutouts are disabled by design call.** `ExhibitionMasthead` still accepts a `cutouts` prop but always pass `cutouts={[]}`. Don't add photo cutouts to mastheads without checking with Eric first.

7. **The `active` prop on ExhibitionLayout** controls which section nav item is underlined. Valid values: `home`, `stories`, `best-of`, `hidden-spots`, `quizzes`, `about`, `support`. Pages outside those sections (like `/exhibition/submit`) pass `active="home"` or just don't pass it.

---

## File map (most useful)

```
src/
├── layouts/
│   ├── ExhibitionLayout.astro     ← Chrome + global CSS for /exhibition/*
│   ├── BaseLayout.astro            ← Legacy chrome for keepers system
│   ├── ArticleImmersive.astro      ← Legacy story layout (still in production)
│   └── ArticleStandard.astro       ← Legacy story layout variant
├── components/
│   ├── ExhibitionMasthead.astro   ← Giant Anton wordmark
│   ├── PageMasthead.astro          ← Legacy keepers wordmark
│   ├── Header.astro                ← Legacy keepers header (lowercase Fraunces)
│   ├── Footer.astro                ← Legacy keepers footer
│   └── Placeholder.astro           ← Image-or-fallback renderer (used by both systems)
├── content/
│   ├── config.ts                   ← Zod schemas for stories + best-of
│   ├── stories/*.md                ← 57 stories
│   └── best-of/*.md                ← 4 categories
├── pages/
│   ├── index.astro                 ← Keepers homepage (current production)
│   ├── about.astro, partners.astro, ...   ← Keepers interior pages
│   ├── exhibition.astro            ← Exhibition homepage sample
│   └── exhibition/
│       ├── template.astro         ← Kitchen-sink reference: every block + placeholders
│       └── about.astro, stories.astro, ...   ← Exhibition sample pages
└── styles/
    └── global.css                  ← Legacy keepers tokens + reset
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
