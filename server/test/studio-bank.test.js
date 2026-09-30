import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapStudioRow } from '../../scripts/lib/studio-bank.js';

const row = (data, extra = {}) => ({ id: 'abc', num: 7, subject: 'Maths', chapter: 'Vector Algebra', type: 'single', format: 'normal', tags: ['Class 12', 'pyq', 'jee-main'], data: JSON.stringify(data), ...extra });

test('single-correct PYQ from the Studio bank', () => {
  const r = mapStudioRow(row({ question: 'Find $|c|$', options: ['1', '2', '3', '4'], answer: 'A', source: 'JEE Main 2025 · 23 Jan · Shift 1' }, { year: 2025, exam: 'JEE Main' }));
  assert.equal(r.ok, true);
  const q = r.question;
  assert.equal(q.subject, 'maths');
  assert.equal(q.type, 'single');
  assert.deepEqual(q.answer, { keys: ['A'] });
  assert.equal(q.status, 'published');
  assert.equal(q.class, 12);
  assert.deepEqual(q.pyq, { exam: 'JEE Main', year: 2025, shift: '23 Jan · Shift 1' });
  assert.deepEqual(q.source, { name: 'studio', id: 'abc', num: 7, label: 'JEE Main 2025 · 23 Jan · Shift 1' });
});

test('multiple-correct and numerical', () => {
  const m = mapStudioRow(row({ question: 'q', options: ['a', 'b', 'c', 'd'], answer: ['A', 'B'] }, { type: 'multiple' }));
  assert.equal(m.question.type, 'multi');
  assert.deepEqual(m.question.answer, { keys: ['A', 'B'] });
  const n = mapStudioRow(row({ question: 'q', options: [], answer: '1' }, { type: 'numerical', tags: ['eqourse', 'practice'] }));
  assert.equal(n.question.type, 'numerical');
  assert.deepEqual(n.question.answer, { value: 1 });
  assert.equal(n.question.source.name, 'eqourse');
});

test('needs-answer and check tags become drafts; proof and other subjects are skipped', () => {
  assert.equal(mapStudioRow(row({ question: 'q', options: [], answer: '' }, { tags: ['doubtnut', 'needs-answer'] })).question.status, 'draft');
  assert.equal(mapStudioRow(row({ question: 'q', options: ['a', 'b'], answer: 'A' }, { tags: ['check-figure'] })).question.status, 'draft');
  assert.equal(mapStudioRow(row({ question: 'Prove that…', options: [], answer: '' }, { tags: ['proof'] })).ok, false);
  assert.equal(mapStudioRow(row({ question: 'q' }, { subject: 'Biology' })).ok, false);
});

test('match-the-columns, figures and passages are folded into the text', () => {
  const r = mapStudioRow(row({
    question: 'Match List-I with List-II',
    options: ['A-I', 'A-II', 'A-III', 'A-IV'],
    answer: 'D',
    image: 'fig 1.png',
    passage: 'Read this.',
    lists: { style: 'PQRS-1234', left: ['$x$', 'y'], right: ['1', '2'] },
  }));
  const t = r.question.text;
  assert.ok(t.startsWith('Read this.'));
  assert.ok(t.includes('<table class="match">') && t.includes('<td>A</td><td>$x$</td>'), 'labels follow the options (A-I…)');
  assert.ok(t.includes('![](/media/fig%201.png)'));
  assert.deepEqual(r.images, ['fig 1.png']);
});

test('tags from sqlite group_concat and null chapters', () => {
  const r = mapStudioRow({ id: 'x', num: 1, subject: 'Physics', chapter: null, type: 'single', tags: 'doubtnut\u001fClass 11', data: '{"question":"q","options":["a","b"],"answer":2}' });
  assert.equal(r.question.source.name, 'doubtnut');
  assert.equal(r.question.class, 11);
  assert.equal(r.question.chapter, 'Mixed');
  assert.deepEqual(r.question.answer, { keys: ['B'] });
});

test('lists already typeset in the question are not repeated', () => {
  const r = mapStudioRow(row({ question: 'Match $$\\begin{array}{cc} a & b \\end{array}$$', options: ['P-1', 'P-2'], answer: 'A', lists: { left: ['a'], right: ['b'] } }));
  assert.ok(!r.question.text.includes('<table'));
});

test('local {{img:…}} tags are collected for copying; URLs are left alone', () => {
  const r = mapStudioRow(row({ question: 'See {{img:fig2.png|6}} and {{img:https://x.net/a.png}}', options: ['{{img:opt.png}}', 'b'], answer: 'A' }));
  assert.deepEqual(r.images.sort(), ['fig2.png', 'opt.png']);
  assert.ok(r.question.text.includes('{{img:https://x.net/a.png}}'));
});
