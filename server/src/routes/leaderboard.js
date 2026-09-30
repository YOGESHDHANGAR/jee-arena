import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { col } from '../db.js';
import { ah, int, weekStart } from '../lib/util.js';

export const leaderboardRouter = Router();

// Global boards change only when contests finalize or people solve problems,
// so a 60-second cache keeps this to ~1 DB query per minute however busy the site is.
const cache = new Map();
const TTL = 60 * 1000;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

/**
 * Questions solved (first solves) in [from, to), most first. Grouped in JS: a week's solves are a
 * modest number of small rows, and this stays portable across Mongo-compatible databases.
 */
async function solvedBetween(from, to) {
  const rows = await col('progress')
    .find({ status: 'solved', solvedAt: { $gte: from, $lt: to } }, { projection: { _id: 0, userId: 1 } })
    .toArray();
  const counts = new Map();
  for (const r of rows) counts.set(String(r.userId), (counts.get(String(r.userId)) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const users = await col('users')
    .find({ _id: { $in: ranked.slice(0, 1000).map(([id]) => new ObjectId(id)) } }, { projection: { name: 1, username: 1, rating: 1, streak: 1 } })
    .toArray();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  let rank = 0;
  let prev = null;
  return ranked.map(([id, n], i) => {
    if (n !== prev) rank = i + 1; // ties share a rank
    prev = n;
    const u = uMap.get(id) || {};
    return { rank, id, name: u.name, username: u.username, rating: u.rating, solvedThisWeek: n, streak: u.streak?.current || 0 };
  });
}

/** This week's board (resets Monday 00:00 IST) plus last week's top 3. */
leaderboardRouter.get(
  '/week',
  ah(async (req, res) => {
    const page = int(req.query.page, 1, 1, 2000);
    const limit = 50;
    const start = weekStart();
    const end = new Date(start.getTime() + 7 * 864e5);
    const lastStart = new Date(start.getTime() - 7 * 864e5);
    const [all, last] = await Promise.all([
      cached(`week:${start.toISOString()}`, () => solvedBetween(start, end)),
      cached(`lastweek:${lastStart.toISOString()}`, () => solvedBetween(lastStart, start)),
    ]);
    const mine = req.user ? all.find((r) => r.id === req.user.id) : null;
    res.json({
      weekStart: start,
      resetsAt: end,
      total: all.length,
      page,
      items: all.slice((page - 1) * limit, page * limit),
      me: mine ? { rank: mine.rank, solvedThisWeek: mine.solvedThisWeek } : null,
      lastWeek: last.slice(0, 3),
    });
  }),
);

leaderboardRouter.get(
  '/',
  ah(async (req, res) => {
    const by = req.query.by === 'solved' ? 'solved' : 'rating';
    const page = int(req.query.page, 1, 1, 2000);
    const limit = 50;
    const filter = by === 'rating' ? { contestsPlayed: { $gt: 0 } } : { solvedCount: { $gt: 0 } };
    const sort = by === 'rating' ? { rating: -1, contestsPlayed: -1 } : { solvedCount: -1, rating: -1 };

    const data = await cached(`${by}:${page}`, async () => {
      const [rows, total] = await Promise.all([
        col('users')
          .find(filter, { projection: { name: 1, username: 1, rating: 1, solvedCount: 1, contestsPlayed: 1, streak: 1 } })
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
        col('users').countDocuments(filter),
      ]);
      return {
        total,
        page,
        items: rows.map((u, i) => ({
          rank: (page - 1) * limit + i + 1,
          id: String(u._id),
          name: u.name,
          username: u.username,
          rating: u.rating,
          solvedCount: u.solvedCount || 0,
          contestsPlayed: u.contestsPlayed || 0,
          streak: u.streak?.current || 0,
        })),
      };
    });

    let me = null;
    if (req.user) {
      const u = await col('users').findOne({ _id: new ObjectId(req.user.id) }, { projection: { rating: 1, solvedCount: 1, contestsPlayed: 1 } });
      if (u && (by === 'rating' ? u.contestsPlayed : u.solvedCount)) {
        const better = await col('users').countDocuments(
          by === 'rating' ? { contestsPlayed: { $gt: 0 }, rating: { $gt: u.rating } } : { solvedCount: { $gt: u.solvedCount } },
        );
        me = { rank: better + 1 };
      }
    }
    res.json({ ...data, me });
  }),
);
