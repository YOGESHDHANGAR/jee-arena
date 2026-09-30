import { col } from '../db.js';

/**
 * Difficulty from real results instead of the source's label.
 *
 * For a question with enough students (default 30), the share who solved it — pulled a little towards
 * the bank-wide average so 30 lucky students don't make a hard question "easy" — decides the level:
 *   ≥ 70% solve it → easy,  40–70% → medium,  < 40% → hard.
 * A question most students solve but only slowly (average solve over 4 minutes) is at least medium.
 *
 * Questions whose difficulty an admin set by hand (difficultySource: 'manual') are never changed.
 * The source's original label is kept in difficultyOriginal.
 */
export const DEFAULTS = { minAttempts: 30, easyAbove: 0.7, hardBelow: 0.4, prior: 0.55, priorWeight: 10, slowSec: 240 };

export function suggestDifficulty(stats, o = DEFAULTS) {
  const attempts = stats?.attempts || 0;
  if (attempts < o.minAttempts) return null;
  const rate = ((stats.solved || 0) + o.prior * o.priorWeight) / (attempts + o.priorWeight);
  let level = rate >= o.easyAbove ? 'easy' : rate >= o.hardBelow ? 'medium' : 'hard';
  const avg = stats.timeCount ? stats.timeSum / stats.timeCount : null;
  if (level === 'easy' && avg && avg > o.slowSec) level = 'medium';
  return { level, rate: Math.round(rate * 100) };
}

/** Recalculate every eligible question. dryRun returns what would change (from → to counts). */
export async function calibrateDifficulty({ dryRun = true, minAttempts = DEFAULTS.minAttempts } = {}) {
  const o = { ...DEFAULTS, minAttempts };
  const cursor = col('questions').find(
    { status: 'published', 'stats.attempts': { $gte: minAttempts }, difficultySource: { $ne: 'manual' } },
    { projection: { _id: 1, qid: 1, difficulty: 1, difficultyOriginal: 1, stats: 1 } },
  );
  const moves = {}; // "easy→hard": n
  let eligible = 0;
  let changed = 0;
  let ops = [];
  const flush = async () => {
    if (!dryRun && ops.length) await col('questions').bulkWrite(ops, { ordered: false });
    ops = [];
  };
  for await (const q of cursor) {
    eligible++;
    const s = suggestDifficulty(q.stats, o);
    if (!s) continue;
    const set = { difficultySource: 'data', solveRate: s.rate };
    if (s.level !== q.difficulty) {
      changed++;
      const k = `${q.difficulty || '?'}→${s.level}`;
      moves[k] = (moves[k] || 0) + 1;
      set.difficulty = s.level;
      if (q.difficultyOriginal === undefined) set.difficultyOriginal = q.difficulty ?? null;
    }
    ops.push({ updateOne: { filter: { _id: q._id }, update: { $set: set } } });
    if (ops.length >= 1000) await flush();
  }
  await flush();
  const withData = await col('questions').countDocuments({ status: 'published', 'stats.attempts': { $gte: minAttempts } });
  return { dryRun, minAttempts, eligible, withData, changed, moves };
}
