/**
 * /api/brief/publish
 *
 * Editor promote endpoint (Path 3). Called by the /brief-dashboard button.
 *
 * Under Path 3 the Cowork task auto-publishes the audit-passing items on its own
 * and stages only the audit-failing ones. So this endpoint handles the exception
 * path: the items the editor read and promoted out of quarantine. It does NOT
 * read the audited queue or a decisions record from KV: the POST body is the
 * source of truth for what the editor promoted.
 *
 * mode 'promote' (the default) MERGES those items into the edition already live
 * at src/content/briefs/<date>.md, keeping its edition number and every
 * auto-published item. It composes a fresh edition only when no file exists for
 * the date, which is the day where nothing cleared the audit. Passing
 * mode 'replace' overwrites the live edition instead and will drop the
 * auto-published items, so only send it deliberately.
 *
 * Either way the write lands via the GitHub Contents API, which triggers a
 * Vercel rebuild.
 *
 * Body shape (JSON, posted from /brief-dashboard):
 * {
 *   "date": "2026-07-20",
 *   "editor": "Eric",
 *   "mode": "promote",            // optional; 'promote' (default) or 'replace'
 *   "edition": 6,                 // optional; ignored when merging into an existing edition
 *   "intro": "...",               // optional editor intro, fresh-compose path only
 *   "items": [                    // promoted items, edits already applied
 *     {
 *       "source_headline": "...", "source_outlet": "...", "source_url": "...",
 *       "source_date": "2026-07-20", "category": "HOUSING", "signal": "structural-pattern",
 *       "composite_score": 8.1, "uniqueness_score": 8,
 *       "angle_statement": "...", "tldr": "...", "editor_note": "...", "what_to_watch": "..."
 *     }
 *   ]
 * }
 *
 * Auth: sits behind the same Vercel deployment protection as /brief-dashboard.
 * DASHBOARD_TOKEN optionally gates direct (non-browser) callers.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { publishFromItems, type PublishItemInput } from '../../scripts/brief-publish.js';

function authorized(req: VercelRequest): boolean {
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
  mode?: 'promote' | 'replace';
  items: PublishItemInput[];
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
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'No promoted items to publish' });
  }

  try {
    const result = await publishFromItems({
      date: body.date,
      editor: body.editor ?? 'Eric',
      edition: body.edition,
      intro: body.intro,
      mode: body.mode ?? 'promote',
      items: body.items,
    });

    return res.status(200).json({
      status: 'ok',
      date: body.date,
      edition: result.edition,
      merged: result.merged,
      item_count: result.item_count,
      items_accepted: result.promoted_count,
      committed: result.committed,
      commit_url: result.commitUrl,
      path: result.path,
      published_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[api/brief/publish] FAIL', err);
    return res.status(500).json({
      status: 'error',
      error: String(err?.message ?? err),
    });
  }
}
