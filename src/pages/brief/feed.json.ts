import { getCollection } from 'astro:content';

/**
 * /brief/feed.json
 *
 * JSON Feed v1.1 alternative to the RSS feed. Same items, modern format.
 * Feed reader spec: https://www.jsonfeed.org/version/1.1/
 *
 * Why ship both: RSS remains the dominant standard but JSON Feed is the
 * modern default for many indie reader apps (Reeder, NetNewsWire, Feedbin
 * web), and JSON parses cleaner if anyone wants to ingest the Brief
 * programmatically.
 */

const SITE = 'https://sftimes.com';

export async function GET() {
  const briefs = await getCollection('briefs');
  const sorted = [...briefs].sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  const flatItems = sorted.flatMap((b) => {
    const dateString = b.data.date.toISOString().slice(0, 10);
    const sortedItems = [...b.data.items].sort((a: any, c: any) => (c.composite_score ?? 0) - (a.composite_score ?? 0));
    return sortedItems.map((item: any) => {
      const url = `${SITE}/brief/${dateString}/${item.slug}/`;
      return {
        id: url,
        url,
        external_url: item.source_url,
        title: item.source_headline,
        content_text: `${item.tldr}\n\n${item.angle_statement}\n\n${item.editor_note}`,
        summary: item.tldr,
        date_published: b.data.date.toISOString(),
        date_modified: b.data.date.toISOString(),
        author: {
          name: b.data.editor,
          url: `${SITE}/team#${b.data.editor.toLowerCase()}`,
        },
        tags: [
          item.category,
          item.signal.replace(/-/g, ' '),
          item.source_outlet,
        ],
        _sftimes: {
          composite_score: item.composite_score,
          uniqueness_score: item.uniqueness_score,
          brief_signal: item.signal,
          source_outlet: item.source_outlet,
          source_byline: item.source_byline,
          angle_statement: item.angle_statement,
          auto_published: item.auto_published,
        },
      };
    });
  });

  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'SF Times · The Brief',
    home_page_url: `${SITE}/brief/`,
    feed_url: `${SITE}/brief/feed.json`,
    description: "Curated SF news daily, with editor's commentary that adds backstory and context the source articles do not. Links out to original reporting on every item.",
    icon: `${SITE}/favicon.svg`,
    favicon: `${SITE}/favicon.svg`,
    language: 'en-US',
    authors: [{ name: 'Eric', url: `${SITE}/team#eric` }],
    items: flatItems,
  };

  return new Response(JSON.stringify(feed, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/feed+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
