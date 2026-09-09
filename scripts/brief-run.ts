/**
 * scripts/brief-run.ts
 *
 * Single-entry orchestrator for the Daily Brief. This is what CI runs.
 *
 * WHY A SINGLE ENTRYPOINT
 * The previous design split the pipeline across three separately-scheduled
 * stages that handed state to each other through a store. Every seam between
 * those stages was a place the chain could break silently: ingest writes, the
 * AI stage boots hours later and finds nothing, and no single process is
 * responsible for the outcome. Running all stages in one process, in one job,
 * means there is exactly one thing to schedule, one exit code that means
 * something, and one status record.
 *
 * ORDER
 *   weekday gate -> idempotency gate -> ingest -> AI (full-body + audit)
 *   -> publish (deterministic firewall) -> status
 *
 * EXIT CODES
 *   0  published, or safely skipped (already published / weekend / dry run)
 *   1  failure. CI marks the job red and the alert step fires.
 *
 * USAGE
 *   npm run brief:run                    today's SF edition
 *   npm run brief:run -- --date=2026-09-07
 *   npm run brief:run -- --dry-run       stops before Stage 3, publishes nothing
 *   npm run brief:run -- --review-only   FULL pipeline incl. firewall and
 *                                        composition, writes the edition to a
 *                                        review file, publishes nothing
 *   npm run brief:run -- --force         republish a deliberately removed day
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { ingest, getSourceHealth } from './brief-ingest.js';
import { MIN_HEALTHY_SOURCES } from './lib/editorial-quality.js';
import { aiPass, type AuditedItem } from './brief-ai.js';
import { publish } from './brief-publish.js';
import {
  resolveEditionDate,
  dateArgFrom,
  sfDateToInstant,
  isSfWeekday,
  sfLongDate,
  sfDateString,
} from './lib/sf-date.js';
import { newStatus, writeStatus, safeError, type RunStatus } from './lib/run-status.js';
import { getRunUsage } from './brief-ai.js';
import { estimateCost, resolveMaxUsd, estimateRunCost, BudgetExceededError } from './lib/token-budget.js';

const CONTENT_DIR = path.join(process.cwd(), 'src', 'content', 'briefs');
const QUEUE_DIR = path.join(process.cwd(), 'scripts', 'queue');

interface Options {
  editionDate: string;
  dryRun: boolean;
  reviewOnly: boolean;
  force: boolean;
  skipDeploy: boolean;
  allowWeekend: boolean;
}

function parseArgs(argv: string[]): Options {
  return {
    editionDate: resolveEditionDate(dateArgFrom(argv)),
    dryRun: argv.includes('--dry-run'),
    reviewOnly: argv.includes('--review-only'),
    force: argv.includes('--force'),
    skipDeploy: argv.includes('--skip-deploy'),
    allowWeekend: argv.includes('--allow-weekend'),
  };
}

/** Where a review-only run leaves the composed edition for a human to read. */
const REVIEW_FILENAME = (date: string) => `review-edition-${date}.md`;

export async function run(argv: string[] = []): Promise<number> {
  const opts = parseArgs(argv);
  const { editionDate } = opts;
  const status: RunStatus = newStatus(editionDate, opts.dryRun);

  const banner = opts.dryRun
    ? 'DRY RUN - NO PRODUCTION PUBLICATION'
    : opts.reviewOnly
      ? 'REVIEW ONLY - NO PRODUCTION PUBLICATION'
      : 'LIVE RUN';
  console.log('='.repeat(64));
  console.log(`SF Times Daily Brief | ${banner}`);
  console.log(`Edition date: ${editionDate} (${sfLongDate(sfDateToInstant(editionDate))})`);
  console.log(`Process time: ${new Date().toISOString()} | SF date now: ${sfDateString()}`);
  console.log('='.repeat(64));

  try {
    // ---- GATE 1: weekday only ----
    // The cron already restricts to weekdays. This is the in-code second gate
    // so a manual dispatch or a catch-up run cannot publish a weekend edition.
    if (!opts.allowWeekend && !isSfWeekday(sfDateToInstant(editionDate))) {
      status.final_status = 'green';
      status.outcome = 'weekend_skip';
      status.notes.push('Weekend in San Francisco. The Brief is a weekday product.');
      console.log('[run] Weekend edition date. Skipping by design.');
      await writeStatus(status);
      return 0;
    }

    // ---- GATE 2: idempotency ----
    // The published edition file is the source of truth. If it exists, this day
    // has shipped. A rerun must not duplicate it, renumber it, or overwrite it.
    const editionPath = path.join(CONTENT_DIR, `${editionDate}.md`);
    if (!opts.force && existsSync(editionPath)) {
      status.final_status = 'green';
      status.outcome = 'idempotent_skip';
      status.notes.push(`Edition already exists at ${editionPath}.`);
      console.log(`[run] Edition ${editionDate} already published. Nothing to do.`);
      await writeStatus(status);
      return 0;
    }

    // ---- STAGE 1: ingest ----
    console.log('\n[run] Stage 1: ingest');
    const candidates = await ingest({ editionDate, outputDir: QUEUE_DIR });
    const health = getSourceHealth();
    status.counts.ingested = candidates.length;
    status.sources = {
      total: health.total,
      healthy: health.healthy,
      failed: health.failed,
      failed_names: health.failedNames,
    };

    // A partial feed outage must not quietly become an edition that
    // misrepresents the day. This is checked before any model spend.
    if (health.healthy < MIN_HEALTHY_SOURCES) {
      status.final_status = 'red';
      status.outcome = 'insufficient_sources';
      status.error = `Only ${health.healthy} of ${health.total} sources responded (minimum ${MIN_HEALTHY_SOURCES}). Down: ${health.failedNames.join(', ')}.`;
      console.error(`[run] RED: ${status.error}`);
      await writeStatus(status);
      return 1;
    }

    if (candidates.length === 0) {
      status.final_status = 'yellow';
      status.outcome = 'no_candidates';
      status.notes.push('No candidates ingested. Every feed returned nothing in the window.');
      console.warn('[run] No candidates. Not an infrastructure failure, but nothing to publish.');
      await writeStatus(status);
      return 0;
    }

    // ---- STAGE 2: score, full-body fetch, draft, audit ----
    console.log('\n[run] Stage 2: scoring, full-article fetch, drafting, audit');
    const audited: AuditedItem[] = await aiPass({
      editionDate,
      inputDir: QUEUE_DIR,
      outputDir: QUEUE_DIR,
    });
    status.generation_completed = new Date().toISOString();
    const usage = getRunUsage();
    status.api_usage = {
      calls: usage.calls,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      estimated_cost_usd: estimateCost(usage),
      budget_usd: resolveMaxUsd(),
      estimated: false,
    };
    status.counts.dropped_source_fetch = audited.filter(
      (a) => a.drop_reason === 'source_fetch_failed'
    ).length;
    status.counts.drafted = audited.filter((a) => a.draft?.brief_worthy).length;
    status.counts.audit_passed = audited.filter((a) => a.audit?.audit_pass && !a.audit?.spot_check).length;

    // ---- INFRASTRUCTURE vs EDITORIAL: the distinction that matters ----
    // processCandidates() catches per-item exceptions so one bad article cannot
    // kill a run. That resilience has a dangerous side effect: if the Anthropic
    // key is missing or the API is down, EVERY item fails individually and the
    // run looks like an ordinary quiet news day. Reporting that as a normal
    // no-publish morning is exactly the silent failure this system exists to
    // eliminate. A systemic model failure is RED and must alert.
    const pipelineErrors = audited.filter((a) => a.drop_reason === 'pipeline_error').length;
    status.counts.pipeline_errors = pipelineErrors;
    const systemicFailure =
      pipelineErrors > 0 &&
      (pipelineErrors >= audited.length * 0.5 || (status.counts.audit_passed ?? 0) === 0);

    if (systemicFailure) {
      status.final_status = 'red';
      status.outcome = 'pipeline_errors';
      status.error = `${pipelineErrors} of ${audited.length} candidates failed with pipeline errors. Likely a missing or invalid ANTHROPIC_API_KEY, or an Anthropic API outage.`;
      status.notes.push('Systemic model-call failure, not a quiet news day.');
      console.error(`[run] RED: ${status.error}`);
      await writeStatus(status);
      return 1;
    }

    if ((status.counts.audit_passed ?? 0) === 0) {
      status.final_status = 'yellow';
      status.outcome = 'no_items_cleared';
      status.notes.push(
        `Nothing cleared the editorial gates. ${status.counts.dropped_source_fetch} dropped at the full-article guardrail, ${pipelineErrors} pipeline errors.`
      );
      console.warn('[run] No items cleared audit. Publishing nothing, by design.');
      await writeStatus(status);
      return 0;
    }

    // ---- DRY RUN STOPS HERE ----
    if (opts.dryRun) {
      status.validation_completed = new Date().toISOString();
      status.final_status = 'green';
      status.outcome = 'dry_run_complete';
      status.notes.push('Dry run: pipeline executed through audit, publication skipped.');
      const proj = estimateRunCost(status.counts.ingested ?? 0, status.counts.audit_passed ?? 0);
      console.log('\n=== DRY RUN COMPLETE - NOTHING PUBLISHED ===');
      console.log(
        `[run] Projected cost for an equivalent full run: $${proj.usd.toFixed(4)} ` +
          `(${proj.calls} calls, ${proj.inputTokens.toLocaleString()} in / ${proj.outputTokens.toLocaleString()} out)`
      );
      console.log(
        `Would publish approximately ${status.counts.audit_passed} items for ${editionDate}, ` +
          'before the deterministic firewall runs at publish time.'
      );
      await writeStatus(status);
      return 0;
    }

    // ---- REVIEW-ONLY: compose a real edition, publish nothing ----
    // This is the supervised step between "dry run" and "live publishing".
    //
    // A dry run stops before Stage 3, so it never exercises the firewall, the
    // deduper, the diversity cap, the quality floor, or edition composition.
    // Those are exactly the components whose thresholds need calibrating
    // against real copy. Review-only runs ALL of them and produces the actual
    // edition markdown, then stops before writing to the content collection or
    // touching git. The output is uploaded for a human to read.
    if (opts.reviewOnly) {
      console.log('\n[run] Stage 3: firewall + composition (REVIEW ONLY, nothing will publish)');
      const composed = await publish({
        editionDate,
        runDate: sfDateToInstant(editionDate),
        queueDir: QUEUE_DIR,
        contentDir: CONTENT_DIR,
        dryRun: true, // composes and validates, returns markdown, writes nothing
        healthySources: health.healthy,
        totalSources: health.total,
      });

      const reviewPath = path.join(process.cwd(), REVIEW_FILENAME(editionDate));
      await writeFile(reviewPath, composed, 'utf-8');

      status.validation_completed = new Date().toISOString();
      status.counts.published_items = (composed.match(/^\s*- id:\s*\S+/gm) ?? []).length;
      status.counts.firewall_removed =
        (status.counts.audit_passed ?? 0) - (status.counts.published_items ?? 0);
      status.final_status = 'green';
      status.outcome = 'review_only';
      status.notes.push(
        `Composed a real edition and stopped. Review ${REVIEW_FILENAME(editionDate)} before enabling publishing.`
      );

      console.log('\n=== REVIEW ONLY - NOTHING PUBLISHED ===');
      console.log(`Edition written for review: ${reviewPath}`);
      console.log(`Items that survived every gate: ${status.counts.published_items}`);
      await writeStatus(status);
      return 0;
    }

    // ---- STAGE 3: publish (runs the deterministic editorial firewall) ----
    console.log('\n[run] Stage 3: firewall + publish');
    const markdown = await publish({
      editionDate,
      runDate: sfDateToInstant(editionDate),
      queueDir: QUEUE_DIR,
      contentDir: CONTENT_DIR,
      skipDeploy: opts.skipDeploy,
      force: opts.force,
      healthySources: health.healthy,
      totalSources: health.total,
    });
    status.validation_completed = new Date().toISOString();
    status.publication_completed = new Date().toISOString();
    status.live_url = `https://sftimes.com/brief/${editionDate}/`;
    status.final_status = 'green';
    status.outcome = 'published';

    // Count what actually shipped, from the composed edition rather than from
    // intent, so the report reflects the artifact and not the plan.
    status.counts.published_items = (markdown.match(/^\s*- id:\s*\S+/gm) ?? []).length;
    status.counts.firewall_removed =
      (status.counts.audit_passed ?? 0) - (status.counts.published_items ?? 0);

    console.log(`\n[run] Published ${editionDate}`);
    await writeStatus(status);
    return 0;
  } catch (err) {
    const msg = safeError(err);
    // A budget stop is deliberate protection, not a bug. Surface it distinctly
    // so the operator sees "we hit the ceiling", not "something broke".
    if (err instanceof BudgetExceededError) {
      const u = getRunUsage();
      status.final_status = 'red';
      status.outcome = 'budget_exceeded';
      status.error = msg;
      status.api_usage = {
        calls: u.calls,
        input_tokens: u.inputTokens,
        output_tokens: u.outputTokens,
        estimated_cost_usd: estimateCost(u),
        budget_usd: resolveMaxUsd(),
        estimated: false,
      };
      console.error(`[run] BUDGET STOP: ${msg}`);
      await writeStatus(status).catch(() => {});
      return 1;
    }
    // An empty brief is an editorial outcome, not an infrastructure fault.
    const editorialEmpty = /Empty brief|No items survived/i.test(msg);
    status.final_status = editorialEmpty ? 'yellow' : 'red';
    status.outcome = editorialEmpty ? 'empty_after_firewall' : 'failed';
    status.error = msg;
    console.error(`[run] ${status.final_status.toUpperCase()}: ${msg}`);
    await writeStatus(status).catch(() => {});
    // Yellow is a legitimate no-publish day. Only red fails the job.
    return editorialEmpty ? 0 : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[run] FATAL', err);
      process.exit(1);
    });
}
