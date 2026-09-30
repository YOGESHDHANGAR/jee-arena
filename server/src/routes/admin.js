import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { col, nextSeq } from '../db.js';
import { requireAdmin, requireUser } from '../auth.js';
import { ah, bad, notFound, int, SUBJECTS, DIFFICULTIES, TYPES, dayKey } from '../lib/util.js';
import { JEE_MAIN_PATTERN, pickQuestions } from '../lib/tests.js';
import { SCHEMES } from '../lib/grading.js';
import { applyPremium, FREE_ONLY } from '../lib/premium.js';
import { applySearch, textOrScan } from '../lib/search.js';
import { fingerprint } from '../lib/fingerprint.js';
import { chapterIdFields } from '../lib/chapterIds.js';
import { syllabusChapter } from '../lib/syllabus.js';
import { clearChapterCache } from '../lib/chapters.js';
import { previewOf } from '../lib/util.js';
import { calibrateDifficulty } from '../lib/difficulty.js';
import { growthReport } from '../lib/growth.js';
import { autoMerge, clearDuplicateCache, describeGroups, duplicateGroups, mergeGroup, scanFingerprints, scanStatus } from '../lib/duplicates.js';

export const adminRouter = Router();
adminRouter.use(requireUser, requireAdmin);

adminRouter.get(
  '/overview',
  ah(async (_req, res) => {
    const [users, pro, byStatus, bySubject, tests, attemptsToday, activeToday, premiumQs, openReports, errors24h] = await Promise.all([
      col('users').estimatedDocumentCount(),
      col('users').countDocuments({ plan: 'pro' }),
      col('questions').aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
      col('questions').aggregate([{ $match: { status: 'published' } }, { $group: { _id: { s: '$subject', t: '$type' }, n: { $sum: 1 } } }]).toArray(),
      col('tests').aggregate([{ $group: { _id: '$kind', n: { $sum: 1 } } }]).toArray(),
      col('testAttempts').countDocuments({ startedAt: { $gte: new Date(Date.now() - 864e5) } }),
      col('activity').countDocuments({ day: dayKey() }),
      col('questions').countDocuments({ status: 'published', premium: true }),
      col('reports').distinct('qid', { status: 'open' }).then((q) => q.length),
      col('errors').countDocuments({ lastAt: { $gte: new Date(Date.now() - 864e5) } }),
    ]);
    res.json({
      users,
      pro,
      premiumQuestions: premiumQs,
      openReports,
      errors24h,
      activeToday,
      attemptsToday,
      questions: Object.fromEntries(byStatus.map((r) => [r._id || 'unknown', r.n])),
      publishedBySubjectType: bySubject.map((r) => ({ subject: r._id.s, type: r._id.t, count: r.n })),
      tests: Object.fromEntries(tests.map((r) => [r._id, r.n])),
    });
  }),
);

adminRouter.get(
  '/questions',
  ah(async (req, res) => {
    const f = {};
    if (['draft', 'published', 'hidden'].includes(req.query.status)) f.status = req.query.status;
    if (SUBJECTS.includes(req.query.subject)) f.subject = req.query.subject;
    if (req.query.source) f['source.name'] = String(req.query.source);
    if (req.query.search) {
      const s = String(req.query.search).trim();
      if (/^#?\d+$/.test(s)) f.qid = Number(s.replace('#', ''));
      else applySearch(f, s);
    }
    const page = int(req.query.page, 1, 1, 100000);
    const filter = await textOrScan(col('questions'), f);
    const [items, total, sources] = await Promise.all([
      col('questions').find(filter).sort({ qid: 1 }).skip((page - 1) * 25).limit(25).toArray(),
      col('questions').countDocuments(filter),
      col('questions').distinct('source.name'),
    ]);
    res.json({ total, page, items, sources });
  }),
);

function cleanQuestion(b, partial = false) {
  const out = {};
  const need = (k) => !partial || b[k] !== undefined;
  if (need('subject')) {
    if (!SUBJECTS.includes(b.subject)) throw bad('subject must be physics, chemistry or maths');
    out.subject = b.subject;
  }
  if (need('type')) {
    if (!TYPES.includes(b.type)) throw bad('type must be single, multi or numerical');
    out.type = b.type;
  }
  if (need('difficulty')) out.difficulty = DIFFICULTIES.includes(b.difficulty) ? b.difficulty : 'medium';
  for (const k of ['chapter', 'topic', 'text', 'solution']) if (b[k] !== undefined) out[k] = String(b[k]);
  if (b.options !== undefined) {
    if (!Array.isArray(b.options)) throw bad('options must be a list');
    out.options = b.options.map((o, i) => ({ key: String(o.key || 'ABCDEFGH'[i]).toUpperCase(), text: String(o.text ?? '') }));
  }
  if (b.answer !== undefined) out.answer = b.answer;
  if (b.status !== undefined) {
    if (!['draft', 'published', 'hidden'].includes(b.status)) throw bad('bad status');
    out.status = b.status;
  }
  if (b.premium !== undefined) out.premium = !!b.premium;
  if (b.pyq !== undefined) out.pyq = b.pyq;
  if (b.chapterId !== undefined) out.chapterId = b.chapterId ? String(b.chapterId) : null; // checked against the subject by the caller
  return out;
}

/** Standard chapter for a created/edited question: an admin's pick wins, else it follows the chapter name. */
function withChapterId(set, cur = {}) {
  const subject = set.subject || cur.subject;
  if (set.chapterId !== undefined) {
    if (set.chapterId && !syllabusChapter(subject, set.chapterId)) throw bad('Unknown standard chapter for this subject');
    set.chapterIdSource = 'manual';
    return set;
  }
  const renamed = (set.chapter !== undefined && set.chapter !== cur.chapter) || (set.subject && set.subject !== cur.subject);
  if (renamed && cur.chapterIdSource !== 'manual') Object.assign(set, chapterIdFields(subject, set.chapter ?? cur.chapter));
  return set;
}

adminRouter.post(
  '/questions',
  ah(async (req, res) => {
    const q = withChapterId(cleanQuestion(req.body));
    const doc = { ...q, ...fingerprint(q), qid: await nextSeq('qid'), status: q.status || 'draft', stats: { attempts: 0, solved: 0 }, source: { name: 'manual' }, createdAt: new Date() };
    await col('questions').insertOne(doc);
    res.status(201).json(doc);
  }),
);

adminRouter.patch(
  '/questions/:qid',
  ah(async (req, res) => {
    const set = cleanQuestion(req.body, true);
    if (set.chapter !== undefined || set.subject !== undefined || set.chapterId !== undefined) {
      const cur = await col('questions').findOne({ qid: int(req.params.qid, 0) }, { projection: { subject: 1, chapter: 1, chapterIdSource: 1 } });
      withChapterId(set, cur || {});
    }
    if (set.status === 'published') {
      const cur = await col('questions').findOne({ qid: int(req.params.qid, 0) });
      const merged = { ...cur, ...set };
      if (!merged.answer || (!merged.answer.keys?.length && !Number.isFinite(merged.answer.value) && !Number.isFinite(merged.answer.min))) {
        throw bad('Add a correct answer before publishing');
      }
    }
    if (set.premium !== undefined) set.premiumSource = 'manual'; // automatic selection won't override this
    const qid = int(req.params.qid, 0);
    const unset = {};
    if (set.difficulty !== undefined) {
      const cur = await col('questions').findOne({ qid }, { projection: { difficulty: 1 } });
      if (cur && cur.difficulty !== set.difficulty) set.difficultySource = 'manual'; // calibration won't override this
    }
    if (set.status === 'published') unset.duplicateOf = ''; // re-publishing a merged copy un-merges it
    let r = await col('questions').findOneAndUpdate(
      { qid },
      { $set: { ...set, manual: true, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { returnDocument: 'after' },
    );
    if (!r) throw notFound();
    const f = fingerprint(r);
    if (f.fp !== (r.fp ?? null) || f.fpText !== (r.fpText ?? null)) {
      await col('questions').updateOne({ qid }, { $set: f });
      r = { ...r, ...f };
      clearDuplicateCache();
    }
    res.json(r);
  }),
);

/**
 * Student reports, grouped by question (most-reported first), with the full question
 * so the admin can open it straight in the editor.
 */
adminRouter.get(
  '/reports',
  ah(async (req, res) => {
    const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    const page = int(req.query.page, 1, 1, 10000);
    const limit = 20;
    // Grouped in JS (like the profile page) so it also runs on Mongo-compatible databases
    // without $group accumulators. The open queue stays small; closed lists show the latest 5,000 reports.
    const rows = await col('reports')
      .find({ status }, { projection: { qid: 1, reason: 1, note: 1, userId: 1, createdAt: 1, from: 1 } })
      .sort({ createdAt: -1 })
      .limit(5000)
      .toArray();
    const byQid = new Map();
    for (const r of rows) {
      const g = byQid.get(r.qid) || { _id: r.qid, count: 0, latest: r.createdAt, reasons: [], notes: [] };
      g.count += 1;
      g.reasons.push(r.reason);
      g.notes.push({ note: r.note, userId: r.userId, at: r.createdAt, reason: r.reason, from: r.from });
      byQid.set(r.qid, g);
    }
    const all = [...byQid.values()].sort((a, b) => b.count - a.count || b.latest - a.latest);
    const groups = all.slice((page - 1) * limit, page * limit);
    const qids = groups.map((g) => g._id);
    const userIds = [...new Set(groups.flatMap((g) => g.notes.slice(0, 5).map((n) => String(n.userId))))].map((id) => new ObjectId(id));
    const [questions, users] = await Promise.all([
      col('questions').find({ qid: { $in: qids } }).toArray(),
      col('users').find({ _id: { $in: userIds } }, { projection: { username: 1 } }).toArray(),
    ]);
    const qMap = new Map(questions.map((q) => [q.qid, q]));
    const uMap = new Map(users.map((u) => [String(u._id), u.username]));
    res.json({
      status,
      page,
      total: all.length,
      items: groups.map((g) => {
        const byReason = {};
        for (const r of g.reasons) byReason[r] = (byReason[r] || 0) + 1;
        return {
          qid: g._id,
          count: g.count,
          latest: g.latest,
          byReason,
          notes: g.notes.slice(0, 5).map((n) => ({ ...n, userId: undefined, username: uMap.get(String(n.userId)) || null })),
          question: qMap.get(g._id) || null,
        };
      }),
    });
  }),
);

/** Close every open report on a question: { status: 'resolved' | 'dismissed' | 'open' }. */
adminRouter.patch(
  '/reports/:qid',
  ah(async (req, res) => {
    const status = ['resolved', 'dismissed', 'open'].includes(req.body.status) ? req.body.status : null;
    if (!status) throw bad('status must be resolved, dismissed or open');
    const from = status === 'open' ? { $in: ['resolved', 'dismissed'] } : 'open';
    const r = await col('reports').updateMany(
      { qid: int(req.params.qid, 0), status: from },
      { $set: { status, closedAt: status === 'open' ? null : new Date(), closedBy: new ObjectId(req.user.id) } },
    );
    res.json({ updated: r.modifiedCount });
  }),
);

/** Visitors, sign-ups, active students, sources, retention, referrers. ?days=7|30|90 */
adminRouter.get(
  '/growth',
  ah(async (req, res) => {
    res.json(await growthReport([7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30));
  }),
);

// ---- solutions from the discussion ------------------------------------------------------------

/**
 * Top-voted comments on questions that have no written solution yet — candidates to become the
 * official solution. ?min=2 (votes), ?all=1 to include questions that already have a solution.
 */
adminRouter.get(
  '/solution-candidates',
  ah(async (req, res) => {
    const min = int(req.query.min, 2, 1, 1000);
    const page = int(req.query.page, 1, 1, 1000);
    const limit = 10;
    const comments = await col('comments')
      .find(
        { parentId: null, deleted: { $ne: true }, acceptedAsSolution: { $ne: true }, solutionDismissed: { $ne: true }, score: { $gte: min } },
        { projection: { qid: 1, userId: 1, body: 1, score: 1, createdAt: 1, spoiler: 1 } },
      )
      .sort({ score: -1, createdAt: 1 })
      .limit(2000)
      .toArray();
    const qids = [...new Set(comments.map((c) => c.qid))];
    const questions = await col('questions')
      .find({ qid: { $in: qids }, status: 'published', ...(req.query.all === '1' ? {} : { $or: [{ solution: { $exists: false } }, { solution: '' }, { solution: null }] }) })
      .toArray();
    const qMap = new Map(questions.map((q) => [q.qid, q]));
    const byQ = new Map();
    for (const c of comments) {
      if (!qMap.has(c.qid)) continue;
      const list = byQ.get(c.qid) || [];
      if (list.length < 3) list.push(c);
      byQ.set(c.qid, list);
    }
    const groups = [...byQ.entries()].sort((a, b) => b[1][0].score - a[1][0].score);
    const slice = groups.slice((page - 1) * limit, page * limit);
    const users = await col('users')
      .find({ _id: { $in: slice.flatMap(([, cs]) => cs.map((c) => c.userId)) } }, { projection: { username: 1, name: 1, solutionsAccepted: 1 } })
      .toArray();
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    res.json({
      total: groups.length,
      page,
      items: slice.map(([qid, cs]) => {
        const q = qMap.get(qid);
        return {
          question: { qid, subject: q.subject, chapter: q.chapter, type: q.type, text: q.text, options: q.options || [], answer: q.answer || null, solution: q.solution || '' },
          comments: cs.map((c) => {
            const u = uMap.get(String(c.userId)) || {};
            return { id: String(c._id), body: c.body, score: c.score, createdAt: c.createdAt, author: { username: u.username, name: u.name, accepted: u.solutionsAccepted || 0 } };
          }),
        };
      }),
    });
  }),
);

/** Make a comment the question's official solution. { body? } lets the admin tidy it first. */
adminRouter.post(
  '/solution-candidates/:id/accept',
  ah(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) throw notFound();
    const c = await col('comments').findOne({ _id: new ObjectId(req.params.id) });
    if (!c || c.deleted) throw notFound('Comment not found');
    const author = await col('users').findOne({ _id: c.userId }, { projection: { username: 1 } });
    const q = await col('questions').findOne({ qid: c.qid }, { projection: { solution: 1, solutionSource: 1 } });
    if (!q) throw notFound('Question not found');
    const body = String(req.body.body ?? c.body).trim();
    if (!body) throw bad('The solution is empty');
    await col('questions').updateOne(
      { qid: c.qid },
      {
        $set: {
          solution: body,
          solutionSource: { type: 'comment', commentId: c._id, userId: c.userId, username: author?.username || null, acceptedAt: new Date() },
          ...(q.solution ? { solutionPrevious: q.solution } : {}),
          manual: true, // the importer must not overwrite it
          updatedAt: new Date(),
        },
      },
    );
    // Only one accepted comment per question: un-mark a previously accepted one.
    if (q.solutionSource?.commentId && String(q.solutionSource.commentId) !== String(c._id)) {
      await col('comments').updateOne({ _id: q.solutionSource.commentId }, { $unset: { acceptedAsSolution: '' } });
      await col('users').updateOne({ _id: q.solutionSource.userId, solutionsAccepted: { $gt: 0 } }, { $inc: { solutionsAccepted: -1 } });
    }
    if (!c.acceptedAsSolution) {
      await col('comments').updateOne({ _id: c._id }, { $set: { acceptedAsSolution: true } });
      await col('users').updateOne({ _id: c.userId }, { $inc: { solutionsAccepted: 1 } });
    }
    res.json({ ok: true, qid: c.qid });
  }),
);

/** "Not good enough" — stop suggesting this comment. */
adminRouter.post(
  '/solution-candidates/:id/dismiss',
  ah(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) throw notFound();
    await col('comments').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { solutionDismissed: true } });
    res.json({ ok: true });
  }),
);

// ---- error log (lib/errors.js) ---------------------------------------------------------------

adminRouter.get(
  '/errors',
  ah(async (req, res) => {
    const where = ['server', 'web'].includes(req.query.where) ? { where: req.query.where } : {};
    const items = await col('errors').find(where).sort({ lastAt: -1 }).limit(200).toArray();
    res.json({ items });
  }),
);

/** Mark one error fixed (it reappears if it happens again). */
adminRouter.delete(
  '/errors/:id',
  ah(async (req, res) => {
    await col('errors').deleteOne({ _id: String(req.params.id) });
    res.json({ ok: true });
  }),
);

adminRouter.delete(
  '/errors',
  ah(async (_req, res) => {
    const r = await col('errors').deleteMany({});
    res.json({ deleted: r.deletedCount });
  }),
);

/** Difficulty from students' results: { dryRun, minAttempts } */
adminRouter.post(
  '/difficulty',
  ah(async (req, res) => {
    const minAttempts = int(req.body.minAttempts, 30, 10, 10000);
    res.json(await calibrateDifficulty({ dryRun: req.body.dryRun !== false, minAttempts }));
  }),
);

// ---- duplicate questions --------------------------------------------------------------------

/** Groups of copies of the same question. mode=exact (text + options) | text (text only). */
adminRouter.get(
  '/duplicates',
  ah(async (req, res) => {
    const mode = req.query.mode === 'text' ? 'text' : 'exact';
    const page = int(req.query.page, 1, 1, 100000);
    const limit = 10;
    const groups = await duplicateGroups(mode);
    const [missing, total] = await Promise.all([
      col('questions').countDocuments({ fp: { $exists: false } }, { limit: 1 }),
      col('questions').estimatedDocumentCount(),
    ]);
    res.json({
      mode,
      page,
      totalGroups: groups.length,
      extraCopies: groups.reduce((n, g) => n + g.qids.length - 1, 0),
      needsScan: !!missing || !total,
      scan: scanStatus(),
      items: await describeGroups(groups.slice((page - 1) * limit, page * limit)),
    });
  }),
);

/** Recompute fingerprints for the whole bank (runs in the background; poll GET /duplicates). */
adminRouter.post(
  '/duplicates/scan',
  ah(async (_req, res) => {
    if (!scanStatus().running) scanFingerprints().catch((e) => console.error('Duplicate scan failed', e));
    res.status(202).json(scanStatus());
  }),
);

/** { keep: qid, hide: [qid…] } */
adminRouter.post(
  '/duplicates/merge',
  ah(async (req, res) => {
    const keep = int(req.body.keep, NaN);
    const hide = Array.isArray(req.body.hide) ? req.body.hide.map(Number).filter(Number.isFinite) : [];
    if (!Number.isFinite(keep) || !hide.length) throw bad('Pick the copy to keep and the copies to hide');
    res.json(await mergeGroup(keep, hide));
  }),
);

/** "These aren't the same question" — hide the group from the list. { mode, key } */
adminRouter.post(
  '/duplicates/ignore',
  ah(async (req, res) => {
    const mode = req.body.mode === 'text' ? 'text' : 'exact';
    const key = String(req.body.key || '');
    if (!key) throw bad('Missing group key');
    await col('dupIgnored').updateOne({ mode, key }, { $set: { mode, key, at: new Date() } }, { upsert: true });
    clearDuplicateCache();
    res.json({ ok: true });
  }),
);

/** Merge every exact group whose copies agree on the answer. { dryRun } */
adminRouter.post(
  '/duplicates/auto',
  ah(async (req, res) => {
    res.json(await autoMerge({ dryRun: req.body.dryRun !== false, mode: 'exact' }));
  }),
);

/**
 * Create a contest or mock test.
 * body: { kind: 'contest'|'mock', title, description?, startAt (contest), windowMin (contest),
 *         durationMin, pattern: 'jee_main' | 'custom', sections?: [...], questionIds?: [...],
 *         scheme, rated, premium }
 */
adminRouter.post(
  '/tests',
  ah(async (req, res) => {
    const b = req.body;
    const kind = b.kind === 'mock' ? 'mock' : 'contest';
    const title = String(b.title || '').trim();
    if (title.length < 3) throw bad('Give the test a title');
    const scheme = SCHEMES[b.scheme] ? b.scheme : 'jee_main';
    // Contests and free mocks use only free questions; a Pro mock may use Pro questions.
    const premiumPaper = kind === 'mock' && !!b.premium;

    let questionIds;
    if (Array.isArray(b.questionIds) && b.questionIds.length) {
      questionIds = b.questionIds.map(Number);
      const found = await col('questions').countDocuments({ qid: { $in: questionIds }, status: 'published' });
      if (found !== questionIds.length) throw bad('Some question numbers are missing or unpublished');
    } else if (b.pattern === 'jee_main') {
      questionIds = await pickQuestions(JEE_MAIN_PATTERN, { extra: premiumPaper ? {} : FREE_ONLY });
    } else {
      const sections = (b.sections || []).map((s) => ({
        subject: SUBJECTS.includes(s.subject) ? s.subject : undefined,
        type: TYPES.includes(s.type) ? s.type : undefined,
        difficulty: DIFFICULTIES.includes(s.difficulty) ? s.difficulty : undefined,
        chapters: Array.isArray(s.chapters) && s.chapters.length ? s.chapters : undefined,
        count: int(s.count, 0, 0, 100),
      })).filter((s) => s.count > 0);
      if (!sections.length) throw bad('Add at least one section');
      questionIds = await pickQuestions(sections, { extra: premiumPaper ? {} : FREE_ONLY });
    }

    const t = {
      kind,
      title,
      description: String(b.description || ''),
      questionIds,
      scheme,
      durationMin: int(b.durationMin, kind === 'mock' ? 180 : 60, 5, 300),
      premium: kind === 'mock' && !!b.premium,
      rated: kind === 'contest' && b.rated !== false,
      createdBy: new ObjectId(req.user.id),
      createdAt: new Date(),
    };
    if (kind === 'contest') {
      const startAt = new Date(b.startAt);
      if (Number.isNaN(startAt.getTime())) throw bad('Pick a start time');
      t.startAt = startAt;
      t.endAt = new Date(startAt.getTime() + int(b.windowMin, t.durationMin, t.durationMin, 7 * 24 * 60) * 60000);
      t.slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;
    }
    const r = await col('tests').insertOne(t);

    // Hide contest questions from the practice list until the contest is over.
    if (kind === 'contest') {
      await col('questions').updateMany({ qid: { $in: questionIds } }, { $max: { lockedUntil: t.endAt } });
    }
    res.status(201).json({ id: String(r.insertedId), slug: t.slug, questionIds });
  }),
);

adminRouter.delete(
  '/tests/:id',
  ah(async (req, res) => {
    const _id = new ObjectId(req.params.id);
    if (await col('testAttempts').countDocuments({ testId: _id })) throw bad('People have already attempted this test; hide it instead');
    const t = await col('tests').findOneAndDelete({ _id });
    if (t?.kind === 'contest') await col('questions').updateMany({ qid: { $in: t.questionIds }, lockedUntil: t.endAt }, { $unset: { lockedUntil: '' } });
    res.json({ ok: true });
  }),
);

adminRouter.patch(
  '/tests/:id',
  ah(async (req, res) => {
    const set = {};
    if (req.body.hidden !== undefined) set.hidden = !!req.body.hidden;
    if (req.body.title) set.title = String(req.body.title);
    if (req.body.description !== undefined) set.description = String(req.body.description);
    await col('tests').updateOne({ _id: new ObjectId(req.params.id) }, { $set: set });
    res.json({ ok: true });
  }),
);

/** Manual Pro upgrade (until a payment gateway is wired in). */
adminRouter.patch(
  '/users/:username',
  ah(async (req, res) => {
    const set = {};
    if (['free', 'pro'].includes(req.body.plan)) set.plan = req.body.plan;
    if (['student', 'admin'].includes(req.body.role)) set.role = req.body.role;
    const r = await col('users').findOneAndUpdate({ username: String(req.params.username).toLowerCase() }, { $set: set }, { returnDocument: 'after' });
    if (!r) throw notFound('User not found');
    res.json({ username: r.username, plan: r.plan, role: r.role });
  }),
);

/**
 * Automatic Pro selection: { percent: 20, includePyq: false, dryRun: true }.
 * Dry run returns the counts without changing anything.
 */
adminRouter.post(
  '/premium',
  ah(async (req, res) => {
    const percent = Number(req.body.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 60) throw bad('Percent must be between 0 and 60');
    res.json(await applyPremium({ percent, includePyq: !!req.body.includePyq, dryRun: req.body.dryRun !== false }));
  }),
);

// ---------------------------------------------------------------- standard chapters review

/**
 * Admin → Chapters: questions the importer couldn't place in a standard chapter, with the text-based
 * guess from `npm run chapters:classify`, most confident first. Also lists auto-placed ones to spot-check.
 */
adminRouter.get(
  '/chapters',
  ah(async (req, res) => {
    const rows = await col('questions').aggregate([{ $group: { _id: { subject: '$subject', src: '$chapterIdSource' }, n: { $sum: 1 } } }]).toArray();
    const summary = Object.fromEntries(SUBJECTS.map((s) => [s, { name: 0, auto: 0, manual: 0, none: 0 }]));
    for (const r of rows) if (summary[r._id.subject]) summary[r._id.subject][r._id.src || 'none'] = (summary[r._id.subject][r._id.src || 'none'] || 0) + r.n;

    const subject = SUBJECTS.includes(req.query.subject) ? req.query.subject : 'maths';
    const src = req.query.status === 'auto' ? 'auto' : 'none';
    const page = int(req.query.page, 1, 1, 10000);
    const match = { subject, chapterIdSource: src, status: { $ne: 'hidden' } };
    const [total, items] = await Promise.all([
      col('questions').countDocuments(match),
      col('questions')
        .find(match, { projection: { qid: 1, subject: 1, chapter: 1, topic: 1, text: 1, options: 1, chapterId: 1, chapterGuess: 1, status: 1 } })
        .sort({ 'chapterGuess.p': src === 'auto' ? 1 : -1, qid: 1 }) // unplaced: surest first; auto: least sure first
        .skip((page - 1) * 20)
        .limit(20)
        .toArray(),
    ]);
    const name = (id) => syllabusChapter(subject, id)?.name || null;
    res.json({
      summary,
      subject,
      status: src,
      total,
      items: items.map((q) => ({
        qid: q.qid,
        status: q.status,
        chapter: q.chapter || null,
        topic: q.topic || null,
        text: previewOf(q.text, 400),
        options: (q.options || []).map((o) => ({ key: o.key, text: previewOf(o.text, 120) })),
        chapterId: q.chapterId || null,
        chapterName: name(q.chapterId),
        guess: q.chapterGuess?.id ? { id: q.chapterGuess.id, name: name(q.chapterGuess.id), p: q.chapterGuess.p, second: q.chapterGuess.second, secondName: name(q.chapterGuess.second) } : null,
      })),
    });
  }),
);

/** Set one question's standard chapter by hand (null = "no JEE chapter fits"). Never changed by scripts afterwards. */
adminRouter.post(
  '/chapters/:qid',
  ah(async (req, res) => {
    const qid = int(req.params.qid, 0);
    const q = await col('questions').findOne({ qid }, { projection: { subject: 1 } });
    if (!q) throw notFound();
    const id = req.body.chapterId ? String(req.body.chapterId) : null;
    if (id && !syllabusChapter(q.subject, id)) throw bad('Unknown chapter for this subject');
    await col('questions').updateOne({ qid }, { $set: { chapterId: id, chapterIdSource: 'manual', updatedAt: new Date() } });
    clearChapterCache();
    res.json({ ok: true });
  }),
);

/** Accept every remaining guess at or above a confidence, for one subject. */
adminRouter.post(
  '/chapters-accept',
  ah(async (req, res) => {
    const subject = SUBJECTS.includes(req.body.subject) ? req.body.subject : null;
    const minP = Math.min(1, Math.max(0.5, Number(req.body.minP) || 0.8));
    if (!subject) throw bad('subject?');
    const rows = await col('questions')
      .find({ subject, chapterIdSource: 'none', 'chapterGuess.p': { $gte: minP } }, { projection: { _id: 1, chapterGuess: 1 } })
      .toArray();
    const ops = rows
      .filter((r) => syllabusChapter(subject, r.chapterGuess?.id))
      .map((r) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { chapterId: r.chapterGuess.id, chapterIdSource: 'manual' } } } }));
    for (let i = 0; i < ops.length; i += 1000) await col('questions').bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    clearChapterCache();
    res.json({ accepted: ops.length });
  }),
);
