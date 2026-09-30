import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, answerToKeys, parseNumeric, normOptions } from '../../scripts/lib/normalize.js';

test('answer spellings map to option keys', () => {
  assert.deepEqual(answerToKeys('B', 4), ['B']);
  assert.deepEqual(answerToKeys('(c)', 4), ['C']);
  assert.deepEqual(answerToKeys('option 2', 4), ['B']);
  assert.deepEqual(answerToKeys(3, 4), ['C']);
  assert.deepEqual(answerToKeys([1, 4], 4), ['A', 'D']);
  assert.deepEqual(answerToKeys('A, C', 4), ['A', 'C']);
  assert.deepEqual(answerToKeys('AC', 4), ['A', 'C']);
  assert.deepEqual(answerToKeys('', 4), []);
});

test('numeric answers and ranges', () => {
  assert.deepEqual(parseNumeric('2.5'), { value: 2.5 });
  assert.deepEqual(parseNumeric(7), { value: 7 });
  assert.deepEqual(parseNumeric('0.49 to 0.51'), { min: 0.49, max: 0.51 });
  assert.equal(parseNumeric('see solution'), null);
});

test('options in different shapes', () => {
  assert.deepEqual(normOptions(['(a) 2', '(b) 4']).options, [{ key: 'A', text: '2' }, { key: 'B', text: '4' }]);
  const o = normOptions([{ text: 'x', isCorrect: false }, { text: 'y', isCorrect: true }]);
  assert.deepEqual(o.flagged, ['B']);
  assert.deepEqual(normOptions({ A: 'p', B: 'q' }).options.map((x) => x.key), ['A', 'B']);
});

test('full document -> published single-correct question', () => {
  const r = normalize({
    _id: 'abc',
    question: 'A ball is thrown…',
    options: ['1 m', '2 m', '3 m', '4 m'],
    answer: 'b',
    subject: 'Physics',
    chapter: 'Kinematics',
    class: '11',
    source: 'site-x',
    year: 'JEE Main 2023',
  });
  assert.equal(r.ok, true);
  assert.equal(r.question.type, 'single');
  assert.deepEqual(r.question.answer, { keys: ['B'] });
  assert.equal(r.question.status, 'published');
  assert.deepEqual(r.question.source, { name: 'site-x', id: 'abc' });
  assert.equal(r.question.pyq.year, 2023);
});

test('question-only entries import as drafts, others are filtered', () => {
  assert.equal(normalize({ _id: 1, question: 'Find x', subject: 'Maths' }).question.status, 'draft');
  assert.equal(normalize({ _id: 1, question: 'x', subject: 'Biology' }).ok, false);
  assert.equal(normalize({ _id: 1, question: 'x', subject: 'Maths', class: 10 }).ok, false);
  assert.equal(normalize({ _id: 1, question: 'x', subject: 'Chemistry', answer: '5' }).question.type, 'numerical');
});
