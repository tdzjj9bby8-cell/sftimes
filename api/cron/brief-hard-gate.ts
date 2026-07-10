/**
 * /api/cron/brief-hard-gate
 *
 * The 7:30 AM PT hard gate. If the editor has not clicked PUBLISH in the
 * dashboard, this cron fires brief-publish.ts with no decisions file.
 *
 * Publishes only the auto-passing batch. Held items get dropped. The brief
 * publishes shorter than usual but ships on time.
 *
 * Wired in vercel.json at 15:30 UTC (7:30 AM PT).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { publish } from '../../scripts/brief-publish.js';

function authorized(req: VercelRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const got = req.headers.authorization || '';
  return got === `Bearer ${expected}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const runDate = new Date();
    const dateString = runDate.toISOString().slice(0, 10);
    const queueDir = path.join(process.cwd(), 'scripts', 'queue');
    const decisionsPath = path.join(queueDir, `${dateString}-decisions.json`);

    // If the editor already published, skip silently.
    if (existsSync(decisionsPath)) {
      return res.status(200).json({
        status: 'ok',
        stage: 'hard-gate',
        action: 'skipped',
        reason: 'Editor already published',
      });
    }

    console.log(`[hard-gate] No editor decision by 7:30 AM PT. Force-publishing auto-batch.`);
    await publish({ runDate });

    return res.status(200).json({
      status: 'ok',
      stage: 'hard-gate',
      action: 'force-published auto-batch',
      run_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[api/cron/brief-hard-gate] FAIL', err);
    return res.status(500).json({
      status: 'error',
      stage: 'hard-gate',
      error: String(err?.message ?? err),
    });
  }
}
