/**
 * /api/cron/brief-ai
 *
 * Vercel cron entry point for Stages 2 and 3 of the Brief pipeline.
 * Wired in vercel.json crons array to fire at 13:30 UTC (5:30 AM PT).
 *
 * Reads the candidate queue from the Stage 1 ingest, runs scoring + category
 * + draft + auditor against Claude Haiku, writes the audited queue for the
 * editor dashboard and the publish stage.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { aiPass } from '../../scripts/brief-ai.js';

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
    const startedAt = Date.now();
    const results = await aiPass({ runDate: new Date() });
    const elapsed = Date.now() - startedAt;

    const autoCount = results.filter((r) => r.audit?.audit_pass && !r.audit?.spot_check).length;
    const heldCount = results.filter((r) => r.audit && (!r.audit.audit_pass || r.audit.spot_check)).length;
    const droppedCount = results.filter((r) => !r.audit).length;

    return res.status(200).json({
      status: 'ok',
      stage: 'ai',
      auto_publishing: autoCount,
      held: heldCount,
      dropped: droppedCount,
      total: results.length,
      elapsed_ms: elapsed,
      run_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[api/cron/brief-ai] FAIL', err);
    return res.status(500).json({
      status: 'error',
      stage: 'ai',
      error: String(err?.message ?? err),
    });
  }
}
