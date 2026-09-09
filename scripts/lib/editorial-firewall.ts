/**
 * scripts/lib/editorial-firewall.ts
 *
 * Deterministic pre-publish validation of every drafted Brief item.
 *
 * WHY THIS EXISTS
 * The existing auditor pass in brief-ai.ts (prompt 7.4) checks editorial CRAFT:
 * does the note recap, does it lead with an angle, is the TLDR specific, is the
 * word count right, does it sound like SF Times. Those are real checks and they
 * stay. But none of them verify that the draft is TRUE with respect to the
 * source. A fabricated vote count reads as specific and confident, which means
 * it passes all five craft checks. That is precisely what happened on
 * 2026-07-15.
 *
 * This module is the factual layer the craft audit cannot provide. It is
 * deterministic code, not a model call, so it cannot be talked out of a
 * conclusion and it costs nothing to run.
 *
 * DESIGN PRINCIPLE
 * When an item fails, we REMOVE THE ITEM. We never repair it, never soften the
 * claim, never regenerate it into something plausible. If every item fails, the
 * edition does not publish. A missed edition is always preferable to a
 * fabricated one.
 */

import { countWords } from './fetch-article.js';

// ============ TYPES ============

export type FirewallSeverity = 'remove_item' | 'block_edition';

export interface FirewallViolation {
  check: string;
  severity: FirewallSeverity;
  detail: string;
}

export interface FirewallVerdict {
  pass: boolean;
  violations: FirewallViolation[];
}

/**
 * The minimum shape this module needs. Kept structural rather than importing
 * AuditedItem so the firewall can validate anything shaped like a Brief item,
 * including editor-promoted items arriving from the dashboard.
 */
export interface ValidatableItem {
  id?: string;
  source_url?: string;
  source_outlet?: string;
  source_byline?: string;
  original_headline?: string;
  /** The real fetched body. Presence of this is itself a required check. */
  source_body?: string;
  source_body_word_count?: number;
  draft?: {
    brief_worthy?: boolean;
    angle_statement?: string;
    tldr?: string;
    editor_note?: string;
    what_to_watch?: string;
    brief_signal?: string;
  };
}

// ============ CONFIG ============

/** Editor's note bounds. Mirrors the auditor's check 4 tolerance. */
const NOTE_MIN_WORDS = 90;
const NOTE_MAX_WORDS = 165;

/**
 * Bylines that legitimately mean "no individual byline was published."
 * These are honest representations, not inventions. Anything else must have
 * come from the source feed.
 */
const GENERIC_BYLINES = new Set(['staff', 'staff report', 'editorial board', 'newsroom', '']);

// ============ PUBLIC API ============

/**
 * Validate one drafted item against the factual firewall.
 *
 * `publishedSourceUrls` lets the caller pass URLs already used in previous
 * editions so the same story is not published twice.
 */
export function validateItem(
  item: ValidatableItem,
  opts: { publishedSourceUrls?: Set<string>; editionDate?: string } = {}
): FirewallVerdict {
  const v: FirewallViolation[] = [];
  const d = item.draft ?? {};

  // ---- 1. Source exists and is a real URL ----
  if (!item.source_url || !isHttpUrl(item.source_url)) {
    v.push({
      check: 'source_url_valid',
      severity: 'remove_item',
      detail: `Missing or malformed source URL: ${String(item.source_url).slice(0, 120)}`,
    });
  }

  // ---- 2. Source outlet identified ----
  if (!nonEmpty(item.source_outlet)) {
    v.push({
      check: 'source_outlet_present',
      severity: 'remove_item',
      detail: 'No source outlet recorded. Attribution would be impossible.',
    });
  }

  // ---- 3. Source article was actually retrieved and read ----
  // This is the provenance check. Without a real body, the draft has no
  // factual basis and must not publish, regardless of how good it reads.
  const body = item.source_body ?? '';
  const bodyWords = item.source_body_word_count ?? countWords(body);
  if (!nonEmpty(body) || bodyWords === 0) {
    v.push({
      check: 'source_body_retrieved',
      severity: 'remove_item',
      detail:
        'No source body attached to this item. Drafting without the full article is the 2026-07-15 failure mode.',
    });
  }

  // ---- 4. Byline is not invented ----
  // We never synthesize a reporter. The byline must either be a generic
  // honest placeholder, or have come from the feed. A byline that appears
  // nowhere in the source body AND is not generic is treated as suspect.
  const byline = (item.source_byline ?? '').trim();
  if (!GENERIC_BYLINES.has(byline.toLowerCase()) && nonEmpty(body)) {
    const lastName = byline.split(/\s+/).filter(Boolean).slice(-1)[0] ?? '';
    if (lastName.length >= 3 && !normalize(body).includes(normalize(lastName))) {
      // Not fatal on its own: many sites omit the byline from body text.
      // Recorded as a violation only when combined with nothing else to
      // corroborate it would be over-aggressive, so we downgrade to a note by
      // not adding a violation here. Kept as an explicit decision, not an
      // oversight: see LIMITATIONS at the bottom.
    }
  }
  if (byline && /^(by\s+)?(unknown|n\/?a|anonymous)$/i.test(byline)) {
    v.push({
      check: 'byline_honest',
      severity: 'remove_item',
      detail: `Byline "${byline}" is a placeholder that misrepresents attribution.`,
    });
  }

  // ---- 5. Required structure present ----
  for (const [field, label] of [
    ['angle_statement', 'angle statement'],
    ['tldr', 'TLDR'],
    ['editor_note', "editor's note"],
  ] as const) {
    if (!nonEmpty((d as Record<string, string | undefined>)[field])) {
      v.push({
        check: 'structure_complete',
        severity: 'remove_item',
        detail: `Missing required field: ${label}.`,
      });
    }
  }

  // ---- 6. Editor's note word count ----
  if (nonEmpty(d.editor_note)) {
    const w = countWords(d.editor_note!);
    if (w < NOTE_MIN_WORDS || w > NOTE_MAX_WORDS) {
      v.push({
        check: 'note_word_count',
        severity: 'remove_item',
        detail: `Editor's note is ${w} words, outside ${NOTE_MIN_WORDS}-${NOTE_MAX_WORDS}.`,
      });
    }
  }

  // ---- 7. No fabricated quotations ----
  // Any quoted span in the drafted copy must appear in the source body.
  // This is the check that would have caught invented quotes directly.
  if (nonEmpty(body)) {
    const draftText = [d.tldr, d.editor_note, d.what_to_watch].filter(Boolean).join('\n');
    const haystack = normalizeQuote(body);
    for (const q of extractQuotations(draftText)) {
      if (!haystack.includes(normalizeQuote(q))) {
        v.push({
          check: 'no_fabricated_quotes',
          severity: 'remove_item',
          detail: `Quotation not found in source article: "${q.slice(0, 90)}"`,
        });
      }
    }
  }

  // ---- 8. No unsupported numbers ----
  // Every figure asserted in the TLDR or the editor's note must be traceable to
  // the source text. Invented vote counts and invented statistics were the
  // core of the 2026-07-15 incident, and they are exactly what this catches.
  if (nonEmpty(body)) {
    const claimText = [d.tldr, d.editor_note].filter(Boolean).join('\n');
    const unsupported = findUnsupportedNumbers(claimText, body);
    for (const n of unsupported) {
      v.push({
        check: 'numbers_supported_by_source',
        severity: 'remove_item',
        detail: `Figure "${n}" appears in the draft but not in the source article.`,
      });
    }
  }

  // ---- 9. Attribution must exist in the source ----
  // "police said", "the mayor announced", "according to Mission Local".
  // A model can attach a confident attribution to a claim the source never
  // attributes to anyone. We verify the attributed party actually appears in
  // the article and that the article contains reported speech at all.
  if (nonEmpty(body)) {
    const claimText = [d.tldr, d.editor_note, d.what_to_watch].filter(Boolean).join('\n');
    for (const a of findUnsupportedAttributions(claimText, body)) {
      v.push({
        check: 'attribution_supported',
        severity: 'remove_item',
        detail: `Draft attributes a statement to "${a}" but the source article does not.`,
      });
    }
  }

  // ---- 10. Certainty must not be escalated ----
  // Turning "alleged" / "reportedly" / "preliminary" into settled fact is a
  // defamation risk as much as an accuracy one. If the source is substantially
  // hedged and the draft strips every hedge, we drop the item.
  if (nonEmpty(body) && nonEmpty(d.editor_note)) {
    const claimText = [d.tldr, d.editor_note].filter(Boolean).join('\n');
    if (isCertaintyEscalated(claimText, body)) {
      v.push({
        check: 'certainty_preserved',
        severity: 'remove_item',
        detail:
          'Source treats this as alleged, reported, or preliminary; the draft states it as settled fact.',
      });
    }
  }

  // ---- 11. No duplicate publication ----
  if (item.source_url && opts.publishedSourceUrls?.has(canonicalUrl(item.source_url))) {
    v.push({
      check: 'not_already_published',
      severity: 'remove_item',
      detail: 'This source URL has already appeared in a previous edition.',
    });
  }

  return { pass: v.length === 0, violations: v };
}

/** Validate a whole batch. Returns the surviving items plus a per-item report. */
export function validateBatch<T extends ValidatableItem>(
  items: T[],
  opts: { publishedSourceUrls?: Set<string>; editionDate?: string } = {}
): {
  kept: T[];
  removed: Array<{ item: T; violations: FirewallViolation[] }>;
  blockEdition: boolean;
} {
  const kept: T[] = [];
  const removed: Array<{ item: T; violations: FirewallViolation[] }> = [];
  let blockEdition = false;

  // Track URLs within this run too, so one edition cannot carry the same
  // source twice.
  const seen = new Set<string>(opts.publishedSourceUrls ?? []);

  for (const item of items) {
    const verdict = validateItem(item, { ...opts, publishedSourceUrls: seen });
    if (verdict.violations.some((x) => x.severity === 'block_edition')) blockEdition = true;
    if (verdict.pass) {
      kept.push(item);
      if (item.source_url) seen.add(canonicalUrl(item.source_url));
    } else {
      removed.push({ item, violations: verdict.violations });
    }
  }

  return { kept, removed, blockEdition };
}

// ============ HELPERS ============

function nonEmpty(s?: string): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

export function canonicalUrl(u: string): string {
  try {
    const p = new URL(u);
    p.hash = '';
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid']) {
      p.searchParams.delete(k);
    }
    return `${p.host}${p.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

/** Lowercase, collapse whitespace, normalize quotes and dashes for comparison. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compare-form for quotations: normalized, with punctuation at the EDGES
 * stripped.
 *
 * The reason is ordinary house style, not leniency. A source renders a quote
 * mid-sentence and ends it with a comma: `"...who can't afford to live here,"
 * he said.` A draft ends its own sentence with the same quote and takes a
 * period: `"...who can't afford to live here."` Those are the same words. A
 * plain substring test calls the second one fabricated.
 *
 * That is not a hypothetical either. It removed three true items, from three
 * different outlets, on the first edition drafted against the full Bay Area
 * source list. An accuracy check that fires on correct work does not make the
 * publication safer, it makes the check something the operator learns to
 * override.
 *
 * Only the outermost punctuation is touched. Every word, number and internal
 * mark still has to appear in the article exactly, so nothing about the
 * fabricated-quote protection is weakened.
 */
function normalizeQuote(s: string): string {
  return normalize(s).replace(/^[\s.,;:!?"'-]+/, '').replace(/[\s.,;:!?"'-]+$/, '');
}

/**
 * Pull quoted spans out of drafted copy. Only spans long enough to be a real
 * assertion are checked; short quoted words are usually scare quotes or a
 * term of art, not a sourced quotation.
 */
export function extractQuotations(text: string): string[] {
  const out: string[] = [];
  const re = /["“]([^"“”]{25,400})["”]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const q = m[1].trim();
    if (countWords(q) >= 5) out.push(q);
  }
  return out;
}

/**
 * Find figures asserted in the draft that do not appear in the source body.
 *
 * Deliberately conservative about what counts as a checkable figure, because
 * false positives cost real items. We check:
 *   - vote counts and ratios (9-2, 7 to 4)
 *   - money ($34 million, $5,002)
 *   - percentages (28 percent, 64%)
 *   - standalone quantities of 2+ digits (14,000, 500, 4,200)
 *
 * We deliberately do NOT check bare single digits or four-digit years, which
 * are usually ordinary prose ("the second time", "since 2019") and would
 * generate noise without catching real fabrication.
 */
export function findUnsupportedNumbers(claimText: string, body: string): string[] {
  const nbody = normalizeNumbers(body);
  const unsupported: string[] = [];
  const seen = new Set<string>();

  const patterns: RegExp[] = [
    /\b\d{1,3}\s*(?:-|to)\s*\d{1,3}\b/g,            // vote counts / ratios
    /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand)?/gi, // money
    /\b\d[\d,]*(?:\.\d+)?\s*(?:percent|%)/gi,        // percentages
    /\b\d[\d,]{2,}(?:\.\d+)?\b/g,                    // quantities 3+ digits
    // Small numbers only when carrying a unit or a countable noun. A bare "3"
    // is ordinary prose; "42 units" or "aged 68" is a checkable assertion.
    // This closes the ages / small-counts gap without flooding on prose.
    /\b\d{1,2}\s+(?:units?|people|residents?|employees?|workers?|officers?|votes?|beds?|floors?|stories|blocks?|acres?|years? old|months?|weeks?|days?|arrests?|deaths?|injuries|cases?|seats?|members?|schools?|stores?|restaurants?)\b/gi,
    /\b(?:aged?|age)\s+\d{1,3}\b/gi,
    // Month-day dates. A fabricated hearing or vote date is a real failure mode.
    // Abbreviations are normalized on both sides so "Sept. 7" in the source
    // satisfies "September 7" in the draft.
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/gi,
  ];
  // Deliberately NOT checked: bare ordinals ("the third largest"). Matching
  // them produces constant false positives on ordinary prose for negligible
  // protection. The model auditor's source-fidelity check covers that class.

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(claimText)) !== null) {
      const raw = m[0].trim();
      const key = normalizeOneNumber(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // Skip plain four-digit years, which are ordinary editorial context.
      if (/^\d{4}$/.test(key) && Number(key) >= 1800 && Number(key) <= 2100) continue;
      if (!nbody.includes(key)) unsupported.push(raw);
    }
  }

  return unsupported;
}

// ============ ATTRIBUTION ============

/** Saying-verbs that signal reported speech in the source. */
const SAYING_VERBS = /\b(said|says|saying|stated|told|announced|wrote|testified|confirmed|acknowledged|according to)\b/i;

/**
 * Find attributions asserted in the draft that the source does not support.
 *
 * Two patterns are checked:
 *   "<subject> said/announced/confirmed ..."   e.g. "police said"
 *   "according to <subject>"                    e.g. "according to the mayor"
 *
 * An attribution is unsupported when the subject does not appear anywhere in
 * the article body, or when the article contains no reported speech at all.
 * Deliberately loose: we are catching invented sources, not auditing phrasing.
 */
export function findUnsupportedAttributions(claimText: string, body: string): string[] {
  const nbody = normalize(body);
  const bodyHasSpeech = SAYING_VERBS.test(body);
  const found = new Set<string>();

  const patterns: RegExp[] = [
    // "according to X" up to punctuation
    /\baccording to ([A-Za-z][A-Za-z .'’-]{2,40}?)(?=[,.;:]|\s+(?:the|a|an|which|who|that)\b|$)/gi,
    // "X said/announced/..." where X is a short noun phrase
    /\b((?:the\s+)?[A-Z][A-Za-z.'’-]*(?:\s+[A-Za-z.'’-]+){0,3}|police|officials|prosecutors|supervisors|residents|neighbors)\s+(?:said|announced|confirmed|stated|told|testified|acknowledged)\b/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(claimText)) !== null) {
      const subject = (m[1] || '').trim().replace(/^the\s+/i, '');
      if (!subject || subject.length < 3) continue;
      // Ignore SF Times referring to itself or to generic prior reporting.
      if (/^(sf times|we|it|this|that|there)$/i.test(subject)) continue;
      const key = subject.toLowerCase();
      if (found.has(key)) continue;

      // Match on the most distinctive token so titles and honorifics do not
      // cause false negatives ("Mayor Daniel Lurie" matches on "Lurie").
      const tokens = subject.split(/\s+/).filter((t) => t.length >= 4);
      const probe = tokens.length ? tokens[tokens.length - 1] : subject;
      const subjectInBody = nbody.includes(normalize(probe));

      if (!subjectInBody || !bodyHasSpeech) found.add(key);
    }
  }

  return [...found];
}

// ============ CERTAINTY ============

/**
 * Markers that a SOURCE treats a claim as unproven: allegation, report, or
 * preliminary finding. Deliberately narrow. This list answers one question:
 * "is this story legally or factually unsettled?"
 */
const SOURCE_HEDGE_MARKERS = [
  'alleged', 'allegedly', 'accused', 'accusation', 'suspect', 'suspected',
  'reportedly', 'preliminary', 'unconfirmed', 'claims', 'claimed',
  'appears to', 'is expected to', 'could', 'may have', 'according to police',
  'under investigation', 'pending', 'proposed', 'if approved',
];

/**
 * Markers that a DRAFT preserved uncertainty. Deliberately WIDER than the
 * source list, and the asymmetry is the point.
 *
 * The two lists answer different questions. The source list asks whether the
 * story is unsettled. This one asks whether the writer hedged at all, and
 * ordinary English hedges with bare modals: "may", "might", "would", "is
 * expected", "has not yet". Judging the draft with the narrow allegation
 * vocabulary marked a correctly hedged sentence as an escalation, because
 * "may be under pressure" contains no word from the list above. That fired on
 * a true item during the first real edition composed on this path.
 *
 * Widening only the draft side cannot let a fabrication through: a draft that
 * genuinely converts an allegation into settled fact contains none of these
 * words either.
 *
 * Attribution verbs are deliberately NOT included. Almost every draft contains
 * "said", so counting it would make this check fire on nothing at all.
 */
const DRAFT_HEDGE_MARKERS = [
  ...SOURCE_HEDGE_MARKERS,
  'may', 'might', 'would', 'expected', 'likely', 'possible', 'possibly',
  'apparently', 'seems', 'plans to', 'is set to', 'not yet',
  'no timeline', 'no start date', 'no announced',
];

function hedgeCount(s: string, markers: string[]): number {
  const n = normalize(s);
  let hits = 0;
  for (const m of markers) if (n.includes(m)) hits++;
  return hits;
}

/**
 * True when the source is substantially hedged and the draft is not hedged at
 * all. Requires TWO distinct hedge markers in the source before firing, so a
 * single incidental "proposed" in a paragraph of an otherwise settled story
 * does not remove a legitimate item.
 */
export function isCertaintyEscalated(claimText: string, body: string): boolean {
  const sourceHedges = hedgeCount(body, SOURCE_HEDGE_MARKERS);
  const draftHedges = hedgeCount(claimText, DRAFT_HEDGE_MARKERS);
  return sourceHedges >= 2 && draftHedges === 0;
}

// The trailing period is consumed AFTER the word boundary, not inside it.
// `\bsept?\.?\b` cannot match "sept." because the boundary test after the
// period has non-word characters on both sides.
const MONTH_ABBREV: Array<[RegExp, string]> = [
  [/\bjan\b\.?/g, 'january'], [/\bfeb\b\.?/g, 'february'], [/\bmar\b\.?/g, 'march'],
  [/\bapr\b\.?/g, 'april'], [/\bjun\b\.?/g, 'june'], [/\bjul\b\.?/g, 'july'],
  [/\baug\b\.?/g, 'august'], [/\bsept?\b\.?/g, 'september'], [/\boct\b\.?/g, 'october'],
  [/\bnov\b\.?/g, 'november'], [/\bdec\b\.?/g, 'december'],
];

/**
 * Collapse the ways the same percentage gets written.
 *
 * Newsrooms write "67%"; the house style for the Brief's prose is "67 percent".
 * Without this, an editor correctly transcribing a figure from the source gets
 * the item removed for fabricating it. That is not a hypothetical: it fired on
 * the first real edition composed on the subscription path, on a figure that
 * was verbatim in the source.
 *
 * This is a false-positive fix, not a loosening. The digits still have to be
 * present in the source AS A PERCENTAGE. "67 percent" in a draft is satisfied
 * only by "67%" or "67 percent" in the article, never by a bare "67".
 */
function normalizePercent(s: string): string {
  return s
    .replace(/(\d)\s*(?:per\s?cent(?:age)?|percent|pct\.?)/gi, '$1%')
    .replace(/(\d)\s+%/g, '$1%');
}

/**
 * Collapse numeric ranges and vote counts to one form: "9 to 2" and "9 - 2"
 * both become "9-2".
 *
 * Anchored on DIGITS ON BOTH SIDES, which matters more than it looks. An
 * earlier version collapsed any " to ", which silently rewrote the word
 * "stories" to "s-ries" and made "3 stories" in a draft unmatchable against
 * "3 stories" in the source. Scoping to digits removes that whole class.
 */
function normalizeRanges(s: string): string {
  return s.replace(/(\d)\s*(?:-|to)\s*(\d)/gi, '$1-$2');
}

/** Shared normalization, applied identically to the source body and to each
 *  extracted figure. Applying different rules to the two sides is how a
 *  correctly transcribed number gets reported as a fabrication. */
function normalizeNumericText(s: string): string {
  let out = s
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ');
  // Expand month abbreviations so "sept. 7" in the source matches
  // "september 7" asserted in the draft.
  for (const [re, full] of MONTH_ABBREV) out = out.replace(re, full);
  return normalizeRanges(normalizePercent(out));
}

function normalizeNumbers(s: string): string {
  return normalizeNumericText(s);
}

function normalizeOneNumber(s: string): string {
  return normalizeNumericText(s).replace(/^\$\s*/, '$').trim();
}

/**
 * LIMITATIONS (documented, not hidden)
 *
 * 1. The numbers check compares against the source body only. A figure the
 *    editor legitimately knows from prior SF Times reporting but that does not
 *    appear in today's source will be flagged and the item removed. That is the
 *    intended direction of the tradeoff, but it does mean the firewall is
 *    stricter than a human editor would be.
 * 2. Byline verification is intentionally weak. Many outlets omit the byline
 *    from body text, so requiring the name to appear in the body would remove
 *    legitimate items. We therefore verify only that the byline came through
 *    the feed and is not a misleading placeholder. We never synthesize one.
 * 3. Paraphrased fabrication (an invented claim stated without numbers or
 *    quotation marks) is not caught here. The craft auditor and the
 *    full-body-fetch requirement are the mitigations for that class. This
 *    module narrows the attack surface; it does not eliminate it.
 */
