/**
 * scripts/brief-ai.ts
 *
 * Stages 2 and 3 of the Brief pipeline (BRIEF-MASTER-PLAN.md sections 6.2 and 6.2.5).
 *
 * Reads scripts/queue/<date>-ingested.json from the ingest step. For each
 * candidate runs four sequential Claude Haiku calls:
 *
 *   1. Scoring (prompt 7.1): novelty/civic/SF-specificity/uniqueness.
 *      Auto-reject if composite < 7.0 OR uniqueness < 6.
 *   2. Category (prompt 7.2): one tag from the 13-value taxonomy.
 *   3. Brief-worthy check + TLDR + editor's note (prompt 7.3): three
 *      yes/no questions, then draft TLDR (25-30w) and editor's note
 *      (100-150w starting with explicit angle statement).
 *   4. Auditor (prompt 7.4): five firewall checks. If all pass, item is
 *      auto-publish eligible. If any fail, item is held for editor.
 *
 * Random 10% of audit-passing items are still held as drift-detection
 * spot-check (master plan section 6.2.5).
 *
 * Writes scripts/queue/<date>-audited.json which is consumed by the
 * dashboard (brief-dashboard.astro) and the publish handler (brief-publish.ts).
 *
 * Runs at 5:30 AM PT via Vercel cron (vercel.json). Locally:
 *   npm run brief:ai -- --date 2026-06-14
 *
 * Dependencies: @anthropic-ai/sdk
 * Env: ANTHROPIC_API_KEY (set in Vercel env or .env.local)
 *
 * Cost model: see BRIEF-COST-MODEL.md. Roughly $0.40-$0.80 per day at
 * 40-60 candidates.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Candidate } from './brief-ingest.js';

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
   *  when the scoring filter or brief-worthy check rejects the item. */
  drop_reason?: string;
}

// ============ CONFIG ============

const MODEL = 'claude-haiku-4-5-20251001';
const SPOT_CHECK_RATE = 0.10; // 10% per master plan section 6.2.5

// Hard reject thresholds from prompt 7.1
const COMPOSITE_MIN = 7.0;
const UNIQUENESS_MIN = 6;

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

async function callClaude(prompt: string, maxTokens = 1500): Promise<string> {
  const client = await getClient();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
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

function categoryPrompt(c: Candidate): string {
  return `You are tagging an SF Times brief item with one category from a fixed taxonomy.

Categories: Transit, Housing, Food, Politics, Tech, Culture, Arts, Business, Public safety, Openings, Closings, Weather, Sports.

Pick the single best fit. If the story spans two categories, pick the one that matches the primary newsworthy hook.

Return just the category name in ALL CAPS, no other text.

Headline: ${c.original_headline}
Dek: ${c.original_dek}
First paragraph: ${c.first_paragraph ?? '(none)'}`;
}

function draftPrompt(c: Candidate, scoring: ScoringResult): string {
  return `You are deciding whether this story belongs in SF Times' daily Brief and, if so, drafting the TLDR and editor's note.

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

STEP 4. BRIEF SIGNAL (pick exactly one)

- "first-to-connect": We are first to make the connection between this and another story.
- "underreported": Other outlets have this but at low depth.
- "missing-context": Other outlets ran the news but missed the backstory we add.
- "structural-pattern": This is one instance of a larger structural pattern only we are naming.

Return JSON only:
{
  "brief_worthy": true,
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
- Full available text: ${c.first_paragraph ?? '(none)'}
- Source URL: ${c.source_url}
- Other outlets likely running this: ${scoring.outlets_running_this}`;
}

function auditorPrompt(c: Candidate, draft: DraftResult): string {
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
  "audit_pass": <true if all 5 checks pass, false otherwise>,
  "check_1_recap": "pass" | "fail",
  "check_2_angle": "pass" | "fail",
  "check_3_specificity": "pass" | "fail",
  "check_4_word_count": "pass" | "fail",
  "check_5_voice": "pass" | "fail",
  "fail_reasons": [<one-line explanation for each failed check>],
  "recommendation": "auto-publish" | "hold for editor"
}

Source materials:
- Source URL: ${c.source_url}
- Source headline: ${c.original_headline}
- Source first paragraph: ${c.first_paragraph ?? '(none)'}

Draft to audit:
- Brief signal: ${draft.brief_signal}
- Angle statement: ${draft.angle_statement}
- TLDR: ${draft.tldr}
- Editor's note: ${draft.editor_note}
- What to watch: ${draft.what_to_watch}`;
}

// ============ PROMPT RUNNERS ============

export async function runScoring(c: Candidate): Promise<ScoringResult> {
  const text = await callClaude(scoringPrompt(c), 400);
  return parseJson<ScoringResult>(text);
}

export async function runCategory(c: Candidate): Promise<Category> {
  const text = await callClaude(categoryPrompt(c), 50);
  const cleaned = text.trim().replace(/[^A-Z ]/gi, '').toUpperCase();
  return cleaned as Category;
}

export async function runDraft(c: Candidate, scoring: ScoringResult): Promise<DraftResult> {
  const text = await callClaude(draftPrompt(c, scoring), 1200);
  return parseJson<DraftResult>(text);
}

export async function runAuditor(c: Candidate, draft: DraftResult): Promise<AuditResult> {
  const text = await callClaude(auditorPrompt(c, draft), 500);
  return parseJson<AuditResult>(text);
}

// ============ ORCHESTRATION ============

export async function processCandidates(candidates: Candidate[]): Promise<AuditedItem[]> {
  const results: AuditedItem[] = [];

  for (const c of candidates) {
    try {
      // Step A: scoring
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

      // Step B: category (parallel-safe with C but we serialize for cost predictability)
      const category = await runCategory(c);

      // Step C: brief-worthy + draft
      const draft = await runDraft(c, scoring);
      if (!draft.brief_worthy) {
        results.push({
          ...c,
          scoring,
          category,
          draft,
          drop_reason: 'brief_worthy_check',
        });
        continue;
      }

      // Step D: auditor pass (Stage 3, master plan section 6.2.5)
      const audit = await runAuditor(c, draft);

      // Random spot-check: even if audit_pass, promote a small percentage to held.
      const spotCheck = audit.audit_pass && Math.random() < SPOT_CHECK_RATE;
      if (spotCheck) audit.spot_check = true;

      results.push({ ...c, scoring, category, draft, audit });
    } catch (err) {
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
}

export async function aiPass(opts: RunOpts = {}): Promise<AuditedItem[]> {
  const runDate = opts.runDate ?? new Date();
  const inputDir = opts.inputDir ?? path.join(process.cwd(), 'scripts', 'queue');
  const outputDir = opts.outputDir ?? inputDir;
  const dateString = runDate.toISOString().slice(0, 10);

  const inputPath = path.join(inputDir, `${dateString}-ingested.json`);
  const outputPath = path.join(outputDir, `${dateString}-audited.json`);

  console.log(`[ai] Loading candidates from ${inputPath}`);
  const raw = await readFile(inputPath, 'utf-8');
  const candidates: Candidate[] = JSON.parse(raw);
  console.log(`[ai] Processing ${candidates.length} candidates against ${MODEL}`);

  const results = await processCandidates(candidates);

  const auditPassing = results.filter((r) => r.audit?.audit_pass && !r.audit?.spot_check);
  const held = results.filter((r) => r.audit && (!r.audit.audit_pass || r.audit.spot_check));
  const dropped = results.filter((r) => !r.audit);

  console.log(`[ai] Auto-publishing: ${auditPassing.length}`);
  console.log(`[ai] Held for editor: ${held.length}`);
  console.log(`[ai] Dropped: ${dropped.length}`);

  await writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`[ai] Wrote ${results.length} audited records to ${outputPath}`);

  return results;
}

// ============ CLI ============

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => a.startsWith('--date='))?.slice(7);
  const runDate = dateArg ? new Date(dateArg + 'T08:00:00Z') : new Date();
  aiPass({ runDate }).catch((err) => {
    console.error('[ai] FATAL', err);
    process.exit(1);
  });
}
