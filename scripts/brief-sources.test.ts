/**
 * scripts/brief-sources.test.ts
 *
 * Tests for the two pieces of logic that decide WHICH newsrooms the Brief
 * actually reads. Both are quiet failure modes: if either is wrong, the
 * pipeline still runs, still publishes, and still reports success while
 * silently ignoring most of its own source list.
 *
 * Run: npm run brief:test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interleaveByOutlet } from './brief-ingest.js';
import {
  requiredHealthySources,
  MIN_HEALTHY_SOURCES,
  evaluateQualityFloor,
} from './lib/editorial-quality.js';

function item(outlet: string, minutesAgo: number) {
  return {
    source_outlet: outlet,
    published_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

test('a high-volume outlet cannot crowd out a low-volume one', () => {
  // The real shape of the problem: KRON4 publishes 50 items a day, The Almanac
  // publishes a handful a week. Before interleaving, a budget of 5 went
  // entirely to KRON4 and The Almanac was never read.
  const items = [
    ...Array.from({ length: 50 }, (_, i) => item('KRON4', i)),
    item('The Almanac', 200),
  ];
  const budget = interleaveByOutlet(items).slice(0, 5);
  assert.ok(
    budget.some((i) => i.source_outlet === 'The Almanac'),
    'the low-volume outlet must appear within the first few slots'
  );
});

test('every outlet gets its first story before any outlet gets its second', () => {
  const items = [
    item('A', 1), item('A', 2), item('A', 3),
    item('B', 4), item('B', 5),
    item('C', 6),
  ];
  const first3 = interleaveByOutlet(items).slice(0, 3).map((i) => i.source_outlet);
  assert.deepEqual([...first3].sort(), ['A', 'B', 'C']);
});

test('within an outlet, the newest story is offered first', () => {
  const items = [item('A', 90), item('A', 5), item('A', 40)];
  const order = interleaveByOutlet(items).map((i) => i.published_at);
  assert.deepEqual(order, [...order].sort().reverse(), 'expected newest-first inside the outlet');
});

test('interleaving preserves every item', () => {
  const items = [
    ...Array.from({ length: 12 }, (_, i) => item('A', i)),
    ...Array.from({ length: 3 }, (_, i) => item('B', i)),
    item('C', 1),
  ];
  assert.equal(interleaveByOutlet(items).length, items.length);
});

test('the very first item is still the freshest story of the day', () => {
  const items = [item('Quiet Paper', 2), ...Array.from({ length: 20 }, (_, i) => item('Loud Paper', 30 + i))];
  assert.equal(interleaveByOutlet(items)[0].source_outlet, 'Quiet Paper');
});

test('the health floor scales with the size of the source list', () => {
  // The bug this prevents: a fixed floor of 4 means every source you ADD makes
  // the check weaker. At 32 sources, 4 healthy is a catastrophic outage.
  assert.equal(requiredHealthySources(32), 20);
  assert.equal(requiredHealthySources(11), 7);
  assert.ok(
    requiredHealthySources(32) > MIN_HEALTHY_SOURCES,
    'a large source list must require more than the absolute floor'
  );
});

test('the health floor never exceeds the number of sources configured', () => {
  assert.equal(requiredHealthySources(2), 2);
  assert.equal(requiredHealthySources(0), 0);
});

test('a half-down source list fails the quality floor', () => {
  const verdict = evaluateQualityFloor({
    itemCount: 5,
    healthySources: 14,
    totalSources: 32,
    outletCounts: { A: 2, B: 2, C: 1 },
    pipelineErrors: 0,
    candidatesIngested: 100,
  });
  assert.equal(verdict.publish, false);
  assert.ok(verdict.reasons.some((r) => r.includes('sources responded')));
});

test('a healthy large source list passes the quality floor', () => {
  const verdict = evaluateQualityFloor({
    itemCount: 5,
    healthySources: 32,
    totalSources: 32,
    outletCounts: { A: 2, B: 2, C: 1 },
    pipelineErrors: 0,
    candidatesIngested: 200,
  });
  assert.equal(verdict.publish, true, verdict.reasons.join(' '));
});
