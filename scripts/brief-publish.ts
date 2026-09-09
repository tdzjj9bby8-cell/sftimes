/**
 * scripts/brief-publish.ts
 *
 * Stage 4 of the Brief pipeline (BRIEF-MASTER-PLAN.md section 6.4).
 *
 * Reads the audited queue + editor decisions and writes a new content
 * collection entry at src/content/briefs/<date>.md. Triggers a Vercel
 * production deploy via webhook. Pings the Indexing API and IndexNow.
 *
 * Inputs:
 *   scripts/queue/<date>-audited.json     (output of brief-ai.ts)
 *   scripts/queue/<date>-decisions.json   (editor accept/reject on held items,
 *                                          written by the dashboard publish action)
 *
 * Editor decisions JSON shape:
 *   {
 *     "accepted_held": ["candidate-id-1", "candidate-id-2", ...],
 *     "rejected_held": [...],
 *     "removed_auto":  [...],   // items the editor pulled from the auto-batch
 *     "edits": {                // optional inline edits per item id
 *       "candidate-id-1": { tldr: "...", editor_note: "...", angle_statement: "...", what_to_watch: "..." }
 *     },
 *     "editor": "Eric",
 *     "edition": 5,
 *     "published_at": "2026-06-14T14:00:00Z"
 *   }
 *
 * If the 7:30 AM hard gate fires without a decisions file, this script
 * still runs with auto-publishing items only, drops held items, and
 * publishes a shorter brief.
 *
 * Usage:
 *   npm run brief:publish -- --date 2026-06-14
 *   npm run brief:publish -- --date 2026-06-14 --skip-deploy   (write file only)
 *   npm run brief:publish -- --date 2026-06-14 --dry-run       (print, don't write)
 *
 * Env:
 *   VERCEL_DEPLOY_HOOK_URL   (required for deploy unless --skip-deploy)
 *   GOOGLE_INDEXING_API_KEY  (optional, used for Indexing API ping)
 */

import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AuditedItem, BriefSignal, Category } from './brief-ai.js';
import { getQueue, putQueue, kvEnabled } from './lib/queue-store.js';
import { sfDateString, resolveEditionDate, dateArgFrom, sfDateToInstant } from './lib/sf-date.js';
import { validateBatch, canonicalUrl } from './lib/editorial-firewall.js';
import {
  removeNearDuplicates,
  enforceSourceDiversity,
  orderForEdition,
  evaluateQualityFloor,
  MIN_HEALTHY_SOURCES,
} from './lib/editorial-quality.js';

// ============ CONFIG ============

const SITE_ORIGIN = 'https://sftimes.com';
const CONTENT_DIR_DEFAULT = path.join(process.cwd(), 'src', 'content', 'briefs');

// GitHub Contents API target. The git repo root IS the astro/ directory, so the
// content-collection path is repo-relative `src/content/briefs/...` (NOT
// `astro/src/content/briefs/...`). Committing to the wrong path would land the
// file where Vercel never builds it.
const GITHUB_REPO = 'tdzjj9bby8-cell/sftimes';
const GITHUB_API = 'https://api.github.com';
const BOT_NAME = 'SF Times Brief Bot';
const BOT_EMAIL = 'brief-bot@sftimes.com';

interface Decisions {
  accepted_held: string[];
  rejected_held: string[];
  removed_auto: string[];
  edits?: Record<string, ItemEdits>;
  editor: 'Eric' | 'Nicholas' | 'Daisy';
  edition: number;
  published_at: string;
  intro?: string;
}

interface ItemEdits {
  tldr?: string;
  editor_note?: string;
  angle_statement?: string;
  what_to_watch?: string;
}

// ============ ENTRYPOINT ============

interface RunOpts {
  runDate?: Date;
  queueDir?: string;
  contentDir?: string;
  skipDeploy?: boolean;
  dryRun?: boolean;
  /** Explicit YYYY-MM-DD edition date. Wins over runDate. */
  editionDate?: string;
  /** Bypass the idempotency gate. Only for a deliberate republish of a day
   *  whose edition file was removed on purpose. Never set this in automation. */
  force?: boolean;
  /** Feed-health context from the ingest stage, used by the quality floor. */
  healthySources?: number;
  totalSources?: number;
  /** How this edition was produced, in reader-facing language. Defaults to the
   *  automated-path statement; the manual path passes its own, because the two
   *  processes are genuinely different and the disclosure is an accuracy claim
   *  rather than boilerplate. */
  aiDisclosure?: string;
}

export async function publish(opts: RunOpts = {}): Promise<string> {
  const runDate = opts.runDate ?? new Date();
  const queueDir = opts.queueDir ?? path.join(process.cwd(), 'scripts', 'queue');
  const contentDir = opts.contentDir ?? CONTENT_DIR_DEFAULT;
  // San Francisco calendar date, never the runner's UTC date.
  const dateString = opts.editionDate ?? sfDateString(runDate);

  // ---- IDEMPOTENCY GATE ----
  // The published edition file in the content collection is the source of
  // truth. If it already exists, this date has shipped and a second run must
  // not compose a new edition, bump the edition number, or overwrite good
  // content. Reruns are expected: the workflow can be retried, and a manual
  // dispatch may race a scheduled run.
  const existingPath = path.join(contentDir, `${dateString}.md`);
  if (!opts.force && existsSync(existingPath)) {
    console.log(`[publish] Edition ${dateString} already exists at ${existingPath}. Nothing to do.`);
    console.log('[publish] IDEMPOTENT_SKIP');
    return await readFile(existingPath, 'utf-8');
  }

  console.log(`[publish] Loading audited queue for ${dateString} (${kvEnabled() ? 'KV' : 'filesystem'})`);
  const audited = await getQueue<AuditedItem[]>(dateString, 'audited', { baseDir: queueDir });
  if (!audited) {
    throw new Error(`No audited queue for ${dateString}. Run brief-ai for that date first.`);
  }

  const decisions = await getQueue<Decisions>(dateString, 'decisions', { baseDir: queueDir });
  if (decisions) {
    console.log(`[publish] Editor decisions loaded`);
  } else {
    console.warn(`[publish] No decisions. Hard gate may have fired. Publishing auto-batch only.`);
  }

  // Auto-publishing batch: audit_pass items not removed by editor and not spot-check
  const autoBatch = audited.filter(
    (a) =>
      a.audit?.audit_pass &&
      !a.audit.spot_check &&
      !(decisions?.removed_auto ?? []).includes(a.id)
  );

  // Held items that the editor accepted
  const acceptedHeld = audited.filter((a) =>
    (decisions?.accepted_held ?? []).includes(a.id) && a.audit
  );

  const selected = [...autoBatch, ...acceptedHeld];

  // ---- DETERMINISTIC EDITORIAL FIREWALL ----
  // The model auditor checks craft. This checks facts. Every asserted number
  // and quotation must be traceable to the fetched source body, the source must
  // be real and retrieved, and the story must not already have run. Items that
  // fail are removed, never repaired. See scripts/lib/editorial-firewall.ts.
  const priorUrls = await collectPublishedSourceUrls(contentDir, dateString);
  const firewall = validateBatch(selected as any[], {
    publishedSourceUrls: priorUrls,
    editionDate: dateString,
  });

  for (const r of firewall.removed) {
    const id = (r.item as AuditedItem).id;
    const outlet = (r.item as AuditedItem).source_outlet;
    console.warn(`[publish] FIREWALL REMOVED ${id} (${outlet}):`);
    for (const v of r.violations) console.warn(`[publish]   [${v.check}] ${v.detail}`);
  }

  if (firewall.blockEdition) {
    throw new Error('Editorial firewall raised a block_edition violation. Refusing to publish.');
  }

  const verified = firewall.kept as AuditedItem[];

  console.log(
    `[publish] Firewall: ${verified.length} passed, ${firewall.removed.length} removed of ${selected.length} selected`
  );

  // ---- EDITORIAL QUALITY: duplicates, then diversity, then ordering ----
  // Accuracy is not sufficiency. Six true items about the same event from the
  // same outlet is a technically-correct failure of the product.
  const deduped = removeNearDuplicates(verified as any[]);
  for (const r of deduped.removed) {
    console.warn(
      `[publish] NEAR-DUPLICATE removed ${(r.item as AuditedItem).id} (similarity ${r.similarity} vs ${r.duplicateOf})`
    );
  }

  const diverse = enforceSourceDiversity(deduped.kept as any[]);
  for (const r of diverse.removed) {
    console.warn(`[publish] DIVERSITY removed ${(r.item as AuditedItem).id}: ${r.reason}`);
  }

  const final = orderForEdition(diverse.kept as any[]) as AuditedItem[];

  // ---- EDITORIAL QUALITY FLOOR ----
  const floor = evaluateQualityFloor({
    itemCount: final.length,
    // Source health is evaluated upstream in brief-run.ts, which knows the feed
    // results. Publishing on its own passes neutral values so a direct
    // brief-publish invocation is not blocked by data it cannot see.
    healthySources: opts.healthySources ?? MIN_HEALTHY_SOURCES,
    totalSources: opts.totalSources ?? MIN_HEALTHY_SOURCES,
    outletCounts: diverse.outletCounts,
    pipelineErrors: 0,
    candidatesIngested: audited.length,
  });

  if (!floor.publish) {
    for (const r of floor.reasons) console.error(`[publish] QUALITY FLOOR: ${r}`);
    throw new Error(`Empty brief: quality floor not met. ${floor.reasons.join(' ')}`);
  }

  console.log(
    `[publish] Quality: ${deduped.removed.length} near-duplicates, ${diverse.removed.length} over-concentration, outlets ${JSON.stringify(diverse.outletCounts)}`
  );

  if (final.length === 0) {
    console.error(`[publish] No items survived the editorial gates. Aborting.`);
    throw new Error('Empty brief: refusing to publish a zero-item edition');
  }

  console.log(`[publish] Final brief: ${autoBatch.length} auto + ${acceptedHeld.length} accepted held, ${final.length} after firewall`);

  // Compose the content collection markdown
  const editor = decisions?.editor ?? 'Eric';
  const edition = decisions?.edition ?? (await nextEdition(contentDir));
  const intro = decisions?.intro;
  const markdown = composeMarkdown({
    // Derive the composition date FROM the resolved edition date, never from
    // the ambient clock. `runDate` is whatever moment the process started, and
    // any run after 5pm Pacific is already tomorrow in UTC, so passing it here
    // wrote a frontmatter date one day ahead of the file it was being written
    // to. That is the same off-by-one the rest of the pipeline was hardened
    // against; this was the last place still trusting `new Date()`.
    //
    // Caught by validateComposedEdition below rather than by a reader, which
    // is what that check is for.
    date: sfDateToInstant(dateString),
    edition,
    editor,
    intro,
    items: final,
    edits: decisions?.edits ?? {},
    aiDisclosure: opts.aiDisclosure ?? AI_DISCLOSURE_AUTOPUBLISH,
  });

  // ---- STRUCTURAL VALIDATION BEFORE ANYTHING IS WRITTEN ----
  // The Astro build happens on Vercel after the push, so malformed frontmatter
  // fails there, not here. Validating now converts a silent stale-site incident
  // into a loud run failure.
  const structure = validateComposedEdition(markdown, dateString);
  if (!structure.valid) {
    for (const e of structure.errors) console.error(`[publish] MALFORMED EDITION: ${e}`);
    throw new Error(
      `Composed edition failed structural validation (${structure.errors.length} error(s)). Refusing to write or push.`
    );
  }
  console.log('[publish] Composed edition passed structural validation.');

  if (opts.dryRun) {
    console.log('=== DRY RUN ===');
    console.log(markdown);
    return markdown;
  }

  // Persist the edition. In production commit the markdown to the repo via the
  // GitHub Contents API: Vercel's function filesystem is read-only, and a write
  // there would never reach the deployed site anyway. The commit to main
  // auto-triggers a Vercel rebuild. For local dev without a token, write to the
  // filesystem so the content collection works offline.
  const repoPath = `src/content/briefs/${dateString}.md`;
  const commitMessage = `Publish Brief edition ${dateString}`;
  let deployedViaCommit = false;

  if (githubEnabled()) {
    const commitUrl = await commitBriefToGitHub(repoPath, markdown, commitMessage);
    console.log(`[publish] Committed ${repoPath} to ${GITHUB_REPO}: ${commitUrl}`);
    deployedViaCommit = true;
  } else {
    console.log(`[publish] GITHUB_TOKEN unset. Intended request: PUT ${GITHUB_API}/repos/${GITHUB_REPO}/contents/${repoPath} (${Buffer.byteLength(markdown, 'utf-8')} bytes, message "${commitMessage}"). Writing to the local filesystem instead (dev mode).`);
    if (!existsSync(contentDir)) await mkdir(contentDir, { recursive: true });
    const outputPath = path.join(contentDir, `${dateString}.md`);
    await writeFile(outputPath, markdown, 'utf-8');
    console.log(`[publish] Wrote ${outputPath}`);
  }

  // Log the edit deltas for the audit trail (via the queue store so it persists
  // on Vercel's read-only filesystem too).
  await writeAuditLog(dateString, audited, decisions, queueDir);

  // Record a published marker so later runs (and the hard gate) know this
  // edition already shipped. Vercel KV in production, filesystem for local dev.
  await putQueue(dateString, 'published', {
    date: dateString,
    edition,
    item_count: final.length,
    editor,
    published_at: decisions?.published_at ?? new Date().toISOString(),
  }, { baseDir: queueDir });

  if (opts.skipDeploy) {
    console.log('[publish] --skip-deploy: skipping deploy trigger and indexing pings');
  } else {
    // A GitHub commit already triggers Vercel's rebuild; only hit the deploy
    // hook on the local/webhook path where nothing was pushed.
    if (!deployedViaCommit) await triggerDeploy();
    await pingIndexingApis(dateString, final);
  }

  console.log(`[publish] OK ${dateString}`);
  return markdown;
}

// ============ EDITOR-DRIVEN PUBLISH (Path 3 promote) ============
//
// The dashboard POSTs the editor's promoted items directly (already reviewed and
// edited). This path does NOT read the audited queue or a decisions record from
// KV: the POST body is the source of truth for what the editor promoted.
//
// Under Path 3 the Cowork task has usually ALREADY auto-published the day's
// edition from the audit-passing items. So mode 'promote' MERGES the promoted
// items into that existing edition (append items, keep its edition number) and
// composes a fresh edition only when no file exists for the date yet, which is
// the day where zero items cleared the audit. Composing fresh over an existing
// edition would drop every auto-published item off the live brief, which is why
// merge is the default for the dashboard.

/** One accepted item as the dashboard POSTs it. Flat, self-contained: no nested
 *  scoring/draft/audit. Every field the content collection needs is here. */
export interface PublishItemInput {
  id?: string;
  slug?: string;
  category?: string;
  signal?: string;
  source_headline: string;
  source_outlet: string;
  source_byline?: string;
  source_url: string;
  source_date: string;
  composite_score?: number;
  uniqueness_score?: number;
  angle_statement: string;
  tldr: string;
  editor_note: string;
  what_to_watch: string;
}

export interface PublishFromItemsArgs {
  date: string; // YYYY-MM-DD
  editor?: 'Eric' | 'Nicholas' | 'Daisy';
  edition?: number;
  intro?: string;
  items: PublishItemInput[];
  contentDir?: string;
  dryRun?: boolean;
  /** 'promote' (dashboard default) merges into an existing edition for the date
   *  when one is present. 'replace' always composes a fresh edition, overwriting
   *  whatever is there. Only use 'replace' when you intend to discard the
   *  auto-published items. */
  mode?: 'promote' | 'replace';
}

export interface PublishFromItemsResult {
  markdown: string;
  committed: boolean;
  commitUrl?: string;
  path: string;
  edition: number;
  /** Total items in the resulting edition (existing + promoted when merging). */
  item_count: number;
  /** Number of items this call contributed. */
  promoted_count: number;
  /** True when the items were appended to an edition that already existed. */
  merged: boolean;
}

/** Compose or extend an edition from the editor-promoted items the dashboard
 *  POSTs. Refuses a zero-item call. In 'promote' mode (the default) an existing
 *  edition for the date is appended to rather than overwritten. Commits via
 *  GitHub in production, writes to the local content collection in dev (no
 *  token). Never reads KV. */
export async function publishFromItems(args: PublishFromItemsArgs): Promise<PublishFromItemsResult> {
  const contentDir = args.contentDir ?? CONTENT_DIR_DEFAULT;
  const items = args.items ?? [];
  if (items.length === 0) {
    throw new Error('Empty brief: refusing to publish a zero-item edition');
  }

  const editor = args.editor ?? 'Eric';
  const mode = args.mode ?? 'promote';
  const repoPath = `src/content/briefs/${args.date}.md`;

  // Look for an edition the Cowork task already auto-published for this date.
  // Skipped in 'replace' mode, where the caller has said to start clean.
  const existing = mode === 'promote' ? await readExistingEdition(repoPath, contentDir, args.date) : null;

  let markdown: string;
  let edition: number;
  let itemCount: number;
  let merged: boolean;
  let commitMessage: string;

  if (existing) {
    const spliced = appendItemsToEdition(existing, items, args.date);
    markdown = spliced.markdown;
    edition = spliced.edition;
    itemCount = spliced.item_count;
    merged = true;
    commitMessage = `Brief ${args.date}: promote ${items.length} audit-flagged item${items.length === 1 ? '' : 's'} into edition ${edition}`;
  } else {
    edition = args.edition ?? (await nextEdition(contentDir));
    markdown = composeMarkdownFromInputs({
      date: args.date,
      edition,
      editor,
      intro: args.intro,
      items,
    });
    itemCount = items.length;
    merged = false;
    commitMessage = `Publish Brief edition ${args.date}`;
  }

  const result = {
    markdown,
    path: repoPath,
    edition,
    item_count: itemCount,
    promoted_count: items.length,
    merged,
  };

  if (args.dryRun) {
    return { ...result, committed: false };
  }

  if (githubEnabled()) {
    const commitUrl = await commitBriefToGitHub(repoPath, markdown, commitMessage);
    console.log(`[publishFromItems] ${merged ? 'Merged into' : 'Committed'} ${repoPath}: ${commitUrl}`);
    return { ...result, committed: true, commitUrl };
  }

  // Dev fallback (no GITHUB_TOKEN): write to the local content collection so the
  // editor can preview offline. Nothing is pushed.
  if (!existsSync(contentDir)) await mkdir(contentDir, { recursive: true });
  await writeFile(path.join(contentDir, `${args.date}.md`), markdown, 'utf-8');
  console.log(`[publishFromItems] GITHUB_TOKEN unset. Wrote ${repoPath} to the local filesystem (dev mode).`);
  return { ...result, committed: false };
}

/** Read the edition already published for a date, or null if there is none.
 *  Prefers GitHub when a token is present: that is the authoritative copy, and
 *  the serverless bundle can be a rebuild behind if the editor promotes before
 *  the auto-publish deploy finishes. Falls back to the local content dir. */
async function readExistingEdition(repoPath: string, contentDir: string, date: string): Promise<string | null> {
  if (githubEnabled()) {
    const token = process.env.GITHUB_TOKEN as string;
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/contents/${repoPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'sftimes-brief-bot',
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      // Fail loud. Guessing "no edition exists" here would overwrite a live one.
      throw new Error(`GitHub GET ${repoPath} failed: HTTP ${res.status} ${await res.text()}`);
    }
    return await res.text();
  }

  const localPath = path.join(contentDir, `${date}.md`);
  if (!existsSync(localPath)) return null;
  const { readFile } = await import('node:fs/promises');
  return await readFile(localPath, 'utf-8');
}

/** Append promoted items to an existing edition's `items:` list.
 *
 *  Splices YAML text rather than round-tripping through a parser: the edition is
 *  a live reader surface, and a re-serialize would reformat the task-written
 *  frontmatter (intro, ai_disclosure, block scalars) for no reason. Everything
 *  already in the file is left byte-identical; only new item blocks are inserted
 *  ahead of the closing `---`.
 *
 *  Item ids continue the existing numbering so a promoted item never collides
 *  with an auto-published one. */
function appendItemsToEdition(
  existing: string,
  items: PublishItemInput[],
  date: string,
): { markdown: string; edition: number; item_count: number } {
  if (!existing.startsWith('---')) {
    throw new Error(`Existing edition for ${date} has no frontmatter block. Refusing to merge into it.`);
  }
  // Closing fence of the frontmatter: first line that is exactly `---` after the
  // opening one. Item bodies are indented at least two spaces, so a bare `---`
  // at column zero can only be the fence.
  const closeIdx = existing.indexOf('\n---', 3);
  if (closeIdx === -1) {
    throw new Error(`Existing edition for ${date} has an unterminated frontmatter block. Refusing to merge into it.`);
  }

  const frontmatter = existing.slice(0, closeIdx);
  const editionMatch = frontmatter.match(/^edition:\s*(\d+)\s*$/m);
  if (!editionMatch) {
    throw new Error(`Existing edition for ${date} has no readable edition number. Refusing to merge into it.`);
  }
  const edition = Number(editionMatch[1]);

  if (!/^items:\s*$/m.test(frontmatter)) {
    throw new Error(`Existing edition for ${date} has no items: list. Refusing to merge into it.`);
  }
  const existingCount = (frontmatter.match(/^ {2}- id:/gm) ?? []).length;

  const appended = items
    .map((item, i) => composeInputItemYaml(item, date, existingCount + i))
    .join('\n');

  const markdown = `${frontmatter.replace(/\s*$/, '')}\n${appended}${existing.slice(closeIdx)}`;
  return { markdown, edition, item_count: existingCount + items.length };
}

// ============ AI DISCLOSURE ============
//
// Two variants, because the two publish paths are genuinely different processes
// and the disclosure is a reader-facing accuracy claim, not boilerplate.

/** Canonical Path 3 disclosure. Used by the Cowork task for the auto-published
 *  edition (BRIEF-COWORK-PLAYBOOK.md Stage 6a). Every item in such an edition
 *  cleared all five firewall checks. */
export const AI_DISCLOSURE_AUTOPUBLISH =
  "Produced by a scheduled Cowork task using Claude Sonnet reasoning on the editor's personal subscription. Every item's TLDR and editor's note passed a 5-check firewall audit before publishing. Items that fail the audit are quarantined for editor review and do not appear here. Full pipeline at /brief/methodology.";

/** Used when the editor composes an edition entirely from promoted items, which
 *  only happens on a day where nothing cleared the audit. Saying these items
 *  "passed the audit" would be false, so this variant says what actually
 *  happened. */
export const AI_DISCLOSURE_EDITOR_PROMOTED =
  "Produced by a scheduled Cowork task using Claude Sonnet reasoning on the editor's personal subscription. No item in this edition cleared the automated 5-check firewall audit; every one was quarantined, then read, edited, and promoted by the editor before publishing. Full pipeline at /brief/methodology.";

/** The manual subscription path (brief-prep -> editor agent -> brief-assemble).
 *
 *  Written separately because the other two variants describe a second AI
 *  auditing the first, and on this path that is not what happens: the checks
 *  are deterministic code reading the fetched article, and a human approves the
 *  edition before it ships. Describing the process inaccurately would be the
 *  same category of error the firewall exists to prevent, so the disclosure
 *  gets the same care as the copy. */
export const AI_DISCLOSURE_SUBSCRIPTION =
  "Drafted with AI assistance from the full text of each linked article, on the editor's personal subscription. Every figure, quotation and attribution was then checked automatically against that article text by deterministic code, not by another AI; items that failed were removed, not rewritten. The editor read and approved this edition before it published. AI does not write the news. Original reporting is always linked and always credited. Full pipeline at /brief/methodology.";

const VALID_CATEGORIES = ['TRANSIT', 'HOUSING', 'FOOD', 'POLITICS', 'TECH', 'CULTURE', 'ARTS', 'BUSINESS', 'PUBLIC SAFETY', 'OPENINGS', 'CLOSINGS', 'WEATHER', 'SPORTS'];
const VALID_SIGNALS = ['first-to-connect', 'underreported', 'missing-context', 'structural-pattern'];

function sanitizeCategory(c?: string): string {
  // Normalize before matching: models return trailing whitespace, lowercase,
  // and stray punctuation. Falling back to POLITICS on a recoverable value
  // would mislabel real items, so trim and upcase first.
  const norm = String(c ?? '').trim().toUpperCase().replace(/[^A-Z ]/g, '');
  return VALID_CATEGORIES.includes(norm) ? norm : 'POLITICS';
}
function sanitizeSignal(s?: string): string {
  const norm = String(s ?? '').trim().toLowerCase();
  return VALID_SIGNALS.includes(norm) ? norm : 'underreported';
}
function clampUniqueness(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(10, v));
}

function composeMarkdownFromInputs(args: {
  date: string;
  edition: number;
  editor: 'Eric' | 'Nicholas' | 'Daisy';
  intro?: string;
  items: PublishItemInput[];
}): string {
  const sorted = [...args.items].sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0));
  const itemsYaml = sorted.map((item, i) => composeInputItemYaml(item, args.date, i)).join('\n');
  const lines = [
    '---',
    `date: ${args.date}`,
    `edition: ${args.edition}`,
    `editor: ${args.editor}`,
  ];
  if (args.intro) {
    lines.push('intro: |');
    for (const line of args.intro.split('\n')) lines.push(`  ${line}`);
  }
  // This composer only runs on the editor-promoted path, so it always carries
  // the promoted-items disclosure rather than the auto-publish one.
  lines.push(`ai_disclosure: ${yamlString(AI_DISCLOSURE_EDITOR_PROMOTED)}`);
  lines.push('items:');
  lines.push(itemsYaml);
  lines.push('---');
  lines.push('');
  const human = new Date(args.date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  lines.push(`Edition №${String(args.edition).padStart(2, '0')} of the daily Brief, published ${human}.`);
  lines.push('');
  return lines.join('\n');
}

function composeInputItemYaml(item: PublishItemInput, briefDate: string, index: number): string {
  const slug = item.slug ? slugify(item.slug) : slugify(item.source_headline);
  const indent = '  ';
  const lines: string[] = [];
  lines.push(`${indent}- id: ${briefDate}-${String(index + 1).padStart(3, '0')}`);
  lines.push(`${indent}  slug: ${slug}`);
  lines.push(`${indent}  category: ${sanitizeCategory(item.category)}`);
  lines.push(`${indent}  signal: ${sanitizeSignal(item.signal)}`);
  lines.push(`${indent}  source_headline: ${yamlString(item.source_headline ?? '')}`);
  lines.push(`${indent}  source_outlet: ${yamlString(item.source_outlet ?? '')}`);
  lines.push(`${indent}  source_byline: ${yamlString(item.source_byline || 'Staff')}`);
  lines.push(`${indent}  source_url: ${yamlString(item.source_url ?? '')}`);
  lines.push(`${indent}  source_date: ${(item.source_date || briefDate).slice(0, 10)}`);
  lines.push(`${indent}  composite_score: ${Number(item.composite_score ?? 0)}`);
  lines.push(`${indent}  uniqueness_score: ${clampUniqueness(item.uniqueness_score)}`);
  lines.push(`${indent}  auto_published: false`);
  lines.push(`${indent}  angle_statement: ${yamlString(item.angle_statement || '')}`);
  lines.push(`${indent}  tldr: ${yamlString(item.tldr || '')}`);
  lines.push(`${indent}  editor_note: |`);
  for (const noteLine of (item.editor_note || '').split('\n')) lines.push(`${indent}    ${noteLine}`);
  lines.push(`${indent}  what_to_watch: ${yamlString(item.what_to_watch || '')}`);
  return lines.join('\n');
}

// ============ MARKDOWN COMPOSITION ============

interface ComposeArgs {
  date: Date;
  edition: number;
  editor: 'Eric' | 'Nicholas' | 'Daisy';
  intro?: string;
  items: AuditedItem[];
  edits: Record<string, ItemEdits>;
  /** Reader-facing description of how this edition was produced. Required
   *  rather than defaulted: the content schema has a default, and relying on it
   *  is how an edition ends up carrying a description of a process that is no
   *  longer the one that made it. */
  aiDisclosure: string;
}

function composeMarkdown(args: ComposeArgs): string {
  const sorted = [...args.items].sort((a, b) => (b.scoring?.composite ?? 0) - (a.scoring?.composite ?? 0));
  const dateIso = args.date.toISOString().slice(0, 10);

  const itemsYaml = sorted.map((item) => composeItemYaml(item, args.edits[item.id], dateIso)).join('\n');
  const lines = [
    '---',
    `date: ${dateIso}`,
    `edition: ${args.edition}`,
    `editor: ${args.editor}`,
  ];
  if (args.intro) {
    lines.push('intro: |');
    for (const line of args.intro.split('\n')) lines.push(`  ${line}`);
  }
  lines.push(`ai_disclosure: ${yamlString(args.aiDisclosure)}`);
  lines.push('items:');
  lines.push(itemsYaml);
  lines.push('---');
  lines.push('');
  lines.push(`Edition №${String(args.edition).padStart(2, '0')} of the daily Brief, published ${args.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`);
  lines.push('');
  return lines.join('\n');
}

function composeItemYaml(item: AuditedItem, edits: ItemEdits | undefined, briefDate: string): string {
  const draft = item.draft;
  const tldr = edits?.tldr ?? draft.tldr ?? '';
  const editorNote = (edits?.editor_note ?? draft.editor_note ?? '').trim();
  const angle = edits?.angle_statement ?? draft.angle_statement ?? '';
  const watch = edits?.what_to_watch ?? draft.what_to_watch ?? '';

  const slug = slugify(`${item.id.slice(1, 7)}-${item.original_headline}`);

  const indent = '  ';
  const lines: string[] = [];
  lines.push(`${indent}- id: ${briefDate}-${item.id.slice(1, 4)}`);
  // A slug that normalizes to empty would emit `slug:` with no value and fail
  // the content-collection schema at build time, on Vercel, after the push.
  lines.push(`${indent}  slug: ${slug || `item-${item.id.slice(1, 7)}`}`);
  // category and signal are Zod enums in src/content/config.ts. Writing a raw
  // model response here (a stray "TRANSPORTATION", or trailing whitespace) is
  // the single most likely way to push content that breaks the Astro build:
  // the workflow goes green, the push succeeds, and the site quietly stops
  // updating. Always sanitize to a known-valid enum value.
  lines.push(`${indent}  category: ${sanitizeCategory(item.category)}`);
  lines.push(`${indent}  signal: ${sanitizeSignal(draft.brief_signal)}`);
  lines.push(`${indent}  source_headline: ${yamlString(item.original_headline)}`);
  lines.push(`${indent}  source_outlet: ${yamlString(item.source_outlet)}`);
  lines.push(`${indent}  source_byline: ${yamlString(item.source_byline)}`);
  lines.push(`${indent}  source_url: ${yamlString(item.source_url)}`);
  // published_at can be absent or malformed on a sparse feed. An empty value
  // here emits `source_date:` and fails the schema's date coercion.
  const sourceDate = /^\d{4}-\d{2}-\d{2}/.test(item.published_at ?? '')
    ? item.published_at.slice(0, 10)
    : briefDate;
  lines.push(`${indent}  source_date: ${sourceDate}`);
  // Scores are OMITTED, not zeroed, when no scoring model ran. On the manual
  // path an editor picked the item from the article text and there is no score
  // to record. Writing 0 was both untrue and invalid: the schema requires
  // uniqueness to be 1-10, so a zero passed the composed-edition check and then
  // failed the Astro build, which is precisely the silent-stale-site failure
  // the build-before-push step exists to catch. Absent is the honest value.
  const composite = safeNumber(item.scoring?.composite);
  const uniqueness = safeNumber(item.scoring?.uniqueness);
  if (composite > 0) lines.push(`${indent}  composite_score: ${composite}`);
  if (uniqueness > 0) lines.push(`${indent}  uniqueness_score: ${clampUniqueness(uniqueness)}`);
  lines.push(`${indent}  auto_published: ${item.audit?.audit_pass && !item.audit.spot_check}`);
  lines.push(`${indent}  angle_statement: ${yamlString(angle)}`);
  lines.push(`${indent}  tldr: ${yamlString(tldr)}`);
  lines.push(`${indent}  editor_note: |`);
  for (const noteLine of editorNote.split('\n')) lines.push(`${indent}    ${noteLine}`);
  lines.push(`${indent}  what_to_watch: ${yamlString(watch)}`);
  return lines.join('\n');
}

function yamlString(s: string): string {
  // Always quote with double quotes and escape internal double quotes +
  // backslashes. Newlines are collapsed: a raw newline inside a double-quoted
  // scalar produces YAML that either fails to parse or silently reflows, and
  // every field using this helper is a single-line field.
  const flat = String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  return `"${flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Guard against NaN/Infinity reaching the frontmatter as a bare token. */
function safeNumber(n: unknown, fallback = 0): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function nextEdition(contentDir: string): Promise<number> {
  if (!existsSync(contentDir)) return 1;
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(contentDir);
  return files.filter((f) => f.endsWith('.md')).length + 1;
}

// ============ COMPOSED-EDITION VALIDATION ============

/**
 * Structurally validate the composed markdown BEFORE it is written or pushed.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * The Astro build runs on Vercel, AFTER the push. So malformed frontmatter
 * does not fail here, it fails there: the workflow goes green, the commit
 * lands, and the site silently stops updating while serving the previous
 * edition. That is the exact "successful Action, unsuccessful publication"
 * failure. Catching it pre-push turns a silent stale-site incident into a
 * loud, actionable run failure.
 *
 * Intentionally a lightweight structural check, not a YAML parser dependency.
 */
export function validateComposedEdition(
  markdown: string,
  expectedDate: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!markdown.startsWith('---\n')) {
    errors.push('Markdown does not begin with a frontmatter fence.');
    return { valid: false, errors };
  }
  const end = markdown.indexOf('\n---', 4);
  if (end < 0) {
    errors.push('Frontmatter fence is not closed.');
    return { valid: false, errors };
  }
  const fm = markdown.slice(4, end);

  // Required top-level fields.
  if (!new RegExp(`^date:\\s*${expectedDate}\\s*$`, 'm').test(fm)) {
    errors.push(`Frontmatter date is missing or does not equal ${expectedDate}.`);
  }
  if (!/^edition:\s*\d+\s*$/m.test(fm)) errors.push('Frontmatter edition is missing or not a number.');
  if (!/^editor:\s*\S+/m.test(fm)) errors.push('Frontmatter editor is missing.');
  if (!/^items:\s*$/m.test(fm)) errors.push('Frontmatter items block is missing.');

  // Per-item structural checks.
  const ids = fm.match(/^\s*- id:\s*\S+/gm) ?? [];
  if (ids.length === 0) errors.push('Edition contains zero items.');

  const categories = fm.match(/^\s*category:\s*(.+)$/gm) ?? [];
  for (const c of categories) {
    const val = c.split(':').slice(1).join(':').trim();
    if (!VALID_CATEGORIES.includes(val)) errors.push(`Invalid category "${val}" would fail the content schema.`);
  }
  const signals = fm.match(/^\s*signal:\s*(.+)$/gm) ?? [];
  for (const s of signals) {
    const val = s.split(':').slice(1).join(':').trim();
    if (!VALID_SIGNALS.includes(val)) errors.push(`Invalid signal "${val}" would fail the content schema.`);
  }

  // Empty required string fields emit `field:` with nothing after it.
  for (const field of ['slug', 'source_headline', 'source_outlet', 'source_url', 'tldr', 'angle_statement']) {
    const empties = fm.match(new RegExp(`^\\s*${field}:\\s*(""|'')?\\s*$`, 'gm')) ?? [];
    if (empties.length) errors.push(`${empties.length} item(s) have an empty ${field}.`);
  }

  // Counts must line up, otherwise an item is half-written.
  const slugs = (fm.match(/^\s*slug:\s*\S+/gm) ?? []).length;
  const urls = (fm.match(/^\s*source_url:\s*\S+/gm) ?? []).length;
  if (ids.length !== slugs || ids.length !== urls) {
    errors.push(`Partial item detected: ${ids.length} ids, ${slugs} slugs, ${urls} source_urls.`);
  }

  // Numeric fields must satisfy the content schema's RANGES, not merely be
  // numbers. A uniqueness_score of 0 is a number, passed every check above,
  // and then failed the Astro build with "must be greater than or equal to 1".
  // The build-before-push step caught it, which is what that step is for, but
  // this validator exists so a schema break is a loud failure HERE rather than
  // a red build after the content has already been composed.
  for (const m of fm.matchAll(/^\s*uniqueness_score:\s*(\S+)\s*$/gm)) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      errors.push(`uniqueness_score "${m[1]}" is outside the schema's 1-10 integer range. Omit the field when no scoring model ran.`);
    }
  }
  for (const m of fm.matchAll(/^\s*composite_score:\s*(\S+)\s*$/gm)) {
    if (!Number.isFinite(Number(m[1]))) {
      errors.push(`composite_score "${m[1]}" is not a number.`);
    }
  }

  // Every source_url must be a real http(s) URL, so no broken links ship.
  for (const m of fm.matchAll(/^\s*source_url:\s*"?([^"\n]+)"?\s*$/gm)) {
    const u = (m[1] ?? '').trim();
    if (!/^https?:\/\/\S+$/.test(u)) errors.push(`Malformed source_url: "${u.slice(0, 80)}"`);
  }

  return { valid: errors.length === 0, errors };
}

// ============ DUPLICATE-STORY GUARD ============

/**
 * Collect every source URL already used in a published edition, so the same
 * story cannot run twice across days. Reads the content collection directly,
 * which is the durable record. Excludes the edition currently being built.
 *
 * Failure here is non-fatal: an unreadable content dir degrades to "no known
 * prior URLs" rather than blocking publication, because the duplicate check is
 * a quality guard, not a safety guard.
 */
async function collectPublishedSourceUrls(
  contentDir: string,
  excludeDate: string
): Promise<Set<string>> {
  const urls = new Set<string>();
  try {
    if (!existsSync(contentDir)) return urls;
    const files = (await readdir(contentDir)).filter(
      (f) => f.endsWith('.md') && f !== `${excludeDate}.md`
    );
    for (const f of files) {
      const raw = await readFile(path.join(contentDir, f), 'utf-8');
      for (const m of raw.matchAll(/source_url:\s*["']?(\S+?)["']?\s*$/gm)) {
        if (m[1]) urls.add(canonicalUrl(m[1]));
      }
    }
  } catch (err) {
    console.warn(`[publish] Could not scan prior editions for duplicates: ${String(err).slice(0, 120)}`);
  }
  return urls;
}

// ============ AUDIT LOG ============

async function writeAuditLog(dateString: string, audited: AuditedItem[], decisions: Decisions | null, queueDir: string) {
  const log = {
    date: dateString,
    decisions_present: !!decisions,
    counts: {
      audited: audited.length,
      auto_passing: audited.filter((a) => a.audit?.audit_pass && !a.audit.spot_check).length,
      held: audited.filter((a) => a.audit && (!a.audit.audit_pass || a.audit.spot_check)).length,
      dropped: audited.filter((a) => !a.audit).length,
      accepted: decisions?.accepted_held.length ?? 0,
      rejected: decisions?.rejected_held.length ?? 0,
      removed_from_auto: decisions?.removed_auto.length ?? 0,
    },
    edits_made: decisions?.edits ? Object.keys(decisions.edits).length : 0,
    editor: decisions?.editor ?? 'system',
    published_at: decisions?.published_at ?? new Date().toISOString(),
  };
  // Via the queue store (KV in prod) so it does not hit the read-only filesystem.
  await putQueue(dateString, 'audit-log', log, { baseDir: queueDir });
}

// ============ GITHUB PUBLISH ============

/** True when a GitHub token is available to commit the brief markdown. */
export function githubEnabled(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

/**
 * Commit the brief markdown to the repo via the GitHub Contents API. Creates the
 * file, or updates it in place (idempotent) when an edition already exists for
 * that date: we look up the current blob SHA first and include it on update, so
 * a re-publish of the same day is a no-drama overwrite rather than a 409/422.
 * Returns the resulting commit's html_url.
 */
export async function commitBriefToGitHub(repoPath: string, content: string, message: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN as string;
  const url = `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${repoPath}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sftimes-brief-bot',
  };

  // Idempotency: fetch the existing file's blob SHA (if any) so the PUT updates
  // rather than failing. A 404 means the file does not exist yet (create path).
  let existingSha: string | undefined;
  const getRes = await fetch(url, { headers });
  if (getRes.ok) {
    const existing = (await getRes.json()) as { sha?: string };
    existingSha = existing.sha;
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub GET ${repoPath} failed: HTTP ${getRes.status} ${await getRes.text()}`);
  }

  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    committer: { name: BOT_NAME, email: BOT_EMAIL },
    branch: 'main',
  };
  if (existingSha) body.sha = existingSha;

  const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!putRes.ok) {
    throw new Error(`GitHub PUT ${repoPath} failed: HTTP ${putRes.status} ${await putRes.text()}`);
  }
  const result = (await putRes.json()) as { commit?: { html_url?: string } };
  return result.commit?.html_url ?? '(committed)';
}

// ============ DEPLOY + INDEX ============

async function triggerDeploy() {
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hook) {
    console.warn('[publish] VERCEL_DEPLOY_HOOK_URL not set. Skipping deploy trigger.');
    return;
  }
  const res = await fetch(hook, { method: 'POST' });
  if (!res.ok) throw new Error(`Vercel deploy hook failed: HTTP ${res.status}`);
  console.log('[publish] Vercel deploy triggered');
}

async function pingIndexingApis(dateString: string, items: AuditedItem[]) {
  // dateString is the San Francisco edition date passed in by the caller. Never
  // recompute it here: a UTC-derived date would ping URLs that do not exist.
  const urls = [
    `${SITE_ORIGIN}/brief/`,
    `${SITE_ORIGIN}/brief/${dateString}/`,
    ...items.map((i) => `${SITE_ORIGIN}/brief/${dateString}/${slugify(`${i.id.slice(1, 7)}-${i.original_headline}`)}/`),
  ];

  // IndexNow (Bing). Anonymous key recommended in production.
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'sftimes.com',
        key: process.env.INDEXNOW_KEY ?? 'sftimes-brief-key',
        urlList: urls,
      }),
    });
    console.log(`[publish] IndexNow pinged for ${urls.length} URLs`);
  } catch (e) {
    console.warn('[publish] IndexNow ping failed', e);
  }

  // Google Indexing API requires service-account auth. Skip if not configured.
  if (!process.env.GOOGLE_INDEXING_API_KEY) {
    console.log('[publish] Google Indexing API key not set, skipping');
  }
}

// ============ CLI ============

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const editionDate = resolveEditionDate(dateArgFrom(args));
  publish({
    editionDate,
    runDate: sfDateToInstant(editionDate),
    skipDeploy: args.includes('--skip-deploy'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
  }).catch((err) => {
    console.error('[publish] FATAL', err);
    process.exit(1);
  });
}
