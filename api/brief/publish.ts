/**
 * /api/brief/publish
 *
 * Editor publish endpoint. Called by the dashboard PUBLISH button.
 *
 * Body shape (JSON, posted from /brief-dashboard):
 * {
 *   "date": "2026-06-14",
 *   "editor": "Eric",
 *   "accepted_held": ["id1", "id2", ...],
 *   "rejected_held": [...],
 *   "removed_auto": [...],
 *   "edits": { "id1": { "tldr": "...", "editor_note": "...", ... } }
 * }
 *
 * Writes the decisions file and invokes the publish handler. Returns the
 * resulting markdown path and the deploy trigger status.
 *
 * Auth: this endpoint must sit behind the same basic auth that protects
 * /brief-dashboard/. In production, configure Vercel password-protection
 * on the /api/brief/* prefix or check a session cookie before running.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { publish } from '../../scripts/brief-publish';

function authorized(req: VercelRequest): boolean {
  // Production: replace with real session check / basic auth.
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected) return true; // dev mode
  const got = req.headers.authorization || '';
  return got === `Bearer ${expected}`;
}

interface PublishBody {
  date: string;
  editor?: 'Eric' | 'Nicholas' | 'Daisy';
  edition?: number;
  intro?: string;
  accepted_held: string[];
  rejected_held: string[];
  removed_auto: string[];
  edits?: Record<string, {
    tldr?: string;
    editor_note?: string;
    angle_statement?: string;
    what_to_watch?: string;
  }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body as PublishBody;
  if (!body?.date) {
    return res.status(400).json({ error: 'Missing required field: date' });
  }

  try {
    const queueDir = path.join(process.cwd(), 'scripts', 'queue');
    if (!existsSync(queueDir)) await mkdir(queueDir, { recursive: true });

    const decisions = {
      accepted_held: body.accepted_held ?? [],
      rejected_held: body.rejected_held ?? [],
      removed_auto: body.removed_auto ?? [],
      edits: body.edits ?? {},
      editor: body.editor ?? 'Eric',
      edition: body.edition ?? 1,
      intro: body.intro,
      published_at: new Date().toISOString(),
    };

    const decisionsPath = path.join(queueDir, `${body.date}-decisions.json`);
    await writeFile(decisionsPath, JSON.stringify(decisions, null, 2), 'utf-8');

    const runDate = new Date(body.date + 'T08:00:00Z');
    await publish({ runDate });

    return res.status(200).json({
      status: 'ok',
      date: body.date,
      items_accepted: decisions.accepted_held.length,
      items_removed_from_auto: decisions.removed_auto.length,
      edits_count: Object.keys(decisions.edits).length,
      published_at: decisions.published_at,
    });
  } catch (err: any) {
    console.error('[api/brief/publish] FAIL', err);
    return res.status(500).json({
      status: 'error',
      error: String(err?.message ?? err),
    });
  }
}
