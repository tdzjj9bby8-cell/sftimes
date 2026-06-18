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
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

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
  const queueDir = path.join(process.cwd(), 'scripts', 'queue');
  const queuePath = path.join(queueDir, `${dateParam}-audited.json`);

  // Add Cache-Control: no-store so the dashboard always pulls fresh state.
  res.setHeader('Cache-Control', 'no-store, must-revalidate');

  try {
    if (existsSync(queuePath)) {
      const raw = await readFile(queuePath, 'utf-8');
      const items = JSON.parse(raw);
      return res.status(200).json({
        date: dateParam,
        source: 'queue-file',
        item_count: items.length,
        items,
      });
    }

    // Fallback: empty queue. The dashboard renders its hardcoded sample data
    // when the API returns no items (development convenience).
    return res.status(200).json({
      date: dateParam,
      source: 'no-queue-found',
      item_count: 0,
      items: [],
      hint: `No audited queue file at scripts/queue/${dateParam}-audited.json. Run npm run brief:ai -- --date ${dateParam} first.`,
    });
  } catch (err: any) {
    console.error('[api/brief/candidates] FAIL', err);
    return res.status(500).json({
      status: 'error',
      error: String(err?.message ?? err),
    });
  }
}
