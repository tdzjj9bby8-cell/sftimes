#!/usr/bin/env node
/**
 * Generate responsive hero images.
 *
 * For each JPG in public/heroes/, public/best-of/, public/team/, produce:
 *   - {name}-480.webp, -960.webp, -1440.webp, -2400.webp
 *   - {name}-480.jpg,  -960.jpg,  -1440.jpg,  -2400.jpg
 *
 * Output goes to /public/heroes/responsive/, etc. Original JPGs are left in
 * place as the largest-fallback source.
 *
 * Why: Placeholder.astro emits a <picture> with srcset + sizes so phones
 * never download a 2400px hero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const widths = [480, 960, 1440, 2400];
const dirs = ['heroes', 'best-of', 'team'];

async function generateVariants(srcPath, outDir, base) {
  const meta = await sharp(srcPath).metadata();
  const tasks = [];
  for (const w of widths) {
    if (meta.width && meta.width < w) continue; // don't upscale
    const targetW = Math.min(w, meta.width || w);
    const webpOut = path.join(outDir, `${base}-${w}.webp`);
    const jpgOut = path.join(outDir, `${base}-${w}.jpg`);
    // Skip if both variants already exist (idempotent across rebuilds)
    if (fs.existsSync(webpOut) && fs.existsSync(jpgOut)) continue;
    tasks.push(
      sharp(srcPath)
        .resize({ width: targetW, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(webpOut)
    );
    tasks.push(
      sharp(srcPath)
        .resize({ width: targetW, withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(jpgOut)
    );
  }
  return Promise.all(tasks);
}

async function main() {
  let count = 0;
  let skipped = 0;
  for (const sub of dirs) {
    const inDir = path.join(root, 'public', sub);
    if (!fs.existsSync(inDir)) continue;
    const outDir = path.join(inDir, 'responsive');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const files = fs.readdirSync(inDir).filter((f) => /\.jpe?g$/i.test(f));
    for (const f of files) {
      const base = f.replace(/\.[^.]+$/, '');
      const src = path.join(inDir, f);
      try {
        const result = await generateVariants(src, outDir, base);
        if (result.length === 0) {
          skipped++;
        } else {
          count++;
          console.log(`  ${sub}/${f} (${result.length / 2} sizes)`);
        }
      } catch (e) {
        console.error(`  ${sub}/${f} ✗`, e.message);
      }
    }
  }
  console.log(`\n[responsive] generated ${count} new, skipped ${skipped} (already up to date).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
