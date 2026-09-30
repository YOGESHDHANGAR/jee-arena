import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, netPerAttempt, recommendations, EXAM_PACE_SEC } from '../src/lib/analysis.js';

test('chapter verdicts', () => {
  assert.equal(verdict({ attempted: 4, accuracy: 90, speedRatio: 1 }), null, 'too few to judge');
  assert.equal(verdict({ attempted: 10, accuracy: 85, speedRatio: 0.9 }), 'strong');
  assert.equal(verdict({ attempted: 10, accuracy: 85, speedRatio: null }), 'strong');
  assert.equal(verdict({ attempted: 10, accuracy: 80, speedRatio: 1.5 }), 'slow');
  assert.equal(verdict({ attempted: 10, accuracy: 30, speedRatio: 0.6 }), 'rushed');
  assert.equal(verdict({ attempted: 10, accuracy: 30, speedRatio: 1.1 }), 'weak');
  assert.equal(verdict({ attempted: 10, accuracy: 55, speedRatio: 1 }), 'improving');
});

test('net marks per attempt under +4/−1', () => {
  assert.equal(netPerAttempt(0.2), 0);
  assert.equal(netPerAttempt(1), 4);
  assert.equal(netPerAttempt(0.6), 2);
});

test('recommendations pick the most useful next steps', () => {
  const sub = { attempted: 30, avgSolveSec: 200, coverage: { notStarted: [{ slug: 'optics', chapter: 'Optics', count: 50, pyqCount: 12 }] } };
  const a = {
    examPaceSec: EXAM_PACE_SEC,
    overall: { attempted: 60 },
    mistakesOpen: 7,
    chapters: [
      { subject: 'physics', chapter: 'Laws of Motion', attempted: 8, accuracy: 25, speedRatio: 1.1, verdict: 'weak' },
      { subject: 'maths', chapter: 'Limits', attempted: 9, accuracy: 80, speedRatio: 1.6, verdict: 'slow' },
    ],
    subjects: { physics: sub, chemistry: { ...sub, avgSolveSec: 90, coverage: { notStarted: [] } }, maths: { ...sub, coverage: { notStarted: [] } } },
    difficulty: { easy: { attempted: 5, accuracy: 90 }, hard: { attempted: 10, accuracy: 40 } },
    tests: { questions: 60, accuracy: 50, marksLost: 20, wrongTimeSec: 1800, attemptRate: 90, recent: [{ id: 'abc' }] },
    consistency: { active14: 9 },
  };
  const r = recommendations(a);
  const ids = r.map((x) => x.id);
  assert.equal(ids[0], 'weak-chapter');
  assert.ok(ids.includes('revise-mistakes'));
  assert.ok(ids.includes('slow-chapter'));
  assert.ok(ids.includes('negative-marks'));
  assert.equal(r.find((x) => x.id === 'negative-marks').link, '/test/abc/result');
  assert.ok(r.length <= 6);
});

test('free view hides the Pro parts on the server', async () => {
  const { freeView } = await import('../src/lib/analysis.js');
  const s = (x = {}) => ({ attempted: 10, accuracy: 60, speedRatio: 1.4, othersAvgSec: 90, ...x });
  const full = {
    overall: s(),
    subjects: { physics: { ...s(), tests: { questions: 30, attemptRate: 80, accuracy: 50, marksLost: 12, avgTimeSec: 100, wrongTimeSec: 900, netPerAttempt: 1.5 } } },
    chapters: [{ ...s(), verdict: 'slow' }],
    topics: [{ accuracy: 20 }, { accuracy: 90 }],
    tests: { count: 3, questions: 30, attemptRate: 80, accuracy: 50, marksLost: 12, wrongTimeSec: 900, netPerAttempt: 1.5, recent: [] },
    actions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  };
  const f = freeView(full);
  assert.equal(f.pro, false);
  assert.equal(f.overall.speedRatio, null);
  assert.equal(f.chapters[0].verdict, null);
  assert.equal(f.chapters[0].speedRatio, null);
  assert.equal(f.chapters[0].accuracy, 60, 'accuracy stays free');
  assert.deepEqual(f.topics, []);
  assert.equal(f.topicsLocked, 1);
  assert.equal(f.tests.marksLost, undefined);
  assert.equal(f.tests.accuracy, 50);
  assert.equal(f.subjects.physics.tests.marksLost, undefined);
  assert.equal(f.actions.length, 2);
  assert.equal(f.actionsLocked, 2);
});
