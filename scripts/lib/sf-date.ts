/**
 * scripts/lib/sf-date.ts
 *
 * Deterministic publication-date handling for the Brief pipeline.
 *
 * WHY THIS EXISTS
 * The original pipeline derived the edition date with
 * `runDate.toISOString().slice(0, 10)`, which is the UTC calendar date. The
 * SF Times editorial day is San Francisco local time. Those two agree during a
 * morning PT run (6 AM PT = 13:00/14:00 UTC, same calendar day) but diverge
 * after 4 or 5 PM PT, when UTC has already rolled over to tomorrow. That is an
 * off-by-one waiting to happen: a late run would publish tomorrow's edition
 * early, or a rerun would file today's content under the wrong date.
 *
 * Every date decision in the pipeline now routes through this module, which
 * always answers in America/Los_Angeles regardless of where the process runs.
 * This matters specifically because the automation runs on GitHub's runners,
 * which are UTC.
 *
 * No dependencies. Uses the Intl API, which ships with Node and handles PST/PDT
 * transitions correctly without a timezone database of our own.
 */

export const SF_TIMEZONE = 'America/Los_Angeles';

/** en-CA formats as YYYY-MM-DD, which is exactly the shape the pipeline uses. */
const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: SF_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: SF_TIMEZONE,
  weekday: 'short',
});

const HOUR_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: SF_TIMEZONE,
  hour: '2-digit',
  hour12: false,
});

const LONG_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: SF_TIMEZONE,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

/**
 * The San Francisco calendar date for a given instant, as YYYY-MM-DD.
 * This is THE edition date. Nothing else in the pipeline should compute one.
 */
export function sfDateString(d: Date = new Date()): string {
  return DATE_FMT.format(d);
}

/** Long human form for logs and alerts, e.g. "Monday, September 7, 2026". */
export function sfLongDate(d: Date = new Date()): string {
  return LONG_FMT.format(d);
}

/** Short weekday in SF time: Mon, Tue, Wed, Thu, Fri, Sat, Sun. */
export function sfWeekday(d: Date = new Date()): string {
  return WEEKDAY_FMT.format(d);
}

/** Hour 0-23 in SF time. Used for cutoff logic and log context. */
export function sfHour(d: Date = new Date()): number {
  return parseInt(HOUR_FMT.format(d), 10);
}

/**
 * True Monday through Friday in San Francisco time.
 *
 * The Brief is a weekday product. Weekend SF news is thin and consistently
 * scrapes the scoring floor, so Saturday and Sunday are deliberately not
 * published. The workflow cron already restricts to weekdays; this is the
 * in-code second gate so a manual or catch-up run cannot accidentally publish
 * a weekend edition.
 */
export function isSfWeekday(d: Date = new Date()): boolean {
  const wd = sfWeekday(d);
  return wd !== 'Sat' && wd !== 'Sun';
}

/**
 * Anchor a YYYY-MM-DD edition date to a real instant at noon SF time.
 *
 * Noon is deliberate: it is far from both midnight boundaries and from the
 * 1-2 AM DST transition, so the resulting Date maps back to the same calendar
 * date under any offset. Never anchor an edition date at midnight.
 */
export function sfDateToInstant(dateString: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error(`sfDateToInstant: expected YYYY-MM-DD, got "${dateString}"`);
  }
  // PT is UTC-8 (PST) or UTC-7 (PDT). Anchoring at 20:00Z lands at noon PST or
  // 1 PM PDT, both safely mid-day on the intended calendar date.
  const anchored = new Date(`${dateString}T20:00:00Z`);
  if (sfDateString(anchored) !== dateString) {
    // Defensive: should not happen, but never silently return a wrong date.
    throw new Error(
      `sfDateToInstant: anchor drifted (${dateString} resolved to ${sfDateString(anchored)})`
    );
  }
  return anchored;
}

/**
 * Resolve the edition date for a run.
 *
 * Precedence: explicit --date argument wins (used for manual reruns and
 * backfills), otherwise today in San Francisco.
 */
export function resolveEditionDate(explicit?: string): string {
  if (explicit) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
      throw new Error(`Invalid --date "${explicit}". Expected YYYY-MM-DD.`);
    }
    // Validate it is a real calendar date, not 2026-02-31.
    const probe = new Date(`${explicit}T20:00:00Z`);
    if (Number.isNaN(probe.valueOf())) {
      throw new Error(`Invalid --date "${explicit}". Not a real date.`);
    }
    return explicit;
  }
  return sfDateString();
}

/** Parse a --date=YYYY-MM-DD style argv flag. Returns undefined when absent. */
export function dateArgFrom(argv: string[]): string | undefined {
  const withEquals = argv.find((a) => a.startsWith('--date='));
  if (withEquals) return withEquals.slice('--date='.length);
  const idx = argv.indexOf('--date');
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}
