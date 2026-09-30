import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { col } from '../db.js';
import { requireUser } from '../auth.js';
import { isCorrect } from '../lib/grading.js';
import { recordActivity } from '../lib/activity.js';
import { hasPro, FREE_ONLY } from '../lib/premium.js';
import { potdQid, recordPotdSolve, liveStreak } from '../lib/potd.js';
import rateLimit from 'express-rate-limit';
import { applySearch, textOrScan, ttlCache } from '../lib/search.js';
import { resolveChapter, subjectUnits } from '../lib/chapters.js';
import { CHEM_BRANCHES } from '../lib/branches.js';
import { dueQids, recordMistake, recordSuccess } from '../lib/reviews.js';
import { syllabusChapters } from '../lib/syllabus.js';
import {
  ah, bad, forbidden, notFound, int, publicQuestion, reveal, practiceFilter, previewOf,
  SUBJECTS, DIFFICULTIES, TYPES, sampleQids, dayKey,
} from '../lib/util.js';

export const problemsRouter = Router();

/** First few plain words only — enough to recognise a locked question, not enough to solve it. */
const teaserOf = (text) => previewOf(text, 45).replace(/…?$/, '…');

function buildFilter(q) {
  const f = practiceFilter();
  if (SUBJECTS.includes(q.subject)) f.subject = q.subject;
  if (q.chapter) f.chapter = String(q.chapter);
  if (DIFFICULTIES.includes(q.difficulty)) f.difficulty = q.difficulty;
  if (TYPES.includes(q.type)) f.type = q.type;
  if (q.pyq === '1') f['pyq.year'] = { $exists: true };
  if (q.year) f['pyq.year'] = int(q.year, 0);
  if (q.access === 'free') f.premium = { $ne: true };
  if (q.access === 'premium') f.premium = true;
  if (q.search) {
    const s = String(q.search).trim().slice(0, 80);
    if (/^#?\d+$/.test(s)) f.qid = Number(s.replace('#', ''));
    else applySearch(f, s); // text index + every word must match (lib/search.js)
  }
  return f;
}

/**
 * buildFilter, plus: chapters are standard chapters (lib/chapters.js), and a fall back from the
 * text index to a scan for partial words.
 */
async function buildFilterAsync(q) {
  const f = buildFilter(q);
  if (f.chapter && f.subject) {
    // A standard chapter id ("kinematics"), or an old link's raw name ("Rotational motion") mapped to one.
    const id = await resolveChapter(f.subject, f.chapter);
    if (id) {
      delete f.chapter;
      f.chapterId = id;
    }
  } else if (CHEM_BRANCHES.includes(q.branch) && (!q.subject || q.subject === 'chemistry')) {
    // Physical / Organic / Inorganic = the chapters of that unit.
    f.subject = 'chemistry';
    const unit = { physical: 'Physical Chemistry', organic: 'Organic Chemistry', inorganic: 'Inorganic Chemistry' }[q.branch];
    f.chapterId = { $in: syllabusChapters('chemistry').filter((c) => c.unit === unit).map((c) => c.id) };
  }
  return textOrScan(col('questions'), f);
}

// Counting 140k questions for every page of the list is the slow part; the same filter is
// counted again on every page flip, so cache it briefly. Only for lists that don't depend on the viewer.
const countCache = ttlCache(2 * 60 * 1000);
const LIST_KEYS = ['subject', 'branch', 'chapter', 'difficulty', 'type', 'pyq', 'year', 'access', 'search'];
const countKey = (q) => JSON.stringify(LIST_KEYS.map((k) => q[k] ?? ''));

/**
 * Adds the viewer's "solved / attempted / not tried" filter to `filter` and returns
 * their progress as a Map(qid -> status). Anonymous viewers get an empty map.
 */
async function applyStatus(filter, req) {
  if (!req.user) return new Map();
  const userId = new ObjectId(req.user.id);
  const rows = await col('progress')
    .find({ userId }, { projection: { qid: 1, status: 1 } })
    .toArray();
  const st = req.query.status;
  const and = (filter.$and ||= []);
  if (st === 'bookmarked') {
    const marks = await col('bookmarks').find({ userId }, { projection: { qid: 1 } }).toArray();
    and.push({ qid: { $in: marks.map((m) => m.qid) } });
  } else if (st === 'solved' || st === 'attempted') {
    and.push({ qid: { $in: rows.filter((r) => r.status === st).map((r) => r.qid) } });
  } else if (st === 'due') {
    and.push({ qid: { $in: await dueQids(userId, 2000) } });
  } else if (st === 'todo') {
    and.push({ qid: { $nin: rows.map((r) => r.qid) } });
  }
  if (!and.length) delete filter.$and;
  return new Map(rows.map((r) => [r.qid, r.status]));
}

/** List with filters + the viewer's solved/attempted status. */
problemsRouter.get(
  '/',
  ah(async (req, res) => {
    const page = int(req.query.page, 1, 1, 10000);
    const limit = int(req.query.limit, 30, 5, 100);
    const filter = await buildFilterAsync(req.query);

    const [progress, pro] = await Promise.all([applyStatus(filter, req), hasPro(req)]);
    const personal = ['solved', 'attempted', 'todo', 'bookmarked', 'due'].includes(req.query.status) && req.user;

    const cursor = col('questions')
      .find(filter, { projection: { qid: 1, subject: 1, chapter: 1, topic: 1, difficulty: 1, type: 1, pyq: 1, stats: 1, premium: 1, text: 1 } })
      .sort({ qid: 1 })
      .skip((page - 1) * limit)
      .limit(limit);
    const count = () => col('questions').countDocuments(filter);
    const [items, total] = await Promise.all([cursor.toArray(), personal ? count() : countCache.get(countKey(req.query), count)]);

    res.json({
      page,
      limit,
      total,
      items: items.map((q) => ({
        qid: q.qid,
        preview: q.premium && !pro ? teaserOf(q.text) : previewOf(q.text),
        subject: q.subject,
        chapter: q.chapter,
        topic: q.topic,
        difficulty: q.difficulty,
        type: q.type,
        pyq: q.pyq || null,
        premium: !!q.premium,
        locked: !!q.premium && !pro,
        acceptance: q.stats?.attempts ? Math.round((100 * q.stats.solved) / q.stats.attempts) : null,
        status: progress.get(q.qid) || null,
      })),
    });
  }),
);

// Standard chapters per subject (grouped by unit) with counts, chemistry branch totals and PYQ years.
let metaCache = { at: 0, data: null };
problemsRouter.get(
  '/meta',
  ah(async (_req, res) => {
    if (Date.now() - metaCache.at > 5 * 60 * 1000) {
      const subjects = {};
      for (const s of SUBJECTS) subjects[s] = await subjectUnits(s);
      const unit = (name) => subjects.chemistry.units.find((u) => u.name === name)?.count || 0;
      const branches = { physical: unit('Physical Chemistry'), organic: unit('Organic Chemistry'), inorganic: unit('Inorganic Chemistry') };
      const years = (await col('questions').distinct('pyq.year', practiceFilter())).filter(Boolean).sort((a, b) => b - a);
      const total = Object.values(subjects).reduce((n, x) => n + x.total, 0);
      metaCache = { at: Date.now(), data: { subjects, branches, years, total } };
    }
    res.json(metaCache.data);
  }),
);

problemsRouter.get(
  '/random',
  ah(async (req, res) => {
    const filter = await buildFilterAsync(req.query);
    if (!(await hasPro(req))) Object.assign(filter, FREE_ONLY);
    const [qid] = await sampleQids(col('questions'), filter, 1);
    if (qid === undefined) throw notFound('No question matches these filters');
    res.json({ qid });
  }),
);

/**
 * Problem of the Day: one free question per IST day, same for everyone.
 * Solving it keeps a separate POTD streak (and, like any submission, the daily streak).
 */
problemsRouter.get(
  '/potd',
  ah(async (req, res) => {
    const day = dayKey();
    const qid = await potdQid(day);
    if (qid === null) return res.json({ day, question: null });
    const q = await col('questions').findOne({ qid }, { projection: { qid: 1, subject: 1, chapter: 1, topic: 1, difficulty: 1, type: 1, pyq: 1, text: 1, stats: 1 } });
    let mine = null;
    if (req.user) {
      const userId = new ObjectId(req.user.id);
      const [p, u] = await Promise.all([
        col('progress').findOne({ userId, qid }, { projection: { status: 1 } }),
        col('users').findOne({ _id: userId }, { projection: { potdStreak: 1 } }),
      ]);
      let streak = u?.potdStreak;
      // Solved it before it became today's pick (or on another device): still counts for today.
      if (p?.status === 'solved' && streak?.lastDay !== day) streak = (await recordPotdSolve(userId, qid)) || streak;
      mine = { status: p?.status || null, streak: liveStreak(streak) };
    }
    res.set('Cache-Control', req.user ? 'private, no-store' : 'public, max-age=300');
    res.json({
      day,
      question: {
        qid: q.qid, subject: q.subject, chapter: q.chapter, topic: q.topic, difficulty: q.difficulty, type: q.type, pyq: q.pyq || null,
        preview: previewOf(q.text, 180),
        acceptance: q.stats?.attempts ? Math.round((100 * q.stats.solved) / q.stats.attempts) : null,
        attempts: q.stats?.attempts || 0,
      },
      mine,
    });
  }),
);

async function loadForPractice(req) {
  const qid = int(req.params.qid, NaN);
  if (!Number.isFinite(qid)) throw notFound();
  const q = await col('questions').findOne({ qid, ...practiceFilter() });
  if (!q) throw notFound('Question not found');
  if (q.premium && !(await hasPro(req))) throw forbidden('This is a Pro question');
  return q;
}

/**
 * Previous / next question and position inside the list the student came from
 * (same filters as the Problems page, passed as query params).
 */
problemsRouter.get(
  '/:qid/nav',
  ah(async (req, res) => {
    const qid = int(req.params.qid, NaN);
    if (!Number.isFinite(qid)) throw notFound();
    const filter = await buildFilterAsync(req.query);
    await applyStatus(filter, req);
    const withQid = (cond) => ({ ...filter, $and: [...(filter.$and || []), { qid: cond }] });
    const [prev, next, before, total] = await Promise.all([
      col('questions').find(withQid({ $lt: qid }), { projection: { qid: 1 } }).sort({ qid: -1 }).limit(1).next(),
      col('questions').find(withQid({ $gt: qid }), { projection: { qid: 1 } }).sort({ qid: 1 }).limit(1).next(),
      col('questions').countDocuments(withQid({ $lt: qid })),
      col('questions').countDocuments(filter),
    ]);
    res.json({ prevQid: prev?.qid ?? null, nextQid: next?.qid ?? null, position: before + 1, total });
  }),
);

problemsRouter.get(
  '/:qid',
  ah(async (req, res) => {
    const qid = int(req.params.qid, NaN);
    const peek = Number.isFinite(qid) ? await col('questions').findOne({ qid, ...practiceFilter() }, { projection: { premium: 1 } }) : null;
    if (peek?.premium && !(await hasPro(req))) {
      // Locked: show what it is (chapter, level, a few words) but not the question itself.
      const t = await col('questions').findOne({ qid }, { projection: { qid: 1, subject: 1, chapter: 1, topic: 1, difficulty: 1, type: 1, pyq: 1, text: 1, stats: 1 } });
      return res.json({
        locked: true,
        question: {
          qid: t.qid, subject: t.subject, chapter: t.chapter, topic: t.topic, difficulty: t.difficulty, type: t.type, pyq: t.pyq || null, premium: true,
          teaser: teaserOf(t.text),
          stats: { attempts: t.stats?.attempts || 0, solved: t.stats?.solved || 0, avgSolveSec: t.stats?.timeCount ? Math.round(t.stats.timeSum / t.stats.timeCount) : null, solveTimes: t.stats?.timeCount || 0 },
        },
      });
    }
    const q = await loadForPractice(req);
    let mine = null;
    let bookmarked = false;
    if (req.user) {
      const userId = new ObjectId(req.user.id);
      [mine, bookmarked] = await Promise.all([
        col('progress').findOne({ userId, qid: q.qid }),
        col('bookmarks').countDocuments({ userId, qid: q.qid }, { limit: 1 }).then(Boolean),
      ]);
    }
    const potd = await col('potd').findOne({ _id: dayKey() }, { projection: { qid: 1 } });
    res.json({
      question: publicQuestion(q),
      bookmarked,
      isPotd: potd?.qid === q.qid,
      progress: mine
        ? { status: mine.status, attempts: mine.attempts, lastAnswer: mine.lastAnswer ?? null, timeSpentSec: mine.timeSpentSec || 0, solveTimeSec: mine.solveTimeSec ?? null }
        : null,
      // Solution stays hidden until the student solves it or chooses to reveal it.
      revealed: mine && (mine.status === 'solved' || mine.revealed) ? reveal(q) : null,
    });
  }),
);

problemsRouter.post(
  '/:qid/submit',
  requireUser,
  ah(async (req, res) => {
    const q = await loadForPractice(req);
    const answer = req.body.answer;
    if (answer === undefined || answer === null || (Array.isArray(answer) && !answer.length) || String(answer).trim() === '') {
      throw bad('Choose or enter an answer first');
    }
    const userId = new ObjectId(req.user.id);
    const correct = isCorrect(q, answer);
    const prev = await col('progress').findOne({ userId, qid: q.qid });
    const firstSolve = correct && prev?.status !== 'solved';
    // Time on the question since the last submit (the page pauses its clock while hidden).
    const timeSec = Math.round(Math.min(3600, Math.max(0, Number(req.body.timeSec) || 0)));
    const solveTimeSec = firstSolve ? (prev?.timeSpentSec || 0) + timeSec : null;

    await col('progress').updateOne(
      { userId, qid: q.qid },
      {
        $inc: { attempts: 1, timeSpentSec: timeSec },
        $set: {
          ...(firstSolve ? { solveTimeSec } : {}),
          status: correct || prev?.status === 'solved' ? 'solved' : 'attempted',
          lastAnswer: answer,
          updatedAt: new Date(),
          subject: q.subject,
          chapter: q.chapter,
          ...(firstSolve ? { solvedAt: new Date() } : {}),
        },
      },
      { upsert: true },
    );

    // Question acceptance stats count each student once.
    const statInc = {};
    if (!prev) statInc['stats.attempts'] = 1;
    if (firstSolve) {
      statInc['stats.solved'] = 1;
      // Average solve time ignores obvious outliers (tab left open for an hour).
      if (solveTimeSec >= 5 && solveTimeSec <= 1800) {
        statInc['stats.timeSum'] = solveTimeSec;
        statInc['stats.timeCount'] = 1;
      }
    }
    const jobs = [recordActivity(userId)];
    if (correct) jobs.push(recordPotdSolve(userId, q.qid));
    // Spaced revision: a mistake comes back tomorrow; a right answer on a due one moves it on.
    jobs.push((correct ? recordSuccess(userId, q.qid) : recordMistake(userId, q.qid, 'practice')).catch(() => null));
    if (Object.keys(statInc).length) jobs.push(col('questions').updateOne({ _id: q._id }, { $inc: statInc }));
    if (firstSolve) {
      jobs.push(col('users').updateOne({ _id: userId }, { $inc: { solvedCount: 1, [`solvedBySubject.${q.subject}`]: 1 } }));
    }
    await Promise.all(jobs);

    res.json({ correct, solveTimeSec, revealed: correct ? reveal(q) : null });
  }),
);

problemsRouter.post(
  '/:qid/reveal',
  requireUser,
  ah(async (req, res) => {
    const q = await loadForPractice(req);
    const userId = new ObjectId(req.user.id);
    await col('progress').updateOne(
      { userId, qid: q.qid },
      {
        $set: { revealed: true, updatedAt: new Date(), subject: q.subject, chapter: q.chapter },
        $inc: { timeSpentSec: Math.round(Math.min(3600, Math.max(0, Number(req.body?.timeSec) || 0))) },
        $setOnInsert: { status: 'attempted', attempts: 0 },
      },
      { upsert: true },
    );
    await recordMistake(userId, q.qid, 'practice').catch(() => null); // looked at the answer: revise it later
    res.json({ revealed: reveal(q) });
  }),
);

/** Save / un-save a question to the student's revision list. */
problemsRouter.put(
  '/:qid/bookmark',
  requireUser,
  ah(async (req, res) => {
    const qid = int(req.params.qid, NaN);
    if (!Number.isFinite(qid) || !(await col('questions').countDocuments({ qid, status: 'published' }, { limit: 1 }))) throw notFound('Question not found');
    await col('bookmarks').updateOne(
      { userId: new ObjectId(req.user.id), qid },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    res.json({ bookmarked: true });
  }),
);

problemsRouter.delete(
  '/:qid/bookmark',
  requireUser,
  ah(async (req, res) => {
    await col('bookmarks').deleteOne({ userId: new ObjectId(req.user.id), qid: int(req.params.qid, NaN) });
    res.json({ bookmarked: false });
  }),
);

export const REPORT_REASONS = {
  'wrong-answer': 'Answer key is wrong',
  'wrong-question': 'Question is incomplete or wrong',
  'bad-render': 'Maths / formatting looks broken',
  'figure': 'Figure missing or wrong',
  'solution': 'Solution is wrong or unclear',
  'other': 'Something else',
};

// Generous for real use, tight enough that one account can't flood the queue.
const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user?.id || req.ip });

/** "Report a problem with this question" — lands in Admin → Reports. */
problemsRouter.post(
  '/:qid/report',
  requireUser,
  reportLimiter,
  ah(async (req, res) => {
    const qid = int(req.params.qid, NaN);
    if (!Number.isFinite(qid) || !(await col('questions').countDocuments({ qid, status: 'published' }, { limit: 1 }))) throw notFound('Question not found');
    const reason = String(req.body.reason || '');
    if (!REPORT_REASONS[reason]) throw bad('Pick what is wrong');
    const note = String(req.body.note || '').trim().slice(0, 1000);
    if (reason === 'other' && note.length < 5) throw bad('Tell us briefly what is wrong');
    const userId = new ObjectId(req.user.id);
    // One open report per student per question: reporting again updates it.
    await col('reports').updateOne(
      { qid, userId, status: 'open' },
      { $set: { reason, note, updatedAt: new Date(), from: req.body.from === 'test' ? 'test' : 'practice' }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    res.status(201).json({ ok: true });
  }),
);
