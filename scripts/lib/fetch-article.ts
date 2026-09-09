/**
 * scripts/lib/fetch-article.ts
 *
 * Full source-article retrieval. This is the single most important safeguard
 * in the automated pipeline.
 *
 * WHY THIS EXISTS
 * Before this module, brief-ai.ts drafted from `candidate.first_paragraph`,
 * which is at most a 600-character RSS snippet, and the drafting prompt labeled
 * that snippet "Full available text". Drafting a 100-150 word editor's note
 * about civic consequences from a 600-character teaser is exactly the failure
 * mode behind the 2026-07-15 fabrication incident: the model had no real
 * material, so it filled the gap with plausible invention (fake vote counts, an
 * invented court case, wrong bylines).
 *
 * BRIEF-COWORK-PLAYBOOK.md Stage 4 already requires full article bodies before
 * drafting, but that requirement lived only in the human/agent-executed
 * playbook, never in this code. Scheduling the old code unchanged would have
 * automated the fabrication mode and run it every weekday. This module closes
 * that gap in code, where the scheduler cannot skip it.
 *
 * CONTRACT
 * - Returns the real fetched body text, or an explicit failure with a reason.
 * - NEVER returns synthesized, inferred, or padded text.
 * - A body under MIN_BODY_WORDS is a failure, not a warning. The caller must
 *   drop the candidate. A missed item is always preferable to a fabricated one.
 *
 * No new dependencies. The extractor is a deliberately conservative heuristic
 * over paragraph tags rather than a full readability port; see LIMITATIONS at
 * the bottom of this file.
 */

/**
 * Minimum words of substantive body text required before an item may be
 * drafted. Matches the floor already documented in BRIEF-COWORK-PLAYBOOK.md
 * Stage 4. Below this we do not have enough material to add real editorial
 * value, and attempting it invites invention.
 */
export const MIN_BODY_WORDS = 500;

/** Per-attempt network timeout. */
const FETCH_TIMEOUT_MS = 20_000;

/** Bounded retries. Transient failures only. Never retries a 404 or a paywall. */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

const USER_AGENT =
  'SF Times Brief Ingest (https://sftimes.com; editorial use; contact eric@sftimes.com)';

export interface ArticleFetchResult {
  ok: boolean;
  /** The extracted body text. Empty string when ok is false. */
  text: string;
  wordCount: number;
  /** URL actually fetched after redirects. */
  finalUrl?: string;
  httpStatus?: number;
  /** Machine-readable failure cause. Undefined when ok. */
  reason?:
    | 'network_error'
    | 'http_error'
    | 'empty_body'
    | 'below_word_floor'
    | 'likely_paywall'
    | 'invalid_url';
  /** Human-readable detail for logs and the run status record. */
  detail?: string;
  attempts: number;
}

/**
 * Retrieve and extract the full body text of a source article.
 *
 * Callers must treat `ok === false` as "this candidate cannot be drafted."
 * Do not fall back to the RSS snippet. Do not draft from the headline.
 */
export async function fetchArticleBody(url: string): Promise<ArticleFetchResult> {
  if (!isHttpUrl(url)) {
    return {
      ok: false,
      text: '',
      wordCount: 0,
      reason: 'invalid_url',
      detail: `Not an http(s) URL: ${String(url).slice(0, 120)}`,
      attempts: 0,
    };
  }

  let lastDetail = '';
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(url);
    } catch (err) {
      lastDetail = `attempt ${attempt}: ${errText(err)}`;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      return {
        ok: false,
        text: '',
        wordCount: 0,
        reason: 'network_error',
        detail: lastDetail,
        attempts: attempt,
      };
    }

    lastStatus = res.status;

    // Retry only genuinely transient statuses. A 404 or 403 will not improve.
    if (!res.ok) {
      const transient = res.status === 429 || res.status >= 500;
      lastDetail = `attempt ${attempt}: HTTP ${res.status}`;
      if (transient && attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt * 2);
        continue;
      }
      return {
        ok: false,
        text: '',
        wordCount: 0,
        httpStatus: res.status,
        reason: 'http_error',
        detail: lastDetail,
        attempts: attempt,
      };
    }

    const html = await res.text();
    const text = extractArticleText(html);
    const wordCount = countWords(text);

    if (wordCount === 0) {
      return {
        ok: false,
        text: '',
        wordCount: 0,
        finalUrl: res.url || url,
        httpStatus: res.status,
        reason: 'empty_body',
        detail: 'No paragraph text extracted from the document.',
        attempts: attempt,
      };
    }

    if (wordCount < MIN_BODY_WORDS) {
      // Distinguish a paywall stub from a genuinely short post, for the log.
      const paywalled = looksPaywalled(html, wordCount);
      return {
        ok: false,
        text: '',
        wordCount,
        finalUrl: res.url || url,
        httpStatus: res.status,
        reason: paywalled ? 'likely_paywall' : 'below_word_floor',
        detail: `Extracted ${wordCount} words, floor is ${MIN_BODY_WORDS}.${
          paywalled ? ' Paywall or subscription gate detected.' : ''
        }`,
        attempts: attempt,
      };
    }

    return {
      ok: true,
      text,
      wordCount,
      finalUrl: res.url || url,
      httpStatus: res.status,
      attempts: attempt,
    };
  }

  return {
    ok: false,
    text: '',
    wordCount: 0,
    httpStatus: lastStatus,
    reason: 'network_error',
    detail: lastDetail || 'Exhausted retries.',
    attempts: MAX_ATTEMPTS,
  };
}

// ============ EXTRACTION ============

/**
 * Pull readable body text out of an article HTML document.
 *
 * Strategy, in order:
 *   1. Remove non-content elements outright (script, style, nav, header,
 *      footer, aside, form, figure captions, etc). These are the source of
 *      most junk words and the reason a naive strip inflates word counts.
 *   2. Narrow to the most likely article container when one exists.
 *   3. Collect <p> text only. News articles are paragraph-structured, and
 *      restricting to <p> discards menus, link lists, and boilerplate that
 *      would otherwise pad the word count past the floor without being body
 *      text. Padding the count is the dangerous failure here, so the extractor
 *      errs toward under-counting.
 */
export function extractArticleText(html: string): string {
  let doc = html;

  // 1. Strip elements that never contain body prose.
  doc = removeBlocks(doc, [
    'script',
    'style',
    'noscript',
    'svg',
    'nav',
    'header',
    'footer',
    'aside',
    'form',
    'template',
    'iframe',
    'figcaption',
  ]);

  // 2. Prefer an explicit article container when present.
  const container = firstMatch(doc, /<article\b[^>]*>([\s\S]*?)<\/article>/i)
    ?? firstMatch(doc, /<main\b[^>]*>([\s\S]*?)<\/main>/i)
    ?? doc;

  // 3. Paragraph text only.
  const paragraphs: string[] = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(container)) !== null) {
    const t = decodeEntities(stripTags(m[1])).trim();
    // Drop one-liners: bylines, timestamps, "Share this", cookie notices.
    if (countWords(t) >= 8) paragraphs.push(t);
  }

  return paragraphs.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Heuristic paywall detection, used only to label the failure reason. */
function looksPaywalled(html: string, wordCount: number): boolean {
  if (wordCount > 250) return false;
  const markers = [
    'subscribe to continue',
    'subscribers only',
    'this article is for subscribers',
    'create an account to continue',
    'sign in to read',
    'paywall',
    'become a member to read',
    'to continue reading',
  ];
  const hay = html.toLowerCase();
  return markers.some((k) => hay.includes(k));
}

// ============ HELPERS ============

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function removeBlocks(html: string, tags: string[]): string {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
    // Self-closing / unclosed variants.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/>`, 'gi'), ' ');
  }
  return out;
}

function firstMatch(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'", mdash: '-', ndash: '-',
    hellip: '...', eacute: 'e', egrave: 'e', uuml: 'u', ouml: 'o', auml: 'a', ntilde: 'n',
  };
  return s
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (full, name) => named[String(name).toLowerCase()] ?? full);
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

export function countWords(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/**
 * LIMITATIONS (deliberate, documented rather than hidden)
 *
 * 1. This is a heuristic extractor, not a full readability implementation. It
 *    reads <p> tags inside <article>/<main>. Sites that render body copy
 *    entirely client-side, or that use non-paragraph markup for prose, will
 *    under-extract and therefore fail the word floor. That failure is SAFE: the
 *    item is dropped, not drafted from thin material.
 * 2. It cannot read paywalled content, and must not. Paywalled sources fail
 *    with `likely_paywall` and are dropped.
 * 3. Because it errs toward under-counting, some legitimate articles will be
 *    rejected. That is the correct direction for the tradeoff. Cadence loses to
 *    editorial integrity every time.
 */
