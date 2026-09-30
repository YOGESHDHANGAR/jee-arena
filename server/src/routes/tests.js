import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { col } from '../db.js';
import { requireUser } from '../auth.js';
import { ah, bad, forbidden, notFound, int, publicQuestion, reveal } from '../lib/util.js';
import {
  GRACE_MS, attemptDeadline, finalizeContest, gradeAttempt, liveRank, loadPaper, testState, cleanTimes, questionTimeStats,
} from '../lib/tests.js';
import { recordActivity } from '../lib/activity.js';
import { hasPro } from '../lib/premium.js';
import { buildPractice, mistakeCount, resolveChapterFor, syllabusOverview, weakPreview } from '../lib/builder.js';
import { dueCount } from '../lib/reviews.js';
import { cleanConfidence, cleanReason, cleanVisits } from '../lib/signals.js';
import { forgetInsights, testReplay } from '../lib/insights.js';

export const testsRouter = Router();

const summary = (t, mine) => ({
  id: String(t._id),
  kind: t.kind,
  title: t.title,
  slug: t.slug || null,
  description: t.description || '',
  startAt: t.startAt || null,
  endAt: t.endAt || null,
  durationMin: t.durationMin || null,
  questionCount: t.questionIds.length,
  scheme: t.scheme,
  rated: !!t.rated,
  premium: !!t.premium,
  state: testState(t),
  participants: t.participants || t.submissions || 0,
  mine: mine
    ? { started: true, submitted: !!mine.submittedAt, score: mine.submittedAt && t.kind !== 'contest' ? mine.score : undefined, rank: mine.rank }
    : null,
});

async function getTest(id, userId) {
  const t = await col('tests').findOne({ $or: [{ _id: ObjectId.isValid(id) ? new ObjectId(id) : null }, { slug: id }] });
  if (!t) throw notFound('Test not found');
  if (t.kind === 'practice' && String(t.ownerId) !== String(userId)) throw notFound('Test not found');
  return t;
}

async function assertAccess(t, req) {
  if (!t.premium || req.user?.role === 'admin') return;
  const u = await col('users').findOne({ _id: new ObjectId(req.user.id) }, { projection: { plan: 1 } });
  if (u?.plan !== 'pro') throw forbidden('This test is part of Pro');
}

/** Public list of contests and mock tests. */
testsRouter.get(
  '/',
  ah(async (req, res) => {
    const kind = req.query.kind === 'mock' ? 'mock' : 'contest';
    const tests = await col('tests')
      .find({ kind, hidden: { $ne: true } }, { projection: { perQuestion: 0 } })
      .sort({ startAt: -1, createdAt: -1 })
      .limit(100)
      .toArray();
    let mine = new Map();
    if (req.user && tests.length) {
      const rows = await col('testAttempts')
        .find({ userId: new ObjectId(req.user.id), testId: { $in: tests.map((t) => t._id) } }, { projection: { testId: 1, submittedAt: 1, score: 1, rank: 1 } })
        .toArray();
      mine = new Map(rows.map((r) => [String(r.testId), r]));
    }
    res.json(tests.map((t) => summary(t, mine.get(String(t._id)))));
  }),
);

/** The logged-in user's own attempts (contests, mocks and custom tests). */
testsRouter.get(
  '/mine',
  requireUser,
  ah(async (req, res) => {
    const attempts = await col('testAttempts')
      .find({ userId: new ObjectId(req.user.id) }, { projection: { perQuestion: 0, answers: 0 } })
      .sort({ startedAt: -1 })
      .limit(50)
      .toArray();
    const tests = await col('tests').find({ _id: { $in: attempts.map((a) => a.testId) } }).toArray();
    const tMap = new Map(tests.map((t) => [String(t._id), t]));
    res.json(
      attempts
        .filter((a) => tMap.has(String(a.testId)))
        .map((a) => {
          const t = tMap.get(String(a.testId));
          const hide = t.kind === 'contest' && testState(t) !== 'ended';
          return {
            test: summary(t),
            startedAt: a.startedAt,
            submittedAt: a.submittedAt || null,
            score: hide ? undefined : a.score,
            maxScore: hide ? undefined : a.maxScore,
            rank: a.rank,
            ratingDelta: a.ratingDelta,
          };
        }),
    );
  }),
);

/** What the custom-test builder needs: the syllabus with counts, and the student's mistake count. */
testsRouter.get(
  '/builder',
  ah(async (req, res) => {
    const [overview, mistakes, weak, due] = await Promise.all([
      syllabusOverview(),
      req.user ? mistakeCount(req.user.id) : null,
      req.user ? weakPreview(req.user.id, await hasPro(req)) : null,
      req.user ? dueCount(req.user.id) : null,
    ]);
    const prefill = req.query.chapter ? await resolveChapterFor(req.query.subject, String(req.query.chapter)) : null;
    res.json({ ...overview, mistakes, weak, due, prefill: prefill ? `${req.query.subject}:${prefill}` : null });
  }),
);

/** Create a custom practice test: chosen chapters, a class, the JEE Main pattern, or the student's mistakes. */
testsRouter.post(
  '/practice',
  requireUser,
  ah(async (req, res) => {
    const built = await buildPractice(req.body || {}, { pro: await hasPro(req), userId: req.user.id });
    const t = {
      kind: 'practice',
      title: req.body.title?.trim().slice(0, 80) || built.title,
      ownerId: new ObjectId(req.user.id),
      questionIds: built.questionIds,
      durationMin: built.durationMin,
      scheme: req.body.negative === false ? 'practice' : 'jee_main',
      createdAt: new Date(),
    };
    const r = await col('tests').insertOne(t);
    res.status(201).json({ id: String(r.insertedId), questions: built.questionIds.length });
  }),
);

testsRouter.get(
  '/:id',
  ah(async (req, res) => {
    let t = await getTest(req.params.id, req.user?.id);
    if (testState(t) === 'ended') t = await finalizeContest(t);
    const mine = req.user ? await col('testAttempts').findOne({ testId: t._id, userId: new ObjectId(req.user.id) }, { projection: { perQuestion: 0 } }) : null;
    res.json({ ...summary(t, mine), serverTime: new Date(), deadline: mine?.deadline || null });
  }),
);

/** Start (or resume) an attempt and receive the whole paper in one response. */
testsRouter.post(
  '/:id/start',
  requireUser,
  ah(async (req, res) => {
    const t = await getTest(req.params.id, req.user.id);
    await assertAccess(t, req);
    const state = testState(t);
    const userId = new ObjectId(req.user.id);
    let attempt = await col('testAttempts').findOne({ testId: t._id, userId });

    if (!attempt) {
      if (state === 'upcoming') throw bad('This contest has not started yet');
      if (state === 'ended') throw bad('This contest has ended — try it from the problem list or a mock test');
      const startedAt = new Date();
      attempt = { testId: t._id, userId, startedAt, deadline: attemptDeadline(t, startedAt), answers: {}, marked: [] };
      try {
        const r = await col('testAttempts').insertOne(attempt);
        attempt._id = r.insertedId;
      } catch (e) {
        if (e.code !== 11000) throw e;
        attempt = await col('testAttempts').findOne({ testId: t._id, userId }); // double-click
      }
      if (t.kind === 'contest') await col('tests').updateOne({ _id: t._id }, { $inc: { participants: 1 } });
      await recordActivity(userId);
    }

    if (attempt.submittedAt) return res.json({ submitted: true });
    if (Date.now() > attempt.deadline.getTime() + GRACE_MS) {
      await gradeAttempt(t, attempt, attempt.deadline);
      return res.json({ submitted: true });
    }

    const paper = await loadPaper(t);
    res.json({
      submitted: false,
      test: summary(t, attempt),
      serverTime: new Date(),
      deadline: attempt.deadline,
      answers: attempt.answers || {},
      marked: attempt.marked || [],
      times: attempt.times || {},
      confidence: attempt.confidence || {},
      visits: attempt.visits || [],
      questions: paper.map(publicQuestion),
    });
  }),
);

/** Autosave. The client batches changes, so this is called every ~20s, not per click. */
testsRouter.put(
  '/:id/answers',
  requireUser,
  ah(async (req, res) => {
    const t = await getTest(req.params.id, req.user.id);
    const attempt = await col('testAttempts').findOne({ testId: t._id, userId: new ObjectId(req.user.id) });
    if (!attempt) throw bad('Start the test first');
    if (attempt.submittedAt) throw bad('Already submitted');
    if (Date.now() > attempt.deadline.getTime() + GRACE_MS) throw bad('Time is up');
    const allowed = new Set(t.questionIds.map(String));
    const answers = {};
    for (const [k, v] of Object.entries(req.body.answers || {})) if (allowed.has(k)) answers[k] = v;
    const marked = (req.body.marked || []).map(Number).filter((n) => allowed.has(String(n)));
    const set = { answers, marked, savedAt: new Date() };
    if (req.body.times) set.times = cleanTimes(t, req.body.times, attempt.times);
    if (req.body.confidence) set.confidence = cleanConfidence(t, req.body.confidence);
    if (req.body.visits) set.visits = cleanVisits(t, req.body.visits);
    await col('testAttempts').updateOne({ _id: attempt._id, submittedAt: { $exists: false } }, { $set: set });
    res.json({ ok: true, savedAt: new Date() });
  }),
);

testsRouter.post(
  '/:id/submit',
  requireUser,
  ah(async (req, res) => {
    const t = await getTest(req.params.id, req.user.id);
    let attempt = await col('testAttempts').findOne({ testId: t._id, userId: new ObjectId(req.user.id) });
    if (!attempt) throw bad('Start the test first');
    if (!attempt.submittedAt) {
      const late = Date.now() > attempt.deadline.getTime() + GRACE_MS;
      if (req.body.answers && !late) {
        const allowed = new Set(t.questionIds.map(String));
        const answers = {};
        for (const [k, v] of Object.entries(req.body.answers)) if (allowed.has(k)) answers[k] = v;
        attempt.answers = answers;
        const set = { answers };
        if (req.body.times) set.times = attempt.times = cleanTimes(t, req.body.times, attempt.times);
        if (req.body.confidence) set.confidence = attempt.confidence = cleanConfidence(t, req.body.confidence);
        if (req.body.visits) set.visits = attempt.visits = cleanVisits(t, req.body.visits);
        await col('testAttempts').updateOne({ _id: attempt._id }, { $set: set });
      }
      attempt = await gradeAttempt(t, attempt, new Date());
    }
    res.json({ submitted: true, resultsAvailable: t.kind !== 'contest' || testState(t) === 'ended' });
  }),
);

/** Detailed result with answers and solutions. Contest results open after the contest ends. */
testsRouter.get(
  '/:id/result',
  requireUser,
  ah(async (req, res) => {
    let t = await getTest(req.params.id, req.user.id);
    let attempt = await col('testAttempts').findOne({ testId: t._id, userId: new ObjectId(req.user.id) });
    if (!attempt) throw notFound('You have not taken this test');
    if (!attempt.submittedAt && Date.now() > attempt.deadline.getTime() + GRACE_MS) {
      attempt = await gradeAttempt(t, attempt, attempt.deadline);
    }
    if (!attempt.submittedAt) throw bad('Submit the test to see results');
    if (t.kind === 'contest') {
      if (testState(t) !== 'ended') return res.json({ pending: true, endAt: t.endAt });
      t = await finalizeContest(t);
      attempt = await col('testAttempts').findOne({ _id: attempt._id });
    }

    const paper = await loadPaper(t);
    const pq = new Map((attempt.perQuestion || []).map((p) => [p.qid, p]));
    const rank = t.kind === 'mock' ? await liveRank(t, attempt) : t.kind === 'contest' ? { rank: attempt.rank, of: t.participants } : null;
    // How everyone else did on each question (not for a student's own custom test: nobody else took it).
    const others = t.kind === 'practice' ? null : await questionTimeStats(t);
    // Which of these questions are in the student's spaced revision ("Save to revise").
    const inRevision = (await col('reviews').find({ userId: new ObjectId(req.user.id), qid: { $in: paper.map((q) => q.qid) } }, { projection: { qid: 1 } }).toArray()).map((x) => x.qid);

    res.json({
      test: summary(t, attempt),
      score: attempt.score,
      maxScore: attempt.maxScore,
      correct: attempt.correct,
      partial: attempt.partial,
      wrong: attempt.wrong,
      unattempted: attempt.unattempted,
      timeTakenSec: attempt.timeTakenSec,
      bySubject: attempt.bySubject,
      rank,
      rating: attempt.ratingAfter !== undefined ? { before: attempt.ratingBefore, after: attempt.ratingAfter, delta: attempt.ratingDelta } : null,
      questions: paper.map((q) => ({ ...publicQuestion(q), ...reveal(q), result: pq.get(q.qid) || null, others: others?.get(q.qid) || null })),
      inRevision,
      // Why each mark was lost, as tagged by the student, and how they moved through the paper.
      reasons: attempt.reasons || {},
      replay: testReplay(attempt, paper, t),
    });
  }),
);

/** "Why did I lose this mark?" on a wrong or skipped test question (lib/signals.js). reason: null clears it. */
testsRouter.post(
  '/:id/reasons',
  requireUser,
  ah(async (req, res) => {
    const t = await getTest(req.params.id, req.user.id);
    const qid = Number(req.body.qid);
    if (!t.questionIds.includes(qid)) throw bad('That question is not in this test');
    const attempt = await col('testAttempts').findOne({ testId: t._id, userId: new ObjectId(req.user.id) }, { projection: { submittedAt: 1, perQuestion: 1 } });
    if (!attempt?.submittedAt) throw bad('Submit the test first');
    const p = (attempt.perQuestion || []).find((x) => x.qid === qid);
    if (!p || p.status === 'correct') throw bad('Only wrong or skipped questions can be tagged');
    const reason = cleanReason(req.body.reason);
    await col('testAttempts').updateOne({ _id: attempt._id }, reason ? { $set: { [`reasons.${qid}`]: reason } } : { $unset: { [`reasons.${qid}`]: '' } });
    forgetInsights(req.user.id);
    res.json({ qid, reason });
  }),
);

testsRouter.get(
  '/:id/leaderboard',
  ah(async (req, res) => {
    let t = await getTest(req.params.id, req.user?.id);
    if (t.kind === 'practice') throw notFound();
    if (t.kind === 'contest') {
      if (testState(t) !== 'ended') return res.json({ pending: true, endAt: t.endAt, items: [] });
      t = await finalizeContest(t);
    }
    const page = int(req.query.page, 1, 1, 100000);
    const limit = 50;
    const filter = { testId: t._id, submittedAt: { $exists: true } };
    const [rows, total] = await Promise.all([
      col('testAttempts')
        .find(filter, { projection: { userId: 1, score: 1, maxScore: 1, timeTakenSec: 1, rank: 1, ratingDelta: 1, correct: 1, wrong: 1 } })
        .sort({ score: -1, timeTakenSec: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      col('testAttempts').countDocuments(filter),
    ]);
    const users = await col('users')
      .find({ _id: { $in: rows.map((r) => r.userId) } }, { projection: { name: 1, username: 1, rating: 1 } })
      .toArray();
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    res.json({
      total,
      page,
      items: rows.map((r, i) => {
        const u = uMap.get(String(r.userId)) || {};
        return {
          rank: r.rank ?? (page - 1) * limit + i + 1,
          username: u.username,
          name: u.name,
          rating: u.rating,
          score: r.score,
          maxScore: r.maxScore,
          correct: r.correct,
          wrong: r.wrong,
          timeTakenSec: r.timeTakenSec,
          ratingDelta: r.ratingDelta,
        };
      }),
    });
  }),
);

