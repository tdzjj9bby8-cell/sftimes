/**
 * scripts/brief-ingest.ts
 *
 * Stage 1 of the Brief pipeline (BRIEF-MASTER-PLAN.md section 6.1).
 *
 * Pulls candidate stories from 12 SF news RSS feeds + 3 Reddit subreddits
 * for the last 24 hours, dedupes them, and writes a candidate queue to
 * scripts/queue/<YYYY-MM-DD>-ingested.json.
 *
 * Runs nightly at 3:00 AM PT via Vercel cron (vercel.json). Locally:
 *   npm run brief:ingest -- --date 2026-06-14
 *
 * Output queue is consumed by brief-ai.ts (Stage 2) and brief-auditor (Stage 3).
 *
 * Dependencies: rss-parser, node-fetch (or native fetch on Node 18+).
 * Install: npm install rss-parser
 *
 * Author: SF Times. Single file by design so it's auditable end to end.
 */

import path from 'node:path';
import { putQueue, kvEnabled } from './lib/queue-store.js';

// ============ CONFIG ============

interface SourceFeed {
  name: string;
  url: string;
  /** Hard filter: drop items whose URL host does not include any of these strings.
   *  Catches stray syndicated stories that the feed bundles in. */
  hostMustInclude?: string[];
}

const RSS_SOURCES: SourceFeed[] = [
  { name: 'Mission Local', url: 'https://missionlocal.org/feed/', hostMustInclude: ['missionlocal.org'] },
  { name: 'SF Standard', url: 'https://sfstandard.com/feed/', hostMustInclude: ['sfstandard.com'] },
  { name: 'SFist', url: 'https://sfist.com/feed/', hostMustInclude: ['sfist.com'] },
  { name: 'ABC7 Bay Area', url: 'https://abc7news.com/feed/', hostMustInclude: ['abc7news.com'] },
  { name: 'KQED', url: 'https://www.kqed.org/news/feed', hostMustInclude: ['kqed.org'] },
  { name: 'NBC Bay Area', url: 'https://www.nbcbayarea.com/news/local/feed/', hostMustInclude: ['nbcbayarea.com'] },
  { name: 'Berkeleyside', url: 'https://www.berkeleyside.org/feed', hostMustInclude: ['berkeleyside.org'] },
  { name: 'Eater SF', url: 'https://sf.eater.com/rss/index.xml', hostMustInclude: ['sf.eater.com'] },
  { name: 'Curbed SF', url: 'https://sf.curbed.com/rss/index.xml', hostMustInclude: ['sf.curbed.com'] },
  { name: 'SF Chronicle', url: 'https://www.sfchronicle.com/rss/feed/Latest-News-415.php', hostMustInclude: ['sfchronicle.com'] },
  { name: 'SF Examiner', url: 'https://www.sfexaminer.com/feed/', hostMustInclude: ['sfexaminer.com'] },
  { name: 'SF Public Press', url: 'https://www.sfpublicpress.org/feed/', hostMustInclude: ['sfpublicpress.org'] },
];

const REDDIT_SUBS = ['sanfrancisco', 'AskSF', 'bayarea'];

/** Look back this many hours from the run timestamp. 24 = "since yesterday at this time." */
const LOOKBACK_HOURS = 24;

/** Hard cap so a surge week doesn't blow the AI cost. Per master plan risk #5. */
const MAX_CANDIDATES_PER_DAY = 80;

/** Dedupe parameters. */
const TITLE_COSINE_THRESHOLD = 0.85;

// ============ TYPES ============

export interface Candidate {
  /** Stable id used by downstream stages and the dashboard. */
  id: string;
  source_url: string;
  source_outlet: string;
  source_byline: string;
  original_headline: string;
  original_dek: string;
  published_at: string; // ISO 8601
  first_paragraph?: string;
  ingest_at: string; // ISO 8601
  /** Optional cluster id when the dedupe stage merges multiple candidates. */
  cluster_id?: string;
}

// ============ ENTRYPOINT ============

interface RunOpts {
  runDate?: Date;
  outputDir?: string;
}

export async function ingest(opts: RunOpts = {}): Promise<Candidate[]> {
  const runDate = opts.runDate ?? new Date();
  const outputDir = opts.outputDir ?? path.join(process.cwd(), 'scripts', 'queue');
  const sinceMs = runDate.valueOf() - LOOKBACK_HOURS * 60 * 60 * 1000;

  console.log(`[ingest] Run date: ${runDate.toISOString()}`);
  console.log(`[ingest] Pulling from ${RSS_SOURCES.length} RSS feeds + ${REDDIT_SUBS.length} subreddits`);
  console.log(`[ingest] Window: last ${LOOKBACK_HOURS}h`);

  // Pull all feeds in parallel. Failures are logged and the source is skipped.
  const rssResults = await Promise.allSettled(RSS_SOURCES.map((src) => pullRss(src, sinceMs)));
  const redditResults = await Promise.allSettled(REDDIT_SUBS.map((sub) => pullReddit(sub, sinceMs)));

  const candidates: Candidate[] = [];
  let failures = 0;

  for (const [i, r] of rssResults.entries()) {
    if (r.status === 'fulfilled') {
      candidates.push(...r.value);
      console.log(`[ingest] ${RSS_SOURCES[i].name}: ${r.value.length} items`);
    } else {
      failures++;
      console.warn(`[ingest] FAIL ${RSS_SOURCES[i].name}: ${r.reason}`);
    }
  }
  for (const [i, r] of redditResults.entries()) {
    if (r.status === 'fulfilled') {
      candidates.push(...r.value);
      console.log(`[ingest] r/${REDDIT_SUBS[i]}: ${r.value.length} items`);
    } else {
      failures++;
      console.warn(`[ingest] FAIL r/${REDDIT_SUBS[i]}: ${r.reason}`);
    }
  }

  console.log(`[ingest] Raw candidates: ${candidates.length} (${failures} source failures)`);

  // Dedupe
  const deduped = dedupe(candidates);
  console.log(`[ingest] After dedupe: ${deduped.length}`);

  // Cap volume
  const capped = deduped.slice(0, MAX_CANDIDATES_PER_DAY);
  if (deduped.length > capped.length) {
    console.warn(`[ingest] Volume cap hit: dropped ${deduped.length - capped.length} candidates`);
  }

  // Persist the candidate queue. Vercel KV in production, filesystem for local dev.
  const dateString = runDate.toISOString().slice(0, 10);
  await putQueue(dateString, 'ingested', capped, { baseDir: outputDir });
  console.log(`[ingest] Wrote ${capped.length} candidates for ${dateString} (${kvEnabled() ? 'KV' : 'filesystem'})`);

  return capped;
}

// ============ RSS PULL ============

async function pullRss(source: SourceFeed, sinceMs: number): Promise<Candidate[]> {
  // Use rss-parser when installed. Stub the import so the script type-checks
  // even before the dep is added; throws at runtime if missing.
  let Parser: any;
  try {
    Parser = (await import('rss-parser')).default;
  } catch (e) {
    throw new Error('rss-parser not installed. Run: npm install rss-parser');
  }

  const parser = new Parser({
    timeout: 15_000,
    headers: { 'User-Agent': 'SF Times Brief Ingest (https://sftimes.com)' },
  });

  const feed = await parser.parseURL(source.url);
  const items = (feed.items || []).filter((item: any) => {
    const pub = item.isoDate ? Date.parse(item.isoDate) : Date.parse(item.pubDate || '');
    if (!pub || pub < sinceMs) return false;
    if (source.hostMustInclude && item.link) {
      try {
        const host = new URL(item.link).host;
        if (!source.hostMustInclude.some((h) => host.includes(h))) return false;
      } catch (e) {
        return false;
      }
    }
    return true;
  });

  return items.map((item: any) => ({
    id: hashId(item.link || item.guid || item.title),
    source_url: item.link || item.guid || '',
    source_outlet: source.name,
    source_byline: item.creator || item.author || 'Staff',
    original_headline: stripHtml(item.title || ''),
    original_dek: stripHtml(item.contentSnippet || item.summary || item.description || '').slice(0, 280),
    published_at: item.isoDate || new Date(item.pubDate || Date.now()).toISOString(),
    first_paragraph: stripHtml(item['content:encoded'] || item.content || '').slice(0, 600) || undefined,
    ingest_at: new Date().toISOString(),
  }));
}

// ============ REDDIT PULL ============

async function pullReddit(sub: string, sinceMs: number): Promise<Candidate[]> {
  // Reddit JSON listing for top posts in the last 24h. No auth required for read.
  const url = `https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SF Times Brief Ingest (https://sftimes.com)' },
  });
  if (!res.ok) throw new Error(`Reddit ${sub}: HTTP ${res.status}`);
  const data: any = await res.json();
  const posts = (data?.data?.children || []) as any[];

  return posts
    .filter((p) => {
      const created = (p.data?.created_utc || 0) * 1000;
      return created >= sinceMs && !p.data?.over_18 && !p.data?.stickied;
    })
    .map((p) => ({
      id: hashId(`reddit-${p.data.id}`),
      source_url: `https://www.reddit.com${p.data.permalink}`,
      source_outlet: `r/${sub}`,
      source_byline: `u/${p.data.author}`,
      original_headline: p.data.title || '',
      original_dek: stripHtml(p.data.selftext || '').slice(0, 280),
      published_at: new Date((p.data.created_utc || 0) * 1000).toISOString(),
      first_paragraph: stripHtml(p.data.selftext || '').slice(0, 600) || undefined,
      ingest_at: new Date().toISOString(),
    }));
}

// ============ DEDUPE ============

function dedupe(candidates: Candidate[]): Candidate[] {
  // Step 1: exact URL match. Reddit and source can both surface the same article.
  const byUrl = new Map<string, Candidate>();
  for (const c of candidates) {
    const norm = normalizeUrl(c.source_url);
    if (!byUrl.has(norm)) byUrl.set(norm, c);
  }
  const urlDeduped = Array.from(byUrl.values());

  // Step 2: title cosine similarity ≥ TITLE_COSINE_THRESHOLD clusters together.
  // Keep the earliest-published item in each cluster.
  const clusters: Candidate[][] = [];
  for (const c of urlDeduped) {
    let placed = false;
    for (const cluster of clusters) {
      if (titleCosine(c.original_headline, cluster[0].original_headline) >= TITLE_COSINE_THRESHOLD) {
        cluster.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([c]);
  }

  const titleDeduped: Candidate[] = clusters.map((cluster) => {
    cluster.sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
    const winner = { ...cluster[0] };
    if (cluster.length > 1) {
      winner.cluster_id = `cluster-${winner.id.slice(0, 8)}`;
    }
    return winner;
  });

  // Step 3 (planned, not implemented here): named entity match across titles.
  // Requires an NER pass. For now, returns title-deduped results.
  // TODO: integrate spaCy or compromise.js NER once the prompt is locked.

  return titleDeduped;
}

// ============ UTILITIES ============

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Strip common tracking params
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'mc_cid', 'mc_eid']) {
      u.searchParams.delete(p);
    }
    return `${u.host}${u.pathname}${u.search}`.toLowerCase();
  } catch (e) {
    return url.toLowerCase();
  }
}

function titleCosine(a: string, b: string): number {
  const aTok = tokenize(a);
  const bTok = tokenize(b);
  if (aTok.size === 0 || bTok.size === 0) return 0;
  let intersect = 0;
  for (const t of aTok) if (bTok.has(t)) intersect++;
  return intersect / Math.sqrt(aTok.size * bTok.size);
}

const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'sf', 'san', 'francisco']);

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function hashId(input: string): string {
  // Simple stable hash. Sufficient for dedupe keys at this volume.
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return `c${(h >>> 0).toString(16).padStart(8, '0')}`;
}

// ============ CLI ============

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => a.startsWith('--date='))?.slice(7);
  const runDate = dateArg ? new Date(dateArg + 'T08:00:00Z') : new Date();
  ingest({ runDate }).catch((err) => {
    console.error('[ingest] FATAL', err);
    process.exit(1);
  });
}
