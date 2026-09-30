import { col, getDb } from '../db.js';
import { dayKey } from './util.js';

/**
 * Admin → Usage & cost: how much of the free tiers is used, what the month will cost and what
 * that is per student.
 *
 * Render has no usage API on the free plan, so the server counts for itself:
 *  - instance hours: one minute is added for every minute this process is awake,
 *  - bandwidth: bytes written to each connection (after compression), which is what Render bills.
 * Counts are kept in memory and added to the `usage` collection once a minute (one doc per UTC day,
 * because Render's and Atlas's billing months are UTC calendar months).
 *
 * Prices (USD) are Render's and Atlas's public list prices, checked Sep 2026. Change them here, or set
 * the env vars below if you move to a paid plan.
 */
export const PRICES = {
  render: {
    freeHoursPerMonth: 750, // shared by every free service in the Render workspace
    includedBandwidthGb: 5, // Hobby workspace
    bandwidthPerGb: 0.15,
    plans: { free: 0, starter: 7, standard: 25 }, // per instance per month
  },
  atlas: {
    freeStorageMb: 512,
    plans: {
      free: { monthly: 0, storageMb: 512 },
      flex: { hourly: 0.011, capMonthly: 30, storageMb: 5 * 1024 },
      m10: { hourly: 0.08, storageMb: 10 * 1024 },
    },
  },
};

const plans = () => ({
  render: PRICES.render.plans[process.env.PLAN_RENDER] !== undefined ? process.env.PLAN_RENDER : 'free',
  atlas: PRICES.atlas.plans[process.env.PLAN_ATLAS] ? process.env.PLAN_ATLAS : 'free',
  // Hours other free Render services in the same workspace use per month (they share the 750).
  otherRenderHours: Math.max(0, Number(process.env.RENDER_OTHER_FREE_HOURS || 0)),
  usdToInr: Number(process.env.USD_INR || 88),
});

const MB = 1024 * 1024;
const GB = 1024 * MB;
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const utcMonth = (d = new Date()) => d.toISOString().slice(0, 7);

// ---------- counting (runs in every request / once a minute) ----------

const pending = { requests: 0, bytesOut: 0, minutes: 0 };
const recent = []; // [timestamp, bytes] for the "right now" numbers, last 5 minutes
const startedAt = Date.now();

/** Express middleware: counts requests and bytes sent, without touching the response. */
export function trackTraffic(req, res, next) {
  res.on('finish', () => {
    const s = req.socket;
    if (!s) return;
    // Requests on one keep-alive connection finish one after another, so the growth in bytesWritten
    // since the last request on this socket is this response (headers + compressed body).
    const total = s.bytesWritten || 0;
    const bytes = Math.max(0, total - (s.__usageBytes || 0));
    s.__usageBytes = total;
    pending.requests++;
    pending.bytesOut += bytes;
    const now = Date.now();
    recent.push([now, bytes]);
    while (recent.length && recent[0][0] < now - 5 * 60e3) recent.shift();
  });
  next();
}

let timer;
/** Once a minute: add this awake minute and the traffic counted so far to today's usage doc. */
export function startUsageClock() {
  if (timer) return;
  timer = setInterval(() => {
    pending.minutes++;
    flush().catch(() => {});
  }, 60e3);
  timer.unref();
}

async function flush() {
  const { requests, bytesOut, minutes } = pending;
  if (!requests && !minutes) return;
  pending.requests = 0;
  pending.bytesOut = 0;
  pending.minutes = 0;
  const day = utcDay();
  try {
    await col('usage').updateOne(
      { _id: `day|${day}` },
      { $set: { day, month: day.slice(0, 7) }, $inc: { requests, bytesOut, awakeMinutes: minutes } },
      { upsert: true },
    );
  } catch (e) {
    // Put them back so nothing is lost if the database blips.
    pending.requests += requests;
    pending.bytesOut += bytesOut;
    pending.minutes += minutes;
    throw e;
  }
}

// ---------- database size ----------

async function databaseSize() {
  const s = await getDb().stats();
  const dataBytes = s.dataSize || 0;
  const storageBytes = s.storageSize || 0;
  const indexBytes = s.indexSize || 0;
  // Atlas counts against the 512 MB with its own measure; use the larger of logical and on-disk size
  // so the bar never under-reports.
  const usedBytes = Math.max(dataBytes, storageBytes) + indexBytes;

  let collections = [];
  try {
    const names = (await getDb().listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
    collections = await Promise.all(
      names.map(async (name) => {
        const [st] = await col(name).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
        const ss = st?.storageStats || {};
        return { name, docs: ss.count || 0, bytes: Math.max(ss.size || 0, ss.storageSize || 0) + (ss.totalIndexSize || 0) };
      }),
    );
    collections.sort((a, b) => b.bytes - a.bytes);
  } catch {
    collections = []; // $collStats isn't available on every tier; the total still works
  }
  return { dataBytes, storageBytes, indexBytes, usedBytes, objects: s.objects || 0, collections };
}

/** Remember the biggest size seen each day, so growth per day can be projected. */
async function recordSize(usedBytes) {
  const day = utcDay();
  await col('usage').updateOne({ _id: `day|${day}` }, { $set: { day, month: day.slice(0, 7) }, $max: { dbBytes: usedBytes } }, { upsert: true }).catch(() => {});
}

// ---------- report ----------

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (a, b) => (b ? round((100 * a) / b, 1) : 0);

export async function usageReport() {
  await flush().catch(() => {}); // include the last few seconds
  const p = plans();
  const now = new Date();
  const month = utcMonth(now);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const monthFrac = (now - monthStart) / (monthEnd - monthStart); // how far through the month we are
  const hoursInMonth = (monthEnd - monthStart) / 36e5;

  const since = utcDay(new Date(now - 30 * 864e5));
  const [db, days, users, activeMonth, activeWeek] = await Promise.all([
    databaseSize(),
    col('usage').find({ day: { $gte: since } }).sort({ day: 1 }).toArray(),
    col('users').estimatedDocumentCount(),
    col('activity').distinct('userId', { day: { $gte: dayKeyIst(-29) } }).then((a) => a.length),
    col('activity').distinct('userId', { day: { $gte: dayKeyIst(-6) } }).then((a) => a.length),
  ]);
  await recordSize(db.usedBytes);

  // Render: this month so far (+ what's still in memory), and where it's heading.
  const thisMonth = days.filter((d) => d.month === month);
  const sum = (k) => thisMonth.reduce((a, d) => a + (d[k] || 0), 0);
  const awakeHours = sum('awakeMinutes') / 60;
  const bandwidthGb = sum('bytesOut') / GB;
  const requests = sum('requests');
  const hoursProjected = monthFrac > 0.02 ? awakeHours / monthFrac : awakeHours;
  const bandwidthProjectedGb = monthFrac > 0.02 ? bandwidthGb / monthFrac : bandwidthGb;
  const freeHoursForUs = Math.max(0, PRICES.render.freeHoursPerMonth - p.otherRenderHours);

  // Atlas growth: bytes per day over the snapshots we have (up to 30 days).
  const sizes = days.filter((d) => d.dbBytes).map((d) => ({ day: d.day, bytes: d.dbBytes }));
  let growthPerDay = 0;
  if (sizes.length >= 2) {
    const a = sizes[0];
    const b = sizes[sizes.length - 1];
    const span = (Date.parse(b.day) - Date.parse(a.day)) / 864e5;
    if (span > 0) growthPerDay = Math.max(0, (b.bytes - a.bytes) / span);
  }
  const atlasPlan = PRICES.atlas.plans[p.atlas];
  const limitBytes = atlasPlan.storageMb * MB;
  const daysUntilFull = growthPerDay > 0 ? Math.max(0, Math.floor((limitBytes - db.usedBytes) / growthPerDay)) : null;

  // Money, in USD. "So far" = this month to date, "projected" = the whole month at the current rate.
  const renderInstance = PRICES.render.plans[p.render];
  const overGb = (gb) => Math.max(0, gb - PRICES.render.includedBandwidthGb);
  const atlasCost = (frac) => {
    if (atlasPlan.monthly !== undefined) return atlasPlan.monthly;
    const c = atlasPlan.hourly * hoursInMonth * frac;
    return atlasPlan.capMonthly ? Math.min(atlasPlan.capMonthly, c) : c;
  };
  const cost = (frac, gb) => {
    const render = renderInstance * frac;
    const bandwidth = overGb(gb) * PRICES.render.bandwidthPerGb;
    const atlas = atlasCost(frac);
    return { render: round(render), bandwidth: round(bandwidth), atlas: round(atlas), total: round(render + bandwidth + atlas) };
  };
  const soFar = cost(monthFrac, bandwidthGb);
  const projected = cost(1, bandwidthProjectedGb);
  const perUser = (usd, n) => (n ? round(usd / n, 4) : 0);

  // What it would cost to move up, per active student (whole month, current bandwidth).
  const scenarios = [
    { name: 'Now', render: p.render, atlas: p.atlas },
    { name: 'Always-on server', render: 'starter', atlas: 'free' },
    { name: 'Always-on + 5 GB database', render: 'starter', atlas: 'flex' },
    { name: 'Production (dedicated DB)', render: 'standard', atlas: 'm10' },
  ].map((s) => {
    const ap = PRICES.atlas.plans[s.atlas];
    const atlas = ap.monthly !== undefined ? ap.monthly : Math.min(ap.capMonthly ?? Infinity, ap.hourly * hoursInMonth);
    const total = PRICES.render.plans[s.render] + atlas + overGb(bandwidthProjectedGb) * PRICES.render.bandwidthPerGb;
    return { ...s, monthly: round(total), perActiveUser: perUser(total, activeMonth) };
  });

  // Live: this process right now.
  const recentBytes = recent.reduce((a, r) => a + r[1], 0);
  const mem = process.memoryUsage();

  const warnings = [];
  const warn = (usedPct, what) => {
    if (usedPct >= 100) warnings.push({ level: 'bad', text: `${what} is over the free limit.` });
    else if (usedPct >= 80) warnings.push({ level: 'warn', text: `${what} is at ${usedPct}% of the free limit.` });
  };
  if (p.atlas === 'free') warn(pct(db.usedBytes, limitBytes), 'Database storage');
  if (p.render === 'free') {
    warn(pct(awakeHours, freeHoursForUs), 'Render instance hours this month');
    warn(pct(hoursProjected, freeHoursForUs), 'Projected Render instance hours for the month');
  }
  warn(pct(bandwidthProjectedGb, PRICES.render.includedBandwidthGb), 'Projected bandwidth for the month');
  if (daysUntilFull !== null && daysUntilFull < 30) warnings.push({ level: 'warn', text: `At the current growth the database fills up in about ${daysUntilFull} days.` });
  if (mem.rss > 0.85 * 512 * MB) warnings.push({ level: 'warn', text: 'The server is using over 85% of its 512 MB memory.' });

  return {
    generatedAt: now,
    month,
    monthProgressPct: round(monthFrac * 100, 1),
    plans: p,
    prices: PRICES,
    warnings,
    database: {
      ...db,
      limitBytes,
      usedPct: pct(db.usedBytes, limitBytes),
      growthPerDayBytes: Math.round(growthPerDay),
      daysUntilFull,
      history: sizes,
    },
    server: {
      awakeHours: round(awakeHours, 1),
      freeHours: freeHoursForUs,
      hoursUsedPct: pct(awakeHours, freeHoursForUs),
      hoursProjected: round(hoursProjected, 1),
      bandwidthGb: round(bandwidthGb, 3),
      bandwidthIncludedGb: PRICES.render.includedBandwidthGb,
      bandwidthUsedPct: pct(bandwidthGb, PRICES.render.includedBandwidthGb),
      bandwidthProjectedGb: round(bandwidthProjectedGb, 3),
      requests,
      daily: days.map((d) => ({ day: d.day, requests: d.requests || 0, mb: round((d.bytesOut || 0) / MB, 1), hours: round((d.awakeMinutes || 0) / 60, 1) })),
    },
    live: {
      upSinceMinutes: Math.round((Date.now() - startedAt) / 60e3),
      requests5m: recent.length,
      kbPerMin5m: round(recentBytes / 1024 / 5, 1),
      memoryMb: round(mem.rss / MB, 0),
      memoryLimitMb: 512,
      memoryPct: pct(mem.rss, 512 * MB),
    },
    cost: {
      soFar,
      projected,
      users,
      activeMonth,
      activeWeek,
      perUser: perUser(projected.total, users),
      perActiveUser: perUser(projected.total, activeMonth),
      scenarios,
    },
  };
}

// Activity rows use IST day keys (lib/util.js); only used to count active students.
const dayKeyIst = (offsetDays) => dayKey(new Date(Date.now() + offsetDays * 864e5));
