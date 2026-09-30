import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedMarks, chapterWeights, chapterExamAcc, lostMarks, guessing, predictScore, studyNext,
  syllabusPace, defaultExamDate, testReplay, retention, effort, freeInsights, weekKey,
} from '../src/lib/insights.js';
import { cleanConfidence, cleanVisits, cleanReason } from '../src/lib/signals.js';

const DAY = 864e5;
const d = (daysAgo) => new Date(Date.now() - daysAgo * DAY);

test('expected marks under +4/−1', () => {
  assert.equal(expectedMarks(1), 4);
  assert.equal(expectedMarks(0.2), 0); // break-even: skipping is as good
  assert.equal(expectedMarks(0.1), 0); // below it you'd skip, not lose marks
  assert.equal(expectedMarks(0.6), 2);
});

test('chapter weights share the 25 questions by PYQs', () => {
  const w = chapterWeights([{ slug: 'a', count: 100, pyqCount: 60 }, { slug: 'b', count: 100, pyqCount: 20 }, { slug: 'c', count: 10, pyqCount: 20 }]);
  assert.deepEqual(w.map((c) => c.expQ), [15, 5, 5]);
  // Few PYQs: falls back to question counts.
  const f = chapterWeights([{ slug: 'a', count: 30, pyqCount: 1 }, { slug: 'b', count: 70, pyqCount: 0 }]);
  assert.deepEqual(f.map((c) => c.expQ), [7.5, 17.5]);
});

test('chapter accuracy is pulled toward the subject when there is little data', () => {
  assert.equal(chapterExamAcc(null, 0.6, 1), 0.15);
  const few = chapterExamAcc({ attempted: 2, accuracy: 100 }, 0.5, 1);
  assert.ok(few > 0.5 && few < 0.75, String(few));
  const many = chapterExamAcc({ attempted: 100, accuracy: 80 }, 0.5, 1);
  assert.ok(many > 0.78 && many <= 0.8);
  assert.ok(chapterExamAcc({ attempted: 100, accuracy: 80 }, 0.5, 0.8) < many); // worse under exam conditions
});

test('lost marks by reason, with a list of mistakes to tag', () => {
  const T = new Map([['t1', { title: 'Mock 1' }]]);
  const attempts = [{
    testId: 't1',
    reasons: { 2: 'calculation', 3: 'time' },
    perQuestion: [
      { qid: 1, status: 'correct', marks: 4, max: 4 },
      { qid: 2, status: 'wrong', marks: -1, max: 4 },
      { qid: 3, status: 'unattempted', marks: 0, max: 4 },
      { qid: 4, status: 'wrong', marks: -1, max: 4 },
    ],
  }];
  const progress = [
    { qid: 10, status: 'attempted', attempts: 2, reason: 'concept', updatedAt: d(1) },
    { qid: 11, status: 'solved', attempts: 1 }, // right first time: not a mistake
    { qid: 12, status: 'solved', attempts: 3, updatedAt: d(2) }, // untagged mistake
  ];
  const r = lostMarks(progress, attempts, T, (qid) => ({ subject: 'physics', slug: 'kinematics', chapter: 'Kinematics', qid }));
  assert.equal(r.tests.calculation.marks, 5);
  assert.equal(r.tests.time.marks, 4);
  assert.equal(r.tests.untagged.n, 1);
  assert.equal(r.practice.concept.n, 1);
  assert.equal(r.practice.untagged.n, 1);
  assert.equal(r.testMarksLost, 14);
  assert.equal(r.sillyPerTest, 5);
  assert.equal(r.toTag.length, 2);
  assert.equal(r.toTag[0].kind, 'test');
  assert.equal(r.share.calculation + r.share.time + r.share.concept, 100);
});

test('guessing verdict against the 20% break-even', () => {
  const pq = [];
  for (let i = 0; i < 10; i++) pq.push({ qid: i, status: i < 1 ? 'correct' : 'wrong', marks: i < 1 ? 4 : -1, conf: 'guess' }); // 10% right
  for (let i = 10; i < 20; i++) pq.push({ qid: i, status: i < 17 ? 'correct' : 'wrong', marks: i < 17 ? 4 : -1, conf: 'sure' });
  const g = guessing([{ testId: 't', perQuestion: pq }]);
  assert.equal(g.levels.guess.accuracy, 10);
  assert.equal(g.levels.guess.verdict, 'skip');
  assert.equal(g.levels.guess.net, 4 - 9);
  assert.equal(g.gainSkipGuesses, 5);
  assert.equal(g.levels.sure.verdict, 'keep');
});

const bank = {
  physics: chapterWeights([{ slug: 'kinematics', chapter: 'Kinematics', count: 100, pyqCount: 50 }, { slug: 'optics', chapter: 'Optics', count: 100, pyqCount: 50 }]),
  chemistry: chapterWeights([{ slug: 'mole', chapter: 'Mole', count: 100, pyqCount: 100 }]),
  maths: chapterWeights([{ slug: 'calc', chapter: 'Calculus', count: 100, pyqCount: 100 }]),
};
const analysis = (acc) => ({
  overall: { attempted: 300, accuracy: acc },
  tests: null,
  subjects: { physics: { accuracy: acc }, chemistry: { accuracy: acc }, maths: { accuracy: acc } },
  chapters: [
    { subject: 'physics', slug: 'kinematics', attempted: 100, accuracy: acc },
    { subject: 'physics', slug: 'optics', attempted: 100, accuracy: acc },
    { subject: 'chemistry', slug: 'mole', attempted: 100, accuracy: acc },
    { subject: 'maths', slug: 'calc', attempted: 100, accuracy: acc },
  ],
});

test('predicted score grows with accuracy and gives a rank range', () => {
  const lo = predictScore(analysis(40), bank, [], new Map());
  const hi = predictScore(analysis(90), bank, [], new Map());
  assert.ok(hi.score > lo.score);
  assert.ok(hi.low <= hi.score && hi.score <= hi.high);
  assert.ok(hi.best.rank <= hi.percentile.rank && hi.percentile.rank <= hi.worst.rank);
  assert.equal(predictScore({ ...analysis(50), overall: { attempted: 5, accuracy: 50 } }, bank, [], new Map()).score, null);
});

test('mocks pull the prediction toward the real mock average', () => {
  const T = new Map([['m', { scheme: 'jee_main', questionIds: Array(75).fill(0) }]]);
  const mocks = [150, 160, 170].map((score, i) => ({ testId: 'm', score, maxScore: 300, submittedAt: d(i + 1) }));
  const p = predictScore(analysis(40), bank, mocks, T);
  assert.equal(p.fromMocks.average, 160);
  assert.ok(Math.abs(p.score - 160) < Math.abs(p.model - 160));
});

test('study next ranks chapters by marks to gain', () => {
  const a = analysis(80);
  a.chapters[0] = { ...a.chapters[0], accuracy: 20 }; // weak kinematics
  const rows = studyNext(a, bank, 1);
  assert.equal(rows[0].slug, 'kinematics');
  assert.ok(rows[0].gain > 0);
});

test('syllabus pace against the exam date', () => {
  const now = new Date('2026-09-30T10:00:00Z');
  const Q = new Map();
  const progress = [];
  let qid = 0;
  // Two chapters covered in the last 4 weeks (10 solves each).
  for (const slug of ['kinematics', 'optics']) {
    for (let i = 0; i < 10; i++) {
      Q.set(++qid, { subject: 'physics', chapterId: slug });
      progress.push({ qid, status: 'solved', solvedAt: new Date(now - 10 * DAY) });
    }
  }
  const syl = { physics: [{ slug: 'kinematics', count: 100 }, { slug: 'optics', count: 100 }, { slug: 'x', count: 100 }, { slug: 'y', count: 100 }], chemistry: [], maths: [] };
  // syllabusChapter needs real ids; use real physics chapter ids.
  const real = { physics: [{ slug: 'kinematics', count: 100 }, { slug: 'ray-optics', count: 100 }, { slug: 'gravitation', count: 100 }, { slug: 'nuclei', count: 100 }], chemistry: [], maths: [] };
  for (const p of progress) if (Q.get(p.qid).chapterId === 'optics') Q.get(p.qid).chapterId = 'ray-optics';
  const r = syllabusPace(progress, Q, real, { examDate: '2027-01-22' }, now);
  assert.equal(r.covered, 2);
  assert.equal(r.total, 4);
  assert.equal(r.perWeek, 0.5);
  assert.ok(r.needPerWeek > 0);
  assert.ok(['ahead', 'on-track', 'behind'].includes(r.status));
  assert.equal(syllabusPace([], Q, syl, { examDate: '2020-01-01' }, now).status, 'passed');
});

test('default exam date is the next January session', () => {
  assert.equal(defaultExamDate(null, new Date('2026-09-30T00:00:00Z')), '2027-01-22');
  assert.equal(defaultExamDate(null, new Date('2026-01-10T00:00:00Z')), '2026-01-22');
  assert.equal(defaultExamDate(2028, new Date('2026-09-30T00:00:00Z')), '2028-01-22');
});

test('test replay: order, time on wrong answers, easy questions left, stuck questions', () => {
  const paper = [
    { qid: 1, subject: 'maths', difficulty: 'easy' },
    { qid: 2, subject: 'maths', difficulty: 'hard' },
    { qid: 3, subject: 'physics', difficulty: 'easy' },
    { qid: 4, subject: 'physics', difficulty: 'medium' },
  ];
  const attempt = {
    perQuestion: [
      { qid: 1, status: 'correct', timeSec: 60 },
      { qid: 2, status: 'wrong', timeSec: 600 },
      { qid: 3, status: 'unattempted', timeSec: 0 },
      { qid: 4, status: 'unattempted', timeSec: 30 },
    ],
    visits: [[1, 0, 60], [2, 60, 300], [4, 360, 30], [2, 390, 300]],
  };
  const r = testReplay(attempt, paper, { durationMin: 60 });
  assert.equal(r.wrongMinutes, 10);
  assert.deepEqual(r.easyLeft, [3]);
  assert.equal(r.neverSeen, 1);
  assert.equal(r.stuck[0].n, 2);
  assert.deepEqual(r.subjectOrder, ['maths', 'physics']);
  assert.equal(r.revisited, 1);
  assert.equal(r.quarters.reduce((a, b) => a + b), 3);
  assert.equal(testReplay({ perQuestion: [] }, paper, {}), null);
});

test('retention counts questions solved a week+ before a test', () => {
  const progress = [
    { qid: 1, status: 'solved', solvedAt: d(30) },
    { qid: 2, status: 'solved', solvedAt: d(30) },
    { qid: 3, status: 'solved', solvedAt: d(2) }, // too recent
  ];
  const attempts = [{ submittedAt: d(0), perQuestion: [{ qid: 1, status: 'correct' }, { qid: 2, status: 'wrong' }, { qid: 3, status: 'wrong' }] }];
  const r = retention(progress, attempts, () => ({ subject: 'physics', slug: 'kinematics', chapter: 'Kinematics' }));
  assert.equal(r.checked, 2);
  assert.equal(r.pct, 50);
  assert.equal(r.readyToCheck, 2);
});

test('effort: time share per subject vs predicted marks', () => {
  const Q = new Map([[1, { subject: 'physics' }], [2, { subject: 'maths' }]]);
  const progress = [{ qid: 1, timeSpentSec: 3000 }, { qid: 2, timeSpentSec: 1000 }];
  const r = effort(progress, [], Q, { subjects: { physics: 20, chemistry: 40, maths: 40 } });
  const phy = r.subjects.find((s) => s.subject === 'physics');
  assert.equal(phy.timePct, 75);
  assert.equal(phy.marksPct, 20);
  assert.equal(effort([{ qid: 1, timeSpentSec: 60 }], [], Q, null), null);
});

test('free view hides the Pro parts', () => {
  const f = freeInsights({ studyNext: [1, 2, 3, 4, 5], guessing: { tagged: 3 }, tests: { count: 2 }, retention: { checked: 4, readyToCheck: 9 }, effort: { hours: 3 } });
  assert.equal(f.studyNext.length, 3);
  assert.equal(f.studyNextLocked, 2);
  assert.equal(f.guessing.locked, true);
  assert.equal(f.tests.locked, true);
  assert.equal(f.effort.locked, true);
});

test('week key is the Monday of the IST week', () => {
  assert.equal(weekKey(new Date('2026-09-30T10:00:00Z')), '2026-09-28'); // a Wednesday
  assert.equal(weekKey(new Date('2026-09-27T20:00:00Z')), '2026-09-28'); // Sunday night UTC = Monday IST
});

test('signals are validated', () => {
  const t = { questionIds: [5, 6], durationMin: 10 };
  assert.deepEqual(cleanConfidence(t, { 5: 'sure', 6: 'nope', 7: 'guess' }), { 5: 'sure' });
  assert.deepEqual(cleanVisits(t, [[5, 0, 30], [9, 0, 1], [6, -1, 3], [6, 30, 99999], 'x', [6, 30, 12.4]]), [[5, 0, 30], [6, 30, 12]]);
  assert.equal(cleanReason('concept'), 'concept');
  assert.equal(cleanReason('whatever'), null);
});
