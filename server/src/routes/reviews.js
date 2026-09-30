import { Router } from 'express';
import { requireUser } from '../auth.js';
import { ah, int } from '../lib/util.js';
import { col } from '../db.js';
import { recordMistake, reviewSummary } from '../lib/reviews.js';
import { ObjectId } from 'mongodb';

/** Spaced revision (lib/reviews.js): what's due, and "Save to revise" from a test review. */
export const reviewsRouter = Router();

reviewsRouter.get(
  '/',
  requireUser,
  ah(async (req, res) => res.json(await reviewSummary(req.user.id))),
);

/** Save a question to revise (comes back tomorrow). */
reviewsRouter.post(
  '/:qid',
  requireUser,
  ah(async (req, res) => {
    await recordMistake(req.user.id, int(req.params.qid, 0), 'saved');
    res.json({ saved: true });
  }),
);

reviewsRouter.delete(
  '/:qid',
  requireUser,
  ah(async (req, res) => {
    await col('reviews').deleteOne({ userId: new ObjectId(req.user.id), qid: int(req.params.qid, 0) });
    res.json({ saved: false });
  }),
);
