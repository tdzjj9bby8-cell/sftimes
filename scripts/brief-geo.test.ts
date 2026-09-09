/**
 * scripts/brief-geo.test.ts
 *
 * The out-of-region screen has one dangerous direction: deleting a real Bay
 * Area story to save a download. Most of these tests guard that direction.
 * The real headlines below are the ones that actually reached the editor on
 * 2026-09-08 and 2026-09-09.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLikelyOutOfRegion, mentionsBayArea } from './lib/geo-filter.js';

const off = (h: string, d = '') => isLikelyOutOfRegion(h, d).outOfRegion;

test('the real wire stories that wasted packet slots are screened out', () => {
  assert.equal(off('Surprise Man Accused of Abusing Child Relative Nabbed After Fleeing to UK'), true);
  assert.equal(off("Healthy-Looking Tree Crushes Six Cars at Burien's Seahurst Park on Labor Day"), true);
  assert.equal(off('Harris County public defender resigns amid probe'), true);
  assert.equal(off('DeKalb County homicide investigation continues'), true);
  assert.equal(off('UK air traffic control failure strands travelers'), true);
  assert.equal(off('Temple University receives largest gift in its history'), true);
});

test('real Bay Area headlines are never screened out', () => {
  const keep = [
    'BART Reports Major Crime Drop 1 Year After New Fare Gates',
    'Waymo gets green light to operate in Berkeley',
    'Giant teacher housing project advances in East Palo Alto',
    'Mountain View developer reduces affordable homes in builder’s remedy project',
    'UPDATE: Federal judge weighs temporary pause for South County ICE facility',
    'Pittsburg Police Made ‘Serious Failure’ by Allowing Suspect to Sneak Gun Into Station',
    'Why aren’t Oaklanders more excited about the governor’s race?',
    'Complaints of Employer ICE Threats on the Rise in California',
    'Richmond mayoral runoff set for November',
  ];
  for (const h of keep) assert.equal(off(h), false, `wrongly screened: ${h}`);
});

test('a headline naming no place at all is kept', () => {
  // The screen fires on evidence of elsewhere, never on absence of local words.
  assert.equal(off('Supervisors approve new housing rules'), false);
  assert.equal(off('Rents fall for the third straight quarter'), false);
});

test('a Bay Area reference beats an out-of-region word', () => {
  // "Oakland firm sued in Texas" is our story.
  assert.equal(off('Oakland startup sued in Texas over patent claims'), false);
  assert.equal(off('Berkeley researchers publish study with New York colleagues'), false);
});

test('"Washington" is not treated as out of region', () => {
  // It means the federal government far more often than the state, and federal
  // policy is legitimately Bay Area news.
  assert.equal(off('Washington moves to cut transit funding'), false);
});

test('a wire dateline is caught', () => {
  assert.equal(off('NEW YORK CITY -- Mayor announces air quality records release'), true);
});

test('the body check confirms local stories and flags placeless ones', () => {
  assert.equal(mentionsBayArea('The board met in Oakland on Tuesday to discuss the budget.'), true);
  assert.equal(mentionsBayArea('BART reported a drop in crime across the system.'), true);
  assert.equal(mentionsBayArea('The governor signed the bill at a ceremony in Sacramento.'), false);
});
