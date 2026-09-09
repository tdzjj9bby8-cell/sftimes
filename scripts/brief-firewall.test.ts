/**
 * scripts/brief-firewall.test.ts
 *
 * Regression tests for the deterministic editorial firewall.
 *
 * WHY THESE EXIST
 * The firewall is the last thing standing between a drafted claim and a reader.
 * It has two failure directions and both are expensive:
 *
 *   FALSE NEGATIVE  a fabricated number or quote reaches the site. This is the
 *                   2026-07-15 incident and the reason the module was written.
 *   FALSE POSITIVE  a correctly transcribed figure is reported as fabricated
 *                   and a true item is removed. Less visible, but it quietly
 *                   empties editions and teaches the operator to distrust the
 *                   gate, which ends the same way.
 *
 * Both directions are tested here. The percent and range cases are not
 * hypothetical: they were live bugs found while composing the first real
 * edition on the subscription path.
 *
 * Run: npm run brief:test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findUnsupportedNumbers,
  findUnsupportedAttributions,
  isCertaintyEscalated,
  validateItem,
} from './lib/editorial-firewall.js';
import { validateComposedEdition } from './brief-publish.js';

// A body long enough to look like a real article to any length check.
const filler = 'The agency discussed the proposal at length during the meeting. '.repeat(20);

test('percent written as words matches a source using the % sign', () => {
  const body = `Crimes against riders fell 67% between December 2024 and June 2026. ${filler}`;
  const claim = 'Crimes against riders fell 67 percent over that period.';
  assert.deepEqual(findUnsupportedNumbers(claim, body), []);
});

test('percent written with the % sign matches a source spelling it out', () => {
  const body = `Ridership rose 12 percent year over year. ${filler}`;
  assert.deepEqual(findUnsupportedNumbers('Ridership rose 12%.', body), []);
});

test('a percentage the source never states is still caught', () => {
  const body = `Crimes against riders fell 67% between December 2024 and June 2026. ${filler}`;
  const found = findUnsupportedNumbers('Crimes fell 82 percent over that period.', body);
  assert.equal(found.length, 1, 'expected the invented 82 percent to be flagged');
});

test('a bare number in the source does not satisfy a percentage in the draft', () => {
  const body = `The board reviewed item 67 on the agenda. ${filler}`;
  const found = findUnsupportedNumbers('Crime fell 67 percent.', body);
  assert.equal(found.length, 1, 'a bare 67 must not license "67 percent"');
});

test('vote counts match across "9 to 2" and "9-2"', () => {
  const body = `The board approved the measure 9 to 2 after a long hearing. ${filler}`;
  assert.deepEqual(findUnsupportedNumbers('The board approved it 9-2.', body), []);
});

test('an invented vote count is caught (the July 15 pattern)', () => {
  const body = `The board approved the measure after a long hearing. ${filler}`;
  const found = findUnsupportedNumbers('The board approved it 9-2.', body);
  assert.equal(found.length, 1);
});

test('an invented dollar figure is caught', () => {
  const body = `The agency faces a deficit and has warned of service cuts. ${filler}`;
  // Both the money pattern and the bare-quantity pattern match here, so assert
  // that it is caught rather than pinning an exact violation count.
  const found = findUnsupportedNumbers('The plan carries a $125 million price tag.', body);
  assert.ok(found.length >= 1, 'expected the invented dollar figure to be flagged');
});

test('countable nouns containing the letters "to" are not mangled', () => {
  // Regression: an unscoped " to " collapse rewrote "stories" as "s-ries",
  // making a correctly transcribed "3 stories" unmatchable against the source.
  const body = `The building rises 3 stories above the sidewalk. ${filler}`;
  assert.deepEqual(findUnsupportedNumbers('The building is 3 stories tall.', body), []);
});

test('four-digit years are treated as ordinary context, not assertions', () => {
  const body = `The agency was created decades ago. ${filler}`;
  assert.deepEqual(findUnsupportedNumbers('This dates back to 1972.', body), []);
});

test('an invented quotation is caught by validateItem', () => {
  const body = `The supervisor described the vote as significant for the district. ${filler}`;
  const verdict = validateItem({
    id: 'x1',
    source_url: 'https://example.com/story',
    source_outlet: 'Mission Local',
    source_byline: 'A Reporter',
    original_headline: 'Board acts',
    source_body: body,
    source_body_word_count: 500,
    draft: {
      brief_worthy: true,
      angle_statement: 'Angle.',
      tldr: 'The board acted.',
      editor_note: `"This is a historic day for our city," the supervisor said. ${'The item continues with further context. '.repeat(20)}`,
      what_to_watch: 'What happens next.',
      brief_signal: 'missing-context',
    },
  });
  assert.ok(
    verdict.violations.some((v) => v.check === 'no_fabricated_quotes'),
    'expected a fabricated-quote violation'
  );
});

function quoteVerdict(body: string, note: string) {
  return validateItem({
    id: 'q',
    source_url: 'https://example.com/story',
    source_outlet: 'Palo Alto Online',
    source_byline: 'A Reporter',
    original_headline: 'Council acts',
    source_body: body,
    source_body_word_count: 600,
    draft: {
      brief_worthy: true,
      angle_statement: 'Angle.',
      tldr: 'Summary.',
      editor_note: note,
      what_to_watch: 'Next.',
      brief_signal: 'missing-context',
    },
  }).violations.filter((v) => v.check === 'no_fabricated_quotes');
}

const noteTail = 'The item continues with further context for the reader. '.repeat(15);

test('a quote ending a sentence is not flagged when the source ends it with a comma', () => {
  // Regression: this removed three true items from three outlets on the first
  // edition drafted against the full source list. Sources close a quote
  // mid-sentence with a comma; drafts close their own sentence with a period.
  const body = `The vice mayor spoke at length. "We have been losing people, who just cannot afford to live here," he said. ${'The meeting continued for another hour. '.repeat(30)}`;
  const note = `Vice Mayor Abrica put it plainly: "We have been losing people, who just cannot afford to live here." ${noteTail}`;
  assert.deepEqual(quoteVerdict(body, note), []);
});

test('a partial quote is not flagged when the source sentence continues', () => {
  const body = `The developer wrote that "this step is essential to ensure the project moves forward and delivers much needed housing." ${'Background follows here in the article. '.repeat(30)}`;
  const note = `The developer wrote that "this step is essential to ensure the project moves forward." ${noteTail}`;
  assert.deepEqual(quoteVerdict(body, note), []);
});

test('curly and straight quotation marks are treated as the same characters', () => {
  const body = `The judge asked, “Tell me how this is not a change in use,” during the hearing. ${'The hearing ran long that afternoon. '.repeat(30)}`;
  const note = `From the bench she asked, "Tell me how this is not a change in use." ${noteTail}`;
  assert.deepEqual(quoteVerdict(body, note), []);
});

test('a genuinely invented quote is still caught after the punctuation fix', () => {
  const body = `The vice mayor discussed enrollment trends at the meeting. ${'The meeting continued for another hour. '.repeat(30)}`;
  const note = `The vice mayor said, "We have been losing people, who just cannot afford to live here." ${noteTail}`;
  assert.equal(quoteVerdict(body, note).length, 1);
});

test('a quote with a word changed is still caught', () => {
  // The edge-punctuation fix must not become a fuzzy match. Every word inside
  // the quotation still has to be exactly what the source printed.
  const body = `"We have been losing people, who just cannot afford to live here," he said. ${'The meeting continued for another hour. '.repeat(30)}`;
  const note = `He said, "We have been losing families, who just cannot afford to live here." ${noteTail}`;
  assert.equal(quoteVerdict(body, note).length, 1);
});

test('a range the source never states is caught', () => {
  // True positive found on a live edition: the source said "29 affordable
  // condos, instead of the 44 previously proposed" and the draft compressed it
  // into "44 to 29", which reads as a figure the source did not print.
  const body = `The change results in 29 affordable condos, instead of the 44 previously proposed. ${filler}`;
  const found = findUnsupportedNumbers('Affordable condos drop from 44 to 29.', body);
  assert.ok(found.length >= 1, 'expected the compressed range to be flagged');
});

test('an attribution the source never makes is caught', () => {
  const body = `A spokesperson for the transit agency said service would continue. ${filler}`;
  const found = findUnsupportedAttributions('Mayor Breed said the plan was final.', body);
  assert.ok(found.length > 0, 'expected the unsupported attribution to be flagged');
});

test('certainty escalation is caught when the source is hedged throughout', () => {
  const body =
    'A man allegedly took the items. Police said the account is preliminary and reportedly under review. '.repeat(
      12
    );
  // The draft below deliberately contains no hedge marker of its own. Note that
  // the word "suspect" is itself a hedge marker, so a draft using it would
  // correctly NOT trip this check.
  assert.equal(isCertaintyEscalated('A man took the items and the case is closed.', body), true);
});

test('a draft hedged with a bare modal is not flagged as escalation', () => {
  // Regression: the draft was judged with the narrow allegation vocabulary, so
  // "may be under pressure" counted as zero hedges and a correctly cautious
  // item was removed. Source below carries two source-side hedges.
  const body = `The rollout could depend on mapping. The launch came under investigation last week. ${filler}`;
  assert.equal(
    isCertaintyEscalated('The company may be under commercial pressure to move quickly.', body),
    false
  );
});

test('attribution alone does not count as hedging the draft', () => {
  // "said" appears in nearly every draft. If it counted, this check would never
  // fire on anything.
  const body =
    'The suspect allegedly took the items. The account is preliminary and under investigation. '.repeat(
      12
    );
  assert.equal(isCertaintyEscalated('Police said the man took the items.', body), true);
});

test('a faithful draft of an unhedged source is not flagged for certainty', () => {
  const body = `The board approved the contract at its Tuesday meeting. ${filler}`;
  assert.equal(isCertaintyEscalated('The board approved the contract Tuesday.', body), false);
});

test('a missing source body is itself a violation', () => {
  const verdict = validateItem({
    id: 'x2',
    source_url: 'https://example.com/story',
    source_outlet: 'KQED',
    source_byline: 'A Reporter',
    original_headline: 'Something happened',
    draft: {
      brief_worthy: true,
      angle_statement: 'Angle.',
      tldr: 'Summary.',
      editor_note: 'The item continues with further context. '.repeat(20),
      what_to_watch: 'Next.',
      brief_signal: 'underreported',
    },
  });
  assert.ok(!verdict.pass, 'an item with no fetched body must never pass');
});

test('a composed edition with an out-of-range score is rejected before the build', () => {
  // Regression: uniqueness_score 0 passed every structural check and then broke
  // the Astro build. A green publish followed by a red build is the exact
  // shape of the stale-site incidents this project exists to end.
  const bad = [
    '---', 'date: 2026-09-08', 'edition: 19', 'editor: Eric', 'items:',
    '  - id: 2026-09-08-001',
    '    slug: a-story',
    '    category: HOUSING',
    '    signal: missing-context',
    '    source_headline: "A story"',
    '    source_outlet: "KQED"',
    '    source_url: "https://example.com/a"',
    '    source_date: 2026-09-08',
    '    uniqueness_score: 0',
    '    tldr: "Summary."',
    '    angle_statement: "Angle."',
    '---', '',
  ].join('\n');
  const v = validateComposedEdition(bad, '2026-09-08');
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes('uniqueness_score')));
});

test('a composed edition that simply omits the scores is valid', () => {
  const good = [
    '---', 'date: 2026-09-08', 'edition: 19', 'editor: Eric', 'items:',
    '  - id: 2026-09-08-001',
    '    slug: a-story',
    '    category: HOUSING',
    '    signal: missing-context',
    '    source_headline: "A story"',
    '    source_outlet: "KQED"',
    '    source_url: "https://example.com/a"',
    '    source_date: 2026-09-08',
    '    tldr: "Summary."',
    '    angle_statement: "Angle."',
    '---', '',
  ].join('\n');
  assert.deepEqual(validateComposedEdition(good, '2026-09-08').errors, []);
});
