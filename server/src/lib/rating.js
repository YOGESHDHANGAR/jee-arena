/**
 * Contest rating, Elo-style for many players at once (similar in spirit to
 * LeetCode / Codeforces, simplified).
 *
 * For each player we compute the rank they were *expected* to get from
 * everyone's pre-contest rating (1 + sum of win probabilities of others),
 * compare it with the rank they actually got, and move their rating by a
 * K-weighted, normalised difference. New players move faster.
 *
 * participants: [{ userId, rating, contestsPlayed, rank }]  (rank 1 = best, ties allowed)
 * returns:      [{ userId, before, after, delta, expectedRank }]
 */
export const DEFAULT_RATING = 1500;

const winProb = (ra, rb) => 1 / (1 + 10 ** ((ra - rb) / 400)); // P(b beats a)

export function computeRatingChanges(participants) {
  const n = participants.length;
  if (n < 2) {
    return participants.map((p) => ({ userId: p.userId, before: p.rating, after: p.rating, delta: 0, expectedRank: 1 }));
  }

  // Exact O(n^2) for normal sizes; above that, estimate against a fixed sample.
  const MAX_EXACT = 3000;
  const pool = n <= MAX_EXACT ? participants : sample(participants, MAX_EXACT);
  const scale = n <= MAX_EXACT ? 1 : (n - 1) / pool.length;

  const raw = participants.map((p) => {
    let exp = 1;
    for (const o of pool) if (o !== p) exp += winProb(p.rating, o.rating) * scale;
    const k = (p.contestsPlayed || 0) < 5 ? 160 : 80;
    const normalised = (exp - p.rank) / (n - 1); // in [-1, 1]
    return { p, exp, delta: k * normalised };
  });

  // Keep the total roughly zero-sum so ratings don't inflate over time.
  const mean = raw.reduce((s, r) => s + r.delta, 0) / n;

  return raw.map(({ p, exp, delta }) => {
    const d = Math.round(delta - mean);
    return {
      userId: p.userId,
      before: p.rating,
      after: Math.max(0, p.rating + d),
      delta: d,
      expectedRank: Math.round(exp * 10) / 10,
    };
  });
}

/** Standard competition ranking (1,2,2,4) by score desc, then time asc. */
export function assignRanks(rows) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.timeTakenSec - b.timeTakenSec);
  let lastKey = null;
  let lastRank = 0;
  sorted.forEach((r, i) => {
    const key = `${r.score}|${r.timeTakenSec}`;
    r.rank = key === lastKey ? lastRank : i + 1;
    lastKey = key;
    lastRank = r.rank;
  });
  return sorted;
}

function sample(arr, k) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}
