/**
 * /api/brief/staged
 *
 * Returns today's staged draft queue for the dashboard to render. In the Path 1
 * editor-review model the Cowork brief-daily task drafts and audits every
 * candidate, then writes them all (audit-passing and audit-failing alike) to the
 * staging file scripts/queue/YYYY-MM-DD-staged.json. This endpoint reads that
 * file so the dashboard can present every drafted item for editor review. The
 * task never auto-publishes; nothing here decides what ships.
 *
 * Query params:
 *   ?date=YYYY-MM-DD   optional date override (defaults to today)
 *
 * Response shape: { date, source, item_count, items } where items is
 * AuditedItem[] (see scripts/brief-ai.ts), each carrying its audit result.
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
    const items = await getQueue<AuditedItem[]>(dateParam, 'staged');
    if (items && items.length > 0) {
      return res.status(200).json({
        date: dateParam,
        source: 'queue',
        item_count: items.length,
        items,
      });
    }

    // No staging file yet for this date. The dashboard renders its empty state.
    return res.status(200).json({
      date: dateParam,
      source: 'no-queue-found',
      item_count: 0,
      items: [],
      hint: `No staged queue for ${dateParam}. The Cowork brief-daily task writes scripts/queue/${dateParam}-staged.json when it runs.`,
    });
  } catch (err: any) {
    // KV unreachable or a malformed payload: degrade to the friendly empty
    // state rather than 500ing the whole dashboard.
    console.error('[api/brief/staged] queue read failed', err);
    return res.status(200).json({
      date: dateParam,
      source: 'queue-error',
      item_count: 0,
      items: [],
      hint: 'Queue store unavailable. Showing empty state.',
    });
  }
}
