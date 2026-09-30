import { ObjectId } from 'mongodb';
import { col } from '../db.js';
import { gradePaper } from './grading.js';
import { assignRanks, computeRatingChanges, DEFAULT_RATING } from './rating.js';
import { bad, practiceFilter, sampleQids, SUBJECTS } from './util.js';
import { recordTestResults } from './reviews.js';

export const GRACE_MS = 30 * 1000; // network slack on the final autosave/submit

/** JEE Main paper: per subject 20 MCQ (single correct) + 5 numerical. 180 minutes. */
export const JEE_MAIN_PATTERN = SUBJECTS.flatMap((subject) => [
  { subject, type: 'single', count: 20 },
  { subject, type: 'numerical', count: 5 },
]);

/**
 * Picks random published questions for each section.
 * section: { subject, type?, count, chapters?: string[], difficulty?: string }
 * Throws if the bank can't fill a section, so admins see the gap instead of a short paper.
 */
export async function pickQuestions(sections, { excludeLocked = true, extra = {} } = {}) {
  const chosen = [];
  for (const s of sections) {
    const match = { ...(excludeLocked ? practiceFilter() : { status: 'published' }), ...extra };
    if (s.subject) match.subject = s.subject;
    if (s.type) match.type = s.type;
    if (s.difficulty) match.difficulty = s.difficulty;
    if (s.chapters?.length) match.chapter = { $in: s.chapters };
    if (chosen.length) match.qid = { $nin: chosen };
    const rows = await sampleQids(col('questions'), match, s.count);
    if (rows.length < s.count) {
      const label = [s.subject, s.type, s.difficulty, s.chapters?.join('/')].filter(Boolean).join(', ');
      throw bad(`Only ${rows.length} questions available for [${label}], need ${s.count}`);
    }
    chosen.push(...rows);
  }
  return chosen;
}

export function testState(t, now = new Date()) {
  if (t.kind !== 'contest') return 'open';
  if (now < t.startAt) return 'upcoming';
  if (now < t.endAt) return 'live';
  return 'ended';
}

export function attemptDeadline(t, startedAt) {
  const byDuration = t.durationMin ? new Date(startedAt.getTime() + t.durationMin * 60000) : null;
  if (t.kind === 'contest') return byDuration && byDuration < t.endAt ? byDuration : t.endAt;
  return byDuration || new Date(startedAt.getTime() + 180 * 60000);
}

/** Loads the paper's questions in paper order (full docs, including answers). */
export async function loadPaper(t) {
  const docs = await col('questions').find({ qid: { $in: t.questionIds } }).toArray();
  const byQid = new Map(docs.map((d) => [d.qid, d]));
  return t.questionIds.map((id) => byQid.get(id)).filter(Boolean);
}

/** Grades one attempt and stores the result. Safe to call more than once. */
export async function gradeAttempt(t, attempt, submittedAt = new Date()) {
  if (attempt.submittedAt) return attempt;
  const questions = await loadPaper(t);
  const g = gradePaper(questions, attempt.answers || {}, t.scheme);
  const end = submittedAt > attempt.deadline ? attempt.deadline : submittedAt;
  // Time per question (tracked by the test screen; older attempts don't have it).
  const times = attempt.times || {};
  for (const p of g.perQuestion) if (times[p.qid] !== undefined) p.timeSec = times[p.qid];
  // How sure the student said they were (lib/signals.js), for the "should I guess?" insight.
  const conf = attempt.confidence || {};
  for (const p of g.perQuestion) if (conf[p.qid]) p.conf = conf[p.qid];
  const update = {
    submittedAt: end,
    timeTakenSec: Math.max(0, Math.round((end - attempt.startedAt) / 1000)),
    score: g.score,
    maxScore: g.maxScore,
    correct: g.correct,
    partial: g.partial,
    wrong: g.wrong,
    unattempted: g.unattempted,
    bySubject: g.bySubject,
    perQuestion: g.perQuestion,
  };
  // Only the first grading wins if two requests race.
  const r = await col('testAttempts').findOneAndUpdate(
    { _id: attempt._id, submittedAt: { $exists: false } },
    { $set: update },
    { returnDocument: 'after' },
  );
  if (r && t.kind !== 'practice') {
    await col('tests').updateOne({ _id: t._id }, { $inc: { submissions: 1 } });
  }
  // Wrong answers join the student's spaced revision; right answers on due ones move them on.
  // Not awaited: submitting shouldn't wait on up to 90 small writes.
  if (r) recordTestResults(attempt.userId, g.perQuestion, end).catch((e) => console.error('revision update failed', e.message));
  return r || col('testAttempts').findOne({ _id: attempt._id });
}

/**
 * After a contest ends: grade anyone who didn't press submit, rank everyone,
 * and (for rated contests) update ratings. Runs lazily on the first request
 * that needs results, so no cron job or worker is required.
 */
export async function finalizeContest(t) {
  if (t.kind !== 'contest' || t.finalized || new Date() < t.endAt) return t;

  const lock = await col('tests').findOneAndUpdate(
    { _id: t._id, finalized: { $ne: true }, finalizingAt: { $not: { $gt: new Date(Date.now() - 5 * 60000) } } },
    { $set: { finalizingAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!lock) return col('tests').findOne({ _id: t._id }); // someone else is finalizing

  const pending = await col('testAttempts').find({ testId: t._id, submittedAt: { $exists: false } }).toArray();
  for (const a of pending) await gradeAttempt(t, a, a.deadline);

  const rows = await col('testAttempts')
    .find({ testId: t._id }, { projection: { userId: 1, score: 1, timeTakenSec: 1 } })
    .toArray();
  const ranked = assignRanks(rows);

  const attemptOps = ranked.map((r) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { rank: r.rank } } } }));

  if (t.rated && ranked.length >= 2) {
    const users = await col('users')
      .find({ _id: { $in: ranked.map((r) => r.userId) } }, { projection: { rating: 1, contestsPlayed: 1 } })
      .toArray();
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    const changes = computeRatingChanges(
      ranked.map((r) => {
        const u = uMap.get(String(r.userId)) || {};
        return { userId: r.userId, rating: u.rating ?? DEFAULT_RATING, contestsPlayed: u.contestsPlayed || 0, rank: r.rank };
      }),
    );
    const byUser = new Map(changes.map((c) => [String(c.userId), c]));
    for (const op of attemptOps) {
      const r = ranked.find((x) => x._id === op.updateOne.filter._id);
      const c = byUser.get(String(r.userId));
      Object.assign(op.updateOne.update.$set, { ratingBefore: c.before, ratingAfter: c.after, ratingDelta: c.delta });
    }
    const now = new Date();
    await col('users').bulkWrite(
      changes.map((c) => ({
        updateOne: {
          filter: { _id: c.userId },
          update: {
            $set: { rating: c.after },
            $inc: { contestsPlayed: 1 },
            $push: {
              ratingHistory: {
                $each: [{ testId: t._id, title: t.title, rank: ranked.find((r) => String(r.userId) === String(c.userId)).rank, rating: c.after, delta: c.delta, at: now }],
                $slice: -200,
              },
            },
          },
        },
      })),
    );
  }

  if (attemptOps.length) await col('testAttempts').bulkWrite(attemptOps);
  // Release the paper's questions back to practice (covers contests ended early by an admin).
  await col('questions').updateMany({ qid: { $in: t.questionIds }, lockedUntil: { $gt: new Date() } }, { $set: { lockedUntil: new Date() } });
  await col('tests').updateOne(
    { _id: t._id },
    { $set: { finalized: true, finalizedAt: new Date(), participants: ranked.length }, $unset: { finalizingAt: '' } },
  );
  return col('tests').findOne({ _id: t._id });
}

/** For mocks: live "All-India rank" among everyone who has submitted so far. */
export async function liveRank(t, attempt) {
  const [better, total] = await Promise.all([
    col('testAttempts').countDocuments({
      testId: t._id,
      submittedAt: { $exists: true },
      $or: [{ score: { $gt: attempt.score } }, { score: attempt.score, timeTakenSec: { $lt: attempt.timeTakenSec } }],
    }),
    col('testAttempts').countDocuments({ testId: t._id, submittedAt: { $exists: true } }),
  ]);
  return { rank: better + 1, of: total };
}

export const toId = (s) => (s instanceof ObjectId ? s : new ObjectId(String(s)));

/**
 * Validates the per-question seconds sent by the test screen: only this paper's questions, whole
 * seconds, never more than the whole test, and never lower than what's already stored
 * (an older autosave arriving late mustn't wind the clock back).
 */
export function cleanTimes(t, raw, prev = {}) {
  const cap = (t.durationMin || 180) * 60;
  const allowed = new Set(t.questionIds.map(String));
  const out = { ...(prev || {}) };
  for (const [k, v] of Object.entries(raw || {})) {
    if (!allowed.has(k)) continue;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0) continue;
    out[k] = Math.max(out[k] || 0, Math.min(cap, n));
  }
  return out;
}

const timeStatsCache = new Map(); // testId -> { at, stats }

/**
 * Per question, across everyone who submitted this test: % who got it right and the average time
 * of those who got it right. Cached for 10 minutes per test.
 * Returns Map(qid -> { correctPct, avgCorrectSec, takers }).
 */
export async function questionTimeStats(t) {
  const key = String(t._id);
  const hit = timeStatsCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.stats;
  const rows = await col('testAttempts')
    .find({ testId: t._id, submittedAt: { $exists: true } }, { projection: { _id: 0, perQuestion: 1 } })
    .toArray();
  const acc = new Map();
  for (const r of rows) {
    for (const p of r.perQuestion || []) {
      const a = acc.get(p.qid) || { takers: 0, correct: 0, timeSum: 0, timeN: 0 };
      a.takers++;
      if (p.status === 'correct') {
        a.correct++;
        if (p.timeSec > 0) {
          a.timeSum += p.timeSec;
          a.timeN++;
        }
      }
      acc.set(p.qid, a);
    }
  }
  const stats = new Map(
    [...acc].map(([qid, a]) => [qid, { takers: a.takers, correctPct: Math.round((100 * a.correct) / a.takers), avgCorrectSec: a.timeN ? Math.round(a.timeSum / a.timeN) : null }]),
  );
  if (timeStatsCache.size > 200) timeStatsCache.clear();
  timeStatsCache.set(key, { at: Date.now(), stats });
  return stats;
}
