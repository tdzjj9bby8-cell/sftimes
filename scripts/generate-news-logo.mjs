/**
 * generate-news-logo.mjs
 *
 * One-shot generator for public/logo-news.png, the publisher.logo asset
 * referenced by the NewsArticle JSON-LD on every Saturday Profile page.
 *
 * Google News requires publisher.logo to be an ImageObject with width >= 600px.
 * The existing public/logo.svg is an SVG wrapper around a base64 raster (not a
 * clean vector wordmark), so we render a text-based wordmark via sharp + SVG.
 *
 * Run once, commit the PNG output, do not run again unless the wordmark
 * needs to change.
 *
 * Usage: node scripts/generate-news-logo.mjs
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const WIDTH = 600;
const HEIGHT = 60;
const OUT_PATH = resolve(process.cwd(), 'public', 'logo-news.png');

// Inline SVG: condensed bold black sans on white. System font stack falls back
// across macOS/Linux/Windows: Impact, Arial Black, Helvetica. librsvg (the SVG
// backend sharp uses) resolves the first installed family.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
  <text
    x="${WIDTH / 2}"
    y="${HEIGHT * 0.72}"
    font-family="Impact, 'Arial Black', Helvetica, sans-serif"
    font-size="44"
    font-weight="900"
    fill="#0a0a0a"
    text-anchor="middle"
    letter-spacing="3"
  >SF TIMES</text>
</svg>`;

const png = await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toBuffer();

await writeFile(OUT_PATH, png);
console.log(`Wrote ${OUT_PATH} (${png.length} bytes, ${WIDTH}x${HEIGHT})`);
