#!/usr/bin/env node
/**
 * Run Lighthouse against the deployed site and save a JSON baseline.
 * Saves to docs/perf/ with a timestamped filename.
 *
 * Usage:
 *   npm i -g lighthouse  (or npx lighthouse)
 *   node scripts/lighthouse-baseline.mjs https://sftimes.com
 *
 * Runs the audit twice — desktop and mobile — to capture both profiles.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'https://sftimes.com';
const outDir = path.resolve(__dirname, '..', '..', 'docs', 'perf');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);

function runLighthouse(profile) {
  const out = path.join(outDir, `${stamp}-${profile}.json`);
  console.log(`Running Lighthouse (${profile}) against ${url}…`);
  const args = [
    url,
    `--preset=${profile}`,
    `--output=json`,
    `--output-path=${out}`,
    '--chrome-flags=--headless --no-sandbox',
    '--quiet',
  ];
  const result = spawnSync('lighthouse', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`  ${profile} failed`);
    return null;
  }
  try {
    const report = JSON.parse(fs.readFileSync(out, 'utf8'));
    const cats = report.categories || {};
    return {
      profile,
      url,
      at: report.fetchTime,
      performance: Math.round((cats.performance?.score || 0) * 100),
      accessibility: Math.round((cats.accessibility?.score || 0) * 100),
      bestPractices: Math.round((cats['best-practices']?.score || 0) * 100),
      seo: Math.round((cats.seo?.score || 0) * 100),
      lcp: report.audits?.['largest-contentful-paint']?.numericValue,
      cls: report.audits?.['cumulative-layout-shift']?.numericValue,
      tbt: report.audits?.['total-blocking-time']?.numericValue,
      file: path.basename(out),
    };
  } catch (e) {
    console.error(`  ${profile} parse failed:`, e.message);
    return null;
  }
}

const summary = ['desktop'].map(runLighthouse).concat(['mobile'].map(runLighthouse)).filter(Boolean);
console.table(summary);
const summaryPath = path.join(outDir, `${stamp}-summary.json`);
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`\nSaved to ${path.relative(process.cwd(), summaryPath)}`);
