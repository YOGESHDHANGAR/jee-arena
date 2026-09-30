import { col } from '../db.js';
import { SUBJECTS } from './util.js';
import { subjectChapters } from './chapters.js';
import { syllabusChapter } from './syllabus.js';
import { cachedAnalysis } from './analysis.js';
import { REASONS } from './signals.js';
// The marks → percentile → rank table lives with the web app (it also shows it on mock results).
import { estimatePercentile } from '../../../web/src/lib/percentile.js';

/**
 * "My journey": insights that help a student judge themselves, on top of the analysis (lib/analysis.js).
 *
 *  lostMarks   why marks were lost (concept / calculation / misread / guess / time), from the student's tags
 *  guessing    how often "sure", "50-50" and "guess" answers are right, and whether guessing pays under −1
 *  predicted   a likely JEE Main score today, with a range, percentile and rank (and a weekly trend)
 *  studyNext   chapters ordered by marks to gain: exam weightage × how far the student is from 80%
 *  pace        syllabus coverage now vs what's needed by the exam date
 *  tests       test strategy across recent tests: time on wrong answers, easy questions left, etc.
 *  retention   of questions solved in practice, how many are still right in a test a week or more later
 *  effort      time spent per subject vs marks it brings
 *
 * The college predictor runs in the browser from `predicted` (web/src/components/CollegePredictor.jsx).
 * Everything is computed from stored data on request and cached for a minute per student.
 */

const DAY = 864e5;
export const PAPER_PER_SUBJECT = 25; // JEE Main: 25 questions per subject
export const TARGET_ACC = 0.8; // "good enough" accuracy used for marks to gain
const COVER_MIN = 10; // a chapter counts as covered after this many questions solved (or a quarter of it)

/** Expected marks for one question at accuracy a (0..1) under +4/−1, skipping when a guess wouldn't pay. */
export const expectedMarks = (a) => Math.max(0, Math.min(4, 5 * a - 1));

const round = (n, d = 0) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------------------------------------------------------------------------------------------------
// Chapter weightage: how many of a subject's 25 questions a chapter gets, from how often it appears in
// past papers in the bank. Falls back to the number of questions when there are few PYQs.
export function chapterWeights(bankChapters) {
  const pyq = bankChapters.reduce((a, c) => a + (c.pyqCount || 0), 0);
  const all = bankChapters.reduce((a, c) => a + (c.count || 0), 0);
  const usePyq = pyq >= 50;
  return bankChapters.map((c) => ({
    ...c,
    expQ: round((PAPER_PER_SUBJECT * (usePyq ? c.pyqCount || 0 : c.count || 0)) / ((usePyq ? pyq : all) || 1), 2),
  }));
}

/**
 * Exam accuracy estimate for one chapter: practice first-try accuracy pulled toward the subject's
 * accuracy when there are few questions (so 2/2 isn't "100%"), times how much worse the student does
 * under test conditions. Unstarted chapters assume 15%.
 */
export function chapterExamAcc(ch, subjectAcc, examFactor) {
  if (!ch || !ch.attempted || ch.accuracy === null) return 0.15;
  const k = 5;
  const prior = subjectAcc ?? 0.3;
  const a = ((ch.accuracy / 100) * ch.attempted + prior * k) / (ch.attempted + k);
  return clamp(a * examFactor, 0, 1);
}

// ---------------------------------------------------------------------------------------------------

export async function studentInsights(userId) {
  const [a, user, progress, attempts, history] = await Promise.all([
    cachedAnalysis(userId),
    col('users').findOne({ _id: userId }, { projection: { examDate: 1, targetYear: 1, homeState: 1, femaleSeats: 1 } }),
    col('progress')
      .find({ userId }, { projection: { _id: 0, qid: 1, status: 1, attempts: 1, revealed: 1, reason: 1, solvedAt: 1, timeSpentSec: 1, updatedAt: 1, subject: 1 } })
      .toArray(),
    col('testAttempts')
      .find(
        { userId, submittedAt: { $exists: true } },
        { projection: { _id: 0, testId: 1, perQuestion: 1, reasons: 1, visits: 1, score: 1, maxScore: 1, bySubject: 1, submittedAt: 1, timeTakenSec: 1 } },
      )
      .sort({ submittedAt: -1 })
      .limit(30)
      .toArray(),
    col('predictions').find({ userId }, { projection: { _id: 0, week: 1, score: 1 } }).sort({ week: -1 }).limit(12).toArray(),
  ]);

  const qids = new Set(progress.map((p) => p.qid));
  for (const t of attempts) for (const p of t.perQuestion || []) qids.add(p.qid);
  const [questions, tests, bank] = await Promise.all([
    col('questions').find({ qid: { $in: [...qids] } }, { projection: { _id: 0, qid: 1, subject: 1, chapterId: 1, difficulty: 1 } }).toArray(),
    col('tests').find({ _id: { $in: attempts.map((t) => t.testId) } }, { projection: { title: 1, kind: 1, scheme: 1, questionIds: 1, durationMin: 1 } }).toArray(),
    Promise.all(SUBJECTS.map(async (s) => [s, chapterWeights((await subjectChapters(s)).filter((c) => c.count))])).then(Object.fromEntries),
  ]);
  const Q = new Map(questions.map((q) => [q.qid, q]));
  const T = new Map(tests.map((t) => [String(t._id), t]));
  const chapterOf = (qid) => {
    const q = Q.get(qid);
    const std = q && syllabusChapter(q.subject, q.chapterId);
    return q ? { subject: q.subject, slug: std?.id || null, chapter: std?.name || null } : null;
  };

  const out = {
    lostMarks: lostMarks(progress, attempts, T, chapterOf),
    guessing: guessing(attempts),
  };
  const model = predictScore(a, bank, attempts, T);
  out.predicted = model;
  out.studyNext = studyNext(a, bank, model?.examFactor ?? 0.85);
  out.pace = syllabusPace(progress, Q, bank, user);
  out.tests = testStrategy(attempts, T, Q);
  out.retention = retention(progress, attempts, chapterOf);
  out.effort = effort(progress, attempts, Q, model);
  out.settings = { examDate: out.pace.examDate, examDateIsDefault: !user?.examDate, homeState: user?.homeState || null, femaleSeats: !!user?.femaleSeats };

  // Weekly snapshot of the prediction, so students see the trend over time.
  if (model?.score !== null && model?.score !== undefined) {
    const week = weekKey();
    await col('predictions')
      .updateOne({ _id: `${userId}|${week}` }, { $set: { userId, week, score: model.score, at: new Date() } }, { upsert: true })
      .catch(() => {});
    const h = history.filter((x) => x.week !== week);
    out.predicted.history = [...h.reverse(), { week, score: model.score }].slice(-12);
  }
  return out;
}

const insightsCache = new Map();
export async function cachedInsights(userId) {
  const key = String(userId);
  const hit = insightsCache.get(key);
  if (hit && hit.at > Date.now() - 60 * 1000) return hit.data;
  const data = await studentInsights(userId);
  if (insightsCache.size > 500) insightsCache.clear();
  insightsCache.set(key, { at: Date.now(), data });
  return data;
}
export const forgetInsights = (userId) => insightsCache.delete(String(userId));

/** Monday of this week (IST), YYYY-MM-DD. */
export function weekKey(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 36e5);
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(ist.getTime() - dow * DAY).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------
// 1. Why did I lose marks?

/** Whole-number percentages that always add up to 100 (largest remainder). */
export function percentShares(weights, total) {
  const keys = Object.keys(weights);
  if (!total) return Object.fromEntries(keys.map((k) => [k, 0]));
  const raw = keys.map((k) => [k, (100 * weights[k]) / total]);
  const out = Object.fromEntries(raw.map(([k, v]) => [k, Math.floor(v)]));
  let left = 100 - Object.values(out).reduce((a, b) => a + b, 0);
  for (const [k] of [...raw].sort((x, y) => (y[1] % 1) - (x[1] % 1))) {
    if (left <= 0) break;
    out[k]++;
    left--;
  }
  return out;
}

export function lostMarks(progress, attempts, T, chapterOf) {
  const zero = () => Object.fromEntries([...REASONS, 'untagged'].map((r) => [r, { n: 0, marks: 0 }]));
  const tests = zero();
  let testMarks = 0;
  const toTag = [];
  for (const at of attempts) {
    const t = T.get(String(at.testId));
    for (const p of at.perQuestion || []) {
      if (p.status === 'correct') continue;
      const lost = (p.max ?? 4) - (p.marks || 0); // distance from full marks: 5 for a wrong MCQ, 4 for a blank
      if (lost <= 0) continue;
      const r = at.reasons?.[p.qid] || 'untagged';
      tests[r].n++;
      tests[r].marks += lost;
      testMarks += lost;
      if (r === 'untagged' && toTag.length < 8 && t) {
        toTag.push({ kind: 'test', testId: String(at.testId), testTitle: t.title, qid: p.qid, status: p.status, ...chapterOf(p.qid) });
      }
    }
  }
  const practice = zero();
  const recentWrong = [];
  for (const p of progress) {
    const missed = p.status !== 'solved' || (p.attempts || 0) > 1 || p.revealed;
    if (!missed || !((p.attempts || 0) > 0 || p.revealed)) continue;
    const r = p.reason || 'untagged';
    practice[r].n++;
    if (r === 'untagged') recentWrong.push(p);
  }
  recentWrong.sort((x, y) => (y.updatedAt?.getTime?.() || 0) - (x.updatedAt?.getTime?.() || 0));
  for (const p of recentWrong.slice(0, Math.max(0, 8 - toTag.length))) toTag.push({ kind: 'practice', qid: p.qid, status: p.status, ...chapterOf(p.qid) });

  // One share across both: a practice mistake counts like a wrong test answer (5 marks).
  const weight = Object.fromEntries(REASONS.map((r) => [r, tests[r].marks + practice[r].n * 5]));
  const tagged = REASONS.reduce((s, r) => s + weight[r], 0);
  const share = percentShares(weight, tagged);
  const top = tagged ? REASONS.reduce((best, r) => (weight[r] > weight[best] ? r : best), REASONS[0]) : null;
  const testsCount = attempts.length;
  const silly = tests.calculation.marks + tests.misread.marks;
  const taggedCount = REASONS.reduce((s, r) => s + tests[r].n + practice[r].n, 0);
  return {
    tests,
    practice,
    share,
    top,
    taggedCount,
    untaggedCount: tests.untagged.n + practice.untagged.n,
    testMarksLost: testMarks,
    sillyPerTest: testsCount ? round(silly / testsCount, 1) : null,
    toTag,
  };
}

// ---------------------------------------------------------------------------------------------------
// 2. Should I guess? Under +4/−1 an answer pays on average only if it's right more than 20% of the time.

export const BREAK_EVEN = 0.2;
export function guessing(attempts) {
  const lv = () => ({ attempted: 0, correct: 0, net: 0 });
  const by = { sure: lv(), maybe: lv(), guess: lv() };
  let untagged = 0;
  const testsWith = new Set();
  for (const at of attempts) {
    for (const p of at.perQuestion || []) {
      if (p.status === 'unattempted') continue;
      if (!p.conf || !by[p.conf]) {
        untagged++;
        continue;
      }
      testsWith.add(String(at.testId));
      const b = by[p.conf];
      b.attempted++;
      if (p.status === 'correct') b.correct++;
      b.net += p.marks || 0;
    }
  }
  const n = testsWith.size || 1;
  const levels = Object.fromEntries(
    Object.entries(by).map(([k, b]) => {
      const acc = b.attempted ? b.correct / b.attempted : null;
      let verdict = null;
      if (b.attempted >= 5) verdict = acc > BREAK_EVEN + 0.05 ? 'keep' : acc < BREAK_EVEN - 0.02 ? 'skip' : 'even';
      return [k, { ...b, accuracy: acc === null ? null : Math.round(acc * 100), netPerAnswer: b.attempted ? round(b.net / b.attempted, 2) : null, verdict, perTest: round(b.net / n, 1) }];
    }),
  );
  // Marks per test the student would gain by leaving out answers of a level that loses marks.
  const gainIfSkipped = (k) => (levels[k].net < 0 ? round(-levels[k].net / n, 1) : 0);
  return {
    levels,
    tagged: by.sure.attempted + by.maybe.attempted + by.guess.attempted,
    untagged,
    testsWithTags: testsWith.size,
    breakEvenPct: BREAK_EVEN * 100,
    gainSkipGuesses: gainIfSkipped('guess'),
    gainSkipMaybes: gainIfSkipped('maybe'),
  };
}

// ---------------------------------------------------------------------------------------------------
// 3. Predicted JEE Main score today

const isFullMain = (at, t) => t?.scheme === 'jee_main' && at.maxScore === 300 && (t.questionIds?.length || 0) === 75;

export function predictScore(a, bank, attempts, T) {
  const practiced = a.overall.attempted || 0;
  const mocks = attempts.filter((at) => isFullMain(at, T.get(String(at.testId))) && at.submittedAt > new Date(Date.now() - 60 * DAY)).slice(0, 3);
  if (practiced < 20 && !mocks.length) return { score: null, need: 20 - practiced };

  // How much worse (or better) the student does in timed tests than in untimed practice.
  const pAcc = a.overall.accuracy;
  const tAcc = a.tests?.accuracy;
  const examFactor = pAcc && tAcc && a.tests.questions >= 20 ? clamp(tAcc / pAcc, 0.6, 1.1) : 0.85;

  const chapters = new Map(a.chapters.map((c) => [`${c.subject}|${c.slug}`, c]));
  const subjects = {};
  let modelTotal = 0;
  for (const s of SUBJECTS) {
    const subjAcc = a.subjects[s]?.accuracy !== null && a.subjects[s]?.accuracy !== undefined ? a.subjects[s].accuracy / 100 : null;
    let m = 0;
    for (const c of bank[s] || []) m += c.expQ * expectedMarks(chapterExamAcc(chapters.get(`${s}|${c.slug}`), subjAcc, examFactor));
    subjects[s] = clamp(m, 0, 100);
    modelTotal += subjects[s];
  }

  const mockScores = mocks.map((m) => m.score);
  const mockAvg = mockScores.length ? mockScores.reduce((x, y) => x + y, 0) / mockScores.length : null;
  const w = mockScores.length >= 3 ? 0.75 : mockScores.length ? 0.6 : 0;
  const score = clamp(Math.round(w * (mockAvg ?? 0) + (1 - w) * modelTotal), 0, 300);

  // Uncertainty: wider with little data; with mocks, how much the mock scores vary.
  const sd = mockScores.length >= 2 ? Math.sqrt(mockScores.reduce((s, x) => s + (x - mockAvg) ** 2, 0) / (mockScores.length - 1)) : null;
  const half = mockScores.length ? Math.max(10, Math.round((sd ?? 15) + 8)) : practiced < 100 ? 30 : practiced < 400 ? 22 : 16;
  const low = clamp(score - half, 0, 300);
  const high = clamp(score + half, 0, 300);
  const conf = mockScores.length >= 2 && practiced >= 300 ? 'high' : practiced < 60 && !mockScores.length ? 'low' : 'medium';

  // Subject split: the model's split, scaled to the blended total.
  const scale = modelTotal > 0 ? score / modelTotal : 0;
  const pr = (x) => {
    const e = estimatePercentile(x);
    return e ? { percentile: round(e.percentile, 3), rank: e.rank } : null;
  };
  return {
    score,
    low,
    high,
    confidence: conf,
    examFactor: round(examFactor, 2),
    fromMocks: mockScores.length ? { count: mockScores.length, average: Math.round(mockAvg) } : null,
    model: Math.round(modelTotal),
    subjects: Object.fromEntries(SUBJECTS.map((s) => [s, Math.round(subjects[s] * scale)])),
    percentile: pr(score),
    // A higher score is a better (smaller) rank: the range's best rank comes from `high`.
    best: pr(high),
    worst: pr(low),
  };
}

// ---------------------------------------------------------------------------------------------------
// 4. What to study next, by marks

export function studyNext(a, bank, examFactor = 0.85) {
  const chapters = new Map(a.chapters.map((c) => [`${c.subject}|${c.slug}`, c]));
  const rows = [];
  for (const s of SUBJECTS) {
    const subjAcc = a.subjects[s]?.accuracy !== null && a.subjects[s]?.accuracy !== undefined ? a.subjects[s].accuracy / 100 : null;
    for (const c of bank[s] || []) {
      if (!c.expQ || c.expQ < 0.2) continue;
      const mine = chapters.get(`${s}|${c.slug}`);
      const acc = chapterExamAcc(mine, subjAcc, examFactor);
      const now = c.expQ * expectedMarks(acc);
      const gain = c.expQ * expectedMarks(TARGET_ACC) - now;
      if (gain < 0.3) continue;
      rows.push({
        subject: s,
        slug: c.slug,
        chapter: c.chapter,
        questionsPerPaper: round(c.expQ, 1),
        marksNow: round(now, 1),
        gain: round(gain, 1),
        accuracy: mine?.accuracy ?? null,
        attempted: mine?.attempted || 0,
        state: !mine?.attempted ? 'not-started' : mine.verdict || 'few',
      });
    }
  }
  return rows.sort((x, y) => y.gain - x.gain).slice(0, 12);
}

// ---------------------------------------------------------------------------------------------------
// 5. Syllabus pace against the exam date

/** JEE Main session 1 is in the last week of January; used when the student hasn't set a date. */
export function defaultExamDate(targetYear, now = new Date()) {
  const y = now.getUTCFullYear();
  let year = Number(targetYear) || (now < new Date(Date.UTC(y, 0, 22)) ? y : y + 1);
  if (new Date(Date.UTC(year, 0, 22)) < now) year = y + 1;
  return `${year}-01-22`;
}

export function syllabusPace(progress, Q, bank, user, now = new Date()) {
  const examDate = user?.examDate || defaultExamDate(user?.targetYear, now);
  const exam = new Date(`${examDate}T09:00:00+05:30`);
  // When each chapter reached "covered": the Nth solve in it.
  const solvesByChapter = new Map();
  for (const p of progress) {
    if (p.status !== 'solved' || !p.solvedAt) continue;
    const q = Q.get(p.qid);
    const std = q && syllabusChapter(q.subject, q.chapterId);
    if (!std) continue;
    const k = `${q.subject}|${std.id}`;
    (solvesByChapter.get(k) || solvesByChapter.set(k, []).get(k)).push(p.solvedAt.getTime());
  }
  const all = SUBJECTS.flatMap((s) => (bank[s] || []).map((c) => ({ ...c, subject: s })));
  const coveredAt = [];
  const bySubject = Object.fromEntries(SUBJECTS.map((s) => [s, { total: (bank[s] || []).length, covered: 0 }]));
  for (const c of all) {
    const need = Math.max(3, Math.min(COVER_MIN, Math.ceil((c.count || 0) * 0.25)));
    const times = (solvesByChapter.get(`${c.subject}|${c.slug}`) || []).sort((x, y) => x - y);
    if (times.length >= need) {
      coveredAt.push(times[need - 1]);
      bySubject[c.subject].covered++;
    }
  }
  const total = all.length;
  const covered = coveredAt.length;
  const in4w = coveredAt.filter((t) => t > now.getTime() - 28 * DAY).length;
  const in8w = coveredAt.filter((t) => t > now.getTime() - 56 * DAY).length;
  const perWeek = in4w ? in4w / 4 : in8w / 8;
  const weeksLeft = (exam.getTime() - now.getTime()) / (7 * DAY);
  const remaining = total - covered;
  const base = { examDate, total, covered, coveredPct: pct(covered, total), perWeek: round(perWeek, 1), bySubject, weeksLeft: round(weeksLeft, 1) };
  if (weeksLeft <= 0) return { ...base, status: 'passed' };
  // Keep the last ~20% of the time (at most 4 weeks) for revision and mocks.
  const revisionWeeks = Math.min(4, weeksLeft * 0.2);
  const studyWeeks = Math.max(0.5, weeksLeft - revisionWeeks);
  const needPerWeek = remaining / studyWeeks;
  const projected = Math.min(total, Math.round(covered + perWeek * weeksLeft));
  const finishInWeeks = perWeek > 0 ? remaining / perWeek : null;
  let status = 'on-track';
  if (!remaining) status = 'done';
  else if (perWeek === 0) status = 'not-started';
  else if (perWeek >= needPerWeek * 1.15) status = 'ahead';
  else if (perWeek < needPerWeek * 0.9) status = 'behind';
  return {
    ...base,
    status,
    remaining,
    needPerWeek: round(needPerWeek, 1),
    revisionWeeks: round(revisionWeeks, 1),
    projected,
    projectedPct: pct(projected, total),
    finishDate: finishInWeeks !== null ? new Date(now.getTime() + finishInWeeks * 7 * DAY).toISOString().slice(0, 10) : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// 6. Test strategy replay: one test (for the result page) and across recent tests (for insights)

/** How the student moved through one paper. Needs `visits` (recorded since this feature) or `times`. */
export function testReplay(attempt, paper, t) {
  const pq = new Map((attempt.perQuestion || []).map((p) => [p.qid, p]));
  const idx = new Map(paper.map((q, i) => [q.qid, i]));
  const visits = (attempt.visits || []).filter((v) => idx.has(v[0]));
  const timeOf = (qid) => pq.get(qid)?.timeSec ?? (attempt.times || {})[qid] ?? null;
  const haveTimes = paper.some((q) => Number.isFinite(timeOf(q.qid)));
  if (!visits.length && !haveTimes) return null;

  const status = (qid) => pq.get(qid)?.status || 'unattempted';
  const secs = (qid) => (Number.isFinite(timeOf(qid)) ? timeOf(qid) : 0);
  const sum = (arr) => arr.reduce((s, q) => s + secs(q.qid), 0);
  const wrong = paper.filter((q) => status(q.qid) === 'wrong');
  const blankSeen = paper.filter((q) => status(q.qid) === 'unattempted' && secs(q.qid) >= 20);
  const neverSeen = visits.length ? paper.filter((q) => !visits.some((v) => v[0] === q.qid)) : [];
  const easyLeft = paper.filter((q) => status(q.qid) === 'unattempted' && q.difficulty === 'easy');
  // "Stuck": well over exam pace (2 min 24 s) and still not right.
  const stuck = paper
    .filter((q) => secs(q.qid) >= 240 && status(q.qid) !== 'correct')
    .sort((x, y) => secs(y.qid) - secs(x.qid))
    .slice(0, 5)
    .map((q) => ({ n: idx.get(q.qid) + 1, qid: q.qid, secs: secs(q.qid), status: status(q.qid), subject: q.subject }));

  // Order: the sequence of first visits, grouped into runs by subject ("Maths → Physics → Chemistry").
  const firstSeen = [];
  const seen = new Set();
  for (const v of visits) if (!seen.has(v[0])) seen.add(v[0]), firstSeen.push(v[0]);
  const subjectOrder = [];
  for (const qid of firstSeen) {
    const s = paper[idx.get(qid)].subject;
    if (subjectOrder[subjectOrder.length - 1] !== s) subjectOrder.push(s);
  }
  const visitCount = new Map();
  for (const v of visits) visitCount.set(v[0], (visitCount.get(v[0]) || 0) + 1);
  const revisited = [...visitCount.values()].filter((n) => n > 1).length;

  // Timeline for the chart: merged runs on the same question, capped for the response size.
  const timeline = [];
  for (const [qid, start, s] of visits) {
    const last = timeline[timeline.length - 1];
    if (last && last.qid === qid && Math.abs(last.start + last.secs - start) <= 2) last.secs += s;
    else timeline.push({ qid, n: idx.get(qid) + 1, start, secs: s, subject: paper[idx.get(qid)].subject, status: status(qid) });
  }
  const duration = (t?.durationMin || 180) * 60;
  // How many questions were first opened in each quarter of the time: shows a slow start or a rush at the end.
  const quarters = [0, 0, 0, 0];
  const firstStart = new Map();
  for (const v of visits) if (!firstStart.has(v[0])) firstStart.set(v[0], v[1]);
  for (const s of firstStart.values()) quarters[Math.min(3, Math.floor((4 * s) / duration))]++;

  return {
    hasOrder: visits.length > 0,
    duration,
    wrongMinutes: round(sum(wrong) / 60, 1),
    wrongCount: wrong.length,
    blankSeenMinutes: round(sum(blankSeen) / 60, 1),
    blankSeenCount: blankSeen.length,
    neverSeen: neverSeen.length,
    easyLeft: easyLeft.map((q) => idx.get(q.qid) + 1),
    stuck,
    subjectOrder,
    revisited,
    quarters,
    timeline: timeline.length <= 400 ? timeline : null,
  };
}

export function testStrategy(attempts, T, Q) {
  const rows = [];
  for (const at of attempts.slice(0, 10)) {
    const t = T.get(String(at.testId));
    if (!t || !(at.perQuestion || []).length) continue;
    const paper = at.perQuestion.map((p) => ({ qid: p.qid, subject: Q.get(p.qid)?.subject, difficulty: Q.get(p.qid)?.difficulty }));
    const r = testReplay(at, paper, t);
    if (!r) continue;
    rows.push({ testId: String(at.testId), title: t.title, at: at.submittedAt, ...r, timeline: undefined });
  }
  if (!rows.length) return null;
  const avg = (f) => round(rows.reduce((s, r) => s + f(r), 0) / rows.length, 1);
  return {
    count: rows.length,
    wrongMinutes: avg((r) => r.wrongMinutes),
    blankSeenMinutes: avg((r) => r.blankSeenMinutes),
    easyLeft: avg((r) => r.easyLeft.length),
    neverSeen: avg((r) => r.neverSeen),
    stuck: avg((r) => r.stuck.length),
    recent: rows.slice(0, 5).map((r) => ({ testId: r.testId, title: r.title, at: r.at, wrongMinutes: r.wrongMinutes, easyLeft: r.easyLeft.length, stuck: r.stuck.length })),
  };
}

// ---------------------------------------------------------------------------------------------------
// 7. Retention: questions solved in practice, seen again in a test at least a week later

const RETENTION_GAP = 7 * DAY;
export function retention(progress, attempts, chapterOf) {
  const solvedAt = new Map(progress.filter((p) => p.status === 'solved' && p.solvedAt).map((p) => [p.qid, p.solvedAt.getTime()]));
  const byChapter = new Map();
  let checked = 0;
  let kept = 0;
  const seen = new Set();
  for (const at of [...attempts].reverse()) {
    for (const p of at.perQuestion || []) {
      const t0 = solvedAt.get(p.qid);
      if (!t0 || seen.has(p.qid) || at.submittedAt.getTime() - t0 < RETENTION_GAP) continue;
      seen.add(p.qid); // first time it came back counts
      checked++;
      const ok = p.status === 'correct';
      if (ok) kept++;
      const c = chapterOf(p.qid);
      if (!c?.slug) continue;
      const k = `${c.subject}|${c.slug}`;
      const b = byChapter.get(k) || byChapter.set(k, { ...c, checked: 0, kept: 0 }).get(k);
      b.checked++;
      if (ok) b.kept++;
    }
  }
  const ready = progress.filter((p) => p.status === 'solved' && p.solvedAt && p.solvedAt.getTime() < Date.now() - 14 * DAY).length;
  return {
    checked,
    kept,
    pct: pct(kept, checked),
    chapters: [...byChapter.values()]
      .filter((c) => c.checked >= 3)
      .map((c) => ({ ...c, pct: pct(c.kept, c.checked) }))
      .sort((x, y) => x.pct - y.pct)
      .slice(0, 8),
    readyToCheck: ready,
  };
}

// ---------------------------------------------------------------------------------------------------
// 8. Effort against result

export function effort(progress, attempts, Q, model) {
  const secs = Object.fromEntries(SUBJECTS.map((s) => [s, 0]));
  for (const p of progress) {
    const s = Q.get(p.qid)?.subject || p.subject;
    if (secs[s] !== undefined) secs[s] += Math.min(3600, p.timeSpentSec || 0);
  }
  for (const at of attempts) {
    for (const p of at.perQuestion || []) {
      const s = Q.get(p.qid)?.subject;
      if (secs[s] !== undefined && Number.isFinite(p.timeSec)) secs[s] += p.timeSec;
    }
  }
  const total = SUBJECTS.reduce((a, s) => a + secs[s], 0);
  if (total < 3600) return null; // under an hour in all: nothing to compare yet
  const marks = model?.subjects || null;
  const marksTotal = marks ? SUBJECTS.reduce((a, s) => a + (marks[s] || 0), 0) : 0;
  return {
    hours: round(total / 3600, 1),
    subjects: SUBJECTS.map((s) => ({
      subject: s,
      hours: round(secs[s] / 3600, 1),
      timePct: pct(secs[s], total),
      marks: marks ? marks[s] : null,
      marksPct: marksTotal ? pct(marks[s], marksTotal) : null,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------
// What a free student sees. Free: predicted score + college predictor, why marks were lost, syllabus pace,
// top 3 chapters to study. Pro: the rest (guessing, test strategy, retention, effort, the full list).

export const FREE_STUDY_NEXT = 3;
export function freeInsights(x) {
  return {
    ...x,
    pro: false,
    studyNext: x.studyNext.slice(0, FREE_STUDY_NEXT),
    studyNextLocked: Math.max(0, x.studyNext.length - FREE_STUDY_NEXT),
    guessing: x.guessing.tagged ? { locked: true, tagged: x.guessing.tagged } : x.guessing,
    tests: x.tests ? { locked: true, count: x.tests.count } : null,
    retention: x.retention.checked ? { locked: true, checked: x.retention.checked, readyToCheck: x.retention.readyToCheck } : x.retention,
    effort: x.effort ? { locked: true } : null,
  };
}
