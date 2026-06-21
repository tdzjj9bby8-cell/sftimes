/**
 * news-sitemap.xml.ts
 *
 * Google News sitemap. Emits dated stories + brief items from the last 48h
 * per https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap.
 *
 * If zero items in the window, emits an empty <urlset> (still valid XML).
 * Regenerated on every Vercel deploy (build-time static). Stale 24h after
 * the last push if no redeploy happens, which is acceptable for a publication
 * shipping at weekly Saturday cadence.
 */
import { getCollection } from 'astro:content';

const SITE = 'https://www.sftimes.com';
const WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function briefDateString(d: Date): string {
  // YYYY-MM-DD path segment for /brief/{date}/{slug}/ permalinks.
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  const stories = await getCollection('stories');
  const briefs = await getCollection('briefs');

  type Entry = { loc: string; pubDate: Date; title: string };
  const entries: Entry[] = [];

  // Saturday Profile stories: filter by published date within window.
  for (const s of stories) {
    const published = new Date(s.data.published);
    if (published.getTime() >= cutoff) {
      entries.push({
        loc: `${SITE}/stories/${s.data.url_slug}`,
        pubDate: published,
        title: s.data.title,
      });
    }
  }

  // Brief items: each brief file is a daily edition with N items. Filter by
  // the brief's date field. If the edition itself is within 48h, include
  // every item permalink as a separate <url> entry per Google News spec.
  for (const b of briefs) {
    const briefDate = new Date(b.data.date);
    if (briefDate.getTime() < cutoff) continue;
    const datePath = briefDateString(briefDate);
    for (const item of b.data.items || []) {
      entries.push({
        loc: `${SITE}/brief/${datePath}/${item.slug}`,
        pubDate: briefDate,
        title: item.source_headline || item.tldr?.slice(0, 80) || item.slug,
      });
    }
  }

  // Sort newest first so the freshest content sits at the top of the sitemap.
  entries.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  const urlEntries = entries
    .map(
      (e) => `  <url>
    <loc>${xmlEscape(e.loc)}</loc>
    <news:news>
      <news:publication>
        <news:name>SF Times</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${e.pubDate.toISOString()}</news:publication_date>
      <news:title>${xmlEscape(e.title)}</news:title>
    </news:news>
  </url>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urlEntries}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
