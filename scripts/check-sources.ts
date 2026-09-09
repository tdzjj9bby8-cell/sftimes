/**
 * scripts/check-sources.ts
 *
 * Verify that every configured news feed is real, reachable, and current.
 *
 * WHY THIS EXISTS
 * The source list is the one part of this pipeline that rots silently. Outlets
 * move their feed, put it behind Cloudflare, or quietly stop publishing, and
 * none of that announces itself. Ingest tolerates individual failures by
 * design, which is right at 5am and dangerous over months: a list of thirty
 * sources where nine died in the spring still ingests, still passes the health
 * gate, and quietly narrows the publication's field of view.
 *
 * It reads the REAL source list out of brief-ingest.ts rather than keeping its
 * own copy, because a second copy of a list is a list that will disagree with
 * the first one within a month.
 *
 *   npm run brief:sources
 *
 * Reports per feed: HTTP status, item count, and the age of the newest item.
 * A feed that returns 200 with nothing from the last week is dead in the way
 * that matters, and is reported STALE rather than OK.
 *
 * Exit code 0 only when every configured feed is OK.
 */

import { RSS_SOURCES, type SourceFeed } from './brief-ingest.js';

const TIMEOUT_MS = 15_000;
const STALE_AFTER_DAYS = 7;

const UA = 'SF Times Brief Ingest (https://sftimes.com; editorial use; contact eric@sftimes.com)';

type Verdict = 'OK' | 'STALE' | 'FAIL';

interface Result {
  name: string;
  region: string;
  status: string;
  verdict: Verdict;
}

function countItems(xml: string): number {
  return (xml.match(/<item[\s>]/gi) ?? []).length + (xml.match(/<entry[\s>]/gi) ?? []).length;
}

function newestDate(xml: string): number | null {
  const stamps: number[] = [];
  const patterns = [
    /<pubDate>([^<]+)<\/pubDate>/gi,
    /<published>([^<]+)<\/published>/gi,
    /<updated>([^<]+)<\/updated>/gi,
    /<dc:date>([^<]+)<\/dc:date>/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const t = Date.parse(m[1].trim());
      if (Number.isFinite(t)) stamps.push(t);
    }
  }
  return stamps.length ? Math.max(...stamps) : null;
}

async function check(src: SourceFeed): Promise<Result> {
  const base = { name: src.name, region: src.region };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(src.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    const body = await res.text();

    if (!res.ok) return { ...base, status: `HTTP ${res.status}`, verdict: 'FAIL' };
    if (!/<rss|<feed|<rdf:RDF/i.test(body.slice(0, 2000)))
      return { ...base, status: 'not a feed', verdict: 'FAIL' };

    const n = countItems(body);
    if (n === 0) return { ...base, status: 'feed has no items', verdict: 'FAIL' };

    const newest = newestDate(body);
    const ageDays = newest === null ? null : (Date.now() - newest) / 86_400_000;

    if (ageDays !== null && ageDays > STALE_AFTER_DAYS) {
      return { ...base, status: `${n} items, newest ${ageDays.toFixed(0)}d old`, verdict: 'STALE' };
    }
    return {
      name: src.name,
      region: src.region,
      status: `${n} items, newest ${ageDays === null ? 'undated' : ageDays.toFixed(1) + 'd'}`,
      verdict: 'OK',
    };
  } catch (err) {
    return { ...base, status: String((err as Error)?.message ?? err).slice(0, 60), verdict: 'FAIL' };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSources(): Promise<number> {
  console.log(`Checking ${RSS_SOURCES.length} configured feeds...\n`);
  const results = await Promise.all(RSS_SOURCES.map(check));

  const namePad = Math.max(...results.map((r) => r.name.length));
  const regionPad = Math.max(...results.map((r) => r.region.length));

  for (const group of ['OK', 'STALE', 'FAIL'] as Verdict[]) {
    const rows = results.filter((r) => r.verdict === group);
    if (!rows.length) continue;
    console.log(`--- ${group} (${rows.length}) ---`);
    for (const r of rows) {
      console.log(`  ${r.name.padEnd(namePad)}  ${r.region.padEnd(regionPad)}  ${r.status}`);
    }
    console.log('');
  }

  const byRegion = new Map<string, number>();
  for (const r of results) {
    if (r.verdict === 'OK') byRegion.set(r.region, (byRegion.get(r.region) ?? 0) + 1);
  }
  console.log('Working feeds by region: ' + [...byRegion.entries()].map(([k, v]) => `${k} ${v}`).join(', '));

  const ok = results.filter((r) => r.verdict === 'OK').length;
  console.log(`${ok} of ${results.length} usable.\n`);
  return ok === results.length ? 0 : 1;
}

const isDirect = process.argv[1] && process.argv[1].includes('check-sources');
if (isDirect) {
  checkSources()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[check-sources] FATAL', err);
      process.exit(1);
    });
}
