/**
 * scripts/lib/article-firewall.ts
 *
 * The editorial firewall, adapted for long-form.
 *
 * WHY A SEPARATE MODULE
 * A Brief item has exactly one source, so "is this number in the article?" is a
 * single substring test. A 1,200-word feature is built from several sources, so
 * the same question becomes "is this number in ANY of them?" That change sounds
 * small and is not: it is the difference between a check that works and a check
 * that removes every true item on a multi-source piece.
 *
 * THE RISK THAT IS SPECIFIC TO LONG-FORM
 * Multi-source synthesis is where a model is most likely to produce a confident
 * narrative that no individual source supports. Three articles about a
 * neighborhood get smoothed into a fourth article containing a claim none of
 * them made, and every individual fact checks out. The number check cannot see
 * that. Per-paragraph source mapping is the mitigation: every paragraph of a
 * draft must name the source it came from, and a paragraph that cannot name one
 * is removed. It is a mitigation, not a guarantee, and it should not be
 * described as one.
 *
 * WHAT THIS DOES NOT DO
 * It does not judge whether the article is any good. It checks that the article
 * does not assert things its sources do not contain.
 */

import {
  findUnsupportedNumbers,
  findUnsupportedAttributions,
  extractQuotations,
  isCertaintyEscalated,
  type FirewallViolation,
} from './editorial-firewall.js';
import { countWords } from './fetch-article.js';

/** Minimum distinct verified sources before a feature may be drafted at all.
 *  One source is not an article, it is a longer Brief item under a byline. */
export const MIN_ARTICLE_SOURCES = 3;

/** Below this, it is not a feature. */
export const MIN_ARTICLE_WORDS = 700;

export interface VerifiedSource {
  id: string;
  url: string;
  outlet: string;
  title: string;
  body: string;
  word_count: number;
  /** journalism | primary | supporting. Set at research time. Supporting
   *  sources may add detail but cannot carry a piece; see lib/source-quality. */
  tier?: string;
}

/** One paragraph of the drafted article, with the sources it came from. */
export interface MappedParagraph {
  text: string;
  /** Source ids from the research packet. Empty is a violation, not a default. */
  source_ids: string[];
}

export interface ArticleDraft {
  title: string;
  deck: string;
  /** Body as source-mapped paragraphs, not a blob. The mapping is the safety
   *  primitive; accepting a blob would discard it. */
  paragraphs: MappedParagraph[];
  pull_quote?: string;
  pull_quote_attr?: string;
}

export interface ArticleVerdict {
  pass: boolean;
  violations: FirewallViolation[];
  /** Paragraphs that failed and would be removed. Reported, never repaired. */
  removedParagraphs: Array<{ index: number; text: string; reason: string }>;
  wordCount: number;
  sourcesUsed: number;
}

/**
 * Validate a drafted feature against the sources it claims to be built from.
 *
 * Order matters: structural problems are reported before factual ones, because
 * a draft that names no sources cannot be fact-checked at all and saying "no
 * unsupported numbers found" about it would be actively misleading.
 */
export function validateArticle(
  draft: ArticleDraft,
  sources: VerifiedSource[]
): ArticleVerdict {
  const v: FirewallViolation[] = [];
  const removed: ArticleVerdict['removedParagraphs'] = [];

  const byId = new Map(sources.map((s) => [s.id, s]));
  const allText = sources.map((s) => s.body).join('\n\n');
  const fullDraft = draft.paragraphs.map((p) => p.text).join('\n\n');
  const wordCount = countWords(fullDraft);

  // ---- 1. Enough distinct sources to be an article ----
  if (sources.length < MIN_ARTICLE_SOURCES) {
    v.push({
      check: 'multi_source_floor',
      severity: 'block_edition',
      detail: `Only ${sources.length} verified source(s); a feature requires at least ${MIN_ARTICLE_SOURCES}. One source is a Brief item, not an article.`,
    });
  }

  // ---- 2. Enough article to be a feature ----
  if (wordCount < MIN_ARTICLE_WORDS) {
    v.push({
      check: 'article_length',
      severity: 'block_edition',
      detail: `Draft is ${wordCount} words; the floor is ${MIN_ARTICLE_WORDS}.`,
    });
  }

  // ---- 3. Structure ----
  for (const [field, val] of [['title', draft.title], ['deck', draft.deck]] as const) {
    if (!val || !val.trim()) {
      v.push({ check: 'structure_complete', severity: 'block_edition', detail: `Missing ${field}.` });
    }
  }

  // ---- 4. EVERY PARAGRAPH NAMES ITS SOURCES ----
  // The core long-form primitive. A paragraph with no source is exactly where
  // synthesis turns into invention, and it is invisible to every other check
  // here because an invented sentence containing no numbers and no quotations
  // passes all of them.
  const usedSourceIds = new Set<string>();
  draft.paragraphs.forEach((p, i) => {
    const ids = (p.source_ids ?? []).filter((id) => id && id.trim());
    if (ids.length === 0) {
      removed.push({ index: i, text: p.text.slice(0, 160), reason: 'No source mapped to this paragraph.' });
      return;
    }
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) {
      removed.push({
        index: i,
        text: p.text.slice(0, 160),
        reason: `Cites source id(s) not in the research packet: ${unknown.join(', ')}`,
      });
      return;
    }
    for (const id of ids) usedSourceIds.add(id);
  });

  if (removed.length) {
    v.push({
      check: 'paragraph_source_mapping',
      severity: 'remove_item',
      detail: `${removed.length} of ${draft.paragraphs.length} paragraphs could not be traced to a source.`,
    });
  }

  // ---- 5. The article must actually USE its sources ----
  // A draft that cites three sources but draws every paragraph from one of them
  // has cleared the source floor on paper only.
  if (sources.length >= MIN_ARTICLE_SOURCES && usedSourceIds.size < MIN_ARTICLE_SOURCES) {
    v.push({
      check: 'sources_actually_used',
      severity: 'block_edition',
      detail: `Draft draws on only ${usedSourceIds.size} of ${sources.length} available sources. The floor applies to sources USED, not sources fetched.`,
    });
  }

  // ---- 6. Numbers, against the combined corpus ----
  // Combined rather than per-paragraph on purpose: a writer legitimately
  // introduces a figure in one paragraph that a different source established.
  for (const n of findUnsupportedNumbers(fullDraft, allText)) {
    v.push({
      check: 'numbers_supported_by_source',
      severity: 'remove_item',
      detail: `Figure "${n}" appears in the draft but in none of the ${sources.length} sources.`,
    });
  }

  // ---- 7. Quotations ----
  const quotable = sources.map((s) => s.body).join('\n\n').toLowerCase();
  for (const q of extractQuotations(fullDraft)) {
    const norm = q.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
      .replace(/^[\s.,;:!?"'-]+/, '').replace(/[\s.,;:!?"'-]+$/, '');
    const hay = quotable.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');
    if (!hay.includes(norm)) {
      v.push({
        check: 'no_fabricated_quotes',
        severity: 'remove_item',
        detail: `Quotation not found in any source: "${q.slice(0, 90)}"`,
      });
    }
  }

  // A pull quote is a reader-facing assertion like any other.
  if (draft.pull_quote) {
    const pq = draft.pull_quote.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
      .replace(/^[\s.,;:!?"'-]+/, '').replace(/[\s.,;:!?"'-]+$/, '');
    const hay = quotable.replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
    if (pq.length > 12 && !hay.includes(pq)) {
      v.push({
        check: 'no_fabricated_quotes',
        severity: 'block_edition',
        detail: `Pull quote is not present in any source: "${draft.pull_quote.slice(0, 90)}"`,
      });
    }
  }

  // ---- 8. Attribution ----
  for (const a of findUnsupportedAttributions(fullDraft, allText)) {
    v.push({
      check: 'attribution_supported',
      severity: 'remove_item',
      detail: `Draft attributes a statement to "${a}" but no source does.`,
    });
  }

  // ---- 9. Certainty ----
  if (isCertaintyEscalated(fullDraft, allText)) {
    v.push({
      check: 'certainty_preserved',
      severity: 'remove_item',
      detail: 'Sources treat this as alleged, reported or preliminary; the draft states it as settled fact.',
    });
  }

  return {
    pass: v.length === 0,
    violations: v,
    removedParagraphs: removed,
    wordCount,
    sourcesUsed: usedSourceIds.size,
  };
}
