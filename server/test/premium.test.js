import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePremium } from '../src/lib/premium.js';

const mk = (n, chapter, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ qid: chapter.length * 1000 + i, subject: 'physics', chapter, difficulty: 'medium', hasSolution: false, isPyq: false, ...extra }));

test('20% of every chapter, not 20% overall', () => {
  const rows = [...mk(100, 'Optics'), ...mk(10, 'Units')];
  const set = choosePremium(rows, { percent: 20 });
  assert.equal([...set].filter((q) => q < 6000 && q >= 5000 && rows.find((r) => r.qid === q).chapter === 'Units').length, 2);
  assert.equal(set.size, 22);
});

test('prefers questions with solutions, then harder ones', () => {
  const rows = [
    { qid: 1, subject: 'maths', chapter: 'C', difficulty: 'easy', hasSolution: false },
    { qid: 2, subject: 'maths', chapter: 'C', difficulty: 'hard', hasSolution: false },
    { qid: 3, subject: 'maths', chapter: 'C', difficulty: 'easy', hasSolution: true },
    { qid: 4, subject: 'maths', chapter: 'C', difficulty: 'medium', hasSolution: false },
    { qid: 5, subject: 'maths', chapter: 'C', difficulty: 'easy', hasSolution: false },
  ];
  assert.deepEqual([...choosePremium(rows, { percent: 40 })].sort(), [2, 3]);
});

test('PYQs stay free unless asked; manual choices are respected and counted', () => {
  const rows = [...mk(10, 'Waves', { isPyq: true })];
  assert.equal(choosePremium(rows, { percent: 50 }).size, 0);
  assert.equal(choosePremium(rows, { percent: 50, includePyq: true }).size, 5);
  const mixed = mk(10, 'Heat');
  mixed[0].premium = true; mixed[0].premiumSource = 'manual';
  mixed[1].premiumSource = 'manual'; // manually kept free
  const set = choosePremium(mixed, { percent: 30 });
  assert.equal(set.size, 2); // 3 target − 1 manual
  assert.ok(!set.has(mixed[0].qid) && !set.has(mixed[1].qid));
});

test('same input gives the same selection (stable)', () => {
  const rows = mk(50, 'Gravitation');
  assert.deepEqual([...choosePremium(rows, { percent: 20 })].sort(), [...choosePremium([...rows].reverse(), { percent: 20 })].sort());
});
