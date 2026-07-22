/**
 * /api/brief/staged
 *
 * Returns today's staged draft queue for the dashboard to render.
 *
 * The Cowork brief-daily task drafts and audits every candidate, then writes
 * them all to scripts/queue/YYYY-MM-DD-staged.json on disk and commits it
 * (BRIEF-COWORK-PLAYBOOK.md Stage 9). This endpoint reads that file directly at
 * runtime. It replaced a Vercel KV read left over from the pre-Cowork
 * architecture: the task writes to the filesystem, KV was always empty, so the
 * dashboard saw nothing. Vercel bundles the file into the serverless function
 * via vercel.json `includeFiles: "{src/content/briefs/**,scripts/**}"`. Same
 * filesystem-read pattern as api/og/brief/[date]/[slug].ts.
 *
 * Query params:
 *   ?date=YYYY-MM-DD   optional date override (defaults to today)
 *
 * Response shape: { date, source, item_count, items } where items is the
 * canonical AuditedItem shape (nested scoring / draft / audit) the dashboard's
 * normalize() consumes.
 *
 * Shape bridge: the brief-daily task currently writes items FLAT (draft fields
 * at the top level, `source_headline` rather than `original_headline`). The
 * dashboard expects the canonical nested AuditedItem. toAuditedItem() maps flat
 * to nested and passes through items that are already nested, so the endpoint
 * works whichever shape the task emits.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** The canonical item shape the dashboard renders (subset used by normalize()). */
interface StagedItem {
  id: string;
  original_headline: string;
  source_outlet: string;
  source_byline: string;
  source_url: string;
  published_at: string;
  category: string;
  scoring: Record<string, unknown>;
  draft: {
    brief_worthy: boolean;
    brief_signal?: string;
    angle_statement?: string;
    tldr?: string;
    editor_note?: string;
    what_to_watch?: string;
  };
  audit: Record<string, unknown>;
}

function authorized(req: VercelRequest): boolean {
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected) return true;
  const got = req.headers.authorization || '';
  return got === `Bearer ${expected}`;
}

/** Bridge the task's flat on-disk shape to the canonical nested AuditedItem the
 *  dashboard consumes. Items that already carry a `draft` object pass straight
 *  through, so this is safe if the task is later updated to emit nested items. */
function toAuditedItem(raw: any, fileDate: string): StagedItem {
  if (raw && raw.draft) return raw as StagedItem; // already canonical
  return {
    id: raw.id,
    original_headline: raw.original_headline ?? raw.source_headline ?? '',
    source_outlet: raw.source_outlet ?? '',
    source_byline: raw.source_byline ?? 'Staff',
    source_url: raw.source_url ?? '#',
    published_at: raw.published_at ?? raw.source_date ?? fileDate ?? '',
    category: raw.category ?? '',
    scoring: raw.scoring ?? {},
    draft: {
      brief_worthy: true,
      brief_signal: raw.brief_signal,
      angle_statement: raw.angle_statement,
      tldr: raw.tldr,
      editor_note: raw.editor_note,
      what_to_watch: raw.what_to_watch,
    },
    audit: raw.audit ?? {},
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dateParam = (req.query.date as string) || new Date().toISOString().slice(0, 10);

  // Always serve fresh: the file changes when the task re-runs before publish.
  res.setHeader('Cache-Control', 'no-store, must-revalidate');

  const filePath = path.join(process.cwd(), 'scripts', 'queue', `${dateParam}-staged.json`);

  try {
    const rawText = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(rawText);
    // The task writes { date, item_count, items: [...] }; tolerate a bare array.
    const rawItems: any[] = Array.isArray(parsed) ? parsed : parsed.items ?? [];
    const fileDate = (!Array.isArray(parsed) && parsed.date) || dateParam;
    const items = rawItems.map((it) => toAuditedItem(it, fileDate));

    if (items.length > 0) {
      return res.status(200).json({
        date: dateParam,
        source: 'queue',
        item_count: items.length,
        items,
      });
    }

    // File exists but has no items.
    return res.status(200).json({
      date: dateParam,
      source: 'no-queue-found',
      item_count: 0,
      items: [],
      hint: `Staging file ${dateParam}-staged.json exists but has no items.`,
    });
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      // No staging file for this date yet: the dashboard renders its empty state.
      return res.status(200).json({
        date: dateParam,
        source: 'no-queue-found',
        item_count: 0,
        items: [],
        hint: `No staged queue for ${dateParam}. The Cowork brief-daily task writes scripts/queue/${dateParam}-staged.json when it runs.`,
      });
    }
    // Malformed JSON or read error: degrade to the empty state, never 500 the dashboard.
    console.error('[api/brief/staged] read failed', err);
    return res.status(200).json({
      date: dateParam,
      source: 'queue-error',
      item_count: 0,
      items: [],
      hint: 'Staging file unreadable. Showing empty state.',
    });
  }
}
