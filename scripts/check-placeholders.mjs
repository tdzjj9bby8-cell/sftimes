#!/usr/bin/env node
/**
 * Neon-green placeholder guard.
 *
 * --pre  (runs before astro build): sanity-check that the source token is intact.
 * --post (runs after astro build):  scan dist/ for the neon-green color. If found,
 *                                   fail the build hard so we never accidentally
 *                                   ship without real photos.
 *
 * Override (use sparingly, only for staging deploys with placeholders intentional):
 *   ALLOW_PLACEHOLDERS=1 npm run build
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const PLACEHOLDER_HEX = '#39FF14';
const PLACEHOLDER_HEX_LOWER = PLACEHOLDER_HEX.toLowerCase();
const PLACEHOLDER_RGB = 'rgb(57, 255, 20)';
const PLACEHOLDER_RGB_NO_SPACE = 'rgb(57,255,20)';

const mode = process.argv[2] || '--post';

if (mode === '--pre') {
  const css = fs.readFileSync(path.join(projectRoot, 'src/styles/global.css'), 'utf8');
  if (!css.includes('--placeholder-green: ' + PLACEHOLDER_HEX)) {
    console.error('[guard] global.css does not declare --placeholder-green: ' + PLACEHOLDER_HEX);
    process.exit(1);
  }
  console.log('[guard] pre-build OK. Placeholder token is ' + PLACEHOLDER_HEX + '.');
  process.exit(0);
}

if (mode === '--post') {
  if (process.env.ALLOW_PLACEHOLDERS === '1') {
    console.warn('[guard] ALLOW_PLACEHOLDERS=1 set. Skipping post-build placeholder scan.');
    console.warn('[guard] DO NOT use this for the public launch build.');
    process.exit(0);
  }

  const dist = path.join(projectRoot, 'dist');
  if (!fs.existsSync(dist)) {
    console.warn('[guard] no dist/ to scan; assuming build did not produce output.');
    process.exit(0);
  }

  const offenders = [];
  const skipExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf']);

  // What this guard actually cares about: a visible green placeholder rendered
  // on the page. The Placeholder.astro component marks every visible block with
  // data-placeholder="true" — that's the canonical signal.
  //
  // The literal color value lives in :root as --placeholder-green and gets
  // inlined into compiled CSS bundles regardless of whether any block renders.
  // Flagging that would fail every build forever, so the hex/rgb checks are
  // scoped to .html files only (where a stray inline style would be a real
  // problem).
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (skipExt.has(ext)) continue;
        let txt;
        try { txt = fs.readFileSync(full, 'utf8'); } catch { continue; }
        const isHtml = ext === '.html' || ext === '.htm';
        if (!isHtml) continue; // Only rendered HTML is reader-facing.
        const lower = txt.toLowerCase();
        const hasMarker = txt.includes('data-placeholder="true"');
        const hasLiteral = (
          lower.includes(PLACEHOLDER_HEX_LOWER) ||
          lower.includes(PLACEHOLDER_RGB) ||
          lower.includes(PLACEHOLDER_RGB_NO_SPACE)
        );
        if (hasMarker || hasLiteral) {
          offenders.push(full.replace(projectRoot + path.sep, ''));
        }
      }
    }
  };
  walk(dist);

  if (offenders.length > 0) {
    console.error('\n[guard] BUILD HALTED. Neon-green placeholders or data-placeholder markers found in dist/.');
    console.error('[guard] This means real photos have not been swapped in yet.');
    console.error('[guard] Offending files (' + offenders.length + '):');
    for (const f of offenders.slice(0, 30)) console.error('  - ' + f);
    if (offenders.length > 30) console.error('  ... and ' + (offenders.length - 30) + ' more.');
    console.error('\n[guard] To intentionally ship a staging build with placeholders, set ALLOW_PLACEHOLDERS=1.');
    console.error('[guard] DO NOT use ALLOW_PLACEHOLDERS for the public launch build.\n');
    process.exit(2);
  }
  console.log('[guard] post-build OK. No placeholder color or markers found in dist/.');
  process.exit(0);
}

console.error('[guard] unknown mode: ' + mode + '. Use --pre or --post.');
process.exit(1);
