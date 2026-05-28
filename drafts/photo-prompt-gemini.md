# Gemini photo-generation prompt for SF Times

**Use:** Paste the master prompt into Google Gemini (Imagen). Then for each shot, append the per-shot prompt with the specific subject, aspect ratio, and any extra direction.

**Editorial standards flag (read first):** SF Times' published standards page bans AI-written bylines. It does not currently address AI photography. Before any AI-generated image goes onto a public SF Times page, Eric should either (a) ban AI photography explicitly in the standards page, or (b) document a narrow allowance (for example: AI-generated category card art and abstract textures permitted, AI-generated images of real people or businesses banned). The default assumption in this file is that Gemini output is used for staging review only and gets replaced by real photography before launch.

---

## Master prompt (paste once at the start of a Gemini session)

> You are art-directing photography for SF Times, an independent San Francisco profile publication. The visual language is restrained, intimate, documentary. Reference aesthetic: Atavist Magazine for single-subject longform photography; Exhibition Magazine for editorial restraint and white space. Every image should look like it was shot by a working San Francisco photographer on a 35mm lens in available natural light, not staged in a studio.
>
> The brand palette is warm off-white (#f4f1ea), warm paper (#ebe6d8), deep ink (#181612), and an accent terracotta (#c8542c) for design only, not for photography. Photographs should feel quiet, true, slightly melancholy. Color in-camera, not over-saturated. Slight grain is welcome. The light is morning fog light or late afternoon side light, never midday glare and never harsh artificial.
>
> Hard rules: no logos, no signage with brand names, no recognizable celebrity faces, no overlaid text. People's faces, when shown, are realistic, ordinary, not model-perfect. Hands have five fingers, doors have two hinges, no melted geometry. Composition prioritizes negative space, off-center subjects, layered foreground/background, real depth of field. Avoid the stock-photo look: no over-smiled faces, no posed handshakes, no blurred "city skyline at golden hour" cliches, no fake bokeh.
>
> When I provide a shot brief, render the image at the aspect ratio I specify and at the highest resolution available. Default to a 35mm prime lens look (50mm equivalent) unless I say otherwise. Default to a fixed shallow depth of field (f/2 to f/4). Default to natural color grading.

---

## Per-shot prompt templates

Use the right template by use case. Drop in the specifics in brackets.

### Hero image (article page, immersive layout)

Aspect ratio: 21:9. Used at full-bleed across the top of an article.

> Shot brief: a [SUBJECT, one sentence: who or what, where, at what moment, e.g. "67-year-old Korean tofu shop owner Mrs. Kim at her tofu press, 5:48 a.m. Tuesday morning, on Geary Street, San Francisco"]. Composition: wide horizontal, subject placed off-center, [neighborhood texture/context] visible in the background, [natural light source: morning fog, side light through window, etc.]. Mood: quiet, observational, the kind of moment a reader notices before the subject does. Aspect ratio 21:9, high resolution.

### Story card image (homepage archive grid, /stories page, "read next" cards)

Aspect ratio: 5:4 (homepage and archive) or 4:3 (read-next).

> Shot brief: a [SUBJECT in a single defining gesture: pouring, sweeping, mending, listening]. Composition: medium shot, subject's hands or face are the focal point, neighborhood detail in soft background. [Light note.] Mood: intimate, unposed. Aspect ratio 5:4, high resolution.

### Best Of category card (Korean BBQ, Date Night, etc.)

Aspect ratio: 4:3. Used as the category tile on the Best Of index page.

> Shot brief: a still-life or scene that represents [CATEGORY] without showing any specific restaurant logo or signage. For example: a hand reaching for a banchan plate over a charcoal grill, lit from one window, real metallic tongs visible, kimchi color visible, no readable text in frame. Composition: top-down or 45-degree angle, generous negative space. Mood: appetite-forward but restrained, not overcrowded. Aspect ratio 4:3, high resolution.

### Hidden Spots card

Aspect ratio: 4:3. Used as the spot tile on the Hidden Spots page.

> Shot brief: a place rather than a person. A [SHORT DESCRIPTION: "a corner staircase with iceplant pushing through the cracks, southwest fog rolling in" or "an alley with a single lit window above a closed shop"]. The shot does NOT name or identify the location. No street signs, no addresses, no recognizable storefronts. The image conveys "you would notice this only if you had walked past it 100 times." Mood: hushed, almost private. Aspect ratio 4:3, high resolution.

### Team headshot (author page)

Aspect ratio: 1:1. Used in a circular crop on team and author pages.

> Shot brief: a portrait of [NAME], a [age and role, e.g. "33-year-old reporter for SF Times"], shot in a natural environment, not a studio. They are looking just past the camera or down at their notebook, not directly into the lens. Light: window light, single source. Color: natural skin tones, no warm filters. Background: a softly out-of-focus interior or street scene. The portrait reads as the kind of photograph a friend took, not a corporate headshot. Aspect ratio 1:1, high resolution.

### OG / share image (sitewide social preview)

Aspect ratio: 1200x630 (close enough to 1.91:1).

> Shot brief: a singular SF image that represents the publication without being a cliche. NOT the Golden Gate, NOT Painted Ladies, NOT a cable car. Examples that would work: morning fog rolling over the Outer Richmond, a hand-painted shop sign in Chinatown, an empty Muni 38 at 6 a.m., the back of a person walking up Filbert Steps. Composition: wide, generous negative space on one side so the wordmark could overlay without crowding. Mood: this is a city someone loves quietly. Aspect ratio 1.91:1, 1200x630px minimum.

---

## Aspect ratio reference (matches the existing Astro Placeholder component)

| Use | Aspect | Pixel min |
|---|---|---|
| Article hero (immersive) | 21:9 | 2400 wide |
| Article hero (standard) | 5:4 | 1600 wide |
| Story card (homepage, archive) | 5:4 | 1200 wide |
| Read-next card | 4:3 | 800 wide |
| Best Of category card | 4:3 | 1600 wide |
| Hidden Spot card | 4:3 | 1200 wide |
| Team / author headshot | 1:1 | 800 wide |
| OG / share image | 1.91:1 | 1200x630 |
| Pull-quote interstitial (optional) | 16:9 | 2000 wide |

---

## Negative prompt list (append to any prompt if Gemini supports a negatives field, or include inline)

> NO: text overlays, logos, brand signage with readable names, recognizable real public figures, stock-photo smiles, posed handshakes, over-saturated colors, HDR look, midday harsh sun, lens flares, fake bokeh balls, blurred "city skyline at golden hour" clichés, melted hands, extra fingers, deformed objects, watermarks, AI-tell artifacts (smooth waxy skin, eyes that don't focus, repeating background patterns), Photoshop sky replacements, fake film grain that looks digital, model-perfect faces, "tech worker in hoodie at laptop" trope, anything that screams generic San Francisco.

---

## Shot brief library: the 57 article heroes

For each article in the archive, build a brief in this shape:

```
SUBJECT: [name, age, role from the article's hero_alt or caption]
MOMENT: [the specific time-and-place in the article's opening line]
PLACE TEXTURE: [neighborhood-specific environmental cue]
LIGHT: [time of day implied by the article]
EMOTION: [one word, e.g. patient, weary, quietly proud, mid-laugh, listening]
```

Then paste into the Hero template above. Filename matches the `hero_filename_hint` field in each article's frontmatter, currently `heroes/YYYY-MM-DD-slug.jpg`.

Example, Mrs. Kim:
```
SUBJECT: Mrs. Kim, 67, owner of the last Korean tofu house on Geary Street
MOMENT: 5:48 a.m. Tuesday, at her tofu press, first batch of the morning
PLACE TEXTURE: small shop interior, hand-painted red sign with white block letters visible faintly through the front window, steam, stainless steel
LIGHT: predawn, warm light from a single overhead bulb plus first cool blue light from outside
EMOTION: patient, focused, unhurried
```

---

## Workflow on Eric's end

1. Open Gemini, paste the master prompt at the top of the chat.
2. For each photo, build a shot brief and paste with the appropriate per-shot template.
3. Download the result at full resolution.
4. Save to `astro/src/assets/[heroes|best-of|team|hidden-spots]/[matching-filename].jpg`.
5. Run `npm run build` and confirm the placeholder guard now finds fewer offenders. Keep going until the guard passes.

If the editorial standards page is updated to permit AI photography in some narrow form, document that allowance and the prompt provenance (date generated, model version, prompt used) for every AI-generated image that ships. If the standards page bans AI photography, treat these Gemini outputs strictly as staging-review images and replace before launch.

---

## Future-proofing note

If real photography becomes available (own shoots, Kiwi the named photographer, freelance), retire this file. AI placeholders are a bridge to launch, not the destination. Real photography is what makes SF Times look like SF Times. The neon-green build guard exists for exactly this reason: forcing the discipline that the bridge is temporary.
