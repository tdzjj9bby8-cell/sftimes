# Code prompt: Ship the W22 batch + interlinking + all 2026-06-04 SF Times changes

This consolidates everything ready to publish from the 2026-06-04 Cowork session. Run it after the NursingFloor + Faith Hire Code work is settled. Comprehensive single-push sequence.

## What's queued from this session (pre-committed by Cowork in working tree)

1. **6 W22 articles** in `src/content/stories/`:
   - `2026-05-02-rose-the-ceramicist.md` (voice-cleaned, em dash fixed, caption made evergreen)
   - `2026-05-09-marcus-the-locksmith.md` (typo fix, voice clean)
   - `2026-05-16-826-valencia-tutor-room.md` (director anonymized: "Andrea Calderón" → "the program director" + pronouns)
   - `2026-05-23-hand-foot-tailoring.md` (voice clean)
   - `2026-05-30-olive-branch-roasters.md` (voice clean)
   - `2026-06-06-zareens-fourth-kitchen.md` (polished with real Verde Mag + Stanford Daily + Palo Alto Online quotes, customer interviews, soft-opening framing, evergreen timing). **Sahlik approval received 2026-06-04.**

2. **6 hero photos** in `astro/public/heroes/` + **3 best-of category covers** in `astro/public/best-of/`

3. **Support page (`src/pages/support.astro`):**
   - 75/25 percentage layout collision fixed (column 220px → 320px, max font 130px → 100px, alignment switched, label padding added)
   - 15 Founding Supporters section added with placeholder Bay Area names, slot 16 invites next pledge

4. **Partners page (`src/pages/partners.astro`):**
   - The Pillar: "1 of 1 slot open for 2026" → "3 of 3 slots open for 2026" + bullet "Three pillars per year, limited"
   - The Founding Bundle: "5 of 12 bundles remaining" → "5 of 24 slots open" + cap line updated

5. **Sponsorship deck (`src/pages/sponsorship-deck.astro`):**
   - Caption synced: "Founding Bundle slots open: 5 of 24. Pillar slots open: 3 of 3 for 2026."

6. **`_quarantine-verification-failed/README.md`** — leftover from a quarantine that got resolved. Folder is harmless (Astro ignores `_` prefix) but you can clean it up with `rm -rf src/content/_quarantine-verification-failed/`.

## Stage 1: Run the interlinking spec

Read `astro/code-prompts/interlinking.md` in full. Execute it: header dropdown for "Work With Us," article-footer CTAs on `src/layouts/ArticleImmersive.astro`, About + Support cross-link strips. Voice rules apply to all copy you draft.

After implementation:
- `npm run build` clean (no placeholder guard halts)
- `grep -c "—"` returns 0 across edited files
- `grep -ciE "leverage|utilize|circle back|moving forward|touch base|reach out|hope this finds|synergy|delve into|seamlessly"` returns 0

## Stage 2: Investigate working tree + propose split commits

Per the COMMIT SCOPE DISCIPLINE rule in `astro/CLAUDE.md`, do NOT `git add -A`. Investigate `git status`, sort changes into logical buckets, propose split commits to Eric, wait for approval per bucket.

Expected buckets based on this session's work:
- **Bucket A: W22 article batch** — 6 stories in `src/content/stories/`
- **Bucket B: Hero photos + best-of covers** — 9 image files in `public/`
- **Bucket C: Support page** — `src/pages/support.astro` (layout fix + supporter section)
- **Bucket D: Partners + sponsorship deck** — slot count updates
- **Bucket E: Interlinking** — Header.astro, ArticleImmersive.astro, about.astro, support.astro (additions from Stage 1)
- **Bucket F: Quarantine cleanup** — `_quarantine-verification-failed/README.md` deletion or final readme update
- **Bucket G: Code prompts** — anything new in `code-prompts/`

Surface the buckets. Eric approves which to commit and in what order.

## Stage 3: Voice + build verification before push

For each commit Eric approves:
- `npm run build` clean
- Voice audit on edited files: 0 em dashes, 0 banned filler, closed compounds
- For HTML/JSX changes: `npx tsc --noEmit` (if applicable)

## Stage 4: Push to main, trigger Vercel

Once Eric approves the commits, `git push origin main`. Production deploy is pre-authorized for SF Times per Eric's 2026-06-04 standing direction. Report the Vercel deploy URL.

## Stage 5: Post-deploy smoke test (output for Eric, do not run yourself)

Output a checklist for Eric to run after Vercel finishes deploying:
- `https://sftimes.com/` renders without layout shift, carousel includes Zareen's
- `https://sftimes.com/stories/zareens-fourth-kitchen` renders with hero photo, sources block at bottom
- `https://sftimes.com/stories/[other 5 slugs]` render with their hero photos
- `https://sftimes.com/support` shows 75/25 percentages not crashing into headings, Founding Supporters section visible with 15 names + slot 16 CTA
- `https://sftimes.com/partners` shows "3 of 3 slots open for 2026" on Pillar, "5 of 24 slots open" on Founding Bundle
- Header "Work With Us" dropdown opens on hover, links to /partners /tell-your-story /submit /team
- Mobile menu shows the Work With Us group
- Article footer of any story shows the 4-card Work With Us section
- About + Support pages have the work-with-us link strip near the footer

## Hard rules

- No em dashes in any draft copy. Closed compounds.
- COMMIT SCOPE DISCIPLINE: investigate before committing, no `git add -A`, propose split commits.
- Force-push not pre-authorized. Production push to main IS pre-authorized for SF Times per Eric's standing call.
- Truth contract: don't fabricate progress. If a stage fails, report it and stop.

## When everything ships

Update `PROGRESS.md` and `HANDOFF.md` with what landed + Vercel deploy URL + 2026-06-04 date.
