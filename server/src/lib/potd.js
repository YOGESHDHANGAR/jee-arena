import { createHash } from 'node:crypto';
import { col } from '../db.js';
import { dayKey, practiceFilter, SUBJECTS } from './util.js';

/** Stable number from a string (same day -> same number on every server). */
const hashNum = (s) => createHash('sha256').update(s).digest().readUInt32BE(0);

/** Subjects take turns: Physics, Chemistry, Maths, Physics, … by calendar day. */
export function potdSubject(day) {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 864e5);
  return SUBJECTS[((n % 3) + 3) % 3];
}

/**
 * Picks the Problem of the Day for `day` deterministically from the free, practisable questions
 * of that day's subject (preferring ones with a written solution, medium or hard, never used before).
 * The pick is stored in `potd` so it doesn't change when the bank changes later in the day.
 */
async function pick(day) {
  const subject = potdSubject(day);
  const used = (await col('potd').find({}, { projection: { qid: 1 } }).toArray()).map((r) => r.qid);
  const base = { ...practiceFilter(), premium: { $ne: true }, qid: { $nin: used } };
  const tries = [
    { ...base, subject, difficulty: { $in: ['medium', 'hard'] }, solution: { $nin: ['', null] } },
    { ...base, subject, solution: { $nin: ['', null] } },
    { ...base, subject },
    { ...practiceFilter(), premium: { $ne: true } }, // bank exhausted: allow repeats / any subject
  ];
  for (const f of tries) {
    const n = await col('questions').countDocuments(f);
    if (!n) continue;
    const q = await col('questions').find(f, { projection: { qid: 1 } }).sort({ qid: 1 }).skip(hashNum(day) % n).limit(1).next();
    if (q) return q.qid;
  }
  return null;
}

/** Today's (or `day`'s) question number, or null if the bank is empty. */
export async function potdQid(day = dayKey()) {
  const saved = await col('potd').findOne({ _id: day });
  if (saved) {
    // Still practisable? (An admin may have hidden it or locked it into a contest since.)
    const ok = await col('questions').countDocuments({ qid: saved.qid, ...practiceFilter(), premium: { $ne: true } });
    if (ok) return saved.qid;
  }
  const qid = await pick(day);
  if (qid === null) return null;
  await col('potd').updateOne({ _id: day }, { $set: { qid, pickedAt: new Date() } }, { upsert: true });
  return qid;
}

/**
 * Called when a student solves a question for the first time. If it's today's Problem of the Day,
 * bumps their POTD streak (separate from the everyday streak, which any submission already counts toward).
 */
export async function recordPotdSolve(userId, qid) {
  const today = dayKey();
  const saved = await col('potd').findOne({ _id: today });
  if (!saved || saved.qid !== qid) return null;
  const u = await col('users').findOne({ _id: userId }, { projection: { potdStreak: 1 } });
  const s = u?.potdStreak || { current: 0, best: 0, lastDay: null };
  if (s.lastDay === today) return s;
  const yesterday = dayKey(new Date(Date.now() - 864e5));
  const current = s.lastDay === yesterday ? s.current + 1 : 1;
  const next = { current, best: Math.max(s.best || 0, current), lastDay: today };
  await col('users').updateOne({ _id: userId }, { $set: { potdStreak: next } });
  return next;
}

/** A streak only counts as current if the last solve was today or yesterday. */
export function liveStreak(s) {
  if (!s?.lastDay) return { current: 0, best: s?.best || 0, lastDay: null };
  const today = dayKey();
  const yesterday = dayKey(new Date(Date.now() - 864e5));
  return { ...s, current: s.lastDay === today || s.lastDay === yesterday ? s.current : 0 };
}
