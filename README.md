# SF Times — Astro rebuild

Static publication site. Markdown articles. Deploys to SiteGround.

## What this is

A complete Astro rebuild of sftimes.com:
- 57 features migrated from the legacy `js/app.js` DEMO data into markdown files.
- 4 Best Of category landing pages.
- Hidden Spots page (empty state, awaiting submissions).
- 12 static pages (homepage, about, support, standards, corrections, partners, team, submit, privacy, terms, 404, quizzes hub).
- Sitemap, RSS feed, NewsMediaOrganization schema, per-article NewsArticle schema, OG/Twitter cards.
- Production .htaccess with legacy URL 301s, gzip, cache headers, security headers.
- Neon-green placeholder system + production build guard.

The current live site at `/Users/eric/projects/sftimes/src/SFTIMES/` is untouched. This rebuild lives at `/astro/` alongside it.

## Stack

- **Astro 4** (static output, ships near-zero JS).
- **Self-hosted Google Fonts**: Fraunces (display), Newsreader (body), Inter (UI), JetBrains Mono (mono). All commercial-use OK. Drop variable-axis woff2 files into `/public/fonts/` per `public/fonts/README.md`.
- **No CMS.** Articles live in `src/content/stories/` as markdown. Schema in `src/content/config.ts`.
- **No JavaScript framework runtime.** A small amount of vanilla JS for the mobile menu, reading progress bar, and scroll-reveal observer.

## Setup (one time)

```bash
cd astro
npm install
```

Then drop the four font families into `public/fonts/` (see `public/fonts/README.md`).

## Daily workflow

### Dev server

```bash
npm run dev
```

Opens at `http://localhost:4321`.

### Add a new article

1. Drop the hero photo at `src/assets/heroes/YYYY-MM-DD-slug.jpg`. Optional until launch; placeholder used otherwise.
2. Create `src/content/stories/YYYY-MM-DD-slug.md`:

```yaml
---
title: "The Geary fishmonger who has cleaned 1.4 million fish"
title_em: "1.4 million fish"
deck: "Mr. Tanaka has worked the same counter at New Sun Market for 38 years."
author: Eric                       # Eric | Nicholas | Daisy
photographer: "Kiwi"
published: 2026-06-06
issue: 24
url_slug: "geary-fishmonger"
immersive: true
neighborhood: "Inner Richmond"
keeper_type: recipe                # recipe | routine | room | record | refusal
photo_class: cool
hero_alt: "Mr. Tanaka at the cutting board, 6:48 a.m. Saturday"
hero_filename_hint: "heroes/2026-06-06-geary-fishmonger.jpg"
caption: "Mr. Tanaka at the cutting board, 6:48 a.m. Saturday"
pull_quote: "A fish is the work of forty days of currents."
pull_quote_attr: "Hiroshi Tanaka, 64"
read_minutes: 9
is_featured: false                 # Set true to make this the homepage hero
---

Body content here. Markdown. Paragraphs separated by blank lines.
```

3. `npm run build`, then upload `dist/` to SiteGround.

### Build for launch (with real photos)

```bash
npm run build
```

This runs the placeholder guard before and after. If any neon-green placeholder or `data-placeholder` marker remains in `dist/`, the build hard-fails. This is the launch gate.

### Build for staging (placeholders allowed)

```bash
ALLOW_PLACEHOLDERS=1 npm run build
```

Use for design review only. Do not deploy this to the production URL.

### Build without the guard chain (raw Astro)

```bash
npm run build:dev
```

Skips the guard. Useful for debugging Astro itself.

## Deploy to SiteGround

```bash
# After build, dist/ contains the full static site.
# Upload contents of dist/ to your SiteGround public_html via SFTP or rsync.

# Example with rsync (replace USER/HOST):
rsync -avz --delete dist/ USER@HOST:~/www/sftimes.com/public_html/
```

The .htaccess in `dist/` handles HTTPS forcing, legacy URL 301s (story.html?slug=X → /stories/X/), gzip, cache headers, and security headers.

## Replacing placeholders with real photos

The neon-green placeholder (`#39FF14`) is the single source of truth. To swap:

1. Drop the real image into `src/assets/heroes/` (or wherever the `hero_filename_hint` points).
2. Update the article markdown's `hero_filename_hint` to match.
3. Replace `<Placeholder>` usage in templates with Astro's `<Image>` component (per-template change in `ArticleImmersive.astro`, `StoryCard.astro`, etc.) OR keep the `Placeholder` component but point it at real image URLs.
4. Run `npm run build`. Guard scans `dist/` for `#39FF14`, the rgb equivalent, and `data-placeholder="true"`. If clean, build passes.

The guard's exact scan logic lives in `scripts/check-placeholders.mjs`.

## Re-running the migration

Idempotent. Overwrites existing markdown:

```bash
npm run migrate
```

Reads from `../src/SFTIMES/js/app.js` DEMO data and rewrites `src/content/stories/` + `src/content/best-of/`.

## File map

```
astro/
├── package.json            # scripts: dev, build, build:dev, preview, migrate, guard
├── astro.config.mjs        # site URL, sitemap integration, view transitions config
├── tsconfig.json
├── scripts/
│   ├── migrate-articles.mjs    # one-shot: DEMO → 57 markdown files
│   └── check-placeholders.mjs  # pre/post build guard for #39FF14
├── public/
│   ├── .htaccess           # SiteGround routing, gzip, cache, security
│   ├── robots.txt
│   ├── favicon.svg
│   ├── og-image.svg
│   └── fonts/              # drop variable woff2 files here
├── src/
│   ├── content/
│   │   ├── config.ts       # schema for stories + best-of
│   │   ├── stories/        # 57 .md files
│   │   └── best-of/        # 4 .md files
│   ├── pages/
│   │   ├── index.astro              # homepage
│   │   ├── stories/index.astro      # archive
│   │   ├── stories/[slug].astro     # 57 article pages
│   │   ├── best-of/index.astro      # Best Of index
│   │   ├── best-of/[slug].astro     # 4 category pages
│   │   ├── hidden-spots.astro
│   │   ├── about.astro / support.astro / standards.astro / etc.
│   │   ├── quizzes.astro
│   │   └── rss.xml.js
│   ├── layouts/
│   │   ├── BaseLayout.astro         # head, meta, schema, ViewTransitions
│   │   └── ArticleImmersive.astro   # Atavist-style full-bleed article
│   ├── components/
│   │   ├── Placeholder.astro        # neon-green block with alt + filename hint
│   │   ├── StoryCard.astro
│   │   ├── PullQuote.astro
│   │   ├── ReadingProgress.astro
│   │   ├── RevealObserver.astro
│   │   ├── Header.astro
│   │   └── Footer.astro
│   └── styles/
│       └── global.css       # all design tokens, fonts, animations
└── dist/                    # build output, ready to upload
```

## What's NOT in this build yet (v1.1 targets)

- Quizzes pages 1:1 (the hub exists; the five interactive quiz pages still need to be ported from the legacy site or rebuilt).
- Hidden Spots real entries (page renders empty state until submissions flow is wired).
- Best Of real entries (category pages have placeholder entries; populate `src/content/best-of-entries/` collection when ready).
- ArticleStandard template (the standard / non-immersive variant for lighter pieces). Frontmatter flag `immersive: false` is supported but currently both routes go through ArticleImmersive.
- Stripe Checkout wiring (mailto fallback on support page for now).
- Newsletter provider wiring (form is structural; provider endpoint not posted to yet).
- Admin pages (legacy admin pages did not carry forward; use Supabase Studio or your CMS of choice if needed).
- Author archive pages.

## Known status notes

- Build: confirmed working in sandbox (303 files in dist/, all 57 article pages render, build guard fires correctly on placeholder presence).
- Guard: scans for `#39FF14`, `rgb(57, 255, 20)`, `rgb(57,255,20)`, and `data-placeholder="true"`. Hard-fails on match. Override: `ALLOW_PLACEHOLDERS=1`.
- View transitions enabled site-wide (soft fade between routes, falls back to instant).
- All `prefers-reduced-motion` opt-outs in place.
- NewsMediaOrganization schema on every page; NewsArticle schema on every story.
