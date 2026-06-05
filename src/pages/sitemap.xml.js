import { getCollection } from 'astro:content';

export async function GET() {
  const stories = await getCollection('stories');
  const bestOf = await getCollection('best-of');
  const site = 'https://sftimes.com';

  // Page priority + change frequency per URL family.
  // Pages in `EXCLUDE` are deliberately omitted (noindex destinations).
  const EXCLUDE = new Set([
    '/admin', '/focal-audit', '/tell-your-story', '/sponsorship-deck',
  ]);

  const homepageUrls = [
    { path: '', priority: '1.0', freq: 'daily' },
  ];
  const sectionUrls = [
    { path: '/stories', priority: '0.9', freq: 'weekly' },
    { path: '/best-of', priority: '0.9', freq: 'weekly' },
    { path: '/hidden-spots', priority: '0.8', freq: 'monthly' },
    { path: '/quizzes', priority: '0.7', freq: 'monthly' },
    { path: '/map', priority: '0.8', freq: 'weekly' },
    { path: '/about', priority: '0.7', freq: 'monthly' },
    { path: '/team', priority: '0.7', freq: 'monthly' },
    { path: '/partners', priority: '0.8', freq: 'weekly' },
    { path: '/support', priority: '0.7', freq: 'monthly' },
    { path: '/press', priority: '0.6', freq: 'monthly' },
    { path: '/sample-issue', priority: '0.6', freq: 'monthly' },
    { path: '/newsletter-sample', priority: '0.5', freq: 'monthly' },
    { path: '/reader-letters', priority: '0.6', freq: 'weekly' },
    { path: '/submit', priority: '0.5', freq: 'yearly' },
    { path: '/standards', priority: '0.4', freq: 'yearly' },
    { path: '/corrections', priority: '0.5', freq: 'weekly' },
    { path: '/privacy', priority: '0.3', freq: 'yearly' },
    { path: '/terms', priority: '0.3', freq: 'yearly' },
    { path: '/404', priority: '0.1', freq: 'yearly' },
  ];
  const quizUrls = [
    { path: '/quizzes/mbti', priority: '0.5', freq: 'yearly' },
    { path: '/quizzes/enneagram', priority: '0.5', freq: 'yearly' },
    { path: '/quizzes/blood-type', priority: '0.5', freq: 'yearly' },
    { path: '/quizzes/love-languages', priority: '0.5', freq: 'yearly' },
    { path: '/quizzes/strengths', priority: '0.5', freq: 'yearly' },
  ];

  // Stories: priority decays slightly with age, but everything stays indexed forever.
  const storyEntries = stories
    .sort((a, b) => b.data.published.valueOf() - a.data.published.valueOf())
    .map((s, i) => ({
      path: `/stories/${s.data.url_slug}`,
      priority: i < 5 ? '0.8' : '0.7',
      freq: i < 10 ? 'weekly' : 'monthly',
      lastmod: s.data.published.toISOString().slice(0, 10),
    }));

  // Best-of: refreshed quarterly, higher priority since these are SEO targets.
  const bestOfEntries = bestOf.map((c) => ({
    path: `/best-of/${c.data.url_slug}`,
    priority: '0.8',
    freq: 'monthly',
    lastmod: c.data.last_refreshed.toISOString().slice(0, 10),
  }));

  const allEntries = [
    ...homepageUrls,
    ...sectionUrls,
    ...quizUrls,
    ...storyEntries,
    ...bestOfEntries,
  ].filter((e) => !EXCLUDE.has(e.path));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allEntries.map((e) => {
  const parts = [`    <loc>${site}${e.path}</loc>`];
  if (e.lastmod) parts.push(`    <lastmod>${e.lastmod}</lastmod>`);
  if (e.freq) parts.push(`    <changefreq>${e.freq}</changefreq>`);
  if (e.priority) parts.push(`    <priority>${e.priority}</priority>`);
  return `  <url>\n${parts.join('\n')}\n  </url>`;
}).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
