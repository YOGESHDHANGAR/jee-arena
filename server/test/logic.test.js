import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCorrect, markQuestion, gradePaper } from '../src/lib/grading.js';
import { computeRatingChanges, assignRanks } from '../src/lib/rating.js';

const single = { qid: 1, subject: 'physics', type: 'single', answer: { keys: ['B'] } };
const multi = { qid: 2, subject: 'chemistry', type: 'multi', answer: { keys: ['A', 'C', 'D'] } };
const num = { qid: 3, subject: 'maths', type: 'numerical', answer: { value: 2.5 } };
const range = { qid: 4, subject: 'maths', type: 'numerical', answer: { min: 0.49, max: 0.51 } };

test('single correct', () => {
  assert.equal(isCorrect(single, 'b'), true);
  assert.equal(isCorrect(single, 'A'), false);
  assert.equal(isCorrect(single, ''), false);
});

test('multi correct needs the exact set', () => {
  assert.equal(isCorrect(multi, ['D', 'A', 'C']), true);
  assert.equal(isCorrect(multi, ['A', 'C']), false);
  assert.equal(isCorrect(multi, ['A', 'B', 'C', 'D']), false);
});

test('numerical with tolerance and ranges', () => {
  assert.equal(isCorrect(num, '2.50'), true);
  assert.equal(isCorrect(num, '2.509'), true);
  assert.equal(isCorrect(num, '2.52'), false);
  assert.equal(isCorrect(num, 'abc'), false);
  assert.equal(isCorrect(range, 0.5), true);
  assert.equal(isCorrect(range, 0.52), false);
});

test('JEE Main marking', () => {
  assert.deepEqual(markQuestion(single, 'B', 'jee_main'), { status: 'correct', marks: 4, max: 4 });
  assert.deepEqual(markQuestion(single, 'C', 'jee_main'), { status: 'wrong', marks: -1, max: 4 });
  assert.deepEqual(markQuestion(single, undefined, 'jee_main'), { status: 'unattempted', marks: 0, max: 4 });
  assert.equal(markQuestion(num, '7', 'jee_main').marks, -1);
});

test('JEE Advanced multi-correct partial marking', () => {
  assert.equal(markQuestion(multi, ['A', 'C', 'D'], 'jee_adv').marks, 4);
  assert.equal(markQuestion(multi, ['A', 'C'], 'jee_adv').marks, 2);
  assert.equal(markQuestion(multi, ['A'], 'jee_adv').marks, 1);
  assert.equal(markQuestion(multi, ['A', 'B'], 'jee_adv').marks, -2);
  assert.equal(markQuestion(multi, [], 'jee_adv').marks, 0);
  assert.equal(markQuestion(single, 'B', 'jee_adv').marks, 3);
  assert.equal(markQuestion(num, '1', 'jee_adv').marks, 0);
});

test('gradePaper totals and subject split', () => {
  const g = gradePaper([single, multi, num], { 1: 'B', 3: '9' }, 'jee_main');
  assert.equal(g.score, 3);
  assert.equal(g.maxScore, 12);
  assert.equal(g.correct, 1);
  assert.equal(g.wrong, 1);
  assert.equal(g.unattempted, 1);
  assert.equal(g.bySubject.physics.score, 4);
  assert.equal(g.bySubject.maths.score, -1);
});

test('ranks: ties share a rank, then time breaks ties', () => {
  const r = assignRanks([
    { id: 'a', score: 40, timeTakenSec: 900 },
    { id: 'b', score: 60, timeTakenSec: 1200 },
    { id: 'c', score: 40, timeTakenSec: 800 },
    { id: 'd', score: 40, timeTakenSec: 800 },
  ]);
  assert.deepEqual(r.map((x) => [x.id, x.rank]), [['b', 1], ['c', 2], ['d', 2], ['a', 4]]);
});

test('rating: winners gain, losers drop, roughly zero-sum', () => {
  const players = Array.from({ length: 10 }, (_, i) => ({ userId: i, rating: 1500, contestsPlayed: 0, rank: i + 1 }));
  const ch = computeRatingChanges(players);
  assert.ok(ch[0].delta > 0);
  assert.ok(ch[9].delta < 0);
  assert.ok(ch[0].delta > ch[4].delta);
  assert.ok(Math.abs(ch.reduce((s, c) => s + c.delta, 0)) <= 10);
});

test('rating: beating a stronger field earns more than beating a weaker one', () => {
  const vsStrong = computeRatingChanges([
    { userId: 'me', rating: 1500, contestsPlayed: 10, rank: 1 },
    { userId: 'x', rating: 1900, contestsPlayed: 10, rank: 2 },
    { userId: 'y', rating: 1900, contestsPlayed: 10, rank: 3 },
  ])[0].delta;
  const vsWeak = computeRatingChanges([
    { userId: 'me', rating: 1500, contestsPlayed: 10, rank: 1 },
    { userId: 'x', rating: 1100, contestsPlayed: 10, rank: 2 },
    { userId: 'y', rating: 1100, contestsPlayed: 10, rank: 3 },
  ])[0].delta;
  assert.ok(vsStrong > vsWeak, `${vsStrong} > ${vsWeak}`);
});
