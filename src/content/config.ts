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
    caption: z.string().optional(),
    pull_quote: z.string().optional(),
    pull_quote_attr: z.string().optional(),
    read_minutes: z.number().int().positive(),
    is_featured: z.boolean().default(false),
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
