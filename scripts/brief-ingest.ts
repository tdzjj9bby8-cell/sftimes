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
import { sfDateString, resolveEditionDate, dateArgFrom, sfDateToInstant } from './lib/sf-date.js';

// ============ CONFIG ============

/**
 * Where a source primarily reports from.
 *
 * Carried through the pipeline and shown to the editor, but NOT used to
 * prioritize or filter. The editorial rule for this publication is that the
 * best story wins regardless of which side of the Bay it happened on. Region
 * exists so the editor can SEE the spread of a day's field, not so the code can
 * enforce a quota on it.
 */
export type Region = 'SF' | 'East Bay' | 'South Bay' | 'Peninsula' | 'Bay Area';

export interface SourceFeed {
  name: string;
  url: string;
  region: Region;
  /** Hard filter: drop items whose URL host does not include any of these strings.
   *  Catches stray syndicated stories that the feed bundles in. */
  hostMustInclude?: string[];
  /**
   * Excluded from the source-health denominator.
   *
   * For sources that block automated access as a matter of policy rather than
   * because anything is wrong. Reddit returns 403 to datacenter IPs every
   * single run. Counting that as an outage means the health signal reads
   * permanently degraded, and a health signal that is always yellow is a health
   * signal nobody looks at. These sources still contribute candidates when they
   * happen to work.
   */
  healthOptional?: boolean;
}

/**
 * SOURCE LIST — Core Bay Area.
 *
 * Every URL here was verified live with scripts/check-sources.mjs. Run that
 * before adding to this list and periodically after: feeds move, go behind
 * Cloudflare, or quietly stop publishing, and none of that announces itself.
 *
 * Known unavailable, deliberately absent rather than silently missing:
 *   Bay Area News Group (Mercury News, East Bay Times, Marin IJ) - 403
 *   SF Chronicle, SF Examiner, Bay Area Reporter                 - 403 / 404
 *   San Mateo Daily Journal                                      - feed 500+ days stale
 * San Mateo County is consequently the thinnest part of this map. The Almanac
 * is the only working feed there. That is a real gap in coverage, not an
 * oversight, and it should be revisited if a working Peninsula feed appears.
 */
export const RSS_SOURCES: SourceFeed[] = [
  // ---- San Francisco ----
  { name: 'Mission Local', url: 'https://missionlocal.org/feed/', region: 'SF', hostMustInclude: ['missionlocal.org'] },
  { name: 'SF Standard', url: 'https://sfstandard.com/feed/', region: 'SF', hostMustInclude: ['sfstandard.com'] },
  { name: 'SFist', url: 'https://sfist.com/feed/', region: 'SF', hostMustInclude: ['sfist.com'] },
  { name: 'SF Public Press', url: 'https://www.sfpublicpress.org/feed/', region: 'SF', hostMustInclude: ['sfpublicpress.org'] },
  { name: 'The Frisc', url: 'https://thefrisc.com/feed/', region: 'SF', hostMustInclude: ['thefrisc.com'] },
  { name: '48 Hills', url: 'https://48hills.org/feed/', region: 'SF', hostMustInclude: ['48hills.org'] },
  { name: 'Eater SF', url: 'https://sf.eater.com/rss/index.xml', region: 'SF', hostMustInclude: ['sf.eater.com'] },
  { name: 'Hoodline', url: 'https://hoodline.com/rss.xml', region: 'SF', hostMustInclude: ['hoodline.com'] },
  { name: 'SF Bay View', url: 'https://sfbayview.com/feed/', region: 'SF', hostMustInclude: ['sfbayview.com'] },
  { name: 'Streetsblog SF', url: 'https://sf.streetsblog.org/feed', region: 'SF', hostMustInclude: ['streetsblog.org'] },
  { name: 'SF YIMBY', url: 'https://sfyimby.com/feed', region: 'SF', hostMustInclude: ['sfyimby.com'] },

  // ---- East Bay ----
  { name: 'Berkeleyside', url: 'https://www.berkeleyside.org/feed', region: 'East Bay', hostMustInclude: ['berkeleyside.org'] },
  { name: 'Berkeley Scanner', url: 'https://www.berkeleyscanner.com/feed/', region: 'East Bay', hostMustInclude: ['berkeleyscanner.com'] },
  { name: 'The Oaklandside', url: 'https://oaklandside.org/feed/', region: 'East Bay', hostMustInclude: ['oaklandside.org'] },
  { name: 'Oakland North', url: 'https://oaklandnorth.net/feed/', region: 'East Bay', hostMustInclude: ['oaklandnorth.net'] },
  { name: 'Richmondside', url: 'https://richmondside.org/feed/', region: 'East Bay', hostMustInclude: ['richmondside.org'] },
  { name: 'Alameda Post', url: 'https://alamedapost.com/feed/', region: 'East Bay', hostMustInclude: ['alamedapost.com'] },
  { name: 'Pleasanton Weekly', url: 'https://www.pleasantonweekly.com/feed/', region: 'East Bay', hostMustInclude: ['pleasantonweekly.com'] },
  { name: 'Contra Costa Herald', url: 'https://contracostaherald.com/feed/', region: 'East Bay', hostMustInclude: ['contracostaherald.com'] },

  // ---- South Bay ----
  { name: 'San José Spotlight', url: 'https://sanjosespotlight.com/feed/', region: 'South Bay', hostMustInclude: ['sanjosespotlight.com'] },
  { name: 'Palo Alto Online', url: 'https://www.paloaltoonline.com/feed/', region: 'South Bay', hostMustInclude: ['paloaltoonline.com'] },
  { name: 'Mountain View Voice', url: 'https://www.mv-voice.com/feed/', region: 'South Bay', hostMustInclude: ['mv-voice.com'] },
  { name: 'Palo Alto Daily Post', url: 'https://padailypost.com/feed/', region: 'South Bay', hostMustInclude: ['padailypost.com'] },

  // ---- Peninsula ----
  { name: 'The Almanac', url: 'https://www.almanacnews.com/feed/', region: 'Peninsula', hostMustInclude: ['almanacnews.com'] },

  // ---- Bay Area wide ----
  { name: 'KQED', url: 'https://ww2.kqed.org/news/feed/', region: 'Bay Area', hostMustInclude: ['kqed.org'] },
  { name: 'ABC7 Bay Area', url: 'https://abc7news.com/feed/', region: 'Bay Area', hostMustInclude: ['abc7news.com'] },
  { name: 'NBC Bay Area', url: 'https://www.nbcbayarea.com/news/local/feed/', region: 'Bay Area', hostMustInclude: ['nbcbayarea.com'] },
  { name: 'KTVU', url: 'https://www.ktvu.com/rss/category/local-news', region: 'Bay Area', hostMustInclude: ['ktvu.com'] },
  { name: 'KRON4', url: 'https://www.kron4.com/feed/', region: 'Bay Area', hostMustInclude: ['kron4.com'] },
  { name: 'SFGate', url: 'https://www.sfgate.com/rss/feed/Bay-Area-News-429.php', region: 'Bay Area', hostMustInclude: ['sfgate.com'] },
  { name: 'Local News Matters', url: 'https://localnewsmatters.org/feed/', region: 'Bay Area', hostMustInclude: ['localnewsmatters.org'] },
  { name: 'CalMatters', url: 'https://calmatters.org/feed/', region: 'Bay Area', hostMustInclude: ['calmatters.org'] },
];

/** Reddit blocks datacenter IPs, so these fail on CI and often locally too.
 *  Kept because they surface things no newsroom covers, but excluded from the
 *  health denominator so a permanent 403 does not mask a real outage. */
const REDDIT_SUBS = ['sanfrancisco', 'AskSF', 'bayarea'];
const REDDIT_HEALTH_OPTIONAL = true;

/** Look back this many hours from the run timestamp. 24 = "since yesterday at this time." */
const LOOKBACK_HOURS = 24;

/**
 * Cap on candidates carried into the day's queue.
 *
 * The original 80 existed to bound API spend when every candidate cost a
 * scoring call. On the manual path nothing here costs money, and 80 across 32
 * sources would truncate most of the list. Raised, and more importantly the
 * ORDER is now fair (see interleaveByOutlet) so the cap trims the tail of every
 * outlet rather than deleting whole outlets at the bottom of the source list.
 */
const MAX_CANDIDATES_PER_DAY = 240;

/** Dedupe parameters. */
const TITLE_COSINE_THRESHOLD = 0.85;

// ============ TYPES ============

export interface Candidate {
  /** Stable id used by downstream stages and the dashboard. */
  id: string;
  source_url: string;
  source_outlet: string;
  /** Where the outlet primarily reports from. Informational: shown to the
   *  editor so the day's geographic spread is visible. Never used to rank,
   *  filter, or quota an item. */
  region?: Region;
  source_byline: string;
  original_headline: string;
  original_dek: string;
  published_at: string; // ISO 8601
  first_paragraph?: string;
  ingest_at: string; // ISO 8601
  /** Optional cluster id when the dedupe stage merges multiple candidates. */
  cluster_id?: string;
}

// ============ SOURCE HEALTH ============

export interface SourceHealth {
  total: number;
  healthy: number;
  failed: number;
  failedNames: string[];
}

/** Health of the most recent ingest run. Read by the orchestrator's quality
 *  floor. Module-level rather than a return value so the existing ingest()
 *  signature and its other callers stay unchanged. */
let lastSourceHealth: SourceHealth = { total: 0, healthy: 0, failed: 0, failedNames: [] };

export function getSourceHealth(): SourceHealth {
  return lastSourceHealth;
}

/**
 * Reorder candidates round-robin across outlets, newest first within each.
 *
 * Feeds publish at wildly different rates. NBC Bay Area, KRON4 and Hoodline each
 * push fifty items a day; The Almanac pushes ten a week. Any ordering that is
 * purely by recency, or purely by source order, hands the downstream budget to
 * whoever is loudest. Round-robin gives every newsroom its first story before
 * anyone gets their second.
 *
 * Exported so the prep stage can apply the same fairness to its fetch budget,
 * which is the scarcer resource of the two.
 */
export function interleaveByOutlet<T extends { source_outlet?: string; published_at?: string }>(
  items: T[],
): T[] {
  const byOutlet = new Map<string, T[]>();
  for (const item of items) {
    const key = item.source_outlet ?? 'unknown';
    if (!byOutlet.has(key)) byOutlet.set(key, []);
    byOutlet.get(key)!.push(item);
  }

  // Newest first inside each outlet, so the round-robin hands out each
  // newsroom's freshest story first.
  for (const group of byOutlet.values()) {
    group.sort((a, b) => Date.parse(b.published_at ?? '') - Date.parse(a.published_at ?? ''));
  }

  // Start each round with the outlet whose next story is newest, so the very
  // top of the list is still genuinely the day's freshest news rather than
  // whichever outlet sorts first alphabetically.
  const queues = [...byOutlet.values()];
  const out: T[] = [];
  let remaining = items.length;
  while (remaining > 0) {
    const round = queues.filter((q) => q.length > 0);
    if (round.length === 0) break;
    round.sort((a, b) => Date.parse(b[0].published_at ?? '') - Date.parse(a[0].published_at ?? ''));
    for (const q of round) {
      out.push(q.shift()!);
      remaining--;
    }
  }
  return out;
}

// ============ ENTRYPOINT ============

interface RunOpts {
  runDate?: Date;
  outputDir?: string;
  /** Explicit YYYY-MM-DD edition date. Wins over runDate so every pipeline
   *  stage in a single run agrees on which edition it is building. */
  editionDate?: string;
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

  // Record feed health for the quality floor. Ingest tolerating individual
  // source failures is correct, but publishing an edition drawn from one
  // surviving feed while ten are down turns a partial outage into an edition
  // that misrepresents the day while looking perfectly healthy.
  //
  // Reddit is excluded from the denominator. It returns 403 to datacenter IPs
  // on every run, so counting it made the health line permanently read
  // "11/14 healthy" no matter what. A gauge that never reads full is a gauge
  // nobody checks, which is exactly how a real outage gets missed.
  const countedRss = RSS_SOURCES.filter((s) => !s.healthOptional);
  const rssFailures = rssResults.filter(
    (r, i) => r.status === 'rejected' && !RSS_SOURCES[i].healthOptional
  ).length;

  lastSourceHealth = {
    total: countedRss.length,
    healthy: countedRss.length - rssFailures,
    failed: rssFailures,
    failedNames: rssResults
      .map((r, i) => (r.status === 'rejected' && !RSS_SOURCES[i].healthOptional ? RSS_SOURCES[i].name : null))
      .filter((x): x is string => x !== null),
  };
  const redditDown = redditResults.filter((r) => r.status === 'rejected').length;
  if (redditDown && REDDIT_HEALTH_OPTIONAL) {
    console.log(`[ingest] ${redditDown} of ${REDDIT_SUBS.length} subreddits blocked (expected; not counted against health)`);
  }
  console.log(
    `[ingest] Source health: ${lastSourceHealth.healthy}/${lastSourceHealth.total} responded` +
      (lastSourceHealth.failed ? ` (down: ${lastSourceHealth.failedNames.join(', ')})` : '')
  );

  // Dedupe
  const deduped = dedupe(candidates);
  console.log(`[ingest] After dedupe: ${deduped.length}`);

  // ---- FAIR ORDERING, THEN CAP ----
  // This ordering matters more than the cap value.
  //
  // Candidates arrive grouped by source, in source-list order, so a plain
  // slice() kept everything from the first few outlets and deleted the last
  // outlets entirely. With eleven sources that was survivable. With thirty-two
  // it would mean adding San José Spotlight and The Almanac to this file and
  // then never once reading a story from either, while the run log cheerfully
  // reported them healthy. Expanding the source list without fixing this would
  // have made coverage NARROWER, not wider.
  //
  // Interleaving round-robin across outlets means the cap trims the tail of
  // every outlet evenly instead of amputating whole newsrooms.
  const ordered = interleaveByOutlet(deduped);
  const capped = ordered.slice(0, MAX_CANDIDATES_PER_DAY);
  if (ordered.length > capped.length) {
    console.warn(`[ingest] Volume cap hit: dropped ${ordered.length - capped.length} candidates (evenly across outlets)`);
  }

  // Persist the candidate queue. Vercel KV in production, filesystem for local dev.
  // Edition date is the San Francisco calendar date, never the runner's UTC date.
  const dateString = opts.editionDate ?? sfDateString(runDate);
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
    region: source.region,
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
      region: 'Bay Area' as Region,
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
  const editionDate = resolveEditionDate(dateArgFrom(process.argv.slice(2)));
  ingest({ editionDate, runDate: new Date() }).catch((err) => {
    console.error('[ingest] FATAL', err);
    process.exit(1);
  });
}
