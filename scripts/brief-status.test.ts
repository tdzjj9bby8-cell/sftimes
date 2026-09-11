/**
 * scripts/brief-status.test.ts
 *
 * publication-status.json is the durable record of what a run did. These tests
 * guard one property: it must never claim more than was verified.
 *
 * On 2026-09-11 it claimed an edition was published, with a live_url, at a
 * point in the pipeline before anything had been committed or pushed. The
 * edition sat unpushed and the URL returned 404. A handoff document written
 * hours later read the status file and reported the edition as live. The false
 * green propagated into documentation, which is worse than the original miss:
 * a missed push is a five-second fix, a record that lies about it is not.
 *
 * "Done means verified" is the rule this publication states for the site. It
 * has to hold for the repository's own records first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const assemble = readFileSync(path.join(root, 'scripts/brief-assemble.ts'), 'utf8');
const ship = readFileSync(path.join(root, 'scripts/brief-ship.sh'), 'utf8');
const run = readFileSync(path.join(root, 'scripts/brief-run.ts'), 'utf8');
const workflow = readFileSync(path.join(root, '.github/workflows/daily-brief.yml'), 'utf8');

test('the assemble stage never writes a live_url', () => {
  // Nothing in assemble has touched the public internet, so nothing in
  // assemble may make a claim about it.
  assert.equal(
    /status\.live_url\s*=/.test(assemble),
    false,
    'brief-assemble.ts assigns live_url; only post-verification code may do that'
  );
});

test('the assemble stage never records outcome "published"', () => {
  assert.equal(
    /outcome\s*=\s*['"]published['"]/.test(assemble),
    false,
    'brief-assemble.ts sets outcome to published; it has not published anything'
  );
});

test('the assemble stage records outcome "composed"', () => {
  assert.ok(
    /outcome\s*=\s*['"]composed['"]/.test(assemble),
    'a successful assemble must record composed, which is what actually happened'
  );
});

test('ship promotes to published only inside the live-verification branch', () => {
  const idx = ship.indexOf('brief-watchdog.ts --date="$EDITION" >/dev/null');
  assert.ok(idx > 0, 'expected the watchdog gate in brief-ship.sh');
  const afterGate = ship.slice(idx);
  const beforeGate = ship.slice(0, idx);
  assert.ok(
    afterGate.includes('s.outcome = "published"'),
    'published must be written after the watchdog confirms a 200'
  );
  assert.equal(
    /s\.outcome\s*=\s*"published"/.test(beforeGate),
    false,
    'nothing before the watchdog gate may record published'
  );
});

test('ship treats composed as the only state it may ship from', () => {
  assert.ok(ship.includes('composed)'), 'ship must accept the composed outcome');
  assert.ok(
    ship.includes('already recorded as published and verified'),
    'ship must refuse to redo an edition already verified live'
  );
});

// ---- THE SAME PROPERTY ON THE UNATTENDED PATH ----
//
// The 2026-09-11 fix patched brief-assemble.ts and left the identical defect
// in brief-run.ts. Claude Code caught it. A defect fixed on the path you are
// watching and left on the path you are not is worse than not fixing it,
// because it buys confidence without coverage — and on the API path nobody
// reads a terminal at 06:07, so the status file is the ENTIRE report.

test('brief-run never writes a live_url', () => {
  assert.equal(
    /status\.live_url\s*=/.test(run),
    false,
    'brief-run.ts assigns live_url before anything is pushed or verified'
  );
});

test('brief-run never records outcome "published"', () => {
  assert.equal(
    /status\.outcome\s*=\s*['"]published['"]/.test(run),
    false,
    'brief-run.ts sets outcome to published; the workflow has not pushed yet'
  );
});

test('brief-run records outcome "composed"', () => {
  assert.ok(
    /status\.outcome\s*=\s*['"]composed['"]/.test(run),
    'a successful run must record composed, which is what actually happened'
  );
});

test('the workflow gates its publish steps on "composed"', () => {
  // If these still matched 'published', the build, commit, push and verify
  // steps would all be skipped and the workflow would silently do nothing.
  assert.ok(
    workflow.includes("steps.outcome.outputs.result == 'composed'"),
    'the workflow must act on the composed outcome'
  );
  assert.equal(
    workflow.includes("steps.outcome.outputs.result == 'published'"),
    false,
    'no workflow step may gate on published; nothing produces it before verification'
  );
});

test('the workflow promotes to published only after the watchdog confirms', () => {
  const idx = workflow.indexOf('Verified live on attempt');
  assert.ok(idx > 0, 'expected the live-verification branch in the workflow');
  assert.ok(
    workflow.slice(idx).includes('s.outcome = "published"'),
    'published must be written inside the verified-live branch'
  );
  assert.equal(
    /s\.outcome\s*=\s*"published"/.test(workflow.slice(0, idx)),
    false,
    'nothing before the watchdog confirmation may record published'
  );
});
