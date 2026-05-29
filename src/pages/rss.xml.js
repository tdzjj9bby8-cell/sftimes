import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const stories = (await getCollection('stories')).sort(
    (a, b) => b.data.published.valueOf() - a.data.published.valueOf()
  );
  return rss({
    title: 'the keepers. — sf times',
    description: 'One San Francisco keeper every saturday. Reader-funded.',
    site: context.site,
    items: stories.map((s) => ({
      title: s.data.title,
      pubDate: s.data.published,
      description: s.data.deck,
      link: `/stories/${s.data.url_slug}`,
      author: s.data.author,
    })),
    customData: '<language>en-us</language>',
  });
}
