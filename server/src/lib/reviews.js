import { ObjectId } from 'mongodb';
import { col } from '../db.js';

/**
 * Spaced revision of mistakes. A question a student gets wrong (in practice or a test), gives up on,
 * or saves with "Save to revise" comes back 1 day later. Right when it's due -> again in 3 days,
 * then 7 days, then it's done. Wrong at any point -> back to 1 day.
 *
 * reviews: { userId, qid, stage (0..2), due, addedAt, lastAt, lapses, source }
 * Answering correctly before the question is due (straight after a mistake, say) doesn't count:
 * the point is to remember it days later.
 */
export const INTERVAL_DAYS = [1, 3, 7];
const DAY = 864e5;
const GRACE = 3 * 3600 * 1000; // due "today" includes later today

const oid = (id) => (id instanceof ObjectId ? id : new ObjectId(String(id)));

/** Wrong answer / gave up / saved: schedule for tomorrow (or back to the start if already in revision). */
export async function recordMistake(userId, qid, source = 'practice', now = new Date()) {
  await col('reviews').updateOne(
    { userId: oid(userId), qid },
    {
      $set: { stage: 0, due: new Date(now.getTime() + INTERVAL_DAYS[0] * DAY), lastAt: now },
      $setOnInsert: { addedAt: now, source },
      $inc: { lapses: 1 },
    },
    { upsert: true },
  );
}

/** Right answer: moves a due revision one step on (3 days, 7 days, done). Returns the new state or null. */
export async function recordSuccess(userId, qid, now = new Date()) {
  const r = await col('reviews').findOne({ userId: oid(userId), qid });
  if (!r || r.due.getTime() > now.getTime() + GRACE) return null;
  const stage = r.stage + 1;
  if (stage >= INTERVAL_DAYS.length) {
    await col('reviews').deleteOne({ _id: r._id });
    return { done: true };
  }
  const due = new Date(now.getTime() + INTERVAL_DAYS[stage] * DAY);
  await col('reviews').updateOne({ _id: r._id }, { $set: { stage, due, lastAt: now } });
  return { stage, due };
}

/** A graded test: every wrong/partial answer is a mistake, every correct one a success. */
export async function recordTestResults(userId, perQuestion = [], now = new Date()) {
  for (const p of perQuestion) {
    if (p.status === 'wrong' || p.status === 'partial') await recordMistake(userId, p.qid, 'test', now);
    else if (p.status === 'correct') await recordSuccess(userId, p.qid, now);
  }
}

const dueBy = (now = new Date()) => new Date(now.getTime() + GRACE);

export const dueCount = (userId) => col('reviews').countDocuments({ userId: oid(userId), due: { $lte: dueBy() } });

export async function dueQids(userId, limit = 500) {
  const rows = await col('reviews').find({ userId: oid(userId), due: { $lte: dueBy() } }, { projection: { qid: 1 } }).sort({ due: 1 }).limit(limit).toArray();
  return rows.map((r) => r.qid);
}

/** Due now, coming up over the next 7 days (per day), and everything in revision. */
export async function reviewSummary(userId) {
  const rows = await col('reviews').find({ userId: oid(userId) }, { projection: { _id: 0, due: 1, stage: 1 } }).toArray();
  const now = Date.now();
  const due = rows.filter((r) => r.due.getTime() <= now + GRACE).length;
  const week = Array.from({ length: 7 }, (_, i) => rows.filter((r) => {
    const t = r.due.getTime();
    return t > now + GRACE + (i - 1) * DAY && t <= now + GRACE + i * DAY;
  }).length);
  return { due, total: rows.length, upcoming: week.slice(1), byStage: INTERVAL_DAYS.map((_, s) => rows.filter((r) => r.stage === s).length) };
}

export async function isSaved(userId, qid) {
  return !!(await col('reviews').findOne({ userId: oid(userId), qid }, { projection: { _id: 1 } }));
}
