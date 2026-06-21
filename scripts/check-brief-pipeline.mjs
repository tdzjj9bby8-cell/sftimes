#!/usr/bin/env node
/**
 * scripts/check-brief-pipeline.mjs
 *
 * Pre-flight smoke test for the Brief AI pipeline. Runs the full 4-stage
 * Haiku pipeline against a single hard-coded SF news article and prints
 * the structured output of every stage.
 *
 * Purpose: prove locally that ANTHROPIC_API_KEY, the prompts, and the
 * pipeline orchestration all work BEFORE letting Vercel cron run them
 * autonomously every day at 5:30 AM PT.
 *
 * Usage:
 *   1. Put ANTHROPIC_API_KEY=sk-ant-... in astro/.env.local
 *   2. npm run brief:check
 *
 * The npm script loads .env.local via Node 20.12+ --env-file-if-exists.
 * If running from another path, set ANTHROPIC_API_KEY in the parent shell.
 *
 * Exit 0 on success (any of: all 4 stages run, scoring rejection, brief-worthy
 * rejection — all valid pipeline outcomes). Exit 1 on real failure (missing
 * key, Anthropic API error, tsx loader error).
 */

import process from 'node:process';

// ============ ENV CHECK ============

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[brief:check] ANTHROPIC_API_KEY not set in the current environment.');
  console.error('  Add it to astro/.env.local:');
  console.error('    ANTHROPIC_API_KEY=sk-ant-...');
  console.error('  Then re-run: npm run brief:check');
  process.exit(1);
}

// ============ TEST CANDIDATE ============
//
// Synthetic representative SF news article. Realistic enough that the pipeline
// can score, categorize, draft, and audit it without needing live RSS pulls.
// Adjust the body if you want to test specific edge cases (housing, transit,
// closings, etc.) — anything per the 13-category taxonomy works.

const TEST_CANDIDATE = {
  id: 'check-' + Date.now().toString(36),
  source_url: 'https://missionlocal.org/2026/06/example-valencia-plaza',
  source_outlet: 'Mission Local',
  source_byline: 'Joe Eskenazi',
  original_headline: 'Mission District moves forward with weekend pedestrian plaza on Valencia',
  original_dek: 'The proposal would close one block between 17th and 18th to cars on Saturdays and Sundays through October.',
  published_at: new Date().toISOString(),
  first_paragraph:
    'The Mission District is moving forward with a long-debated proposal to convert one block of Valencia Street into a weekend pedestrian plaza. The plan, championed by Supervisor Hilary Ronen and supported by Calle 24 Latino Cultural District, would close the block between 17th and 18th to vehicle traffic on Saturdays and Sundays from May through October. The SFMTA board votes Tuesday.',
  ingest_at: new Date().toISOString(),
};

// ============ TSX BRIDGE ============
//
// scripts/brief-ai.ts is TypeScript. Use tsx's programmatic ESM loader so this
// .mjs file can import it directly without spawning a subprocess.

let runScoring, runCategory, runDraft, runAuditor;
try {
  const { tsImport } = await import('tsx/esm/api');
  const ai = await tsImport('./brief-ai.ts', import.meta.url);
  ({ runScoring, runCategory, runDraft, runAuditor } = ai);
} catch (err) {
  console.error('[brief:check] failed to load brief-ai.ts via tsx/esm/api');
  console.error('  ' + (err?.message ?? err));
  console.error('  Confirm tsx 4.7+ is installed: npm install --save-dev tsx');
  process.exit(1);
}

// ============ RUN PIPELINE ============

const startedAt = Date.now();
console.log(`[brief:check] testing against:`);
console.log(`  outlet:   ${TEST_CANDIDATE.source_outlet}`);
console.log(`  headline: ${TEST_CANDIDATE.original_headline}`);
console.log();

try {
  // Stage 1: scoring
  console.log(`[brief:check] stage 1/4: scoring (novelty/civic/sf/uniqueness)`);
  const scoring = await runScoring(TEST_CANDIDATE);
  console.log(JSON.stringify(scoring, null, 2));
  console.log();

  if (scoring.composite < 7.0 || scoring.uniqueness < 6) {
    console.log(
      `[brief:check] OK. Pipeline rejected at scoring threshold (composite ${scoring.composite}, uniqueness ${scoring.uniqueness}). This is expected behavior for most candidates — only Brief-worthy items clear the bar.`,
    );
    console.log(`[brief:check] elapsed: ${Date.now() - startedAt} ms`);
    process.exit(0);
  }

  // Stage 2: category
  console.log(`[brief:check] stage 2/4: category`);
  const category = await runCategory(TEST_CANDIDATE);
  console.log(`Category: ${category}`);
  console.log();

  // Stage 3: brief-worthy check + draft TLDR + draft editor's note
  console.log(`[brief:check] stage 3/4: draft (brief-worthy + TLDR + editor's note)`);
  const draft = await runDraft(TEST_CANDIDATE, scoring);
  console.log(JSON.stringify(draft, null, 2));
  console.log();

  if (!draft.brief_worthy) {
    console.log(
      `[brief:check] OK. Pipeline rejected at brief-worthy check. Reason: ${draft.reject_reason ?? '(unspecified)'}`,
    );
    console.log(`[brief:check] elapsed: ${Date.now() - startedAt} ms`);
    process.exit(0);
  }

  // Stage 4: auditor
  console.log(`[brief:check] stage 4/4: auditor (5 firewall checks)`);
  const audit = await runAuditor(TEST_CANDIDATE, draft);
  console.log(JSON.stringify(audit, null, 2));
  console.log();

  console.log(`[brief:check] OK. All 4 stages completed.`);
  console.log(
    `[brief:check] verdict: ${audit.audit_pass ? 'auto-publish eligible' : 'held for editor (' + audit.fail_reasons.join('; ') + ')'}`,
  );
  console.log(`[brief:check] elapsed: ${Date.now() - startedAt} ms`);
  process.exit(0);
} catch (err) {
  console.error(`[brief:check] FAIL`);
  console.error(`  ${err?.message ?? err}`);
  if (err?.status === 401) {
    console.error(`  -> 401 from Anthropic. The ANTHROPIC_API_KEY in .env.local is invalid or revoked.`);
  } else if (err?.status === 429) {
    console.error(`  -> 429 from Anthropic. Rate limited. Try again in a minute.`);
  } else if (err?.status === 400) {
    console.error(`  -> 400 from Anthropic. Likely a prompt parsing error. Check brief-ai.ts.`);
  }
  process.exit(1);
}
