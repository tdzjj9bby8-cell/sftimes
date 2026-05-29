#!/usr/bin/env node
/**
 * Subset variable fonts to Latin character set.
 * Drops ~30% of bytes by removing unused Cyrillic, Greek, Vietnamese, etc.
 *
 * Requires pyftsubset (pip install fonttools brotli).
 *
 * Usage: node scripts/subset-fonts.mjs
 *
 * Output replaces the source woff2 files in /public/fonts/ in place.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(__dirname, '..', 'public', 'fonts');

// Basic Latin + Latin-1 Supplement + Latin Extended-A + common punctuation
const UNICODES = [
  'U+0000-007F',  // basic latin
  'U+00A0-00FF',  // latin-1 supplement
  'U+0100-017F',  // latin extended-A
  'U+2000-206F',  // general punctuation (em dash, quotes, etc.)
  'U+2070-209F',  // superscripts and subscripts
  'U+20A0-20CF',  // currency symbols
  'U+2116',       // numero sign (we use №)
  'U+2192',       // rightward arrow (→)
  'U+2026',       // ellipsis (…)
].join(',');

const fonts = fs.readdirSync(fontsDir).filter((f) => f.endsWith('.woff2'));
let totalBefore = 0;
let totalAfter = 0;

for (const f of fonts) {
  const inPath = path.join(fontsDir, f);
  const tmpPath = path.join(fontsDir, f.replace('.woff2', '.subset.woff2'));
  const before = fs.statSync(inPath).size;
  totalBefore += before;
  const result = spawnSync(
    'pyftsubset',
    [
      inPath,
      `--output-file=${tmpPath}`,
      '--flavor=woff2',
      `--unicodes=${UNICODES}`,
      '--layout-features=*',
      '--name-IDs=*',
      '--notdef-outline',
      '--recommended-glyphs',
      '--ignore-missing-glyphs',
      '--ignore-missing-unicodes',
    ],
    { stdio: 'pipe', encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(`  ${f} ✗`, result.stderr || result.error || 'pyftsubset failed');
    continue;
  }
  const after = fs.statSync(tmpPath).size;
  totalAfter += after;
  fs.renameSync(tmpPath, inPath);
  const dropPct = ((1 - after / before) * 100).toFixed(0);
  console.log(`  ${f}  ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB  (-${dropPct}%)`);
}
const totalDrop = ((1 - totalAfter / totalBefore) * 100).toFixed(0);
console.log(`\n[subset] total ${(totalBefore / 1024).toFixed(0)}KB → ${(totalAfter / 1024).toFixed(0)}KB (-${totalDrop}%)`);
