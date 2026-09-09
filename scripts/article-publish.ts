/**
 * scripts/article-publish.ts
 *
 * STAGE 3 of the long-form path. Makes ZERO model calls.
 *
 * Rejoins a drafted feature to the sources that were actually retrieved, runs
 * the multi-source firewall, composes the `stories` frontmatter, validates it,
 * and writes the file.
 *
 * THE JOIN IS THE POINT
 * The draft is written by an agent. The sources were fetched by code. This
 * stage takes the EVIDENCE from the code side and the PROSE from the agent
 * side, and never lets the agent supply its own evidence. A draft citing a
 * source id that is not in the research packet is discarded, loudly, which is
 * the check that catches a source invented wholesale.
 *
 *   npm run article:publish -- --slug=<slug> --review    validate, write nothing
 *   npm run article:publish -- --slug=<slug>             write the article file
 *
 * Articles NEVER auto-publish to the live site from here. This writes the
 * markdown into the content collection; a human still builds, reads and pushes.
 *
 * EXIT CODES
 *   0  passed (and written, unless --review)
 *   1  refused. The reason is printed.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { validateArticle, MIN_ARTICLE_SOURCES, type ArticleDraft, type VerifiedSource } from './lib/article-firewall.js';
import { countWords } from './lib/fetch-article.js';
import { sfDateString } from './lib/sf-date.js';
import type { ResearchPacket } from './article-prep.js';

const QUEUE_DIR = path.join(process.cwd(), 'scripts', 'queue', 'articles');
const STORIES_DIR = path.join(process.cwd(), 'src', 'content', 'stories');
const REVIEW_DIR = path.join(process.cwd(), 'article-review');

const VALID_KEEPER = ['recipe', 'routine', 'room', 'record', 'refusal'];
const VALID_PHOTO_CLASS = ['warm', 'cool', 'green', 'dusk'];

interface DraftFile extends ArticleDraft {
  slug: string;
  title_em?: string;
  seo_title?: string;
  neighborhood?: string;
  keeper_type?: string;
  photo_class?: string;
  hero_alt?: string;
  lede_line?: string;
  caption?: string;
}

function arg(argv: string[], name: string): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/** Next issue number: one past the highest already published. */
async function nextIssue(): Promise<number> {
  if (!existsSync(STORIES_DIR)) return 1;
  let max = 0;
  for (const f of await readdir(STORIES_DIR)) {
    if (!f.endsWith('.md')) continue;
    const m = (await readFile(path.join(STORIES_DIR, f), 'utf-8')).match(/^issue:\s*(\d+)\s*$/m);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** YAML string that cannot break the frontmatter. Mirrors brief-publish. */
function yamlString(s: string): string {
  return `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s*\n\s*/g, ' ').trim()}"`;
}

export async function articlePublish(argv: string[] = []): Promise<number> {
  const slug = arg(argv, 'slug');
  const review = argv.includes('--review');
  const draftPath = path.resolve(process.cwd(), arg(argv, 'draft') ?? 'article-draft.json');

  if (!slug) {
    console.error('[article-publish] --slug= is required.');
    return 1;
  }

  // ---- LOAD THE EVIDENCE ----
  const packetPath = path.join(QUEUE_DIR, `${slug}.json`);
  if (!existsSync(packetPath)) {
    console.error(`[article-publish] No research packet at ${packetPath}. Run article:prep first.`);
    console.error('[article-publish] Publishing without it would mean shipping prose no fetched source backs.');
    return 1;
  }
  const packet = JSON.parse(await readFile(packetPath, 'utf-8')) as ResearchPacket;
  const sources: VerifiedSource[] = packet.sources ?? [];

  // ---- LOAD THE PROSE ----
  if (!existsSync(draftPath)) {
    console.error(`[article-publish] No draft at ${draftPath}.`);
    return 1;
  }
  let draft: DraftFile;
  try {
    draft = JSON.parse(await readFile(draftPath, 'utf-8')) as DraftFile;
  } catch (e) {
    console.error(`[article-publish] Draft is not valid JSON: ${String(e).slice(0, 200)}`);
    return 1;
  }

  // A stale draft from a different subject is the likeliest way to publish the
  // wrong thing, and it would look entirely normal.
  if (draft.slug && draft.slug !== slug) {
    console.error(`[article-publish] Draft is for "${draft.slug}" but this run is for "${slug}". Refusing.`);
    return 1;
  }

  // ---- THE FIREWALL ----
  const verdict = validateArticle(draft, sources);

  console.log('');
  console.log('--------------- ARTICLE CHECK --------------');
  console.log(`Subject       : ${packet.subject}`);
  console.log(`Words         : ${verdict.wordCount}`);
  console.log(`Sources used  : ${verdict.sourcesUsed} of ${sources.length} (floor ${MIN_ARTICLE_SOURCES})`);
  console.log(`Paragraphs    : ${draft.paragraphs?.length ?? 0}`);
  console.log(`Violations    : ${verdict.violations.length}`);
  console.log('--------------------------------------------');

  for (const r of verdict.removedParagraphs) {
    console.warn(`[article-publish] UNSOURCED ¶${r.index + 1}: ${r.reason}`);
    console.warn(`[article-publish]   "${r.text}..."`);
  }
  for (const v of verdict.violations) {
    console.error(`[article-publish] [${v.check}] ${v.detail}`);
  }

  if (!verdict.pass) {
    console.error('');
    console.error('[article-publish] REFUSED. Nothing written.');
    console.error('[article-publish] Fix the draft against the sources. Do not weaken the check.');
    return 1;
  }

  // ---- COMPOSE ----
  const published = sfDateString();
  const issue = await nextIssue();
  const bodyText = draft.paragraphs.map((p) => p.text).join('\n\n');
  const readMinutes = Math.max(1, Math.round(countWords(bodyText) / 225));

  const keeper = VALID_KEEPER.includes(String(draft.keeper_type)) ? draft.keeper_type : undefined;
  const photoClass = VALID_PHOTO_CLASS.includes(String(draft.photo_class)) ? draft.photo_class : 'warm';

  const fm: string[] = ['---'];
  fm.push(`title: ${yamlString(draft.title)}`);
  if (draft.title_em) fm.push(`title_em: ${yamlString(draft.title_em)}`);
  if (draft.seo_title) fm.push(`seo_title: ${yamlString(draft.seo_title.slice(0, 60))}`);
  fm.push(`deck: ${yamlString(draft.deck)}`);
  fm.push('author: Eric');
  fm.push('photographer: "Staff"');
  fm.push(`published: ${published}`);
  fm.push(`issue: ${issue}`);
  fm.push(`url_slug: ${yamlString(slug)}`);
  fm.push('immersive: true');
  if (draft.neighborhood) fm.push(`neighborhood: ${yamlString(draft.neighborhood)}`);
  if (keeper) fm.push(`keeper_type: ${keeper}`);
  fm.push(`photo_class: ${photoClass}`);
  fm.push(`hero_alt: ${yamlString(draft.hero_alt ?? draft.title)}`);
  fm.push(`hero_filename_hint: ${yamlString(`heroes/${published}-${slug}.jpg`)}`);
  if (draft.lede_line) fm.push(`lede_line: ${yamlString(draft.lede_line)}`);
  if (draft.caption) fm.push(`caption: ${yamlString(draft.caption)}`);
  if (draft.pull_quote) fm.push(`pull_quote: ${yamlString(draft.pull_quote)}`);
  if (draft.pull_quote_attr) fm.push(`pull_quote_attr: ${yamlString(draft.pull_quote_attr)}`);
  fm.push(`read_minutes: ${readMinutes}`);
  fm.push('is_featured: false');
  // NEVER true for a real article. is_sample renders a banner telling readers
  // the piece is a constructed format demo, which would be a lie about
  // genuinely sourced reporting.
  fm.push('is_sample: false');
  fm.push('---');
  fm.push('');
  fm.push(bodyText);
  fm.push('');

  // ---- SOURCING NOTE ----
  // The disclosure pattern established by the Kollmeyer profile. Readers are
  // told this was assembled from public sources rather than original interviews,
  // and every source is linked. Not optional: the credibility of the whole
  // publication rests on not blurring that line.
  fm.push('---');
  fm.push('');
  fm.push('**How this was reported.** This article was assembled from published public sources, listed below, rather than from original interviews by SF Times. Every quotation appears in one of them. Drafted with AI assistance and checked automatically against the full text of each source before publication.');
  fm.push('');
  for (const s of sources) fm.push(`- [${s.outlet}](${s.url})`);
  fm.push('');

  const markdown = fm.join('\n');

  // ---- VALIDATE BEFORE ANYTHING IS WRITTEN ----
  const structural = validateArticleFrontmatter(markdown, slug, published);
  if (structural.length) {
    for (const e of structural) console.error(`[article-publish] MALFORMED: ${e}`);
    console.error('[article-publish] Refusing to write. This would break the Astro build.');
    return 1;
  }

  if (review) {
    if (!existsSync(REVIEW_DIR)) await mkdir(REVIEW_DIR, { recursive: true });
    const out = path.join(REVIEW_DIR, `${published}-${slug}.md`);
    await writeFile(out, markdown, 'utf-8');
    console.log('');
    console.log(`[article-publish] PASSED. Review copy at ${out}`);
    console.log('[article-publish] NOTHING PUBLISHED. Read it, then run without --review.');
    return 0;
  }

  if (!existsSync(STORIES_DIR)) await mkdir(STORIES_DIR, { recursive: true });
  const out = path.join(STORIES_DIR, `${published}-${slug}.md`);
  if (existsSync(out)) {
    console.error(`[article-publish] ${out} already exists. Refusing to overwrite a published article.`);
    return 1;
  }
  await writeFile(out, markdown, 'utf-8');
  console.log('');
  console.log(`[article-publish] Wrote ${out} (issue ${issue}).`);
  console.log('[article-publish] NOT live until built, committed and pushed.');
  console.log(`[article-publish] Verify the build with: npm run build`);
  return 0;
}

/** Structural check against the `stories` Zod schema, before the Astro build
 *  can fail on it. Same reasoning as validateComposedEdition for the Brief:
 *  a green script followed by a red build is how the site goes stale. */
export function validateArticleFrontmatter(md: string, slug: string, date: string): string[] {
  const errs: string[] = [];
  if (!md.startsWith('---\n')) return ['No opening frontmatter fence.'];
  const end = md.indexOf('\n---', 4);
  if (end < 0) return ['Frontmatter fence not closed.'];
  const fm = md.slice(4, end);

  for (const f of ['title', 'deck', 'hero_alt', 'hero_filename_hint', 'url_slug']) {
    const m = fm.match(new RegExp(`^${f}:\\s*(.+)$`, 'm'));
    if (!m || !m[1].replace(/["']/g, '').trim()) errs.push(`${f} is missing or empty.`);
  }
  if (!new RegExp(`^published:\\s*${date}\\s*$`, 'm').test(fm)) errs.push(`published is not ${date}.`);
  if (!/^issue:\s*[1-9]\d*\s*$/m.test(fm)) errs.push('issue is missing or not a positive integer.');
  if (!/^read_minutes:\s*[1-9]\d*\s*$/m.test(fm)) errs.push('read_minutes is missing or not a positive integer.');
  if (!/^author:\s*Eric\s*$/m.test(fm)) errs.push('author must be Eric.');
  if (!/^is_sample:\s*false\s*$/m.test(fm)) errs.push('is_sample must be false on a real article.');

  const seo = fm.match(/^seo_title:\s*"(.*)"\s*$/m);
  if (seo && seo[1].length > 60) errs.push(`seo_title is ${seo[1].length} chars; the schema caps it at 60.`);

  const kt = fm.match(/^keeper_type:\s*(\S+)\s*$/m);
  if (kt && !VALID_KEEPER.includes(kt[1])) errs.push(`keeper_type "${kt[1]}" is not in the schema enum.`);
  const pc = fm.match(/^photo_class:\s*(\S+)\s*$/m);
  if (pc && !VALID_PHOTO_CLASS.includes(pc[1])) errs.push(`photo_class "${pc[1]}" is not in the schema enum.`);

  if (!fm.includes(slug)) errs.push('url_slug does not match the requested slug.');
  if (countWords(md.slice(end)) < 300) errs.push('Article body is implausibly short.');
  return errs;
}

const isDirect = process.argv[1] && process.argv[1].includes('article-publish');
if (isDirect) {
  articlePublish(process.argv.slice(2))
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error('[article-publish] FATAL', e);
      process.exit(1);
    });
}
