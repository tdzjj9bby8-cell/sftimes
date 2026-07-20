/**
 * /api/brief/publish
 *
 * Editor publish endpoint (Path 1). Called by the /brief-dashboard PUBLISH button.
 *
 * In the editor-review model the dashboard POSTs the accepted items directly,
 * already reviewed and edited by the editor. This endpoint composes the edition
 * markdown straight from that payload and commits it to
 * src/content/briefs/<date>.md via the GitHub Contents API (which triggers a
 * Vercel rebuild). It does NOT read the audited queue or a decisions record from
 * KV: the POST body is the source of truth for what publishes.
 *
 * Body shape (JSON, posted from /brief-dashboard):
 * {
 *   "date": "2026-07-20",
 *   "editor": "Eric",
 *   "edition": 6,                 // optional; defaults to the next edition number
 *   "intro": "...",               // optional editor intro
 *   "items": [                    // accepted items, edits already applied
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
    return res.status(400).json({ error: 'No accepted items to publish' });
  }

  try {
    const result = await publishFromItems({
      date: body.date,
      editor: body.editor ?? 'Eric',
      edition: body.edition,
      intro: body.intro,
      items: body.items,
    });

    return res.status(200).json({
      status: 'ok',
      date: body.date,
      edition: result.edition,
      items_accepted: result.item_count,
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
