import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

const SITE = 'https://sftimes.com';

/**
 * RSS feed for the daily Brief.
 *
 * Each item in the feed is a single Brief item permalink. Sorted newest first.
 * This is the subscription channel for daily-Brief readers who don't visit
 * the homepage; populated automatically by the publish stage of the pipeline.
 *
 * Feed URL: /brief/rss.xml
 * Subscriber tools: Feedly, Inoreader, NetNewsWire, etc.
 */
export async function GET(context: { site?: URL } & Record<string, unknown>) {
  const briefs = await getCollection('briefs');

  // Flatten: each brief contains multiple items. Sort by brief date desc,
  // preserving item order within each day (highest composite first).
  const sortedBriefs = [...briefs].sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
  const items = sortedBriefs.flatMap((brief) => {
    const dateString = brief.data.date.toISOString().slice(0, 10);
    const sortedItems = [...brief.data.items].sort((a, b) => b.composite_score - a.composite_score);
    return sortedItems.map((item) => ({
      title: `${item.category} · ${item.source_headline}`,
      description: `${item.tldr}\n\n${item.angle_statement}`,
      link: `/brief/${dateString}/${item.slug}/`,
      pubDate: brief.data.date,
      author: `${brief.data.editor.toLowerCase()}@sftimes.com (${brief.data.editor})`,
      categories: [
        item.category,
        item.signal.replace(/-/g, ' '),
        item.source_outlet,
      ],
    }));
  });

  return rss({
    title: 'SF Times · The Brief',
    description: 'Curated SF news daily, with editor\'s commentary that adds backstory and context the source articles do not. Links out to original reporting on every item.',
    site: (context.site ?? new URL(SITE)).toString(),
    items,
    xmlns: {
      atom: 'http://www.w3.org/2005/Atom',
    },
    customData: `
    <language>en-us</language>
    <atom:link href="${SITE}/brief/rss.xml" rel="self" type="application/rss+xml" />
    <managingEditor>eric@sftimes.com (Eric)</managingEditor>
    <copyright>SF Times. Original reporting credit goes to the linked source on each item.</copyright>
    <category>News</category>
    <category>San Francisco</category>
  `.trim(),
  });
}
