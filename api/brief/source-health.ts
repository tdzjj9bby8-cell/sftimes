/**
 * /api/brief/source-health
 *
 * Pings every RSS source in the brief-ingest config and reports liveness.
 * Returns the count of healthy/degraded/down sources plus per-source detail.
 *
 * Used by:
 *   - The dashboard health page (/brief-dashboard/health) renders this
 *   - Optional weekly cron alert to flag dead sources
 *   - On-demand operations check before publish
 *
 * Each ping is a HEAD request with a 5-second timeout. We do NOT fetch
 * the full feed (that's brief-ingest.ts at 3 AM); we just check whether
 * the URL responds successfully.
 *
 * Cached for 5 minutes via Cache-Control. Authentication via
 * DASHBOARD_TOKEN bearer header.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

function authorized(req: VercelRequest): boolean {
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected) return true; // dev mode
  const got = req.headers.authorization || '';
  return got === `Bearer ${expected}`;
}

interface SourceConfig {
  name: string;
  url: string;
  rss_url: string;
  type: 'outlet' | 'reddit';
}

// Mirrors the SOURCES list in scripts/brief-ingest.ts.
// Kept in sync manually; if you add a source there, add it here too.
const SOURCES: SourceConfig[] = [
  { name: 'Mission Local',        url: 'https://missionlocal.org',         rss_url: 'https://missionlocal.org/feed/',                       type: 'outlet' },
  { name: 'SF Standard',          url: 'https://sfstandard.com',           rss_url: 'https://sfstandard.com/feed/',                         type: 'outlet' },
  { name: 'SFist',                url: 'https://sfist.com',                rss_url: 'https://sfist.com/feed/',                              type: 'outlet' },
  { name: 'ABC7 Bay Area',        url: 'https://abc7news.com',             rss_url: 'https://abc7news.com/feed/',                           type: 'outlet' },
  { name: 'KQED',                 url: 'https://www.kqed.org',             rss_url: 'https://www.kqed.org/news/feed',                       type: 'outlet' },
  { name: 'NBC Bay Area',         url: 'https://www.nbcbayarea.com',       rss_url: 'https://www.nbcbayarea.com/news/local/feed/',          type: 'outlet' },
  { name: 'Berkeleyside',         url: 'https://www.berkeleyside.org',     rss_url: 'https://www.berkeleyside.org/feed',                    type: 'outlet' },
  { name: 'Eater SF',             url: 'https://sf.eater.com',             rss_url: 'https://sf.eater.com/rss/index.xml',                   type: 'outlet' },
  { name: 'Curbed SF',            url: 'https://sf.curbed.com',            rss_url: 'https://sf.curbed.com/rss/index.xml',                  type: 'outlet' },
  { name: 'SF Chronicle',         url: 'https://www.sfchronicle.com',      rss_url: 'https://www.sfchronicle.com/rss/feed/Latest-News-415.php', type: 'outlet' },
  { name: 'SF Examiner',          url: 'https://www.sfexaminer.com',       rss_url: 'https://www.sfexaminer.com/feed/',                     type: 'outlet' },
  { name: 'SF Public Press',      url: 'https://www.sfpublicpress.org',    rss_url: 'https://www.sfpublicpress.org/feed/',                  type: 'outlet' },
  { name: 'r/sanfrancisco',       url: 'https://www.reddit.com/r/sanfrancisco/', rss_url: 'https://www.reddit.com/r/sanfrancisco/top.json?t=day', type: 'reddit' },
  { name: 'r/AskSF',              url: 'https://www.reddit.com/r/AskSF/',  rss_url: 'https://www.reddit.com/r/AskSF/top.json?t=day',         type: 'reddit' },
  { name: 'r/bayarea',            url: 'https://www.reddit.com/r/bayarea/',rss_url: 'https://www.reddit.com/r/bayarea/top.json?t=day',       type: 'reddit' },
];

interface PingResult {
  name: string;
  type: 'outlet' | 'reddit';
  rss_url: string;
  status: 'healthy' | 'degraded' | 'down';
  http_status?: number;
  elapsed_ms: number;
  error?: string;
}

async function pingOne(src: SourceConfig): Promise<PingResult> {
  const startedAt = Date.now();
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);

    // Reddit uses .json endpoints which don't always respond to HEAD;
    // we send GET for those and abort after the first chunk arrives.
    const method = src.type === 'reddit' ? 'GET' : 'HEAD';

    const res = await fetch(src.rss_url, {
      method,
      headers: { 'User-Agent': 'SF Times Brief Source Health Check (https://sftimes.com)' },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    const elapsed = Date.now() - startedAt;
    if (res.status >= 200 && res.status < 300) {
      return { name: src.name, type: src.type, rss_url: src.rss_url, status: 'healthy', http_status: res.status, elapsed_ms: elapsed };
    }
    if (res.status === 304 || res.status === 405 || res.status === 403) {
      // 405 = HEAD not allowed (some outlets disallow HEAD), 403 = blocking
      // our user-agent but feed is probably up. Mark degraded but not down.
      return { name: src.name, type: src.type, rss_url: src.rss_url, status: 'degraded', http_status: res.status, elapsed_ms: elapsed };
    }
    return { name: src.name, type: src.type, rss_url: src.rss_url, status: 'down', http_status: res.status, elapsed_ms: elapsed, error: `HTTP ${res.status}` };
  } catch (e: any) {
    return {
      name: src.name,
      type: src.type,
      rss_url: src.rss_url,
      status: 'down',
      elapsed_ms: Date.now() - startedAt,
      error: e?.name === 'AbortError' ? 'Timeout (5s)' : String(e?.message ?? e).slice(0, 120),
    };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  const startedAt = Date.now();
  const results = await Promise.all(SOURCES.map(pingOne));
  const elapsed = Date.now() - startedAt;

  const healthy = results.filter((r) => r.status === 'healthy').length;
  const degraded = results.filter((r) => r.status === 'degraded').length;
  const down = results.filter((r) => r.status === 'down').length;
  const overallStatus = down === 0 && degraded < 2 ? 'ok' : down > 2 ? 'critical' : 'warn';

  return res.status(200).json({
    status: overallStatus,
    checked_at: new Date().toISOString(),
    total_elapsed_ms: elapsed,
    counts: { healthy, degraded, down, total: results.length },
    sources: results.sort((a, b) => {
      // Surface down/degraded first
      const order = { down: 0, degraded: 1, healthy: 2 } as const;
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.name.localeCompare(b.name);
    }),
  });
}
