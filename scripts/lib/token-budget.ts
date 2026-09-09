/**
 * scripts/lib/token-budget.ts
 *
 * Measures and hard-caps Anthropic API spend for a single Brief run.
 *
 * WHY
 * The pipeline is cheap, but "cheap" is a measurement, not a guarantee. A bug
 * that retries in a loop, a feed that suddenly returns 500 candidates, or a
 * prompt change that balloons input size could all turn a $0.10 run into
 * something surprising. This module makes usage observable and puts a hard
 * ceiling on it that stops the run rather than trusting the code to behave.
 *
 * Two layers of protection, and you want both:
 *   1. This in-run ceiling, which stops a single bad run mid-flight.
 *   2. A spend limit configured in the Anthropic Console, which is the only
 *      thing that can protect you if this code never runs correctly at all.
 *
 * Usage is read from the API response's `usage` block, so the numbers are the
 * real billed counts, not an estimate.
 */

/** Claude Haiku 4.5 list pricing, USD per million tokens. Verified 2026-09. */
export const PRICE_PER_MTOK_INPUT = 1.0;
export const PRICE_PER_MTOK_OUTPUT = 5.0;

/**
 * Default hard ceiling for one run, in USD.
 *
 * A normal run measures $0.08 to $0.21. A ceiling of $0.50 is roughly 2.5x the
 * heaviest expected day: high enough that a legitimately busy news day never
 * trips it, low enough that a runaway loop is stopped almost immediately.
 * Override with BRIEF_MAX_USD.
 */
export const DEFAULT_MAX_USD = 0.5;

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Per-stage breakdown so an operator can see where the money went. */
  byStage: Record<string, { calls: number; input: number; output: number }>;
}

export class BudgetExceededError extends Error {
  constructor(public readonly usage: Usage, public readonly limitUsd: number) {
    super(
      `Token budget exceeded: $${estimateCost(usage).toFixed(4)} spent against a $${limitUsd.toFixed(2)} ceiling after ${usage.calls} calls.`
    );
    this.name = 'BudgetExceededError';
  }
}

export function newUsage(): Usage {
  return { calls: 0, inputTokens: 0, outputTokens: 0, byStage: {} };
}

export function estimateCost(u: Usage): number {
  return (
    (u.inputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT +
    (u.outputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT
  );
}

/** Resolve the ceiling from env, falling back to the default. */
export function resolveMaxUsd(): number {
  const raw = process.env.BRIEF_MAX_USD;
  if (!raw) return DEFAULT_MAX_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[budget] Ignoring invalid BRIEF_MAX_USD="${raw}". Using $${DEFAULT_MAX_USD}.`);
    return DEFAULT_MAX_USD;
  }
  return n;
}

/**
 * Record one API call's real usage and enforce the ceiling.
 *
 * Throws BudgetExceededError once the ceiling is crossed. The caller must let
 * that propagate: a budget stop is a RED run, not a quiet degradation. We
 * would rather publish nothing than silently spend without limit.
 */
export function recordUsage(
  u: Usage,
  stage: string,
  inputTokens: number,
  outputTokens: number,
  limitUsd: number
): void {
  u.calls += 1;
  u.inputTokens += inputTokens || 0;
  u.outputTokens += outputTokens || 0;
  const s = (u.byStage[stage] ??= { calls: 0, input: 0, output: 0 });
  s.calls += 1;
  s.input += inputTokens || 0;
  s.output += outputTokens || 0;

  if (estimateCost(u) > limitUsd) throw new BudgetExceededError(u, limitUsd);
}

/** Human-readable usage block for the run report. */
export function formatUsage(u: Usage, limitUsd: number): string[] {
  const cost = estimateCost(u);
  const lines = [
    `API calls         : ${u.calls}`,
    `Input tokens      : ${u.inputTokens.toLocaleString()}`,
    `Output tokens     : ${u.outputTokens.toLocaleString()}`,
    `Estimated cost    : $${cost.toFixed(4)} (ceiling $${limitUsd.toFixed(2)}, ${Math.round((cost / limitUsd) * 100)}% used)`,
  ];
  for (const [stage, s] of Object.entries(u.byStage)) {
    const c =
      (s.input / 1_000_000) * PRICE_PER_MTOK_INPUT + (s.output / 1_000_000) * PRICE_PER_MTOK_OUTPUT;
    lines.push(
      `  ${stage.padEnd(16)}: ${String(s.calls).padStart(3)} calls, ${s.input.toLocaleString()} in, ${s.output.toLocaleString()} out, $${c.toFixed(4)}`
    );
  }
  return lines;
}

/**
 * Estimate what a run WOULD cost, for dry runs where no call is made.
 * Uses measured per-call averages from the current prompt sizes.
 */
export function estimateRunCost(candidates: number, drafted: number): {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
} {
  // Measured 2026-09 against real prompts and a representative 7,100-char body.
  const SCORE_IN = 575, SCORE_OUT = 150;
  const DRAFT_IN = 2700, DRAFT_OUT = 405;   // category is merged into this call
  const AUDIT_IN = 2500, AUDIT_OUT = 200;

  const inputTokens = candidates * SCORE_IN + drafted * (DRAFT_IN + AUDIT_IN);
  const outputTokens = candidates * SCORE_OUT + drafted * (DRAFT_OUT + AUDIT_OUT);
  return {
    calls: candidates + drafted * 2,
    inputTokens,
    outputTokens,
    usd:
      (inputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT +
      (outputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT,
  };
}
