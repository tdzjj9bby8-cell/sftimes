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
    author: z.enum(['Eric', 'Nicholas', 'Daisy']),
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
  }),
});

const bestOf = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    url_slug: z.string(),
    intro: z.string(),
    editor: z.enum(['Eric', 'Nicholas', 'Daisy']),
    last_refreshed: z.coerce.date(),
    hero_alt: z.string(),
    hero_filename_hint: z.string(),
  }),
});

export const collections = {
  stories,
  'best-of': bestOf,
};
