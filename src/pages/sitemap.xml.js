import { getCollection } from 'astro:content';

export async function GET() {
  const stories = await getCollection('stories');
  const bestOf = await getCollection('best-of');
  const site = 'https://sftimes.com';

  const staticPages = [
    '',
    '/stories',
    '/best-of',
    '/hidden-spots',
    '/quizzes',
    '/quizzes/mbti',
    '/quizzes/enneagram',
    '/quizzes/blood-type',
    '/quizzes/love-languages',
    '/quizzes/strengths',
    '/about',
    '/support',
    '/standards',
    '/corrections',
    '/partners',
    '/team',
    '/submit',
    '/privacy',
    '/terms',
  ];

  const storyUrls = stories.map((s) => `/stories/${s.data.url_slug}`);
  const bestOfUrls = bestOf.map((c) => `/best-of/${c.data.url_slug}`);
  const allUrls = [...staticPages, ...storyUrls, ...bestOfUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map((path) => `  <url><loc>${site}${path}</loc></url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
