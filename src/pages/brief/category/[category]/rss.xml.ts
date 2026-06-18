import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

const SITE = 'https://sftimes.com';

/**
 * Per-category RSS feed at /brief/category/[category]/rss.xml.
 *
 * Subscribers can follow a single Brief category (Politics, Transit, etc.)
 * without receiving the rest. Each category gets its own feed URL listed
 * in <link rel="alternate"> on the category landing page.
 *
 * Feed items: every Brief item in the requested category, sorted newest
 * first, capped at the most recent 100.
 */

export async function getStaticPaths() {
  const briefs = await getCollection('briefs');
  const categories = new Set<string>();
  for (const brief of briefs) {
    for (const item of brief.data.items) {
      categories.add(item.category);
    }
  }
  return Array.from(categories).map((cat) => ({
    params: { category: cat.toLowerCase().replace(/\s+/g, '-') },
    props: { category: cat },
  }));
}

export async function GET(context: { params: { category: string }; props: { category: string }; site?: URL } & Record<string, unknown>) {
  const category = context.props.category;
  const briefs = await getCollection('briefs');

  const items = briefs
    .flatMap((brief) => {
      const dateString = brief.data.date.toISOString().slice(0, 10);
      return brief.data.items
        .filter((i: any) => i.category === category)
        .map((item: any) => ({
          title: item.source_headline,
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
    })
    .sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf())
    .slice(0, 100);

  return rss({
    title: `SF Times · The Brief · ${category}`,
    description: `SF Times Brief items in the ${category} category. Curated SF news with editor's commentary.`,
    site: (context.site ?? new URL(SITE)).toString(),
    items,
    xmlns: {
      atom: 'http://www.w3.org/2005/Atom',
    },
    customData: `
    <language>en-us</language>
    <atom:link href="${SITE}/brief/category/${context.params.category}/rss.xml" rel="self" type="application/rss+xml" />
    <managingEditor>eric@sftimes.com (Eric)</managingEditor>
    <copyright>SF Times. Original reporting credit goes to the linked source on each item.</copyright>
    <category>${category}</category>
    <category>San Francisco</category>
  `.trim(),
  });
}
