import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

const SITE = 'https://www.sftimes.com';

export async function GET(context: { site?: URL } & Record<string, unknown>) {
  const all = await getCollection('stories');
  // Sort newest first, exclude any future-dated drafts.
  const now = new Date();
  const stories = all
    .filter((s) => s.data.published.valueOf() <= now.valueOf())
    .sort((a, b) => b.data.published.valueOf() - a.data.published.valueOf());

  return rss({
    title: 'SF Times · The Keepers',
    description: 'One San Francisco keeper every Saturday morning. Reader-funded. No banner ads.',
    site: (context.site ?? new URL(SITE)).toString(),
    items: stories.map((s) => ({
      title: s.data.title,
      description: s.data.deck,
      link: `/stories/${s.data.url_slug}`,
      pubDate: s.data.published,
      author: `${s.data.author.toLowerCase()}@sftimes.com (${s.data.author})`,
      categories: [
        ...(s.data.neighborhood ? [s.data.neighborhood] : []),
        ...(s.data.keeper_type ? [s.data.keeper_type] : []),
        ...(s.data.sponsor ? ['Sponsored'] : []),
      ],
      // Custom data per the RSS namespace conventions
      customData: [
        s.data.photographer && s.data.photographer !== 'Staff'
          ? `<dc:contributor>${escapeXml(s.data.photographer)}</dc:contributor>`
          : '',
        s.data.sponsor
          ? `<sftimes:sponsor>${escapeXml(s.data.sponsor.name)}</sftimes:sponsor>`
          : '',
      ].filter(Boolean).join(''),
    })),
    customData: '<language>en-us</language><copyright>SF Times · Curry Village Media</copyright>',
    xmlns: {
      dc: 'http://purl.org/dc/elements/1.1/',
      sftimes: 'https://www.sftimes.com/rss-ns',
    },
    stylesheet: false,
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
