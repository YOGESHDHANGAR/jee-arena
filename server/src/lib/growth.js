import { col } from '../db.js';
import { dayKey } from './util.js';

/**
 * Numbers for Admin → Growth: visitors, sign-ups and active students per day, where people come from,
 * whether new students come back, and who brings friends. Everything is counted in JS from small
 * projections so it runs on any Mongo-compatible database; fine up to tens of thousands of students.
 */
const DAY = 864e5;
const addDays = (key, n) => dayKey(new Date(Date.parse(`${key}T12:00:00+05:30`) + n * DAY));

export async function growthReport(days = 30) {
  const today = dayKey();
  const from = addDays(today, -(days - 1));
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const since = new Date(Date.parse(`${from}T00:00:00+05:30`));

  // Cohort for "do they come back": signed up 8–37 days ago, so a full week after sign-up is visible.
  const cohortFrom = new Date(Date.now() - 37 * DAY);
  const cohortTo = new Date(Date.now() - 8 * DAY);

  const [totalUsers, newUsers, activity, visits, cohort, referrers, activeWeek, activeMonth] = await Promise.all([
    col('users').estimatedDocumentCount(),
    col('users').find({ createdAt: { $gte: since } }, { projection: { _id: 0, createdAt: 1, signup: 1 } }).toArray(),
    col('activity').find({ day: { $gte: from } }, { projection: { _id: 0, day: 1 } }).toArray(),
    col('visits').find({ day: { $gte: from } }, { projection: { _id: 0, day: 1, source: 1, visits: 1, newVisitors: 1 } }).toArray(),
    col('users').find({ createdAt: { $gte: cohortFrom, $lt: cohortTo } }, { projection: { _id: 1, createdAt: 1 } }).toArray(),
    col('users').find({ referrals: { $gt: 0 } }, { projection: { _id: 0, username: 1, name: 1, referrals: 1 } }).sort({ referrals: -1 }).limit(10).toArray(),
    col('activity').distinct('userId', { day: { $gte: addDays(today, -6) } }).then((a) => a.length),
    col('activity').distinct('userId', { day: { $gte: addDays(today, -29) } }).then((a) => a.length),
  ]);

  const perDay = Object.fromEntries(dayList.map((d) => [d, { day: d, visits: 0, newVisitors: 0, signups: 0, active: 0 }]));
  for (const u of newUsers) {
    const d = dayKey(u.createdAt);
    if (perDay[d]) perDay[d].signups++;
  }
  for (const a of activity) if (perDay[a.day]) perDay[a.day].active++; // one activity row per student per day
  const bySource = {};
  const src = (s) => (bySource[s] ||= { source: s, visits: 0, newVisitors: 0, signups: 0 });
  for (const v of visits) {
    if (perDay[v.day]) {
      perDay[v.day].visits += v.visits || 0;
      perDay[v.day].newVisitors += v.newVisitors || 0;
    }
    src(v.source).visits += v.visits || 0;
    src(v.source).newVisitors += v.newVisitors || 0;
  }
  for (const u of newUsers) src(u.signup?.source || 'unknown').signups++;

  // Retention: of that cohort, how many were active the day after signing up, and within 7 days.
  let d1 = 0;
  let d7 = 0;
  if (cohort.length) {
    const act = await col('activity')
      .find({ userId: { $in: cohort.map((u) => u._id) }, day: { $gte: dayKey(cohortFrom) } }, { projection: { _id: 0, userId: 1, day: 1 } })
      .toArray();
    const days = new Map();
    for (const a of act) {
      const k = String(a.userId);
      if (!days.has(k)) days.set(k, new Set());
      days.get(k).add(a.day);
    }
    for (const u of cohort) {
      const start = dayKey(u.createdAt);
      const seen = days.get(String(u._id)) || new Set();
      if (seen.has(addDays(start, 1))) d1++;
      if ([1, 2, 3, 4, 5, 6, 7].some((n) => seen.has(addDays(start, n)))) d7++;
    }
  }

  const series = dayList.map((d) => perDay[d]);
  const sum = (k) => series.reduce((n, r) => n + r[k], 0);
  return {
    days,
    from,
    to: today,
    totals: {
      users: totalUsers,
      signups: newUsers.length,
      signupsWeek: series.slice(-7).reduce((n, r) => n + r.signups, 0),
      visits: sum('visits'),
      newVisitors: sum('newVisitors'),
      activeWeek,
      activeMonth,
    },
    retention: { cohort: cohort.length, d1, d7 },
    series,
    sources: Object.values(bySource).sort((a, b) => b.visits - a.visits || b.signups - a.signups),
    referrers,
  };
}
