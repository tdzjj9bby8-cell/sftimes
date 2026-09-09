/**
 * scripts/lib/editorial-quality.ts
 *
 * The difference between an automated feed summarizer and an edition.
 *
 * The firewall answers "is this true?". This module answers "is this a Brief?".
 * Those are different questions, and passing the first does not imply the
 * second. Six accurate items that are all the same story from the same outlet
 * is a technically-correct failure.
 *
 * Three jobs:
 *   1. Semantic near-duplicate removal (the same event, told three ways)
 *   2. Source diversity (no edition dominated by one outlet)
 *   3. The editorial quality floor: the explicit conditions under which we
 *      publish nothing rather than publish filler
 *
 * Principle throughout: no edition is better than a bad edition.
 */

// ============ CONFIG ============

/**
 * Minimum items for a real edition. Below this it reads as an accident rather
 * than a publication. Three is the honest floor for a daily brief.
 */
export const MIN_ITEMS_TO_PUBLISH = 3;

/**
 * No single outlet may supply more than this share of an edition, once the
 * edition is large enough for the ratio to be meaningful.
 *
 * Set to 0.6 rather than something stricter because SF's local ecosystem is
 * genuinely lopsided: on a given day Mission Local really may be the only
 * outlet doing original reporting. The cap prevents "whatever Mission Local
 * published today" without pretending the market is evenly distributed.
 */
export const MAX_SINGLE_OUTLET_SHARE = 0.6;

/** The share cap only applies at or above this item count. */
const SHARE_CAP_MIN_ITEMS = 4;

/**
 * Headline+TLDR similarity at or above this is treated as the same story.
 * Jaccard over stemmed content tokens.
 *
 * WHY 0.38 AND NOT LOWER
 * This catches the common real case: two outlets running the same story with
 * reworded headlines. It does NOT reliably catch a pair that describes one
 * event with almost no shared vocabulary ("City approves new transit plan" vs
 * "Officials vote to approve transit changes" share only two content words).
 *
 * Lowering the threshold far enough to catch that case also merges
 * "Supervisors approve housing plan" with "Supervisors approve transit plan",
 * which are genuinely different stories. Dropping a real story is a worse
 * outcome than tolerating an occasional duplicate, so the threshold stays
 * conservative.
 *
 * The primary defense against saturated stories is upstream anyway: the
 * scoring stage rates uniqueness and rejects anything under 6, so a story
 * several outlets are running rarely survives to this point. This is the
 * second net, not the first.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.38;

/** Similarity alone is not enough on short text; require real lexical overlap. */
const MIN_SHARED_TOKENS = 2;

/**
 * Absolute minimum healthy feeds. Ingest tolerates individual source failures,
 * which is correct, but publishing an edition drawn from one surviving feed
 * while ten are down is how a partial outage becomes a wrong edition that looks
 * fine.
 *
 * This floor alone is not sufficient once the source list grows: 4 healthy out
 * of 32 is a catastrophic outage that this number would wave through. Use
 * requiredHealthySources() rather than comparing against this directly.
 */
export const MIN_HEALTHY_SOURCES = 4;

/**
 * Fraction of configured sources that must respond.
 *
 * A newsroom's feeds fail individually all the time and that is normal. Half of
 * them failing at once is not a quiet news day, it is an incident, and the
 * resulting edition would misrepresent the day while looking perfectly healthy.
 */
export const MIN_HEALTHY_SOURCE_SHARE = 0.6;

/**
 * How many sources must be up for today's edition to be trustworthy.
 *
 * Proportional, with an absolute floor underneath it. Scales automatically as
 * the source list grows, so adding feeds tightens the gate instead of quietly
 * loosening it. That direction matters: the failure mode of a fixed integer is
 * that every source you add makes the check weaker.
 */
export function requiredHealthySources(totalSources: number): number {
  if (totalSources <= 0) return 0;
  return Math.max(
    Math.min(MIN_HEALTHY_SOURCES, totalSources),
    Math.ceil(totalSources * MIN_HEALTHY_SOURCE_SHARE)
  );
}

/**
 * Headline-only dedupe threshold, used before any expensive work happens.
 *
 * Deliberately much higher than NEAR_DUPLICATE_THRESHOLD: at this stage we have
 * nothing but a headline, and wrongly merging two stories costs real coverage
 * that nothing downstream can recover.
 */
export const HEADLINE_DUPLICATE_THRESHOLD = 0.6;

// ============ TYPES ============

export interface QualityItem {
  id?: string;
  source_url?: string;
  source_outlet?: string;
  original_headline?: string;
  /** Taxonomy tag from the categorization stage. Used as a hard guard against
   *  merging two different stories that happen to share vocabulary. */
  category?: string;
  scoring?: { composite?: number; uniqueness?: number };
  draft?: { tldr?: string; angle_statement?: string };
}

export interface DedupeResult<T> {
  kept: T[];
  removed: Array<{ item: T; duplicateOf: string; similarity: number }>;
}

export interface DiversityResult<T> {
  kept: T[];
  removed: Array<{ item: T; reason: string }>;
  outletCounts: Record<string, number>;
}

export interface QualityFloorInput {
  itemCount: number;
  healthySources: number;
  totalSources: number;
  outletCounts: Record<string, number>;
  pipelineErrors: number;
  candidatesIngested: number;
}

export interface QualityFloorVerdict {
  publish: boolean;
  reasons: string[];
}

// ============ 1. SEMANTIC NEAR-DUPLICATES ============

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'has',
  'have', 'he', 'her', 'his', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'she',
  'that', 'the', 'their', 'they', 'this', 'to', 'was', 'were', 'will', 'with',
  'after', 'over', 'into', 'amid', 'sf', 'san', 'francisco', 'city', 'new',
  'says', 'say', 'said', 'could', 'would', 'may', 'more', 'than', 'but', 'not',
]);

/** Content tokens: lowercase, punctuation-stripped, stopworded, stemmed lightly. */
export function contentTokens(s: string): Set<string> {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
      // Stem so approve/approves/approved and vote/votes/voted collapse to a
      // common form. The trailing-e strip is what makes it consistent:
      // without it "approves" becomes "approv" while "approve" stays
      // "approve", and the two never match.
      .map((t) => t.replace(/(ing|ed|es|s)$/, '').replace(/e$/, ''))
      .filter((t) => t.length >= 3)
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Cheap headline-only dedupe, run before anything expensive touches a
 * candidate.
 *
 * Ingest already dedupes by URL and title cosine. This is a second pass with a
 * different metric, because every duplicate removed here is an article body we
 * never fetch and an item no editor has to read twice.
 *
 * Lives here rather than in brief-ai.ts so the subscription publishing path
 * (brief-prep.ts) can use it without importing a module that talks to the
 * Anthropic API.
 */
export function dedupeByHeadline<T extends { original_headline?: string }>(
  candidates: T[],
): { kept: T[]; removed: T[] } {
  const kept: T[] = [];
  const keptTokens: Set<string>[] = [];
  const removed: T[] = [];

  for (const c of candidates) {
    const tokens = contentTokens(c.original_headline ?? '');
    if (tokens.size === 0) {
      kept.push(c);
      keptTokens.push(tokens);
      continue;
    }
    const dupe = keptTokens.some((k) => jaccard(tokens, k) >= HEADLINE_DUPLICATE_THRESHOLD);
    if (dupe) removed.push(c);
    else {
      kept.push(c);
      keptTokens.push(tokens);
    }
  }
  return { kept, removed };
}

/**
 * Remove items that describe the same event as an item already kept.
 *
 * Compares headline plus TLDR, because two outlets often word a headline
 * differently while the TLDRs converge on the same facts. This is what catches
 * "City approves new transit plan" against "Officials vote to approve transit
 * changes", which token-cosine on headlines alone misses.
 *
 * Keeps the higher-scoring item of each pair, so deduping never costs quality.
 */
export function removeNearDuplicates<T extends QualityItem>(items: T[]): DedupeResult<T> {
  const ranked = [...items].sort(
    (a, b) => (b.scoring?.composite ?? 0) - (a.scoring?.composite ?? 0)
  );

  const kept: T[] = [];
  const keptTokens: Array<{ id: string; tokens: Set<string>; category?: string }> = [];
  const removed: DedupeResult<T>['removed'] = [];

  for (const item of ranked) {
    const text = `${item.original_headline ?? ''} ${item.draft?.tldr ?? ''}`;
    const tokens = contentTokens(text);

    let dupeOf: string | null = null;
    let sim = 0;
    for (const k of keptTokens) {
      // HARD GUARD: two items in different categories are different stories,
      // regardless of shared vocabulary. "Supervisors approve housing plan"
      // and "Supervisors approve transit plan" score 0.60 on headline overlap
      // alone, which is well above the threshold. Without this guard the
      // deduper would silently drop one of two legitimate stories, which is
      // the most expensive mistake this module could make.
      if (item.category && k.category && item.category !== k.category) continue;

      const s = jaccard(tokens, k.tokens);
      let shared = 0;
      for (const t of tokens) if (k.tokens.has(t)) shared++;
      if (s >= NEAR_DUPLICATE_THRESHOLD && shared >= MIN_SHARED_TOKENS && s > sim) {
        sim = s;
        dupeOf = k.id;
      }
    }

    if (dupeOf) {
      removed.push({ item, duplicateOf: dupeOf, similarity: Number(sim.toFixed(3)) });
    } else {
      kept.push(item);
      keptTokens.push({
        id: item.id ?? item.source_url ?? String(kept.length),
        tokens,
        category: item.category,
      });
    }
  }

  return { kept, removed };
}

// ============ 2. SOURCE DIVERSITY ============

/**
 * Enforce the single-outlet share cap.
 *
 * Iterates in score order and drops the lowest-scoring surplus items from any
 * outlet that exceeds the cap, so the edition keeps each outlet's best work.
 * Below SHARE_CAP_MIN_ITEMS the cap is not applied: on a 3-item day a ratio is
 * not a meaningful signal and enforcing it would just shrink a thin edition.
 */
export function enforceSourceDiversity<T extends QualityItem>(items: T[]): DiversityResult<T> {
  const outletCounts: Record<string, number> = {};
  for (const i of items) {
    const o = i.source_outlet ?? 'unknown';
    outletCounts[o] = (outletCounts[o] ?? 0) + 1;
  }

  if (items.length < SHARE_CAP_MIN_ITEMS) {
    return { kept: items, removed: [], outletCounts };
  }

  const maxPerOutlet = Math.max(1, Math.floor(items.length * MAX_SINGLE_OUTLET_SHARE));
  const ranked = [...items].sort(
    (a, b) => (b.scoring?.composite ?? 0) - (a.scoring?.composite ?? 0)
  );

  const seen: Record<string, number> = {};
  const kept: T[] = [];
  const removed: DiversityResult<T>['removed'] = [];

  for (const item of ranked) {
    const o = item.source_outlet ?? 'unknown';
    seen[o] = (seen[o] ?? 0) + 1;
    if (seen[o] > maxPerOutlet) {
      removed.push({
        item,
        reason: `Outlet "${o}" exceeded the ${Math.round(MAX_SINGLE_OUTLET_SHARE * 100)}% single-outlet cap (max ${maxPerOutlet} of ${items.length}).`,
      });
    } else {
      kept.push(item);
    }
  }

  const finalCounts: Record<string, number> = {};
  for (const i of kept) {
    const o = i.source_outlet ?? 'unknown';
    finalCounts[o] = (finalCounts[o] ?? 0) + 1;
  }

  return { kept, removed, outletCounts: finalCounts };
}

// ============ 3. EDITORIAL QUALITY FLOOR ============

/**
 * The explicit conditions under which we publish nothing.
 *
 * Every condition here is a case where publishing would produce something the
 * editor would not put his name behind. The pipeline fails safe rather than
 * manufacturing filler.
 */
export function evaluateQualityFloor(input: QualityFloorInput): QualityFloorVerdict {
  const reasons: string[] = [];

  if (input.pipelineErrors > 0 && input.pipelineErrors >= input.candidatesIngested * 0.5) {
    reasons.push(
      `Systemic model failure: ${input.pipelineErrors} of ${input.candidatesIngested} candidates errored.`
    );
  }

  const required = requiredHealthySources(input.totalSources);
  if (input.healthySources < required) {
    reasons.push(
      `Only ${input.healthySources} of ${input.totalSources} sources responded; minimum is ${required}. An edition built on a partial outage misrepresents the day.`
    );
  }

  if (input.itemCount < MIN_ITEMS_TO_PUBLISH) {
    reasons.push(
      `Only ${input.itemCount} verified item(s); minimum is ${MIN_ITEMS_TO_PUBLISH}.`
    );
  }

  const outlets = Object.keys(input.outletCounts);
  if (input.itemCount >= SHARE_CAP_MIN_ITEMS && outlets.length < 2) {
    reasons.push(
      `Every item came from a single outlet (${outlets[0] ?? 'unknown'}). That is a feed digest, not a brief.`
    );
  }

  return { publish: reasons.length === 0, reasons };
}

/**
 * Order the edition. The highest composite score leads, which is the closest
 * deterministic proxy we have for "what a reader should see first".
 *
 * Deliberately simple. Real editorial ordering is a human judgment and the
 * dashboard remains the place to exercise it.
 */
export function orderForEdition<T extends QualityItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byScore = (b.scoring?.composite ?? 0) - (a.scoring?.composite ?? 0);
    if (byScore !== 0) return byScore;
    return (b.scoring?.uniqueness ?? 0) - (a.scoring?.uniqueness ?? 0);
  });
}
