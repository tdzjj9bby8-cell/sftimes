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

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AuditedItem, BriefSignal, Category } from './brief-ai.js';
import { getQueue, putQueue, kvEnabled } from './lib/queue-store.js';

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
}

export async function publish(opts: RunOpts = {}): Promise<string> {
  const runDate = opts.runDate ?? new Date();
  const queueDir = opts.queueDir ?? path.join(process.cwd(), 'scripts', 'queue');
  const contentDir = opts.contentDir ?? CONTENT_DIR_DEFAULT;
  const dateString = runDate.toISOString().slice(0, 10);

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

  const final = [...autoBatch, ...acceptedHeld];

  if (final.length === 0) {
    console.error(`[publish] No items to publish. Aborting.`);
    throw new Error('Empty brief: refusing to publish a zero-item edition');
  }

  console.log(`[publish] Final brief: ${autoBatch.length} auto + ${acceptedHeld.length} accepted held = ${final.length} items`);

  // Compose the content collection markdown
  const editor = decisions?.editor ?? 'Eric';
  const edition = decisions?.edition ?? (await nextEdition(contentDir));
  const intro = decisions?.intro;
  const markdown = composeMarkdown({
    date: runDate,
    edition,
    editor,
    intro,
    items: final,
    edits: decisions?.edits ?? {},
  });

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
    await pingIndexingApis(runDate, final);
  }

  console.log(`[publish] OK ${dateString}`);
  return markdown;
}

// ============ MARKDOWN COMPOSITION ============

interface ComposeArgs {
  date: Date;
  edition: number;
  editor: 'Eric' | 'Nicholas' | 'Daisy';
  intro?: string;
  items: AuditedItem[];
  edits: Record<string, ItemEdits>;
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
  lines.push(`${indent}  slug: ${slug}`);
  lines.push(`${indent}  category: ${item.category ?? 'POLITICS'}`);
  lines.push(`${indent}  signal: ${draft.brief_signal ?? 'underreported'}`);
  lines.push(`${indent}  source_headline: ${yamlString(item.original_headline)}`);
  lines.push(`${indent}  source_outlet: ${yamlString(item.source_outlet)}`);
  lines.push(`${indent}  source_byline: ${yamlString(item.source_byline)}`);
  lines.push(`${indent}  source_url: ${yamlString(item.source_url)}`);
  lines.push(`${indent}  source_date: ${item.published_at.slice(0, 10)}`);
  lines.push(`${indent}  composite_score: ${item.scoring?.composite ?? 0}`);
  lines.push(`${indent}  uniqueness_score: ${item.scoring?.uniqueness ?? 0}`);
  lines.push(`${indent}  auto_published: ${item.audit?.audit_pass && !item.audit.spot_check}`);
  lines.push(`${indent}  angle_statement: ${yamlString(angle)}`);
  lines.push(`${indent}  tldr: ${yamlString(tldr)}`);
  lines.push(`${indent}  editor_note: |`);
  for (const noteLine of editorNote.split('\n')) lines.push(`${indent}    ${noteLine}`);
  lines.push(`${indent}  what_to_watch: ${yamlString(watch)}`);
  return lines.join('\n');
}

function yamlString(s: string): string {
  // Always quote with double quotes and escape internal double quotes + backslashes.
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function nextEdition(contentDir: string): Promise<number> {
  if (!existsSync(contentDir)) return 1;
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(contentDir);
  return files.filter((f) => f.endsWith('.md')).length + 1;
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
function githubEnabled(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

/**
 * Commit the brief markdown to the repo via the GitHub Contents API. Creates the
 * file, or updates it in place (idempotent) when an edition already exists for
 * that date: we look up the current blob SHA first and include it on update, so
 * a re-publish of the same day is a no-drama overwrite rather than a 409/422.
 * Returns the resulting commit's html_url.
 */
async function commitBriefToGitHub(repoPath: string, content: string, message: string): Promise<string> {
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

async function pingIndexingApis(runDate: Date, items: AuditedItem[]) {
  const dateString = runDate.toISOString().slice(0, 10);
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
  const dateArg = args.find((a) => a.startsWith('--date='))?.slice(7);
  const skipDeploy = args.includes('--skip-deploy');
  const dryRun = args.includes('--dry-run');
  const runDate = dateArg ? new Date(dateArg + 'T08:00:00Z') : new Date();
  publish({ runDate, skipDeploy, dryRun }).catch((err) => {
    console.error('[publish] FATAL', err);
    process.exit(1);
  });
}
