import { col } from '../db.js';
import { dayKey, SUBJECTS } from './util.js';
import { subjectChapters } from './chapters.js';
import { isNarrowerName, syllabusChapter } from './syllabus.js';

/**
 * A student's performance analysis: where they're strong or weak, how fast they are compared with other
 * students and with the exam's pace, how they do under test conditions, and what to do next.
 *
 * Data used (nothing new is stored):
 *   progress      one row per question the student practised: attempts, solved?, revealed?, solve time
 *   questions     subject / chapter / topic / difficulty / type, and every student's average solve time
 *   testAttempts  per-question results and seconds from contests, mocks and custom tests
 *   activity      which days they practised
 */

// JEE Main: 180 minutes for 75 questions (60 minutes per subject for 25) = 144 s per question.
export const EXAM_PACE_SEC = 144;
export const MIN_FOR_VERDICT = 5; // questions tried in a chapter before we call it strong or weak

const DAY = 864e5;
const sane = (s) => Number.isFinite(s) && s >= 5 && s <= 1800; // drop "left the tab open" outliers

function bucket() {
  return { attempted: 0, solved: 0, firstTry: 0, gaveUp: 0, wrongTries: 0, timeSum: 0, timeN: 0, ownSum: 0, benchSum: 0, pairs: 0 };
}

function add(b, r) {
  b.attempted++;
  if (r.solved) b.solved++;
  if (r.firstTry) b.firstTry++;
  if (r.gaveUp) b.gaveUp++;
  b.wrongTries += r.wrongTries;
  if (r.solveTime !== null) {
    b.timeSum += r.solveTime;
    b.timeN++;
    if (r.bench !== null) {
      b.ownSum += r.solveTime;
      b.benchSum += r.bench;
      b.pairs++;
    }
  }
}

/** The numbers shown for any group of questions. */
function summarise(b) {
  return {
    attempted: b.attempted,
    solved: b.solved,
    gaveUp: b.gaveUp,
    // First-try accuracy: solved on the first submission without looking at the solution — closest to exam conditions.
    accuracy: b.attempted ? Math.round((100 * b.firstTry) / b.attempted) : null,
    solveRate: b.attempted ? Math.round((100 * b.solved) / b.attempted) : null,
    avgSolveSec: b.timeN ? Math.round(b.timeSum / b.timeN) : null,
    // >1 = slower than the average student on the same questions, <1 = faster. Needs 3 comparable solves.
    speedRatio: b.pairs >= 3 ? Math.round((100 * b.ownSum) / b.benchSum) / 100 : null,
    othersAvgSec: b.pairs >= 3 ? Math.round(b.benchSum / b.pairs) : null,
  };
}

/**
 * strong    accurate and at least average speed
 * slow      accurate but clearly slower than others → speed practice
 * rushed    fast but inaccurate → careless mistakes, slow down
 * weak      inaccurate → concepts need work
 * improving in between
 */
export function verdict(s) {
  if (s.attempted < MIN_FOR_VERDICT || s.accuracy === null) return null;
  const a = s.accuracy;
  const r = s.speedRatio;
  if (a >= 70) return r !== null && r > 1.3 ? 'slow' : 'strong';
  if (a < 45) return r !== null && r < 0.8 ? 'rushed' : 'weak';
  return 'improving';
}

/** Net marks per attempt under +4/−1 at a given accuracy (0..1): 4a − (1 − a). Positive above 20%. */
export const netPerAttempt = (acc) => Math.round((5 * acc - 1) * 100) / 100;

export async function studentAnalysis(userId) {
  const since8w = new Date(Date.now() - 8 * 7 * DAY);
  const [progress, attempts, activity] = await Promise.all([
    col('progress')
      .find({ userId }, { projection: { _id: 0, qid: 1, status: 1, attempts: 1, revealed: 1, solveTimeSec: 1, solvedAt: 1 } })
      .toArray(),
    col('testAttempts')
      .find({ userId, submittedAt: { $exists: true } }, { projection: { _id: 0, testId: 1, perQuestion: 1, score: 1, maxScore: 1, submittedAt: 1, timeTakenSec: 1 } })
      .sort({ submittedAt: -1 })
      .limit(60)
      .toArray(),
    col('activity').find({ userId, day: { $gte: dayKey(since8w) } }, { projection: { _id: 0, day: 1, count: 1 } }).toArray(),
  ]);

  const qids = new Set(progress.map((p) => p.qid));
  for (const a of attempts) for (const p of a.perQuestion || []) qids.add(p.qid);
  const [questions, tests] = await Promise.all([
    col('questions')
      .find({ qid: { $in: [...qids] } }, { projection: { _id: 0, qid: 1, subject: 1, chapter: 1, chapterId: 1, topic: 1, difficulty: 1, type: 1, 'stats.timeSum': 1, 'stats.timeCount': 1 } })
      .toArray(),
    col('tests').find({ _id: { $in: attempts.map((a) => a.testId) } }, { projection: { title: 1, kind: 1, scheme: 1 } }).toArray(),
  ]);
  const Q = new Map(questions.map((q) => [q.qid, q]));
  const T = new Map(tests.map((t) => [String(t._id), t]));

  // Chapters are the standard JEE chapters (lib/syllabus.js) stored on each question as chapterId, so
  // spellings from different sources and topic-level names ("Rain Problem") count as one chapter.
  const bank = Object.fromEntries(await Promise.all(SUBJECTS.map(async (s) => [s, (await subjectChapters(s)).filter((c) => c.count)])));
  // A source's chapter name narrower than the standard chapter works as a topic ("Rain Problem" in Kinematics).
  const topicOf = (q, std) => q.topic || (q.chapter && std && isNarrowerName(q.chapter, std.name) ? q.chapter : null);

  // ---- practice ------------------------------------------------------------------------------
  const groups = { overall: bucket(), subject: {}, chapter: {}, topic: {}, difficulty: {}, type: {}, subjectDifficulty: {} };
  const get = (m, k) => (m[k] ||= bucket());
  let mistakesOpen = 0;
  for (const p of progress) {
    const q = Q.get(p.qid);
    if (!q) continue;
    const tried = (p.attempts || 0) > 0 || p.revealed;
    if (!tried) continue;
    const solved = p.status === 'solved';
    if (!solved) mistakesOpen++;
    const bench = q.stats?.timeCount >= 3 ? q.stats.timeSum / q.stats.timeCount : null;
    const r = {
      solved,
      firstTry: solved && p.attempts === 1 && !p.revealed,
      gaveUp: !!p.revealed && !solved,
      wrongTries: Math.max(0, (p.attempts || 0) - (solved ? 1 : 0)),
      solveTime: solved && sane(p.solveTimeSec) ? p.solveTimeSec : null,
      bench: bench !== null && sane(bench) ? bench : null,
    };
    const std = syllabusChapter(q.subject, q.chapterId);
    add(groups.overall, r);
    add(get(groups.subject, q.subject), r);
    if (std) {
      add(get(groups.chapter, `${q.subject}|${std.id}`), r);
      const topic = topicOf(q, std);
      if (topic) add(get(groups.topic, `${q.subject}|${std.id}|${topic}`), r);
    }
    add(get(groups.difficulty, q.difficulty || 'medium'), r);
    add(get(groups.type, q.type), r);
    add(get(groups.subjectDifficulty, `${q.subject}|${q.difficulty || 'medium'}`), r);
  }

  const chapters = Object.entries(groups.chapter).map(([k, b]) => {
    const [subject, slug] = k.split('|');
    const std = syllabusChapter(subject, slug);
    const s = summarise(b);
    return { subject, slug, chapter: std.name, unit: std.unit, ...s, verdict: verdict(s) };
  });
  const topics = Object.entries(groups.topic)
    .map(([k, b]) => {
      const [subject, slug, topic] = k.split('|');
      const s = summarise(b);
      return { subject, slug, topic, ...s, verdict: verdict(s) };
    })
    .filter((t) => t.attempted >= 3);

  // ---- tests (exam conditions) -------------------------------------------------------------------
  const tBucket = () => ({ questions: 0, attempted: 0, correct: 0, partial: 0, wrong: 0, skipped: 0, marksLost: 0, marks: 0, timeSum: 0, timeN: 0, wrongTime: 0 });
  const testTotals = tBucket();
  const testBySubject = {};
  const recentTests = [];
  for (const a of attempts) {
    const t = T.get(String(a.testId));
    let att = 0;
    let cor = 0;
    for (const p of a.perQuestion || []) {
      const q = Q.get(p.qid);
      const subject = q?.subject || 'other';
      for (const b of [testTotals, (testBySubject[subject] ||= tBucket())]) {
        b.questions++;
        b.marks += p.marks || 0;
        if (p.status === 'unattempted') b.skipped++;
        else {
          b.attempted++;
          if (p.status === 'correct') b.correct++;
          else if (p.status === 'partial') b.partial++;
          else b.wrong++;
        }
        if (p.marks < 0) b.marksLost += -p.marks;
        if (Number.isFinite(p.timeSec)) {
          b.timeSum += p.timeSec;
          b.timeN++;
          if (p.status === 'wrong') b.wrongTime += p.timeSec;
        }
      }
      if (p.status !== 'unattempted') att++;
      if (p.status === 'correct') cor++;
    }
    if (recentTests.length < 12) {
      recentTests.push({
        id: String(a.testId),
        title: t?.title || 'Test',
        kind: t?.kind || 'practice',
        at: a.submittedAt,
        score: a.score,
        maxScore: a.maxScore,
        percent: a.maxScore ? Math.round((100 * a.score) / a.maxScore) : null,
        accuracy: att ? Math.round((100 * cor) / att) : null,
        attemptRate: a.perQuestion?.length ? Math.round((100 * att) / a.perQuestion.length) : null,
      });
    }
  }
  const tSummary = (b) => ({
    questions: b.questions,
    attemptRate: b.questions ? Math.round((100 * b.attempted) / b.questions) : null,
    accuracy: b.attempted ? Math.round((100 * b.correct) / b.attempted) : null,
    marksLost: b.marksLost,
    avgTimeSec: b.timeN ? Math.round(b.timeSum / b.timeN) : null,
    wrongTimeSec: b.wrongTime,
    netPerAttempt: b.attempted ? netPerAttempt(b.correct / b.attempted) : null,
  });

  // ---- consistency & trend -----------------------------------------------------------------------
  const today = dayKey();
  const activeDays = new Set(activity.filter((a) => a.count > 0).map((a) => a.day));
  const daysAgo = (n) => dayKey(new Date(Date.now() - n * DAY));
  const active30 = [...activeDays].filter((d) => d >= daysAgo(29)).length;
  const active14 = [...activeDays].filter((d) => d >= daysAgo(13)).length;
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = Date.now() - (7 - i) * 7 * DAY;
    const start = end - 7 * DAY;
    const from = dayKey(new Date(start + DAY));
    const to = dayKey(new Date(end));
    return {
      day: to, // BarChart labels by `day`
      label: from,
      solved: progress.filter((p) => p.solvedAt && p.solvedAt.getTime() > start && p.solvedAt.getTime() <= end).length,
      activeDays: [...activeDays].filter((d) => d >= from && d <= to).length,
    };
  });

  // ---- coverage ------------------------------------------------------------------------------------
  const triedSlugs = new Set(chapters.map((c) => `${c.subject}|${c.slug}`));
  const coverage = Object.fromEntries(
    SUBJECTS.map((s) => {
      const all = bank[s] || [];
      const started = all.filter((c) => triedSlugs.has(`${s}|${c.slug}`)).length;
      const notStarted = all
        .filter((c) => !triedSlugs.has(`${s}|${c.slug}`))
        .sort((a, b) => b.pyqCount - a.pyqCount || b.count - a.count)
        .slice(0, 5)
        .map(({ slug, chapter, count, pyqCount }) => ({ slug, chapter, count, pyqCount }));
      return [s, { chapters: all.length, started, notStarted }];
    }),
  );

  // ---- syllabus map: every chapter that has questions, with how much of it and how well ---------------
  const byChapter = new Map(chapters.map((c) => [`${c.subject}|${c.slug}`, c]));
  const syllabus = Object.fromEntries(
    SUBJECTS.map((s) => {
      const units = [];
      for (const c of bank[s] || []) {
        let u = units.find((x) => x.name === c.unit);
        if (!u) units.push((u = { name: c.unit, chapters: [] }));
        const mine = byChapter.get(`${s}|${c.slug}`);
        u.chapters.push({
          slug: c.slug,
          chapter: c.chapter,
          class: c.class,
          count: c.count,
          pyqCount: c.pyqCount,
          attempted: mine?.attempted || 0,
          solved: mine?.solved || 0,
          accuracy: mine?.accuracy ?? null,
          verdict: mine?.verdict || null,
        });
      }
      return [s, units];
    }),
  );

  const result = {
    examPaceSec: EXAM_PACE_SEC,
    syllabus,
    overall: summarise(groups.overall),
    mistakesOpen,
    subjects: Object.fromEntries(
      SUBJECTS.map((s) => {
        const sub = summarise(groups.subject[s] || bucket());
        const mine = chapters.filter((c) => c.subject === s && c.verdict);
        const byAcc = [...mine].sort((a, b) => b.accuracy - a.accuracy);
        return [
          s,
          {
            ...sub,
            strongest: byAcc[0] && byAcc[0].accuracy >= 60 ? pick(byAcc[0]) : null,
            weakest: byAcc.length > 1 && byAcc[byAcc.length - 1].accuracy < 70 ? pick(byAcc[byAcc.length - 1]) : null,
            byDifficulty: Object.fromEntries(['easy', 'medium', 'hard'].map((d) => [d, summarise(groups.subjectDifficulty[`${s}|${d}`] || bucket())])),
            tests: testBySubject[s] ? tSummary(testBySubject[s]) : null,
            coverage: coverage[s],
          },
        ];
      }),
    ),
    chapters: chapters.sort((a, b) => b.attempted - a.attempted),
    topics: topics.sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101)).slice(0, 40),
    difficulty: Object.fromEntries(['easy', 'medium', 'hard'].map((d) => [d, summarise(groups.difficulty[d] || bucket())])),
    type: Object.fromEntries(['single', 'multi', 'numerical'].map((t) => [t, summarise(groups.type[t] || bucket())])),
    tests: attempts.length ? { count: attempts.length, ...tSummary(testTotals), recent: recentTests.reverse() } : null,
    consistency: { active30, active14, practisedToday: activeDays.has(today) },
    weeks,
  };
  result.actions = recommendations(result);
  return result;
}

/** studentAnalysis, remembered for a minute per student (the profile tab and the test builder both ask). */
const analysisCache = new Map();
export async function cachedAnalysis(userId) {
  const key = String(userId);
  const hit = analysisCache.get(key);
  if (hit && hit.at > Date.now() - 60 * 1000) return hit.data;
  const data = await studentAnalysis(userId);
  if (analysisCache.size > 500) analysisCache.clear();
  analysisCache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Chapters to fix first, for the "Fix my weak spots" test: weak, then careless (rushed), then
 * improving, then accurate-but-slow — each group weakest first. Needs 5+ questions tried in a chapter.
 */
export function weakChapters(a, max = 5) {
  const order = { weak: 0, rushed: 1, improving: 2, slow: 3 };
  return a.chapters
    .filter((c) => c.verdict in order)
    .sort((x, y) => order[x.verdict] - order[y.verdict] || (x.accuracy ?? 0) - (y.accuracy ?? 0))
    .slice(0, max)
    .map((c) => ({ subject: c.subject, slug: c.slug, chapter: c.chapter, verdict: c.verdict, accuracy: c.accuracy }));
}

const pick = (c) => ({ subject: c.subject, slug: c.slug, chapter: c.chapter, accuracy: c.accuracy, attempted: c.attempted, speedRatio: c.speedRatio });
const listLink = (c, extra = '') => `/problems?subject=${c.subject}&chapter=${c.slug}${extra}`;

/**
 * Up to 6 concrete next steps, most useful first. Each is { id, vars, link } — the web app turns the id
 * into a sentence (in English or Hindi) so the wording lives with the other interface text.
 */
export function recommendations(a) {
  const out = [];
  const withVerdict = a.chapters.filter((c) => c.verdict);
  if (a.overall.attempted < 20) {
    out.push({ id: 'more-data', vars: { n: 20 - a.overall.attempted }, link: '/problems' });
  }
  const weak = withVerdict.filter((c) => c.verdict === 'weak').sort((x, y) => x.accuracy - y.accuracy);
  for (const c of weak.slice(0, 2)) {
    out.push({ id: 'weak-chapter', vars: { chapter: c.chapter, acc: c.accuracy }, link: listLink(c, `&difficulty=${c.accuracy < 30 ? 'easy' : 'medium'}&status=todo`) });
  }
  if (a.mistakesOpen >= 3) out.push({ id: 'revise-mistakes', vars: { n: a.mistakesOpen }, link: '/problems?status=attempted' });
  const rushed = withVerdict.find((c) => c.verdict === 'rushed');
  if (rushed) out.push({ id: 'rushed-chapter', vars: { chapter: rushed.chapter, acc: rushed.accuracy }, link: listLink(rushed) });
  const slow = withVerdict.filter((c) => c.verdict === 'slow').sort((x, y) => y.speedRatio - x.speedRatio)[0];
  if (slow) {
    out.push({ id: 'slow-chapter', vars: { chapter: slow.chapter, x: slow.speedRatio }, link: `/practice?subject=${slow.subject}&chapter=${slow.slug}` });
  }
  const t = a.tests;
  if (t && t.questions >= 20 && t.accuracy !== null && t.accuracy < 60 && t.marksLost >= 8) {
    const last = t.recent[t.recent.length - 1];
    out.push({ id: 'negative-marks', vars: { lost: t.marksLost, acc: t.accuracy, mins: Math.round(t.wrongTimeSec / 60) }, link: last ? `/test/${last.id}/result` : '/practice' });
  } else if (t && t.questions >= 20 && t.attemptRate !== null && t.attemptRate < 60 && t.accuracy >= 70) {
    out.push({ id: 'attempt-more', vars: { rate: t.attemptRate, acc: t.accuracy }, link: '/practice' });
  }
  const easy = a.difficulty.easy;
  const hard = a.difficulty.hard;
  if (easy.attempted >= 10 && easy.accuracy >= 75 && hard.attempted < 5) {
    out.push({ id: 'try-hard', vars: {}, link: '/problems?difficulty=hard' });
  }
  const slowSubject = SUBJECTS.map((s) => [s, a.subjects[s]]).filter(([, s]) => s.avgSolveSec && s.attempted >= 10 && s.avgSolveSec > a.examPaceSec * 1.25)
    .sort((x, y) => y[1].avgSolveSec - x[1].avgSolveSec)[0];
  if (slowSubject && !slow) {
    out.push({ id: 'exam-pace', vars: { subject: slowSubject[0], sec: slowSubject[1].avgSolveSec, pace: a.examPaceSec }, link: `/practice?subject=${slowSubject[0]}` });
  }
  const gap = SUBJECTS.flatMap((s) => a.subjects[s].coverage.notStarted.filter((c) => c.pyqCount > 0).map((c) => ({ ...c, subject: s })))
    .sort((x, y) => y.pyqCount - x.pyqCount)[0];
  if (gap && a.overall.attempted >= 20) out.push({ id: 'not-started', vars: { chapter: gap.chapter, n: gap.pyqCount }, link: `/${gap.subject}/${gap.slug}` });
  if (a.consistency.active14 < 5 && a.overall.attempted > 0) out.push({ id: 'consistency', vars: { n: a.consistency.active14 }, link: '/' });
  return out.slice(0, 6);
}

/**
 * What a free student gets (the rest is Pro). Free keeps the essentials — accuracy, solve time vs exam
 * pace, per-subject and per-chapter accuracy, difficulty/type breakdown, weekly activity, the first two
 * next steps. Pro adds: speed compared with other students, chapter verdicts and the strength map,
 * weakest topics, the full action plan, and the negative-marking / time-lost analysis of tests.
 * Removed on the server, so the numbers can't be read from the network tab either.
 */
export const FREE_ACTIONS = 2;
export function freeView(a) {
  const noSpeed = (s) => ({ ...s, speedRatio: null, othersAvgSec: null });
  const lockTests = (t) => (t ? { questions: t.questions, attemptRate: t.attemptRate, accuracy: t.accuracy, locked: true } : t);
  return {
    ...a,
    pro: false,
    overall: noSpeed(a.overall),
    subjects: Object.fromEntries(
      Object.entries(a.subjects).map(([k, s]) => [k, { ...noSpeed(s), strongest: s.strongest, weakest: s.weakest, tests: lockTests(s.tests) }]),
    ),
    chapters: a.chapters.map((c) => ({ ...noSpeed(c), verdict: null, locked: true })),
    // The map still shows how much of each chapter is done; the strong/weak colours are Pro.
    syllabus: Object.fromEntries(
      Object.entries(a.syllabus || {}).map(([k, units]) => [k, units.map((u) => ({ ...u, chapters: u.chapters.map((c) => ({ ...c, verdict: null })) }))]),
    ),
    topics: [],
    topicsLocked: a.topics.filter((t) => t.accuracy !== null && t.accuracy < 60).length,
    tests: a.tests ? { count: a.tests.count, ...lockTests(a.tests), recent: a.tests.recent } : null,
    actions: a.actions.slice(0, FREE_ACTIONS),
    actionsLocked: Math.max(0, a.actions.length - FREE_ACTIONS),
  };
}
