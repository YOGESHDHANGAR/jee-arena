import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, normalizeText, answerKey, keeperScore } from '../src/lib/fingerprint.js';
import { suggestDifficulty } from '../src/lib/difficulty.js';
import { cleanTimes } from '../src/lib/tests.js';
import { searchParts, setTextIndex } from '../src/lib/search.js';
import { chapterSlug } from '../src/lib/chapters.js';

test('fingerprint ignores formatting, numbering, exam tags and option order', () => {
  const a = { type: 'single', text: 'Q12. The hybridisation of carbon in $\\text{CH}_4$ is: (JEE Main 2019, 9 Jan Shift 1)', options: [{ key: 'A', text: '$sp$' }, { key: 'B', text: '$sp^2$' }, { key: 'C', text: '$sp^3$' }, { key: 'D', text: '$sp^3d$' }], answer: { keys: ['C'] } };
  const b = { type: 'single', text: 'The hybridisation of carbon in CH<sub>4</sub> is :', options: [{ key: 'A', text: 'sp^3' }, { key: 'B', text: 'sp' }, { key: 'C', text: 'sp^2' }, { key: 'D', text: 'sp^3 d' }], answer: { keys: ['A'] } };
  assert.equal(fingerprint(a).fp, fingerprint(b).fp);
  assert.equal(answerKey(a), answerKey(b), 'same answer even though the letters differ');
  const c = { ...b, options: [...b.options.slice(0, 3), { key: 'D', text: 'dsp^2' }] };
  assert.notEqual(fingerprint(a).fp, fingerprint(c).fp);
  assert.equal(fingerprint({ text: 'Find x.' }).fp, null, 'too short to compare');
  assert.equal(normalizeText('$\\dfrac{1}{2}$ × 3'), normalizeText('\\frac{1}{2} \\times 3'));
});

test('keeper prefers published, with solution, PYQ', () => {
  assert.ok(keeperScore({ status: 'published', solution: 'x' }) > keeperScore({ status: 'published' }));
  assert.ok(keeperScore({ status: 'published' }) > keeperScore({ status: 'draft', solution: 'x', pyq: { year: 2020 } }));
});

test('difficulty from results', () => {
  assert.equal(suggestDifficulty({ attempts: 10, solved: 10 }), null, 'too few students');
  assert.equal(suggestDifficulty({ attempts: 100, solved: 90 }).level, 'easy');
  assert.equal(suggestDifficulty({ attempts: 100, solved: 55 }).level, 'medium');
  assert.equal(suggestDifficulty({ attempts: 100, solved: 20 }).level, 'hard');
  assert.equal(suggestDifficulty({ attempts: 100, solved: 90, timeSum: 300 * 50, timeCount: 50 }).level, 'medium', 'slow easy -> medium');
});

test('test times are validated and never go backwards', () => {
  const t = { durationMin: 10, questionIds: [1, 2] };
  assert.deepEqual(cleanTimes(t, { 1: 30.4, 2: -5, 9: 100 }), { 1: 30 });
  assert.deepEqual(cleanTimes(t, { 1: 10, 2: 99999 }, { 1: 30 }), { 1: 30, 2: 600 });
});

test('search: every word must match; text index only for real words', () => {
  setTextIndex(true);
  const p = searchParts('rotational motion');
  assert.equal(p.$text.$search, 'rotational motion');
  assert.equal(p.$and.length, 2);
  assert.equal(searchParts('which is').$text, undefined, 'stop words only -> regex scan');
  setTextIndex(false);
  assert.equal(searchParts('rotational').$text, undefined);
  assert.equal(searchParts('  '), null);
});

test('chapter slugs', () => {
  assert.equal(chapterSlug('Work, Energy & Power'), 'work-energy-and-power');
  assert.equal(chapterSlug('Work Energy and Power'), 'work-energy-and-power');
  assert.equal(chapterSlug('  s-Block Elements '), 's-block-elements');
});

test('JEE Main percentile estimate follows the published table', async () => {
  const { estimatePercentile, isFullJeeMain, fmtRank } = await import('../../web/src/lib/percentile.js');
  assert.ok(Math.abs(estimatePercentile(200).percentile - 99.575) < 0.01);
  assert.equal(estimatePercentile(200).rank, 6269);
  const mid = estimatePercentile(105);
  assert.ok(mid.percentile > 93.8 && mid.percentile < 95.06);
  assert.ok(estimatePercentile(150).percentile < estimatePercentile(151).percentile, 'monotonic');
  assert.equal(estimatePercentile(300).rank, 1);
  assert.ok(estimatePercentile(-20).percentile >= 0);
  assert.equal(isFullJeeMain({ test: { scheme: 'jee_main', questionCount: 75 }, maxScore: 300 }), true);
  assert.equal(isFullJeeMain({ test: { scheme: 'jee_main', questionCount: 30 }, maxScore: 120 }), false);
  assert.equal(fmtRank(91426), '91,400');
  assert.equal(fmtRank(237626), '2.38 lakh');
});
