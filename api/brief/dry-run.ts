/**
 * /api/brief/dry-run
 *
 * Single-article dry-run of the 4-stage Brief AI pipeline. Useful for verifying
 * the prompts, model, and ANTHROPIC_API_KEY are wired correctly BEFORE letting
 * the cron jobs run autonomously every day.
 *
 * Does NOT write to the candidate queue. Does NOT publish anything. Pure test.
 *
 * Authorization: `?secret=<CRON_SECRET>` query param. We use query rather than
 * Bearer header because this endpoint is meant to be hit by hand (curl, browser
 * dev tools) where header injection is awkward.
 *
 * Method: POST
 * Body (JSON):
 *   {
 *     "article_url": "https://missionlocal.org/...",
 *     "headline": "Mission District plans new pedestrian plaza",
 *     "outlet": "Mission Local",
 *     "byline": "Joe Eskenazi",          // optional, defaults to "Staff"
 *     "published_date": "2026-06-20",    // optional, defaults to now
 *     "dek": "Optional summary…",        // optional
 *     "first_paragraph": "Optional lede" // optional but recommended
 *   }
 *
 * Response: full structured output of every stage that ran. Stops early if a
 * stage rejects (under-threshold scoring, not-brief-worthy, etc.) and reports
 * which stage rejected.
 *
 * Example curl:
 *   curl -X POST "https://www.sftimes.com/api/brief/dry-run?secret=$CRON_SECRET" \
 *     -H 'Content-Type: application/json' \
 *     -d @sample-article.json
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runScoring, runCategory, runDraft, runAuditor } from '../../scripts/brief-ai.js';
import type { Candidate } from '../../scripts/brief-ingest.js';

function authorized(req: VercelRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // dev mode: allow when secret not yet wired
  const got = String(req.query.secret ?? '');
  return got === expected;
}

interface DryRunBody {
  article_url?: string;
  headline?: string;
  outlet?: string;
  byline?: string;
  published_date?: string;
  dek?: string;
  first_paragraph?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. POST a JSON body.' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized. Pass ?secret=<CRON_SECRET>.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY not set in this environment. The dry-run cannot reach Claude.',
    });
  }

  const body = (req.body ?? {}) as DryRunBody;
  const missing: string[] = [];
  if (!body.article_url) missing.push('article_url');
  if (!body.headline) missing.push('headline');
  if (!body.outlet) missing.push('outlet');
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`,
      required: ['article_url', 'headline', 'outlet'],
      optional: ['byline', 'published_date', 'dek', 'first_paragraph'],
    });
  }

  // Stable per-run log line so Vercel logs are searchable by headline.
  console.log(`[dry-run] ${new Date().toISOString()} ${body.outlet} :: ${body.headline}`);

  const candidate: Candidate = {
    id: `dry-${Date.now().toString(36)}`,
    source_url: body.article_url!,
    source_outlet: body.outlet!,
    source_byline: body.byline ?? 'Staff',
    original_headline: body.headline!,
    original_dek: body.dek ?? '',
    published_at: body.published_date
      ? new Date(body.published_date).toISOString()
      : new Date().toISOString(),
    first_paragraph: body.first_paragraph,
    ingest_at: new Date().toISOString(),
  };

  try {
    const t0 = Date.now();
    const scoring = await runScoring(candidate);
    const t1 = Date.now();

    // Stage 2A: hard reject if scoring below threshold (mirrors brief-ai.ts logic).
    if (scoring.composite < 7.0 || scoring.uniqueness < 6) {
      return res.status(200).json({
        status: 'rejected_at_scoring',
        verdict: `Below threshold (composite ${scoring.composite}, uniqueness ${scoring.uniqueness}). Brief pipeline would auto-reject; no further stages run.`,
        scoring,
        elapsed_ms: { scoring: t1 - t0, total: Date.now() - t0 },
      });
    }

    const category = await runCategory(candidate);
    const t2 = Date.now();

    const draft = await runDraft(candidate, scoring);
    const t3 = Date.now();

    // Stage 2B: brief-worthy check inside the draft prompt.
    if (!draft.brief_worthy) {
      return res.status(200).json({
        status: 'rejected_at_brief_worthy',
        verdict: 'Brief-worthy check returned false. Brief pipeline would auto-reject; no auditor stage.',
        scoring,
        category,
        draft,
        elapsed_ms: { scoring: t1 - t0, category: t2 - t1, draft: t3 - t2, total: Date.now() - t0 },
      });
    }

    const audit = await runAuditor(candidate, draft);
    const t4 = Date.now();

    return res.status(200).json({
      status: audit.audit_pass ? 'auto_publish_eligible' : 'held_for_editor',
      verdict: audit.audit_pass
        ? 'All 5 firewall checks passed. Brief pipeline would auto-publish this item.'
        : 'Auditor flagged one or more firewall checks. Brief pipeline would hold this for editor review.',
      scoring,
      category,
      draft,
      audit,
      elapsed_ms: {
        scoring: t1 - t0,
        category: t2 - t1,
        draft: t3 - t2,
        audit: t4 - t3,
        total: Date.now() - t0,
      },
    });
  } catch (err: any) {
    console.error('[api/brief/dry-run] FAIL', err);
    return res.status(500).json({
      status: 'error',
      error: String(err?.message ?? err),
      hint: err?.status === 401
        ? 'Anthropic returned 401. Check ANTHROPIC_API_KEY value.'
        : err?.status === 429
          ? 'Anthropic returned 429. Rate limited, retry in a minute.'
          : undefined,
    });
  }
}
