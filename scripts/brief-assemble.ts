/**
 * scripts/brief-assemble.ts
 *
 * STAGE 3 of the subscription publishing path. Makes ZERO model calls.
 *
 * Takes the drafts an editor agent wrote from the work packet, rejoins them to
 * the REAL article bodies that brief-prep.ts fetched, and puts the result
 * through every gate the automated path uses: the deterministic editorial
 * firewall, near-duplicate removal, source diversity, the quality floor, and
 * structural validation of the composed edition.
 *
 * WHY THE JOIN MATTERS
 * The drafts file is written by an agent. The bodies are fetched by code. This
 * stage takes the FACTS from the code side and the PROSE from the agent side,
 * and never lets the agent supply its own evidence. An agent cannot tell the
 * firewall that a number was in the article; the firewall reads the article.
 *
 * A draft naming an id that is not in the prepared packet is discarded, loudly.
 * That is the check that catches an agent inventing a story wholesale.
 *
 * USAGE
 *   npm run brief:assemble -- --review-only   compose through every gate,
 *                                             publish nothing, write it out
 *   npm run brief:assemble                    publish for real
 *   npm run brief:assemble -- --date=2026-09-08
 *   npm run brief:assemble -- --drafts=some-other-file.json
 *
 * EXIT CODES
 *   0  published, reviewed, or safely skipped (already published / weekend)
 *   1  refused to publish. The reason is in the RUN REPORT.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { getQueue, putQueue } from './lib/queue-store.js';
import { publish, AI_DISCLOSURE_SUBSCRIPTION } from './brief-publish.js';
import type { AuditedItem, Category, BriefSignal, AuditResult } from './brief-ai.js';
import type { PreparedPacket, PreparedCandidate } from './brief-prep.js';
import { newStatus, writeStatus, safeError, type RunStatus } from './lib/run-status.js';
import { resolveEditionDate, dateArgFrom, sfDateToInstant, isSfWeekday } from './lib/sf-date.js';

const CONTENT_DIR = path.join(process.cwd(), 'src', 'content', 'briefs');
const QUEUE_DIR = path.join(process.cwd(), 'scripts', 'queue');

/** Fixed filename so the operator's daily prompt never has to know the date. */
export const DRAFTS_FILENAME = 'brief-drafts.json';

const REVIEW_FILENAME = (date: string) => `review-edition-${date}.md`;

const VALID_CATEGORIES: readonly string[] = [
  'TRANSIT', 'HOUSING', 'FOOD', 'POLITICS', 'TECH', 'CULTURE',
  'ARTS', 'BUSINESS', 'PUBLIC SAFETY', 'OPENINGS', 'CLOSINGS',
  'WEATHER', 'SPORTS',
];

const VALID_SIGNALS: readonly string[] = [
  'first-to-connect', 'underreported', 'missing-context', 'structural-pattern',
];

// ============ DRAFTS FILE SHAPE ============

export interface DraftEntry {
  id?: string;
  brief_worthy?: boolean;
  reject_reason?: string;
  category?: string;
  brief_signal?: string;
  angle_statement?: string;
  tldr?: string;
  editor_note?: string;
  what_to_watch?: string;
  audit?: Partial<AuditResult>;
}

export interface DraftsFile {
  edition_date?: string;
  editor?: 'Eric' | 'Nicholas' | 'Daisy';
  intro?: string;
  drafts?: DraftEntry[];
}

interface Options {
  editionDate: string;
  reviewOnly: boolean;
  force: boolean;
  allowWeekend: boolean;
  draftsPath: string;
  skipDeploy: boolean;
}

function parseArgs(argv: string[]): Options {
  const draftsArg = argv.find((a) => a.startsWith('--drafts='));
  return {
    editionDate: resolveEditionDate(dateArgFrom(argv)),
    reviewOnly: argv.includes('--review-only'),
    force: argv.includes('--force'),
    allowWeekend: argv.includes('--allow-weekend'),
    skipDeploy: argv.includes('--skip-deploy'),
    draftsPath: path.resolve(
      process.cwd(),
      draftsArg ? draftsArg.split('=').slice(1).join('=') : DRAFTS_FILENAME
    ),
  };
}

/** Reasons a draft never reaches the firewall. Reported, never silently dropped. */
interface RejectedDraft {
  id: string;
  reason: string;
}

export async function assemble(argv: string[] = []): Promise<number> {
  const opts = parseArgs(argv);
  const { editionDate } = opts;
  const status: RunStatus = newStatus(editionDate, opts.reviewOnly);
  status.notes.push('Subscription path: drafting done by an editor agent, no API calls in this process.');

  try {
    // ---- WEEKDAY GATE ----
    if (!opts.allowWeekend && !isSfWeekday(sfDateToInstant(editionDate))) {
      status.final_status = 'green';
      status.outcome = 'weekend_skip';
      status.notes.push(`${editionDate} is a weekend in San Francisco.`);
      await writeStatus(status);
      return 0;
    }

    // ---- IDEMPOTENCY GATE ----
    const existingPath = path.join(CONTENT_DIR, `${editionDate}.md`);
    if (!opts.force && !opts.reviewOnly && existsSync(existingPath)) {
      status.final_status = 'green';
      status.outcome = 'idempotent_skip';
      status.notes.push(`Edition ${editionDate} already exists. Nothing published.`);
      await writeStatus(status);
      return 0;
    }

    // ---- LOAD THE PREPARED PACKET (the evidence side) ----
    const packet = await getQueue<PreparedPacket>(editionDate, 'prepared', { baseDir: QUEUE_DIR });
    if (!packet) {
      throw new Error(
        `No prepared packet for ${editionDate}. Run "npm run brief:prep" first. Assembling without it would mean publishing prose no fetched article backs.`
      );
    }
    if (packet.edition_date !== editionDate) {
      throw new Error(
        `Prepared packet is for ${packet.edition_date}, not ${editionDate}. Refusing to mix editions.`
      );
    }

    status.sources = {
      total: packet.sources.total,
      healthy: packet.sources.healthy,
      failed: packet.sources.failed,
      failed_names: packet.sources.failed_names,
    };
    status.counts.ingested = packet.counts.ingested;
    status.counts.dropped_source_fetch = packet.counts.dropped;

    // ---- LOAD THE DRAFTS (the prose side) ----
    if (!existsSync(opts.draftsPath)) {
      throw new Error(
        `No drafts file at ${opts.draftsPath}. The editor pass has not run, or wrote somewhere else.`
      );
    }
    let draftsFile: DraftsFile;
    try {
      draftsFile = JSON.parse(await readFile(opts.draftsPath, 'utf-8')) as DraftsFile;
    } catch (err) {
      throw new Error(`Drafts file at ${opts.draftsPath} is not valid JSON: ${safeError(err)}`);
    }

    // A drafts file left over from yesterday is the single most likely way to
    // publish the wrong day's edition, and it would look completely normal.
    if (draftsFile.edition_date && draftsFile.edition_date !== editionDate) {
      throw new Error(
        `Drafts file is for ${draftsFile.edition_date} but this run is for ${editionDate}. Refusing to publish a stale drafts file.`
      );
    }
    if (!draftsFile.edition_date) {
      throw new Error(
        `Drafts file has no edition_date. It must state which edition it is for; an undated drafts file cannot be proven current.`
      );
    }

    const drafts = draftsFile.drafts ?? [];
    if (drafts.length === 0) throw new Error('Drafts file contains no drafts.');

    // ---- JOIN ----
    const byId = new Map<string, PreparedCandidate>(packet.ready.map((c) => [c.id, c]));
    const items: AuditedItem[] = [];
    const rejected: RejectedDraft[] = [];
    const seenIds = new Set<string>();

    for (const d of drafts) {
      const id = (d.id ?? '').trim();
      if (!id) {
        rejected.push({ id: '(missing)', reason: 'Draft has no id, so it cannot be matched to a fetched article.' });
        continue;
      }
      if (seenIds.has(id)) {
        rejected.push({ id, reason: 'Duplicate id in the drafts file.' });
        continue;
      }
      seenIds.add(id);

      if (d.brief_worthy === false) continue; // A considered rejection. Not an error.

      const source = byId.get(id);
      if (!source) {
        // THE FABRICATION TRIPWIRE. An id that is not in the packet means the
        // draft is about a story whose article we never retrieved.
        rejected.push({
          id,
          reason: 'No prepared candidate with this id. Nothing verifies this draft, so it cannot be published.',
        });
        continue;
      }

      const audit = normalizeAudit(d.audit);
      if (!audit.audit_pass || audit.recommendation !== 'auto-publish') {
        rejected.push({
          id,
          reason: `Editor self-audit held it: ${audit.fail_reasons.join('; ') || audit.recommendation}`,
        });
        continue;
      }

      const category = VALID_CATEGORIES.includes(String(d.category)) ? (d.category as Category) : undefined;
      if (d.category && !category) {
        rejected.push({ id, reason: `Unknown category "${d.category}".` });
        continue;
      }
      const signal = VALID_SIGNALS.includes(String(d.brief_signal)) ? (d.brief_signal as BriefSignal) : undefined;
      if (d.brief_signal && !signal) {
        rejected.push({ id, reason: `Unknown brief_signal "${d.brief_signal}".` });
        continue;
      }

      items.push({
        ...source,
        // No scoring model ran, so there are no scores. Zeros here are honest
        // absence, not a rating. orderForEdition sorts on these and V8's sort
        // is stable, so an all-zero field preserves the order the EDITOR listed
        // the items in, which is the correct running order on this path.
        scoring: {
          novelty: 0,
          civic_significance: 0,
          sf_specificity: 0,
          uniqueness: 0,
          composite: 0,
          one_line_reason: 'Editor-selected (subscription path; no scoring model ran).',
          outlets_running_this: '',
        },
        category,
        draft: {
          brief_worthy: true,
          category,
          brief_signal: signal,
          angle_statement: d.angle_statement,
          tldr: d.tldr,
          editor_note: d.editor_note,
          what_to_watch: d.what_to_watch,
        },
        audit,
        // Carried straight from the packet, never from the drafts file.
        source_body: source.source_body,
        source_body_word_count: source.source_body_word_count,
      });
    }

    const consideredRejections = drafts.filter((d) => d.brief_worthy === false).length;
    status.counts.drafted = items.length;
    status.counts.audit_passed = items.length;

    console.log(
      `[assemble] ${drafts.length} drafts read: ${items.length} accepted, ${consideredRejections} declined by the editor, ${rejected.length} rejected on join`
    );
    for (const r of rejected) console.warn(`[assemble] REJECTED ${r.id}: ${r.reason}`);

    // An editor agent that never mentions most of the packet has not read it.
    const unaddressed = packet.ready.filter((c) => !seenIds.has(c.id));
    if (unaddressed.length) {
      status.notes.push(
        `${unaddressed.length} of ${packet.ready.length} packet candidates were not addressed in the drafts file.`
      );
      console.warn(
        `[assemble] Not addressed by the editor: ${unaddressed.map((c) => c.id).join(', ')}`
      );
    }

    if (items.length === 0) {
      status.final_status = 'yellow';
      status.outcome = 'no_items_cleared';
      status.error = 'No drafted item survived the join.';
      await writeStatus(status);
      console.error('[assemble] Nothing to publish. This is an editorial outcome, not an infrastructure failure.');
      return 1;
    }

    status.generation_completed = new Date().toISOString();

    // ---- HAND TO THE SHARED PUBLISH PATH ----
    // The audited queue is the seam the automated path already uses, so the
    // firewall, dedupe, diversity, quality floor and structural validation run
    // here in exactly the same code with exactly the same thresholds. There is
    // no relaxed subscription variant of any gate.
    await putQueue(editionDate, 'audited', items, { baseDir: QUEUE_DIR });
    await putQueue(
      editionDate,
      'decisions',
      {
        accepted_held: [],
        rejected_held: [],
        removed_auto: [],
        editor: draftsFile.editor ?? 'Eric',
        edition: undefined,
        published_at: new Date().toISOString(),
        intro: draftsFile.intro,
      },
      { baseDir: QUEUE_DIR }
    );

    const markdown = await publish({
      editionDate,
      queueDir: QUEUE_DIR,
      contentDir: CONTENT_DIR,
      dryRun: opts.reviewOnly,
      skipDeploy: opts.skipDeploy || opts.reviewOnly,
      // A review run must always COMPOSE, never short-circuit on the
      // idempotency gate and hand back the edition already on disk. It writes
      // nothing, so bypassing that gate here is safe.
      force: opts.force || opts.reviewOnly,
      healthySources: packet.sources.healthy,
      totalSources: packet.sources.total,
      aiDisclosure: AI_DISCLOSURE_SUBSCRIPTION,
    });

    status.validation_completed = new Date().toISOString();
    status.counts.published_items = (markdown.match(/^ {2}- id:/gm) ?? []).length;
    status.counts.firewall_removed = Math.max(0, items.length - (status.counts.published_items ?? 0));

    if (opts.reviewOnly) {
      const reviewPath = path.join(process.cwd(), REVIEW_FILENAME(editionDate));
      await writeFile(reviewPath, markdown, 'utf-8');
      status.final_status = 'green';
      status.outcome = 'review_only';
      status.notes.push(`Composed and validated. NOTHING PUBLISHED. Read ${REVIEW_FILENAME(editionDate)}.`);
      await writeStatus(status);
      console.log('');
      console.log(`[assemble] Review edition written to ${reviewPath}`);
      console.log('[assemble] Read it. If it is good, publish with: npm run brief:assemble');
      return 0;
    }

    // ---- THE EDITION IS COMPOSED. IT IS NOT PUBLISHED. ----
    // This stage writes a file to the working tree. Nothing has been committed,
    // pushed, or built, and no reader can see anything.
    //
    // This used to record outcome 'published' and a live_url here, and on
    // 2026-09-11 that produced exactly the failure this project exists to
    // prevent. The edition cleared every gate, got committed, and the push
    // never happened. The status file said green/published with a live_url
    // that returned 404. The terminal line below was accurate and scrolled
    // away; the JSON persisted, and a handoff doc written hours later read the
    // status file and reported the edition as live. A false green propagated
    // into documentation.
    //
    // "Done means verified" is the rule this repository states for the site.
    // It has to apply to the repository's own records first. A field named
    // live_url is a claim about the public internet, and nothing here has
    // touched the public internet, so nothing here may write it.
    //
    // brief-ship.sh promotes this to 'published' with a live_url only after
    // the watchdog confirms a 200.
    status.final_status = 'green';
    status.outcome = 'composed';
    status.notes.push('Composed and written to the content collection. NOT published: not committed, not pushed, not verified live.');
    await writeStatus(status);
    console.log('');
    console.log('[assemble] Edition written. It is NOT live until it is committed, pushed, and Vercel rebuilds.');
    console.log(`[assemble] Verify with: npm run brief:watchdog -- --date=${editionDate}`);
    return 0;
  } catch (err) {
    status.final_status = 'red';
    status.outcome = status.outcome === 'started' ? 'assemble_failed' : status.outcome;
    status.error = safeError(err);
    await writeStatus(status);
    console.error('[assemble] FAILED:', safeError(err));
    return 1;
  }
}

/**
 * Coerce whatever the editor agent wrote into a well-formed audit record.
 *
 * Missing or malformed is treated as NOT passing. An agent that omits the audit
 * block has not done the check, and absence of a check is never evidence of a
 * pass.
 */
function normalizeAudit(a: Partial<AuditResult> | undefined): AuditResult {
  const checks = ['pass', 'fail'] as const;
  const g = (v: unknown): 'pass' | 'fail' => (checks.includes(v as any) ? (v as 'pass' | 'fail') : 'fail');
  const failReasons = Array.isArray(a?.fail_reasons) ? a!.fail_reasons.map(String) : [];
  if (!a) failReasons.push('No audit block supplied by the editor.');

  const result: AuditResult = {
    audit_pass: a?.audit_pass === true,
    check_1_recap: g(a?.check_1_recap),
    check_2_angle: g(a?.check_2_angle),
    check_3_specificity: g(a?.check_3_specificity),
    check_4_word_count: g(a?.check_4_word_count),
    check_5_voice: g(a?.check_5_voice),
    check_6_source_fidelity: g(a?.check_6_source_fidelity),
    fail_reasons: failReasons,
    recommendation: a?.recommendation === 'auto-publish' ? 'auto-publish' : 'hold for editor',
  };

  // An audit that claims to pass while a check failed is internally
  // inconsistent. Trust the individual checks over the summary flag.
  const anyFailed = [
    result.check_1_recap, result.check_2_angle, result.check_3_specificity,
    result.check_4_word_count, result.check_5_voice, result.check_6_source_fidelity,
  ].includes('fail');
  if (anyFailed) {
    result.audit_pass = false;
    result.recommendation = 'hold for editor';
    result.fail_reasons.push('One or more individual checks did not pass.');
  }

  return result;
}

// ============ CLI ============

const isDirect = process.argv[1] && process.argv[1].includes('brief-assemble');
if (isDirect) {
  assemble(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[assemble] FATAL', err);
      process.exit(1);
    });
}
