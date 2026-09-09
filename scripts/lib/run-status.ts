/**
 * scripts/lib/run-status.ts
 *
 * Machine-readable record of what the Brief pipeline actually did on a run.
 *
 * WHY THIS EXISTS
 * The failure that hurt this publication most was not a loud crash, it was
 * silence: a run that appeared to succeed while nothing reached the site, and
 * nobody found out for days. Exit code 0 is not evidence of publication.
 *
 * This file records each stage boundary so that a human, or the watchdog, can
 * answer "what stage did today actually reach?" without reading logs. It is
 * committed alongside the edition, so the repo carries its own publication
 * history.
 *
 * Deliberately a single flat JSON file, not a database. Observability, not
 * infrastructure.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * GREEN  published and verified end to end
 * YELLOW pipeline ran correctly but produced no edition, or dropped items for
 *        editorial reasons. Not an infrastructure fault. No alert by default.
 * RED    infrastructure or publication failure. Alerts.
 */
export type RunStatusColor = 'green' | 'yellow' | 'red';

export interface RunStatus {
  edition_date: string;
  run_started: string;
  run_finished?: string;
  /** Which stages completed, in order. */
  generation_completed?: string;
  validation_completed?: string;
  publication_completed?: string;
  verification_completed?: string;
  final_status: RunStatusColor;
  /** Short machine-readable outcome, e.g. published, idempotent_skip, weekend_skip. */
  outcome: string;
  dry_run: boolean;
  counts: {
    ingested?: number;
    drafted?: number;
    dropped_source_fetch?: number;
    audit_passed?: number;
    firewall_removed?: number;
    published_items?: number;
    /** Candidates that threw during a model call. A high count means the API
     *  itself is failing, which is RED, not a quiet news day. */
    pipeline_errors?: number;
  };
  /** Feed health for the run. Lets an operator distinguish "quiet news day"
   *  from "half our sources were down". */
  sources?: {
    total: number;
    healthy: number;
    failed: number;
    failed_names: string[];
  };
  /** Wall-clock runtime in seconds. */
  runtime_seconds?: number;
  /** Real Anthropic usage for the run, read from API responses. On a dry run
   *  these are the ESTIMATED values and estimated is set true. */
  api_usage?: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    budget_usd: number;
    estimated: boolean;
  };
  commit_sha?: string;
  deployment_url?: string;
  live_url?: string;
  /** Never contains secrets. Truncated. */
  error?: string;
  notes: string[];
}

export const STATUS_FILENAME = 'publication-status.json';

export function statusPath(baseDir: string = process.cwd()): string {
  return path.join(baseDir, STATUS_FILENAME);
}

export function newStatus(editionDate: string, dryRun: boolean): RunStatus {
  return {
    edition_date: editionDate,
    run_started: new Date().toISOString(),
    final_status: 'red', // pessimistic default: only success flips this
    outcome: 'started',
    dry_run: dryRun,
    counts: {},
    notes: [],
  };
}

export async function writeStatus(status: RunStatus, baseDir?: string): Promise<void> {
  status.run_finished = status.run_finished ?? new Date().toISOString();
  status.runtime_seconds = Math.round(
    (Date.parse(status.run_finished) - Date.parse(status.run_started)) / 1000
  );
  const p = statusPath(baseDir);
  await writeFile(p, JSON.stringify(status, null, 2) + '\n', 'utf-8');

  // Human-readable run report. The point of observability is that the operator
  // can answer "what happened today?" without opening a log.
  const c = status.counts;
  const s = status.sources;
  console.log('');
  console.log('---------------- RUN REPORT ----------------');
  console.log(`Edition date      : ${status.edition_date}`);
  console.log(`Result            : ${status.final_status.toUpperCase()} (${status.outcome})`);
  if (s) console.log(`Sources           : ${s.healthy}/${s.total} healthy${s.failed ? ` (down: ${s.failed_names.join(', ')})` : ''}`);
  if (c.ingested !== undefined) console.log(`Candidates        : ${c.ingested}`);
  if (c.dropped_source_fetch !== undefined) console.log(`Dropped, no body  : ${c.dropped_source_fetch}`);
  if (c.drafted !== undefined) console.log(`Drafted           : ${c.drafted}`);
  if (c.audit_passed !== undefined) console.log(`Cleared audit     : ${c.audit_passed}`);
  if (c.firewall_removed !== undefined) console.log(`Removed at gates  : ${c.firewall_removed}`);
  if (c.published_items !== undefined) console.log(`Published items   : ${c.published_items}`);
  if (c.pipeline_errors) console.log(`AI failures       : ${c.pipeline_errors}`);
  console.log(`Runtime           : ${status.runtime_seconds}s`);
  if (status.api_usage) {
    const a = status.api_usage;
    console.log(`API calls         : ${a.calls}${a.estimated ? ' (estimated)' : ''}`);
    console.log(`API tokens        : ${a.input_tokens.toLocaleString()} in / ${a.output_tokens.toLocaleString()} out`);
    console.log(`API cost          : $${a.estimated_cost_usd.toFixed(4)}${a.estimated ? ' (estimated)' : ''} of $${a.budget_usd.toFixed(2)} ceiling`);
  }
  if (status.live_url) console.log(`Live URL          : ${status.live_url}`);
  if (status.error) console.log(`Error             : ${status.error}`);
  for (const n of status.notes) console.log(`Note              : ${n}`);
  console.log('--------------------------------------------');
  console.log(`[status] written to ${p}`);
}

export async function readStatus(baseDir?: string): Promise<RunStatus | null> {
  const p = statusPath(baseDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf-8')) as RunStatus;
  } catch {
    return null;
  }
}

/** Truncate and strip anything that looks like a token before recording. */
export function safeError(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return raw
    .replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, '[redacted-token]')
    .replace(/sk-[A-Za-z0-9-_]{10,}/g, '[redacted-key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [redacted]')
    .slice(0, 600);
}
