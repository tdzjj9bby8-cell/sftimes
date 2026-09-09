/**
 * scripts/brief-ai.ts
 *
 * Stages 2 and 3 of the Brief pipeline (BRIEF-MASTER-PLAN.md sections 6.2 and 6.2.5).
 *
 * Reads scripts/queue/<date>-ingested.json from the ingest step and runs a
 * two-pass model pipeline designed so the expensive calls only touch stories
 * that can actually reach the edition:
 *
 *   PASS 1, every candidate (cheap, no article body):
 *     Scoring (prompt 7.1). Auto-reject if composite < 7.0 OR uniqueness < 6.
 *
 *   COST GATE: survivors are ranked and only the top MAX_DRAFTS_PER_RUN
 *   continue. Everything below is deferred, not drafted.
 *
 *   PASS 2, selected candidates only (expensive, carries the full body):
 *     a. Full-article fetch. Failure here drops the item before any further
 *        model call, so an unreachable article costs zero extra tokens.
 *     b. Brief-worthy check + TLDR + editor's note + CATEGORY (prompt 7.3).
 *        Category is returned by this call rather than a separate request.
 *     c. Auditor (prompt 7.4): six checks including source fidelity.
 *
 * Random 10% of audit-passing items are still held as drift-detection
 * spot-check (master plan section 6.2.5).
 *
 * Writes scripts/queue/<date>-audited.json which is consumed by the
 * dashboard (brief-dashboard.astro) and the publish handler (brief-publish.ts).
 *
 * Invoked by scripts/brief-run.ts, which CI schedules. Locally:
 *   npm run brief:ai -- --date=2026-06-14
 *
 * Dependencies: @anthropic-ai/sdk
 * Env: ANTHROPIC_API_KEY (set in Vercel env or .env.local)
 *
 * Cost: measured 2026-09 at $0.05 to $0.13 per run (Haiku 4.5, $1/MTok in,
 * $5/MTok out). Every run is metered against a hard ceiling (BRIEF_MAX_USD)
 * that aborts the run rather than overspending. See BRIEF-AUTOMATION.md.
 */

import path from 'node:path';
import type { Candidate } from './brief-ingest.js';
import { getQueue, putQueue, kvEnabled } from './lib/queue-store.js';
import { fetchArticleBody, MIN_BODY_WORDS } from './lib/fetch-article.js';
import { sfDateString, resolveEditionDate, dateArgFrom, sfDateToInstant } from './lib/sf-date.js';
import {
  newUsage,
  recordUsage,
  resolveMaxUsd,
  estimateCost,
  formatUsage,
  BudgetExceededError,
  DEFAULT_MAX_USD,
  type Usage,
} from './lib/token-budget.js';
import { contentTokens, jaccard, dedupeByHeadline } from './lib/editorial-quality.js';

// ============ TYPES ============

export type Category =
  | 'TRANSIT' | 'HOUSING' | 'FOOD' | 'POLITICS' | 'TECH' | 'CULTURE'
  | 'ARTS' | 'BUSINESS' | 'PUBLIC SAFETY' | 'OPENINGS' | 'CLOSINGS'
  | 'WEATHER' | 'SPORTS';

export type BriefSignal = 'first-to-connect' | 'underreported' | 'missing-context' | 'structural-pattern';

export interface ScoringResult {
  novelty: number;
  civic_significance: number;
  sf_specificity: number;
  uniqueness: number;
  composite: number;
  one_line_reason: string;
  outlets_running_this: string;
}

export interface DraftResult {
  brief_worthy: boolean;
  reject_reason?: string;
  /** Taxonomy tag. Returned by the draft call rather than a separate request:
   *  the draft call already has the full article, so asking for the category
   *  there is better-informed AND removes one API round trip per item. */
  category?: Category;
  brief_signal?: BriefSignal;
  angle_statement?: string;
  tldr?: string;
  editor_note?: string;
  what_to_watch?: string;
}

export interface AuditResult {
  audit_pass: boolean;
  check_1_recap: 'pass' | 'fail';
  check_2_angle: 'pass' | 'fail';
  check_3_specificity: 'pass' | 'fail';
  check_4_word_count: 'pass' | 'fail';
  check_5_voice: 'pass' | 'fail';
  /** Source-fidelity check. Added after the 2026-07-15 fabrication incident:
   *  every asserted fact must appear in the fetched article body. Optional in
   *  the type so historical audited queues still parse. */
  check_6_source_fidelity?: 'pass' | 'fail';
  fail_reasons: string[];
  recommendation: 'auto-publish' | 'hold for editor';
  spot_check?: boolean; // true if held for random spot-check rather than audit failure
}

export interface AuditedItem extends Candidate {
  scoring: ScoringResult;
  category?: Category;
  draft: DraftResult;
  audit?: AuditResult;
  /** Why this candidate was dropped before the auditor. Filled by the pipeline
   *  when the scoring filter, the source-fetch guardrail, or the brief-worthy
   *  check rejects the item. */
  drop_reason?: string;
  /** The REAL full article body, fetched before drafting. Attached so the
   *  editorial firewall can verify every drafted claim against it at publish
   *  time. Absence of this field means the item was never safe to draft. */
  source_body?: string;
  source_body_word_count?: number;
  /** Populated when the full-article fetch failed, for the run log. */
  source_fetch_reason?: string;
}

// ============ CONFIG ============

const MODEL = 'claude-haiku-4-5-20251001';
const SPOT_CHECK_RATE = 0.10; // 10% per master plan section 6.2.5

// Hard reject thresholds from prompt 7.1
const COMPOSITE_MIN = 7.0;
const UNIQUENESS_MIN = 6;

/**
 * Maximum items that receive the expensive draft + audit pair.
 *
 * Those two calls each carry the full article body and together cost roughly
 * 20x a scoring call. An edition publishes about five or six items after the
 * firewall, deduper, and diversity cap have taken their share, so drafting far
 * beyond this is money spent on output that gets discarded.
 *
 * Ten leaves comfortable headroom above a typical published edition. This is a
 * cost control, not a quality compromise: the cap selects the highest-scoring
 * candidates, which are the same ones an unbounded run would have published.
 */
const MAX_DRAFTS_PER_RUN = Number(process.env.BRIEF_MAX_DRAFTS ?? 10);

/**
 * Headline-similarity threshold for the free pre-AI dedupe pass.
 * Higher than the post-draft threshold because we only have headlines here,
 * and a false merge at this stage silently costs us a story.
 */
const PRE_AI_DUPLICATE_THRESHOLD = 0.6;

// ============ CLAUDE CLIENT ============

let anthropicClient: any = null;

async function getClient() {
  if (anthropicClient) return anthropicClient;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropicClient;
  } catch (e) {
    throw new Error('@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk');
  }
}

/** Per-run token accounting. Reset at the start of each aiPass. */
let runUsage: Usage = newUsage();
let runLimitUsd: number = DEFAULT_MAX_USD;

export function getRunUsage(): Usage {
  return runUsage;
}

async function callClaude(prompt: string, maxTokens = 1500, stage = 'other'): Promise<string> {
  const client = await getClient();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  // Record the REAL billed usage from the response, then enforce the ceiling.
  // recordUsage throws BudgetExceededError once the cap is crossed, which
  // aborts the run rather than letting spend continue unbounded.
  recordUsage(
    runUsage,
    stage,
    resp.usage?.input_tokens ?? 0,
    resp.usage?.output_tokens ?? 0,
    runLimitUsd
  );
  const text = resp.content?.[0]?.text ?? '';
  return text.trim();
}

function parseJson<T>(text: string): T {
  // Models occasionally wrap JSON in code fences. Strip them.
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  }
  // Some responses include trailing commentary. Find the JSON object.
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}

// ============ PROMPT BUILDERS ============

function scoringPrompt(c: Candidate): string {
  return `You are scoring a candidate story for SF Times' daily Brief.

The Brief is CURATED COMMENTARY, not aggregation. We do not run stories just because they are news. We run stories with an editorial angle, connection, or backstory that other SF outlets are missing. Most newsworthy stories do NOT belong in the Brief.

Score this story 1 to 10 on four dimensions:

NOVELTY: Is this new information, or a rehash of something already widely known?

CIVIC SIGNIFICANCE: Does this affect how people in SF live, work, vote, eat, or move around?

SF SPECIFICITY: Is this specifically about San Francisco or the Bay Area, not a national story with a thin SF angle?

UNIQUENESS: How saturated is this story across SF media? A story 8 outlets are running well scores 2. A story 1 outlet ran with the wrong framing scores 9. A story no outlet has connected to a wider pattern scores 10. This is the most important dimension and weights heaviest in the composite.

Return JSON only:
{
  "novelty": <int 1-10>,
  "civic_significance": <int 1-10>,
  "sf_specificity": <int 1-10>,
  "uniqueness": <int 1-10>,
  "composite": <weighted average: novelty 15%, civic 30%, SF specificity 20%, uniqueness 35%>,
  "one_line_reason": "<one sentence on why this score>",
  "outlets_running_this": "<comma-separated list of other outlets likely covering this same story>"
}

Source headline: ${c.original_headline}
Source outlet: ${c.source_outlet}
Source dek: ${c.original_dek}
Source URL: ${c.source_url}
Source first paragraph: ${c.first_paragraph ?? '(none)'}`;
}

function draftPrompt(c: Candidate, scoring: ScoringResult, sourceBody: string): string {
  return `You are deciding whether this story belongs in SF Times' daily Brief and, if so, drafting the TLDR and editor's note.

GROUNDING RULE (absolute, overrides everything below)
You have the full text of the source article. Every factual claim you write must
come from that text. Do not add numbers, vote counts, dates, names, quotations,
or events that are not in it. Do not infer a figure you did not read. If you
cannot write a meaningful editor's note using only what is in the article plus
genuinely general SF context, return brief_worthy: false. Inventing a plausible
detail is the single worst failure you can produce here.

STEP 1. THE BRIEF-WORTHY CHECK (mandatory, run before drafting anything else)

Answer all three. Be honest. Do not force a yes.

1. Is there an angle other outlets covering this story are missing? (yes/no, with the angle in one sentence if yes)
2. Is there a connection to a wider pattern or another current SF story that other outlets are not making? (yes/no, with the connection in one sentence if yes)
3. Is there backstory or context the source article does not have time for, that materially changes the reader's understanding? (yes/no, with the backstory subject in one sentence if yes)

If all three answers are "no" this story does NOT belong in the Brief. Return:
{ "brief_worthy": false, "reject_reason": "<one sentence>" }

If at least one answer is "yes" proceed to STEP 2.

STEP 2. TLDR (25 to 30 words, two sentences)

- Sentence 1: what happened, active voice, specific.
- Sentence 2: the SF-specific stake or the number that anchors why it matters.
- Sentence case. No filler. No hedging. No "reportedly" or "could potentially."
- Include at least one specific number, named neighborhood, named person, or named institution.

STEP 3. EDITOR'S NOTE (100 to 150 words, in SF Times voice)

- The FIRST sentence must state the editorial angle, connection, or backstory you identified in STEP 1. Make it explicit, not implied.
- DO NOT recap the source article. The reader has the source article one click away.
- Add ONLY material the source article does not contain:
  * Backstory the reader needs to understand why this matters.
  * SF context: prior debates, related neighborhoods, connections to other ongoing SF stories.
  * What to watch next: specific dates, votes, decisions, deadlines.
- Voice: direct, confident, specific. No filler. No "moving forward." No "circle back."
- Sentence case throughout.

If as you draft you realize you do not have the specific knowledge to write meaningful backstory, this story does NOT belong in the Brief. Return brief_worthy: false with reject_reason "Insufficient editorial knowledge for value-add."

STEP 4. CATEGORY (pick exactly one)

Choose the single best fit from this fixed taxonomy, matching the primary
newsworthy hook: TRANSIT, HOUSING, FOOD, POLITICS, TECH, CULTURE, ARTS,
BUSINESS, PUBLIC SAFETY, OPENINGS, CLOSINGS, WEATHER, SPORTS.

STEP 5. BRIEF SIGNAL (pick exactly one)

- "first-to-connect": We are first to make the connection between this and another story.
- "underreported": Other outlets have this but at low depth.
- "missing-context": Other outlets ran the news but missed the backstory we add.
- "structural-pattern": This is one instance of a larger structural pattern only we are naming.

Return JSON only:
{
  "brief_worthy": true,
  "category": "<one taxonomy value from STEP 4, ALL CAPS>",
  "brief_signal": "<one of the four above>",
  "angle_statement": "<one sentence stating the editorial angle>",
  "tldr": "<25-30 word TLDR>",
  "editor_note": "<100-150 word editor's note starting with the angle statement>",
  "what_to_watch": "<one sentence on the next decision point, with a date if possible>"
}

Source article:
- Headline: ${c.original_headline}
- Outlet: ${c.source_outlet}
- Byline: ${c.source_byline}
- Dek: ${c.original_dek}
- Source URL: ${c.source_url}
- Other outlets likely running this: ${scoring.outlets_running_this}

FULL ARTICLE TEXT (this is the complete fetched body, not a summary):
"""
${sourceBody}
"""`;
}

function auditorPrompt(c: Candidate, draft: DraftResult, sourceBody: string): string {
  return `You are auditing a draft Brief item against the editorial firewall rules. Your job is to catch failures BEFORE publish so that nothing slips through to readers that violates SF Times' standards.

Run all five checks. Be strict. False negatives are worse than false positives.

CHECK 1: Recap test (firewall rule 1)
Read the editor's note. Could a reader who only reads the note skip clicking through to the source article and still understand the news?
If YES → fail. If NO → pass.

CHECK 2: Angle statement test
The editor's note must START with a sentence stating the editorial angle, connection, or backstory.
If the first sentence just paraphrases the headline → fail.
If the first sentence names a real angle, connection, or backstory → pass.

CHECK 3: TLDR specificity test
The TLDR must include at least one specific number, named neighborhood, named person, or named institution.
If generic or hedging → fail. If specific → pass.

CHECK 4: Word count test
The editor's note must be 100 to 150 words. If under 90 or over 165 → fail. If 90 to 165 → pass.

CHECK 5: Voice test
Does the editor's note sound like SF Times (direct, confident, specific, no filler)? Or does it sound like generic news brief writing ("this is important because...", "moving forward," "circle back," "leverage")?
If generic → fail. If SF Times voice → pass.

Return JSON only:
{
  "audit_pass": <true if ALL SIX checks pass, false otherwise>,
  "check_1_recap": "pass" | "fail",
  "check_2_angle": "pass" | "fail",
  "check_3_specificity": "pass" | "fail",
  "check_4_word_count": "pass" | "fail",
  "check_5_voice": "pass" | "fail",
  "check_6_source_fidelity": "pass" | "fail",
  "fail_reasons": [<one-line explanation for each failed check>],
  "recommendation": "auto-publish" | "hold for editor"
}

CHECK 6: Source-fidelity test (added after the 2026-07-15 fabrication incident)
Compare every factual assertion in the TLDR and editor's note against the FULL
ARTICLE TEXT below. Flag any number, vote count, date, name, institution, or
quotation that does not appear in that text. If you find even one unsupported
factual assertion, the item fails. Editorial context about San Francisco that
is general knowledge is acceptable; specific invented facts are not.

Source materials:
- Source URL: ${c.source_url}
- Source headline: ${c.original_headline}

FULL ARTICLE TEXT (ground truth for CHECK 6):
"""
${sourceBody}
"""

Draft to audit:
- Brief signal: ${draft.brief_signal}
- Angle statement: ${draft.angle_statement}
- TLDR: ${draft.tldr}
- Editor's note: ${draft.editor_note}
- What to watch: ${draft.what_to_watch}`;
}

// ============ PROMPT RUNNERS ============

export async function runScoring(c: Candidate): Promise<ScoringResult> {
  const text = await callClaude(scoringPrompt(c), 400, 'scoring');
  return parseJson<ScoringResult>(text);
}

// runCategory was removed: the category is now returned by the draft call,
// which already carries the full article. That eliminated one API round trip
// per drafted item at no cost to quality.

export async function runDraft(
  c: Candidate,
  scoring: ScoringResult,
  sourceBody: string
): Promise<DraftResult> {
  if (!sourceBody || !sourceBody.trim()) {
    throw new Error('runDraft called without a source body. Drafting without the full article is forbidden.');
  }
  const text = await callClaude(draftPrompt(c, scoring, sourceBody), 1200, 'draft');
  return parseJson<DraftResult>(text);
}

export async function runAuditor(
  c: Candidate,
  draft: DraftResult,
  sourceBody: string
): Promise<AuditResult> {
  if (!sourceBody || !sourceBody.trim()) {
    throw new Error('runAuditor called without a source body. The source-fidelity check requires it.');
  }
  const text = await callClaude(auditorPrompt(c, draft, sourceBody), 600, 'audit');
  return parseJson<AuditResult>(text);
}

// ============ ORCHESTRATION ============

/**
 * Free, deterministic dedupe on headlines BEFORE any model call.
 *
 * Ingest already dedupes by URL and title cosine. This is a second cheap pass
 * with a different metric, because every duplicate removed here is a scoring
 * call we never pay for. Threshold is deliberately high: at this stage we only
 * have headlines, and wrongly merging two stories costs us real coverage.
 *
 * The implementation now lives in lib/editorial-quality.ts as dedupeByHeadline,
 * so the subscription publishing path (brief-prep.ts) can use the same logic
 * without importing this module and its Anthropic client. This wrapper is kept
 * so existing callers and their tests are untouched.
 */
export function preAiDedupe(candidates: Candidate[]): {
  kept: Candidate[];
  removed: Candidate[];
} {
  return dedupeByHeadline(candidates);
}

export async function processCandidates(candidates: Candidate[]): Promise<AuditedItem[]> {
  const results: AuditedItem[] = [];

  // ---- PASS 1: score everything (the cheap call) ----
  const scored: Array<{ c: Candidate; scoring: ScoringResult }> = [];

  for (const c of candidates) {
    try {
      const scoring = await runScoring(c);
      if (scoring.composite < COMPOSITE_MIN || scoring.uniqueness < UNIQUENESS_MIN) {
        results.push({
          ...c,
          scoring,
          draft: { brief_worthy: false, reject_reason: `Below threshold (composite ${scoring.composite}, uniqueness ${scoring.uniqueness})` },
          drop_reason: 'scoring_threshold',
        });
        continue;
      }
      scored.push({ c, scoring });
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      console.error(`[ai] FAIL scoring ${c.id} (${c.source_outlet})`, err);
      results.push({
        ...c,
        scoring: { novelty: 0, civic_significance: 0, sf_specificity: 0, uniqueness: 0, composite: 0, one_line_reason: 'AI pass failed', outlets_running_this: '' },
        draft: { brief_worthy: false, reject_reason: `Pipeline error: ${String(err).slice(0, 100)}` },
        drop_reason: 'pipeline_error',
      });
    }
  }

  // ---- COST GATE: only the best candidates get the expensive calls ----
  // Drafting and auditing cost roughly 20x a scoring call because both carry
  // the full article body. An edition publishes about five or six items, so
  // drafting every survivor spends real money on work that the firewall, the
  // deduper, and the diversity cap will discard. Take the top N by composite.
  //
  // This is a cost control, not a quality compromise: we are choosing the
  // highest-scoring candidates, which is the same set an unbounded run would
  // have published from.
  scored.sort((a, b) => b.scoring.composite - a.scoring.composite);
  const selected = scored.slice(0, MAX_DRAFTS_PER_RUN);
  const deferred = scored.slice(MAX_DRAFTS_PER_RUN);

  for (const { c, scoring } of deferred) {
    results.push({
      ...c,
      scoring,
      draft: {
        brief_worthy: false,
        reject_reason: `Not in the top ${MAX_DRAFTS_PER_RUN} by composite score for this run.`,
      },
      drop_reason: 'draft_cap',
    });
  }
  if (deferred.length) {
    console.log(
      `[ai] Draft cap: ${selected.length} of ${scored.length} survivors sent to drafting (${deferred.length} deferred, saving ~${deferred.length * 2} calls)`
    );
  }

  // ---- PASS 2: fetch, draft, audit (the expensive calls) ----
  for (const { c, scoring } of selected) {
    try {
      // FULL ARTICLE FETCH. Mandatory guardrail, no exceptions.
      // Deliberately BEFORE any further model call: a candidate whose article
      // cannot be retrieved must not cost a single additional token.
      //
      // BRIEF-COWORK-PLAYBOOK.md Stage 4 has required this since the
      // 2026-07-15 quarantine event, but the requirement previously lived only
      // in the agent-executed playbook, never in this code path. Drafting from
      // the RSS snippet is what produced invented vote counts and an invented
      // court case. If we cannot read the real article, we do not draft it.
      const fetched = await fetchArticleBody(c.source_url);
      if (!fetched.ok) {
        console.warn(
          `[ai] DROP ${c.id} (${c.source_outlet}): source fetch failed - ${fetched.reason} (${fetched.wordCount}w, floor ${MIN_BODY_WORDS})`
        );
        results.push({
          ...c,
          scoring,
          draft: {
            brief_worthy: false,
            reject_reason: `Source article unavailable or too short to draft from (${fetched.reason}, ${fetched.wordCount} words).`,
          },
          drop_reason: 'source_fetch_failed',
          source_fetch_reason: `${fetched.reason}: ${fetched.detail ?? ''}`.trim(),
        });
        continue;
      }

      // Step C: brief-worthy + draft, grounded in the REAL body.
      const draft = await runDraft(c, scoring, fetched.text);
      if (!draft.brief_worthy) {
        results.push({
          ...c,
          scoring,
          category: draft.category,
          draft,
          source_body: fetched.text,
          source_body_word_count: fetched.wordCount,
          drop_reason: 'brief_worthy_check',
        });
        continue;
      }

      // Step D: auditor pass (Stage 3, master plan section 6.2.5), also
      // grounded in the real body so it can run the source-fidelity check.
      const audit = await runAuditor(c, draft, fetched.text);

      // Random spot-check: even if audit_pass, promote a small percentage to held.
      const spotCheck = audit.audit_pass && Math.random() < SPOT_CHECK_RATE;
      if (spotCheck) audit.spot_check = true;

      results.push({
        ...c,
        scoring,
        category: draft.category,
        draft,
        audit,
        // Carried forward so the deterministic editorial firewall can verify
        // every drafted claim against the real source at publish time.
        source_body: fetched.text,
        source_body_word_count: fetched.wordCount,
      });
    } catch (err) {
      // A budget stop must abort the whole run, never degrade into a per-item
      // failure that looks like an ordinary bad article.
      if (err instanceof BudgetExceededError) throw err;
      console.error(`[ai] FAIL ${c.id} (${c.source_outlet})`, err);
      results.push({
        ...c,
        scoring: { novelty: 0, civic_significance: 0, sf_specificity: 0, uniqueness: 0, composite: 0, one_line_reason: 'AI pass failed', outlets_running_this: '' },
        draft: { brief_worthy: false, reject_reason: `Pipeline error: ${String(err).slice(0, 100)}` },
        drop_reason: 'pipeline_error',
      });
    }
  }

  return results;
}

// ============ ENTRYPOINT ============

interface RunOpts {
  runDate?: Date;
  inputDir?: string;
  outputDir?: string;
  /** Explicit YYYY-MM-DD edition date. Wins over runDate. Used by the
   *  orchestrator and by manual reruns so every stage agrees on the date. */
  editionDate?: string;
}

export async function aiPass(opts: RunOpts = {}): Promise<AuditedItem[]> {
  const runDate = opts.runDate ?? new Date();
  const inputDir = opts.inputDir ?? path.join(process.cwd(), 'scripts', 'queue');
  const outputDir = opts.outputDir ?? inputDir;
  // Edition date is always the San Francisco calendar date, never the runner's
  // UTC date. GitHub runners are UTC; without this the edition would file under
  // the wrong day on any run after ~4 PM PT.
  const dateString = opts.editionDate ?? sfDateString(runDate);

  console.log(`[ai] Loading candidates for ${dateString} (${kvEnabled() ? 'KV' : 'filesystem'})`);
  const candidates = await getQueue<Candidate[]>(dateString, 'ingested', { baseDir: inputDir });
  if (!candidates || candidates.length === 0) {
    throw new Error(`No ingested queue for ${dateString}. Run brief-ingest for that date first.`);
  }
  // Reset per-run accounting and arm the ceiling before any call is made.
  runUsage = newUsage();
  runLimitUsd = resolveMaxUsd();
  console.log(`[ai] Budget ceiling: $${runLimitUsd.toFixed(2)} per run (BRIEF_MAX_USD)`);

  // Free dedupe before we spend anything.
  const pre = preAiDedupe(candidates);
  if (pre.removed.length) {
    console.log(
      `[ai] Pre-AI dedupe removed ${pre.removed.length} duplicate headline(s), saving that many scoring calls`
    );
  }
  console.log(`[ai] Processing ${pre.kept.length} candidates against ${MODEL}`);

  let results: AuditedItem[];
  try {
    results = await processCandidates(pre.kept);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      console.error(`[ai] BUDGET STOP: ${err.message}`);
      for (const line of formatUsage(runUsage, runLimitUsd)) console.error(`[ai] ${line}`);
    }
    throw err;
  }

  for (const line of formatUsage(runUsage, runLimitUsd)) console.log(`[ai] ${line}`);

  const auditPassing = results.filter((r) => r.audit?.audit_pass && !r.audit?.spot_check);
  const held = results.filter((r) => r.audit && (!r.audit.audit_pass || r.audit.spot_check));
  const dropped = results.filter((r) => !r.audit);
  const fetchFailed = results.filter((r) => r.drop_reason === 'source_fetch_failed');

  console.log(`[ai] Auto-publishing: ${auditPassing.length}`);
  console.log(`[ai] Held for editor: ${held.length}`);
  console.log(`[ai] Dropped: ${dropped.length}`);
  console.log(`[ai] Dropped at full-article guardrail: ${fetchFailed.length} (floor ${MIN_BODY_WORDS} words)`);

  await putQueue(dateString, 'audited', results, { baseDir: outputDir });
  console.log(`[ai] Wrote ${results.length} audited records for ${dateString}`);

  return results;
}

// ============ CLI ============

if (import.meta.url === `file://${process.argv[1]}`) {
  const editionDate = resolveEditionDate(dateArgFrom(process.argv.slice(2)));
  aiPass({ editionDate, runDate: sfDateToInstant(editionDate) }).catch((err) => {
    console.error('[ai] FATAL', err);
    process.exit(1);
  });
}
