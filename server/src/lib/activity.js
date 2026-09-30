import { col } from '../db.js';
import { dayKey } from './util.js';

/** Bumps the daily heatmap count and the user's streak (IST calendar days). */
export async function recordActivity(userId, n = 1) {
  const today = dayKey();
  await col('activity').updateOne({ userId, day: today }, { $inc: { count: n } }, { upsert: true });

  const u = await col('users').findOne({ _id: userId }, { projection: { streak: 1 } });
  const s = u?.streak || { current: 0, best: 0, lastDay: null };
  if (s.lastDay === today) return;

  const yesterday = dayKey(new Date(Date.now() - 864e5));
  const current = s.lastDay === yesterday ? s.current + 1 : 1;
  await col('users').updateOne(
    { _id: userId },
    { $set: { streak: { current, best: Math.max(s.best || 0, current), lastDay: today } } },
  );
}
