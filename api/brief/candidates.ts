/**
 * /api/brief/candidates
 *
 * Returns today's audited candidate queue for the dashboard to render.
 * Falls back to sample data if the queue file does not exist yet, so the
 * dashboard renders something during development.
 *
 * Query params:
 *   ?date=YYYY-MM-DD   optional date override (defaults to today)
 *
 * Response shape: array of AuditedItem (see scripts/brief-ai.ts).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getQueue } from '../../scripts/lib/queue-store.js';
import type { AuditedItem } from '../../scripts/brief-ai.js';

function authorized(req: VercelRequest): boolean {
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected) return true;
  const got = req.headers.authorization || '';
  return got === `Bearer ${expected}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dateParam = (req.query.date as string) || new Date().toISOString().slice(0, 10);

  // Add Cache-Control: no-store so the dashboard always pulls fresh state.
  res.setHeader('Cache-Control', 'no-store, must-revalidate');

  try {
    const items = await getQueue<AuditedItem[]>(dateParam, 'audited');
    if (items && items.length > 0) {
      return res.status(200).json({
        date: dateParam,
        source: 'queue',
        item_count: items.length,
        items,
      });
    }

    // No queue yet for this date. The dashboard renders its empty state.
    return res.status(200).json({
      date: dateParam,
      source: 'no-queue-found',
      item_count: 0,
      items: [],
      hint: `No audited queue for ${dateParam}. Run npm run brief:ai -- --date ${dateParam} first.`,
    });
  } catch (err: any) {
    // KV unreachable or a malformed payload: degrade to the friendly empty
    // state rather than 500ing the whole dashboard.
    console.error('[api/brief/candidates] queue read failed', err);
    return res.status(200).json({
      date: dateParam,
      source: 'queue-error',
      item_count: 0,
      items: [],
      hint: 'Queue store unavailable. Showing empty state.',
    });
  }
}
