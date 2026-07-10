/**
 * /api/cron/brief-ingest
 *
 * Vercel cron entry point for Stage 1 of the Brief pipeline.
 * Wired in vercel.json crons array to fire at 11:00 UTC (3:00 AM PT).
 *
 * Invokes ../../scripts/brief-ingest.ts. Stateless: writes the candidate
 * queue to disk for the subsequent stages to read.
 *
 * Vercel cron requests carry an Authorization: Bearer header containing
 * the value of the CRON_SECRET environment variable. We verify it before
 * doing any work.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ingest } from '../../scripts/brief-ingest.js';

function authorized(req: VercelRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // dev-mode: allow if no secret set
  const got = req.headers.authorization || '';
  return got === `Bearer ${expected}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const startedAt = Date.now();
    const candidates = await ingest({ runDate: new Date() });
    const elapsed = Date.now() - startedAt;

    return res.status(200).json({
      status: 'ok',
      stage: 'ingest',
      candidate_count: candidates.length,
      elapsed_ms: elapsed,
      run_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[api/cron/brief-ingest] FAIL', err);
    return res.status(500).json({
      status: 'error',
      stage: 'ingest',
      error: String(err?.message ?? err),
    });
  }
}
