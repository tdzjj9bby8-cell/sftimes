/**
 * scripts/brief-watchdog.ts
 *
 * Independent publication-health check.
 *
 * WHY THIS IS SEPARATE FROM THE PIPELINE
 * A scheduler reporting success does not mean an edition reached readers. The
 * publishing job can exit 0 while the commit never pushed, the deploy failed,
 * or the build shipped a stale page. Asking the publishing job whether it
 * published is asking the suspect to testify.
 *
 * So this runs as its own scheduled job, later in the morning, and answers the
 * question from OUTSIDE the pipeline: does today's edition actually exist on
 * the live site, under today's San Francisco date, with real content?
 *
 * It deliberately does not import the pipeline, read the queue, or trust the
 * status file as evidence of publication. It reads the public internet, which
 * is the only thing a reader experiences.
 *
 * EXIT CODES
 *   0  healthy, or a legitimate non-publishing day (weekend)
 *   1  expected edition is missing or unhealthy. CI fails, alert fires.
 *
 * USAGE
 *   npm run brief:watchdog
 *   npm run brief:watchdog -- --date=2026-09-07
 */

import {
  resolveEditionDate,
  dateArgFrom,
  sfDateToInstant,
  isSfWeekday,
  sfLongDate,
} from './lib/sf-date.js';

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://sftimes.com';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

export interface WatchdogResult {
  healthy: boolean;
  editionDate: string;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
  summary: string;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: c.signal,
      headers: { 'User-Agent': 'SF Times Brief Watchdog (https://sftimes.com)' },
      cache: 'no-store',
    });
  } finally {
    clearTimeout(t);
  }
}

/** Bounded retry. A deploy can still be propagating when the watchdog runs. */
async function getWithRetry(url: string): Promise<{ status: number; body: string } | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url);
      const body = res.ok ? await res.text() : '';
      if (res.ok) return { status: res.status, body };
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
        continue;
      }
      return { status: res.status, body: '' };
    } catch {
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  return null;
}

export async function watchdog(argv: string[] = []): Promise<WatchdogResult> {
  const editionDate = resolveEditionDate(dateArgFrom(argv));
  const instant = sfDateToInstant(editionDate);
  const checks: WatchdogResult['checks'] = [];

  // A weekend has no expected edition. Reporting a weekend as unhealthy would
  // train the operator to ignore the alert, which is worse than no alert.
  if (!isSfWeekday(instant)) {
    return {
      healthy: true,
      editionDate,
      checks: [{ name: 'weekday_expected', pass: true, detail: 'Weekend. No edition expected.' }],
      summary: `No edition expected for ${editionDate} (weekend).`,
    };
  }

  const editionUrl = `${SITE_ORIGIN}/brief/${editionDate}/`;
  const indexUrl = `${SITE_ORIGIN}/brief/`;

  // CHECK 1: the dated edition page exists and is reachable.
  const edition = await getWithRetry(editionUrl);
  const editionOk = !!edition && edition.status === 200 && edition.body.length > 0;
  checks.push({
    name: 'edition_page_live',
    pass: editionOk,
    detail: edition ? `HTTP ${edition.status} at ${editionUrl}` : `No response from ${editionUrl}`,
  });

  if (editionOk) {
    const body = edition!.body;

    // CHECK 2: the page is actually today's edition, not a stale render.
    // The date must appear in the served HTML.
    const longForm = sfLongDate(instant); // e.g. "Monday, September 7, 2026"
    const monthDay = longForm.replace(/^[A-Za-z]+,\s*/, ''); // "September 7, 2026"
    const dateVisible = body.includes(editionDate) || body.includes(monthDay);
    checks.push({
      name: 'edition_date_rendered',
      pass: dateVisible,
      detail: dateVisible
        ? `Page renders the expected date (${editionDate} or "${monthDay}").`
        : `Neither "${editionDate}" nor "${monthDay}" found in the served HTML. Possible stale build.`,
    });

    // CHECK 3: the page carries real Brief structure, not an empty shell.
    // Look for the structural markers a real edition always emits.
    const hasStructure =
      /TLDR/i.test(body) && /(EDITOR'?S NOTE|editor-?s?-note|editor_note)/i.test(body);
    checks.push({
      name: 'edition_has_items',
      pass: hasStructure,
      detail: hasStructure
        ? 'Page contains TLDR and editor note markers.'
        : 'Page is missing expected item structure. Edition may have rendered empty.',
    });
  }

  // CHECK 4: /brief/ is serving today, so readers landing on the canonical
  // entry point see the new edition rather than an older one.
  const index = await getWithRetry(indexUrl);
  const indexServesToday =
    !!index && index.status === 200 && index.body.includes(editionDate);
  checks.push({
    name: 'brief_index_current',
    pass: indexServesToday,
    detail: index
      ? indexServesToday
        ? `${indexUrl} references ${editionDate}.`
        : `${indexUrl} returned HTTP ${index.status} but does not reference ${editionDate}.`
      : `No response from ${indexUrl}`,
  });

  const healthy = checks.every((c) => c.pass);
  const failed = checks.filter((c) => !c.pass).map((c) => c.name);

  return {
    healthy,
    editionDate,
    checks,
    summary: healthy
      ? `Healthy. ${editionDate} is live at ${editionUrl}.`
      : `UNHEALTHY. ${editionDate} failed: ${failed.join(', ')}.`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  watchdog(process.argv.slice(2))
    .then((r) => {
      console.log('='.repeat(64));
      console.log(`SF Times Brief Watchdog | edition ${r.editionDate}`);
      console.log('='.repeat(64));
      for (const c of r.checks) {
        console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
      }
      console.log('-'.repeat(64));
      console.log(r.summary);

      // Emit a compact machine-readable line the workflow can pick up for the
      // alert body without re-deriving anything.
      console.log(`WATCHDOG_RESULT=${r.healthy ? 'healthy' : 'unhealthy'}`);
      console.log(`WATCHDOG_EDITION=${r.editionDate}`);
      console.log(
        `WATCHDOG_FAILED=${r.checks.filter((c) => !c.pass).map((c) => c.name).join(',') || 'none'}`
      );

      process.exit(r.healthy ? 0 : 1);
    })
    .catch((err) => {
      console.error('[watchdog] FATAL', err);
      console.log('WATCHDOG_RESULT=error');
      process.exit(1);
    });
}
