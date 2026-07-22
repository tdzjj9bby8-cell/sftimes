import { defineCollection, z } from 'astro:content';

const stories = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    title_em: z.string().optional(),
    // Optional SEO title for search/social. If absent, ArticleImmersive
    // derives a short title from the headline. Keep under ~50 chars so the
    // full string + brand suffix fits Google's ~60-char display limit.
    seo_title: z.string().max(60).optional(),
    deck: z.string(),
    author: z.enum(['Eric']),
    photographer: z.string().default('Staff'),
    published: z.coerce.date(),
    issue: z.number().int().positive(),
    url_slug: z.string(),
    immersive: z.boolean().default(true),
    neighborhood: z.string().optional(),
    keeper_type: z.enum(['recipe', 'routine', 'room', 'record', 'refusal']).optional(),
    photo_class: z.enum(['warm', 'cool', 'green', 'dusk']).default('warm'),
    hero_alt: z.string(),
    hero_filename_hint: z.string(),
    /** Optional one-line clause for the homepage editor's paragraph.
     *  Should pair naturally with the title as a continuation, e.g.
     *  title: "Mrs. Kim's Tofu House" + lede_line: "still serving the same six bowls at 5:47 a.m."
     *  → reads as: "Mrs. Kim's Tofu House still serving the same six bowls at 5:47 a.m."
     *  Falls back to the first sentence of `deck` if absent. */
    lede_line: z.string().optional(),
    /** Focal point for object-position on cropped thumbnails.
     *  Format: "<x> <y>" with % or keywords. Defaults to "center 25%" so
     *  faces (which usually sit in the upper third of journalistic portraits)
     *  stay in frame when the image is cropped to a tighter aspect ratio.
     *  Override per-story when the subject is off-center, e.g. "30% 40%". */
    hero_focal: z.string().default('center 25%'),
    caption: z.string().optional(),
    pull_quote: z.string().optional(),
    pull_quote_attr: z.string().optional(),
    read_minutes: z.number().int().positive(),
    is_featured: z.boolean().default(false),
    /** Optional sponsor metadata. When set, the article is treated as a paid
     *  collaboration: "IN COLLABORATION WITH {name}" eyebrow on the article page,
     *  picked up by the homepage "Partner Feature" slot. Editorial firewall holds. */
    sponsor: z.object({
      name: z.string(),
      url: z.string().optional(),
    }).optional(),
    /** When true, this piece is an illustrative format sample — the subject, quotes,
     *  and details are constructed to demonstrate the article shape, not the result
     *  of actual reporting. The article page renders a visible disclosure banner. */
    is_sample: z.boolean().default(false),
  }),
});

const bestOf = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    url_slug: z.string(),
    intro: z.string(),
    editor: z.enum(['Eric']),
    last_refreshed: z.coerce.date(),
    hero_alt: z.string(),
    hero_filename_hint: z.string(),
  }),
});

/**
 * Daily Brief collection.
 *
 * Each markdown file in src/content/briefs/ represents one day's edition.
 * Filename pattern: YYYY-MM-DD.md (e.g., 2026-06-13.md).
 *
 * The Brief is curated commentary on the day's SF news, not aggregation.
 * Each item carries a TLDR, an editor's note that adds backstory/context
 * the source article does not have, a brief signal tag indicating why we
 * picked it, and a link out to the original reporter.
 *
 * Architecture: AI drafts via the prompts in BRIEF-MASTER-PLAN.md sections
 * 7.1-7.4. An AI auditor pass (7.4) gates auto-publish vs. held-for-editor.
 * Eric reviews held items each morning and publishes the daily edition by
 * 7:30 AM. Held items that don't get reviewed are dropped; auto-publishing
 * batch ships regardless.
 *
 * Permalink routes:
 *   /brief/                        latest published edition (canonical)
 *   /brief/[YYYY-MM-DD]/           specific day's archive entry
 *   /brief/[YYYY-MM-DD]/[slug]/    single-item permalink
 */
const briefs = defineCollection({
  type: 'content',
  schema: z.object({
    /** The date this brief was published, in YYYY-MM-DD form. Drives routing. */
    date: z.coerce.date(),
    /** Edition number. Increments by one each publish day. */
    edition: z.number().int().positive(),
    /** Named editor who published this edition. Currently only 'Eric'. */
    editor: z.enum(['Eric']),
    /** Optional editor's intro at the top of the brief page. */
    intro: z.string().optional(),
    /** AI assistance disclosure. Defaults to the standard statement;
     *  override if a specific day's process differs (e.g., manual draft). */
    ai_disclosure: z.string().default(
      'TLDRs and editor\'s notes drafted with AI assistance from source materials, audited by a second AI against the firewall rules, with editor review on held items and a weekly sample audit. AI does not write the news. Original reporting is always linked, always credited.'
    ),
    /** The items that appear in this edition. */
    items: z.array(
      z.object({
        /** Stable id for cross-day references and the dashboard audit log. */
        id: z.string(),
        /** URL slug for the permalink. Generated from the headline at publish. */
        slug: z.string(),
        /** Category tag. One of the 13 fixed taxonomy values. */
        category: z.enum([
          'TRANSIT',
          'HOUSING',
          'FOOD',
          'POLITICS',
          'TECH',
          'CULTURE',
          'ARTS',
          'BUSINESS',
          'PUBLIC SAFETY',
          'OPENINGS',
          'CLOSINGS',
          'WEATHER',
          'SPORTS',
        ]),
        /** Brief signal tag (the reader-visible badge). One of four values. */
        signal: z.enum(['first-to-connect', 'underreported', 'missing-context', 'structural-pattern']),
        /** Original source headline as published. */
        source_headline: z.string(),
        /** Outlet that ran the source story. */
        source_outlet: z.string(),
        /** Source reporter byline. 'Staff' if not visible. */
        source_byline: z.string().default('Staff'),
        /** Full URL to the source article. Required. The Brief firewall depends
         *  on the reader being able to click out to the original reporting. */
        source_url: z.string().url(),
        /** Date the source article was published, in YYYY-MM-DD form. */
        source_date: z.coerce.date(),
        /** The angle statement. Must match the first sentence of the editor's note. */
        angle_statement: z.string(),
        /** 25 to 30 word TLDR, two sentences, sentence case. */
        tldr: z.string(),
        /** 100 to 150 word editor's note in SF Times voice. Starts with the
         *  angle statement. Never recaps the source article. */
        editor_note: z.string(),
        /** One-line forward-looking note (the next decision date or vote). */
        what_to_watch: z.string(),
        /** Composite score from the primary AI pass scoring prompt. */
        composite_score: z.number(),
        /** Uniqueness score from the primary AI pass. */
        uniqueness_score: z.number().int().min(1).max(10),
        /** True if this item was auto-published (auditor passed all 5 checks).
         *  False if Eric manually accepted it after the auditor flagged it. */
        auto_published: z.boolean().default(true),
      })
    ),
  }),
});

/**
 * Weeklies collection · "This Week in SF" digest posts.
 *
 * Each markdown file in src/content/weeklies/ is one weekly digest.
 * Filename pattern: YYYY-Www.md (e.g., 2026-W29.md).
 *
 * The weekly is the editorial voice-add on top of the daily Brief: it reads
 * the week's published briefs, picks the top items, and adds a
 * pattern-of-the-week note that names the through-line only we are drawing.
 * Composed by the brief-weekly Cowork task (see BRIEF-WEEKLY-PLAYBOOK.md),
 * staged, then reviewed and published by the editor in /brief-dashboard/weekly.
 *
 * Routes:
 *   /this-week/            landing (all weeklies, newest first)
 *   /this-week/[week_id]/  single weekly post
 */
const weeklies = defineCollection({
  type: 'content',
  schema: z.object({
    /** ISO week id, "YYYY-Www" form. Drives routing and sort. */
    week_id: z.string(),
    /** Monday of the covered week. */
    start_date: z.coerce.date(),
    /** Sunday of the covered week. */
    end_date: z.coerce.date(),
    /** Named editor. Currently only 'Eric'. */
    editor: z.enum(['Eric']).default('Eric'),
    /** Editor's intro at the top of the post. */
    intro: z.string(),
    /** AI assistance disclosure, same style as the daily Brief. */
    ai_disclosure: z.string().default(
      'This digest is composed with AI assistance from the week\'s published Brief items, then reviewed and edited by Eric before publish. AI does not write the news. Original reporting is always linked, always credited.'
    ),
    /** The 3 to 5 lead items of the week. Each links out to the source reporter. */
    top_stories: z.array(
      z.object({
        source_headline: z.string(),
        source_outlet: z.string(),
        source_url: z.string().url(),
        source_date: z.coerce.date(),
        /** One-line reader summary in SF Times voice. */
        one_line: z.string(),
        /** Category tag (13-value taxonomy, uppercase). */
        category: z.string(),
        /** Why it mattered, pulled from the editor's note angle. */
        why_it_mattered: z.string(),
      })
    ),
    /** The editorial through-line for the week. The reason the weekly exists. */
    pattern_of_the_week: z.object({
      title: z.string(),
      /** 200 to 300 words naming the cross-item pattern. */
      note: z.string(),
      /** The items or threads this pattern connects. */
      connections: z.array(z.string()).default([]),
    }),
    /** Forward-looking bullets, composed from the week's what_to_watch fields. */
    coming_up: z.array(z.string()).default([]),
  }),
});

export const collections = {
  stories,
  'best-of': bestOf,
  briefs,
  weeklies,
};
