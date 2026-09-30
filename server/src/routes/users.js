import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { col } from '../db.js';
import { publicUser, requireUser } from '../auth.js';
import { ah, bad, forbidden, notFound, dayKey } from '../lib/util.js';
import { cachedAnalysis, freeView, weakChapters } from '../lib/analysis.js';
import { cachedInsights, forgetInsights, freeInsights } from '../lib/insights.js';
import { dueCount } from '../lib/reviews.js';
import { syllabusChapter } from '../lib/syllabus.js';

export const usersRouter = Router();

usersRouter.get(
  '/me',
  requireUser,
  ah(async (req, res) => {
    const u = await col('users').findOne({ _id: new ObjectId(req.user.id) });
    if (!u) throw notFound();
    res.json(publicUser(u));
  }),
);

/**
 * The home page for a logged-in student: today's numbers and where to pick up. Light: a few small
 * queries plus the (cached) analysis for the weakest chapter.
 */
usersRouter.get(
  '/me/today',
  requireUser,
  ah(async (req, res) => {
    const userId = new ObjectId(req.user.id);
    const IST = 5.5 * 3600 * 1000;
    const dayStart = new Date(Math.floor((Date.now() + IST) / 864e5) * 864e5 - IST);
    const [u, today, solvedToday, last, due, a] = await Promise.all([
      col('users').findOne({ _id: userId }, { projection: { name: 1, streak: 1, solvedCount: 1 } }),
      col('activity').findOne({ userId, day: dayKey() }, { projection: { count: 1 } }),
      col('progress').countDocuments({ userId, solvedAt: { $gte: dayStart } }),
      col('progress').find({ userId }, { projection: { qid: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).limit(1).next(),
      dueCount(userId),
      cachedAnalysis(userId).catch(() => null),
    ]);
    // Where they left off: the chapter of the last question they worked on.
    let continueAt = null;
    if (last) {
      const q = await col('questions').findOne({ qid: last.qid }, { projection: { subject: 1, chapterId: 1 } });
      const std = q && syllabusChapter(q.subject, q.chapterId);
      if (std) continueAt = { subject: q.subject, slug: std.id, chapter: std.name, at: last.updatedAt };
    }
    const weakest = a ? weakChapters(a, 1)[0] || null : null;
    res.json({
      name: u?.name || '',
      streak: u?.streak || { current: 0, best: 0 },
      solvedCount: u?.solvedCount || 0,
      today: { submissions: today?.count || 0, solved: solvedToday },
      due,
      mistakesOpen: a?.mistakesOpen || 0,
      continueAt,
      weakest,
      accuracy: a?.overall?.accuracy ?? null,
    });
  }),
);

usersRouter.patch(
  '/me',
  requireUser,
  ah(async (req, res) => {
    const set = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name.length < 2) throw bad('Enter your name');
      set.name = name;
    }
    if (req.body.targetYear !== undefined) set.targetYear = Number(req.body.targetYear) || null;
    if (req.body.examDate !== undefined) {
      const d = String(req.body.examDate || '');
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
      if (d && !ok) throw bad('Pick a valid exam date');
      set.examDate = ok ? d : null;
    }
    if (req.body.homeState !== undefined) set.homeState = String(req.body.homeState || '').slice(0, 40) || null;
    if (req.body.femaleSeats !== undefined) set.femaleSeats = !!req.body.femaleSeats;
    await col('users').updateOne({ _id: new ObjectId(req.user.id) }, { $set: set });
    forgetInsights(req.user.id);
    const u = await col('users').findOne({ _id: new ObjectId(req.user.id) });
    res.json(publicUser(u));
  }),
);

/**
 * Detailed performance analysis (lib/analysis.js). Private: only the student themself (and admins)
 * can see where they're weak. Cached for a minute per student.
 */
usersRouter.get(
  '/:username/analysis',
  requireUser,
  ah(async (req, res) => {
    const u = await col('users').findOne({ username: String(req.params.username).toLowerCase() }, { projection: { _id: 1, plan: 1 } });
    if (!u) throw notFound('User not found');
    if (String(u._id) !== req.user.id && req.user.role !== 'admin') throw forbidden('Only you can see your analysis');
    const data = await cachedAnalysis(u._id);
    // The full analysis is Pro; admins always see everything (e.g. to help a student).
    const full = u.plan === 'pro' || req.user.role === 'admin';
    res.json(full ? { ...data, pro: true } : freeView(data));
  }),
);

/**
 * "My journey" insights (lib/insights.js): why marks were lost, guessing, predicted score and colleges,
 * what to study next, syllabus pace, test strategy, retention, effort. Private like the analysis.
 */
usersRouter.get(
  '/:username/insights',
  requireUser,
  ah(async (req, res) => {
    const u = await col('users').findOne({ username: String(req.params.username).toLowerCase() }, { projection: { _id: 1, plan: 1 } });
    if (!u) throw notFound('User not found');
    if (String(u._id) !== req.user.id && req.user.role !== 'admin') throw forbidden('Only you can see your insights');
    const data = await cachedInsights(u._id);
    const full = u.plan === 'pro' || req.user.role === 'admin';
    res.json(full ? { ...data, pro: true } : freeInsights(data));
  }),
);

/** Public profile + stats, LeetCode-style. */
usersRouter.get(
  '/:username',
  ah(async (req, res) => {
    const u = await col('users').findOne({ username: String(req.params.username).toLowerCase() });
    if (!u) throw notFound('User not found');
    const userId = u._id;
    const since = dayKey(new Date(Date.now() - 365 * 864e5));

    const [activity, chapters, totals, globalRank] = await Promise.all([
      col('activity').find({ userId, day: { $gte: since } }, { projection: { _id: 0, day: 1, count: 1 } }).toArray(),
      col('progress')
        .find({ userId }, { projection: { _id: 0, qid: 1, subject: 1, status: 1, attempts: 1 } })
        .toArray()
        .then(async (rows) => {
          // Grouped by standard chapter (lib/syllabus.js) in JS: one student's rows are small, and it stays portable.
          const qs = await col('questions').find({ qid: { $in: rows.map((r) => r.qid) } }, { projection: { _id: 0, qid: 1, subject: 1, chapterId: 1 } }).toArray();
          const Q = new Map(qs.map((q) => [q.qid, q]));
          const m = new Map();
          const bySubject = {};
          for (const r of rows) {
            const q = Q.get(r.qid);
            const subject = q?.subject || r.subject;
            if (r.status === 'solved') bySubject[subject] = (bySubject[subject] || 0) + 1;
            const std = q && syllabusChapter(subject, q.chapterId);
            if (!std) continue;
            const k = `${subject}|${std.id}`;
            const c = m.get(k) || { subject, slug: std.id, chapter: std.name, attempted: 0, solved: 0, firstTry: 0 };
            c.attempted += 1;
            if (r.status === 'solved') {
              c.solved += 1;
              if (r.attempts === 1) c.firstTry += 1;
            }
            m.set(k, c);
          }
          return { list: [...m.values()], bySubject };
        }),
      col('questions')
        .aggregate([{ $match: { status: 'published' } }, { $group: { _id: '$subject', total: { $sum: 1 } } }])
        .toArray(),
      u.contestsPlayed ? col('users').countDocuments({ contestsPlayed: { $gt: 0 }, rating: { $gt: u.rating } }) : null,
    ]);

    const chapterStats = chapters.list.map((c) => ({
      subject: c.subject,
      slug: c.slug,
      chapter: c.chapter,
      attempted: c.attempted,
      solved: c.solved,
      accuracy: Math.round((100 * c.firstTry) / c.attempted),
    }));
    // Weak chapters: enough attempts to mean something, lowest first-try accuracy.
    const weak = chapterStats.filter((c) => c.attempted >= 3).sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);

    res.json({
      user: {
        name: u.name,
        username: u.username,
        rating: u.rating,
        contestsPlayed: u.contestsPlayed || 0,
        solvedCount: u.solvedCount || 0,
        solvedBySubject: chapters.bySubject, // counted from progress, so it always matches
        streak: u.streak || { current: 0, best: 0 },
        joinedAt: u.createdAt,
        targetYear: u.targetYear || null,
        globalRank: globalRank === null ? null : globalRank + 1,
        solutionsAccepted: u.solutionsAccepted || 0,
        referrals: u.referrals || 0,
      },
      totals: Object.fromEntries(totals.map((t) => [t._id, t.total])),
      ratingHistory: (u.ratingHistory || []).map((h) => ({ title: h.title, rating: h.rating, delta: h.delta, rank: h.rank, at: h.at })),
      activity,
      chapterStats,
      weak,
    });
  }),
);
