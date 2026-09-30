import { Router } from 'express';
import { ObjectId } from 'mongodb';
import rateLimit from 'express-rate-limit';
import { col } from '../db.js';
import { requireUser } from '../auth.js';
import { ah, bad, forbidden, notFound, int, practiceFilter } from '../lib/util.js';
import { hasPro } from '../lib/premium.js';

/**
 * Discussion under each question.
 *   comments: { qid, userId, parentId (null = top level), body, spoiler, voters[], score,
 *               replyCount, createdAt, editedAt?, deleted? }
 * One level of replies (like LeetCode). Bodies support the same LaTeX/markdown as questions.
 */
export const commentsRouter = Router();

const MAX_LEN = 2000;
const postLimit = rateLimit({ windowMs: 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down a little — try again in a minute' } });

const shape = (c, users, viewerId) => {
  const u = users.get(String(c.userId)) || {};
  return {
    id: String(c._id),
    parentId: c.parentId ? String(c.parentId) : null,
    body: c.deleted ? '' : c.body,
    deleted: !!c.deleted,
    spoiler: !!c.spoiler,
    score: c.score || 0,
    voted: !!viewerId && (c.voters || []).some((v) => String(v) === viewerId),
    mine: !!viewerId && String(c.userId) === viewerId,
    replyCount: c.replyCount || 0,
    accepted: !!c.acceptedAsSolution, // chosen as the question's official solution
    createdAt: c.createdAt,
    editedAt: c.editedAt || null,
    author: c.deleted ? null : { name: u.name, username: u.username, rating: u.rating },
  };
};

async function authors(list) {
  const ids = [...new Set(list.map((c) => String(c.userId)))].map((s) => new ObjectId(s));
  const rows = ids.length ? await col('users').find({ _id: { $in: ids } }, { projection: { name: 1, username: 1, rating: 1 } }).toArray() : [];
  return new Map(rows.map((u) => [String(u._id), u]));
}

async function questionExists(qid, req) {
  const q = await col('questions').findOne({ qid, ...practiceFilter() }, { projection: { _id: 1, premium: 1 } });
  if (!q) throw notFound('Question not found');
  // Discussions often contain the answer, so a Pro question's discussion is Pro too.
  if (q.premium && !(await hasPro(req))) throw forbidden('This is a Pro question');
  return q;
}

/** GET /problems/:qid/comments?sort=top|new&page=1 — top-level comments with their replies. */
commentsRouter.get(
  '/problems/:qid/comments',
  ah(async (req, res) => {
    const qid = int(req.params.qid, NaN);
    if (!Number.isFinite(qid)) throw notFound();
    await questionExists(qid, req);
    const page = int(req.query.page, 1, 1, 1000);
    const limit = 20;
    const sort = req.query.sort === 'new' ? { createdAt: -1 } : { score: -1, createdAt: -1 };
    const filter = { qid, parentId: null };
    const [top, total] = await Promise.all([
      col('comments').find(filter).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
      col('comments').countDocuments(filter),
    ]);
    const replies = top.length
      ? await col('comments').find({ parentId: { $in: top.map((c) => c._id) } }).sort({ createdAt: 1 }).limit(500).toArray()
      : [];
    const users = await authors([...top, ...replies]);
    const viewer = req.user?.id;
    const byParent = new Map();
    for (const r of replies) {
      const k = String(r.parentId);
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(shape(r, users, viewer));
    }
    res.json({
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      items: top
        // A deleted comment with no replies left has nothing to show.
        .filter((c) => !c.deleted || byParent.has(String(c._id)))
        .map((c) => ({ ...shape(c, users, viewer), replies: byParent.get(String(c._id)) || [] })),
    });
  }),
);

commentsRouter.post(
  '/problems/:qid/comments',
  requireUser,
  postLimit,
  ah(async (req, res) => {
    const qid = int(req.params.qid, NaN);
    if (!Number.isFinite(qid)) throw notFound();
    const body = String(req.body.body || '').trim();
    if (!body) throw bad('Write something first');
    if (body.length > MAX_LEN) throw bad(`Keep it under ${MAX_LEN} characters`);
    const q = await questionExists(qid, req);

    let parentId = null;
    if (req.body.parentId) {
      if (!ObjectId.isValid(req.body.parentId)) throw bad('Bad reply target');
      const parent = await col('comments').findOne({ _id: new ObjectId(req.body.parentId), qid });
      if (!parent || parent.deleted) throw bad('That comment is no longer available');
      // Replies to a reply attach to the top-level comment (one level deep).
      parentId = parent.parentId || parent._id;
    }

    const userId = new ObjectId(req.user.id);
    const doc = { qid, userId, parentId, body, spoiler: !!req.body.spoiler, voters: [], score: 0, replyCount: 0, createdAt: new Date() };
    const r = await col('comments').insertOne(doc);
    doc._id = r.insertedId;
    await Promise.all([
      col('questions').updateOne({ _id: q._id }, { $inc: { commentCount: 1 } }),
      parentId ? col('comments').updateOne({ _id: parentId }, { $inc: { replyCount: 1 } }) : null,
    ]);
    const users = await authors([doc]);
    res.status(201).json({ ...shape(doc, users, req.user.id), replies: [] });
  }),
);

async function ownOrAdmin(req) {
  if (!ObjectId.isValid(req.params.id)) throw notFound();
  const c = await col('comments').findOne({ _id: new ObjectId(req.params.id) });
  if (!c || c.deleted) throw notFound('Comment not found');
  if (String(c.userId) !== req.user.id && req.user.role !== 'admin') throw forbidden('Not your comment');
  return c;
}

commentsRouter.patch(
  '/comments/:id',
  requireUser,
  ah(async (req, res) => {
    const c = await ownOrAdmin(req);
    const body = String(req.body.body || '').trim();
    if (!body) throw bad('Write something first');
    if (body.length > MAX_LEN) throw bad(`Keep it under ${MAX_LEN} characters`);
    const set = { body, editedAt: new Date() };
    if (req.body.spoiler !== undefined) set.spoiler = !!req.body.spoiler;
    await col('comments').updateOne({ _id: c._id }, { $set: set });
    res.json({ ok: true, ...set });
  }),
);

commentsRouter.delete(
  '/comments/:id',
  requireUser,
  ah(async (req, res) => {
    const c = await ownOrAdmin(req);
    if (c.replyCount > 0) {
      // Keep the thread readable: blank the comment but keep its replies.
      await col('comments').updateOne({ _id: c._id }, { $set: { deleted: true, body: '' } });
    } else {
      await col('comments').deleteOne({ _id: c._id });
      if (c.parentId) await col('comments').updateOne({ _id: c.parentId }, { $inc: { replyCount: -1 } });
    }
    await col('questions').updateOne({ qid: c.qid }, { $inc: { commentCount: -1 } });
    res.json({ ok: true });
  }),
);

/** Toggle an upvote. */
commentsRouter.post(
  '/comments/:id/vote',
  requireUser,
  ah(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) throw notFound();
    const _id = new ObjectId(req.params.id);
    const userId = new ObjectId(req.user.id);
    const c = await col('comments').findOne({ _id }, { projection: { voters: 1, userId: 1 } });
    if (!c) throw notFound('Comment not found');
    const has = (c.voters || []).some((v) => String(v) === req.user.id);
    await col('comments').updateOne({ _id }, has ? { $pull: { voters: userId }, $inc: { score: -1 } } : { $addToSet: { voters: userId }, $inc: { score: 1 } });
    res.json({ voted: !has, score: (c.voters?.length || 0) + (has ? -1 : 1) });
  }),
);
