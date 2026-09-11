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
