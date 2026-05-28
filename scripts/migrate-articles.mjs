#!/usr/bin/env node
// Migrate 57 articles from the legacy app.js DEMO data into Astro content collections.
// Idempotent: overwrites existing markdown files.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const legacyAppJs = path.resolve(projectRoot, '..', 'src', 'SFTIMES', 'js', 'app.js');
const storiesDir = path.resolve(projectRoot, 'src', 'content', 'stories');
const bestOfDir = path.resolve(projectRoot, 'src', 'content', 'best-of');

fs.mkdirSync(storiesDir, { recursive: true });
fs.mkdirSync(bestOfDir, { recursive: true });

console.log(`Reading legacy DEMO from: ${legacyAppJs}`);
const code = fs.readFileSync(legacyAppJs, 'utf8');

// Find DEMO object literal boundaries by brace-matching.
const startToken = 'const DEMO = ';
const startIdx = code.indexOf(startToken);
if (startIdx === -1) throw new Error('DEMO not found in app.js');
let i = startIdx + startToken.length;
if (code[i] !== '{') throw new Error('DEMO is not an object literal');
let depth = 0;
let end = i;
let inStr = null;
for (; i < code.length; i++) {
  const c = code[i];
  if (inStr) {
    if (c === '\\') { i++; continue; }
    if (c === inStr) inStr = null;
    continue;
  }
  if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const demoLiteral = code.slice(startIdx + startToken.length, end);
const DEMO = vm.runInNewContext('(' + demoLiteral + ')');

if (!DEMO.featured || !Array.isArray(DEMO.past_features)) {
  throw new Error('Unexpected DEMO shape');
}

const articles = [DEMO.featured, ...DEMO.past_features];
console.log(`Extracted ${articles.length} articles.`);

const escapeYaml = (s) => {
  if (s == null) return '""';
  const str = String(s);
  // Always quote for safety; escape backslashes and double quotes.
  return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
};

const guessKeeperType = (slug, title) => {
  const t = (title || '').toLowerCase();
  const s = (slug || '').toLowerCase();
  if (/(tofu|pho|broth|bakery|donut|tamale|coffee|fish|pizza)/.test(s + ' ' + t)) return 'recipe';
  if (/(tai chi|driveway|night|morning|patrol|circle|tuesday|friday)/.test(t)) return 'routine';
  if (/(shop|kitchen|garage|salon|barber|bookstore|memorial)/.test(s)) return 'room';
  if (/(photograph|ledger|notebook|archive|memorial|record|book)/.test(t)) return 'record';
  if (/(skateboard|refuses|stays|unchanged|never|kept)/.test(t)) return 'refusal';
  return 'routine';
};

const inferNeighborhood = (slug) => {
  const map = {
    bayview: 'Bayview', bernal: 'Bernal Heights', castro: 'Castro',
    chinatown: 'Chinatown', excelsior: 'Excelsior', glen: 'Glen Park',
    geary: 'Inner Richmond', 'hayes-valley': 'Hayes Valley', hayward: 'Hayward',
    hunters: 'Hunters Point', marina: 'Marina', mission: 'Mission',
    'north-beach': 'North Beach', oakland: 'Oakland', ocean: 'Outer Sunset',
    pacifica: 'Pacifica', 'pacific-heights': 'Pacific Heights',
    richmond: 'Richmond', sunnyside: 'Sunnyside', sunset: 'Sunset',
    tenderloin: 'Tenderloin', 'twin-peaks': 'Twin Peaks',
    visitacion: 'Visitacion Valley', berkeley: 'Berkeley',
    'lake-merritt': 'Oakland', 'daly-city': 'Daly City',
    'coit-tower': 'Telegraph Hill', muni: 'Citywide',
    bart: 'Citywide', 'forty-nine-bus': 'Citywide',
    'general-hospital': 'Mission',
  };
  for (const key of Object.keys(map)) {
    if (slug.startsWith(key)) return map[key];
  }
  return 'San Francisco';
};

const NON_ARTICLE_IDS = new Set(['demo-1']); // featured kept; just a sentinel

let migrated = 0;
for (const a of articles) {
  if (!a.slug || !a.title) {
    console.warn('Skipping article missing slug/title:', a.id);
    continue;
  }
  const isFeatured = a === DEMO.featured;
  const publishedDate = new Date(a.published_at);
  const filename = `${publishedDate.toISOString().slice(0,10)}-${a.slug}.md`;
  const filepath = path.join(storiesDir, filename);

  const heroFilenameHint = `heroes/${publishedDate.toISOString().slice(0,10)}-${a.slug}.jpg`;

  const frontmatter = [
    '---',
    `title: ${escapeYaml(a.title)}`,
    a.title_em ? `title_em: ${escapeYaml(a.title_em)}` : null,
    `deck: ${escapeYaml(a.deck)}`,
    `author: ${escapeYaml(a.author || 'Eric').replace(/"/g,'')}`,
    `photographer: ${escapeYaml(a.photographer || 'Staff')}`,
    `published: ${a.published_at}`,
    `issue: ${a.issue_number}`,
    `slug: ${escapeYaml(a.slug)}`,
    `immersive: true`,
    `neighborhood: ${escapeYaml(inferNeighborhood(a.slug))}`,
    `keeper_type: ${guessKeeperType(a.slug, a.title)}`,
    `photo_class: ${a.photo_class || 'warm'}`,
    `hero_alt: ${escapeYaml(a.caption || a.title)}`,
    `hero_filename_hint: ${escapeYaml(heroFilenameHint)}`,
    a.caption ? `caption: ${escapeYaml(a.caption)}` : null,
    a.pull_quote ? `pull_quote: ${escapeYaml(a.pull_quote)}` : null,
    a.pull_quote_attr ? `pull_quote_attr: ${escapeYaml(a.pull_quote_attr)}` : null,
    `read_minutes: ${a.read_minutes || 10}`,
    `is_featured: ${isFeatured}`,
    '---',
  ].filter(line => line !== null).join('\n');

  const body = Array.isArray(a.body) ? a.body.join('\n\n') : (a.body || '');
  fs.writeFileSync(filepath, frontmatter + '\n\n' + body + '\n', 'utf8');
  migrated++;
}

console.log(`Migrated ${migrated} articles to ${storiesDir}`);

// --- Best Of categories ---
if (Array.isArray(DEMO.best_of_categories)) {
  for (const c of DEMO.best_of_categories) {
    const filepath = path.join(bestOfDir, `${c.slug}.md`);
    const frontmatter = [
      '---',
      `title: ${escapeYaml(c.title || c.name)}`,
      `slug: ${escapeYaml(c.slug)}`,
      `intro: ${escapeYaml(c.intro || c.description || '')}`,
      `editor: Eric`,
      `last_refreshed: ${(c.last_refreshed || c.updated_at || new Date().toISOString().slice(0,10))}`,
      `hero_alt: ${escapeYaml((c.title || c.name) + ' category card')}`,
      `hero_filename_hint: ${escapeYaml('best-of/' + c.slug + '.jpg')}`,
      '---',
      '',
      c.intro || '',
    ].join('\n');
    fs.writeFileSync(filepath, frontmatter, 'utf8');
  }
  console.log(`Migrated ${DEMO.best_of_categories.length} best-of categories.`);
} else {
  console.log('No best_of_categories in DEMO; writing 4 placeholders.');
  const cats = [
    { slug: 'korean-bbq-sf', title: 'Korean BBQ in San Francisco', intro: 'Where the editors actually eat. Updated quarterly. No affiliate links.' },
    { slug: 'date-night', title: 'Date Night', intro: 'Restaurants and rooms made for two. Editor-named, conflict-of-interest disclosed.' },
    { slug: 'family-owned', title: 'Family-Owned, Still', intro: 'The places where the second or third generation is still in the kitchen.' },
    { slug: 'peninsula-coffee', title: 'Peninsula Coffee', intro: 'San Mateo to San Jose, the shops worth the drive.' },
  ];
  for (const c of cats) {
    const filepath = path.join(bestOfDir, `${c.slug}.md`);
    const fm = [
      '---',
      `title: ${escapeYaml(c.title)}`,
      `slug: ${escapeYaml(c.slug)}`,
      `intro: ${escapeYaml(c.intro)}`,
      `editor: Eric`,
      `last_refreshed: ${new Date().toISOString().slice(0,10)}`,
      `hero_alt: ${escapeYaml(c.title + ' category card')}`,
      `hero_filename_hint: ${escapeYaml('best-of/' + c.slug + '.jpg')}`,
      '---',
      '',
      c.intro,
      '',
    ].join('\n');
    fs.writeFileSync(filepath, fm, 'utf8');
  }
  console.log('Wrote 4 best-of placeholder categories.');
}
