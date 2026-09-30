import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { col } from '../db.js';

/**
 * Premium ("Pro") questions.
 *
 * Automatic selection picks `percent`% of published questions in EVERY chapter, so free students
 * can practise every chapter and Pro has something extra in every chapter. Within a chapter it
 * prefers questions that are worth paying for: ones with a written solution, then harder ones.
 * Ties are broken by a stable hash of the question number, so re-running picks the same set.
 *
 * Questions an admin marked or unmarked by hand (premiumSource: 'manual') are never changed.
 * PYQs stay free unless includePyq is set: they bring students in from search.
 */

const DIFF_RANK = { hard: 2, medium: 1, easy: 0 };
const stableHash = (qid) => createHash('sha1').update(`jee-arena:${qid}`).digest().readUInt32BE(0);

/** Pure selection over plain rows — easy to test. Returns the Set of qids that should be premium. */
export function choosePremium(rows, { percent = 20, includePyq = false } = {}) {
  const share = Math.min(100, Math.max(0, Number(percent) || 0)) / 100;
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.subject}\u0000${r.chapter || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const chosen = new Set();
  for (const list of groups.values()) {
    // Manual decisions count towards the chapter's share but are never flipped.
    const manualOn = list.filter((r) => r.premiumSource === 'manual' && r.premium).length;
    const target = Math.round(list.length * share);
    const need = Math.max(0, target - manualOn);
    const candidates = list
      .filter((r) => r.premiumSource !== 'manual')
      .filter((r) => includePyq || !r.isPyq)
      .map((r) => ({
        qid: r.qid,
        score: (r.hasSolution ? 10 : 0) + (DIFF_RANK[r.difficulty] ?? 1) * 3,
        tie: stableHash(r.qid),
      }))
      .sort((a, b) => b.score - a.score || a.tie - b.tie);
    for (const c of candidates.slice(0, need)) chosen.add(c.qid);
  }
  return chosen;
}

/** Load published questions, choose, and (unless dryRun) write the premium flags. */
export async function applyPremium({ percent = 20, includePyq = false, dryRun = false } = {}) {
  const docs = await col('questions')
    .find(
      { status: 'published' },
      { projection: { _id: 0, qid: 1, subject: 1, chapter: 1, difficulty: 1, premium: 1, premiumSource: 1, 'pyq.year': 1, solution: 1 } },
    )
    .toArray();
  const rows = docs.map((d) => ({
    qid: d.qid,
    subject: d.subject,
    chapter: d.chapter,
    difficulty: d.difficulty,
    premium: !!d.premium,
    premiumSource: d.premiumSource,
    isPyq: !!d.pyq?.year,
    hasSolution: !!(d.solution && d.solution.trim().length > 20),
  }));
  const chosen = choosePremium(rows, { percent, includePyq });

  const toOn = [];
  const toOff = [];
  const bySubject = {};
  for (const r of rows) {
    const manual = r.premiumSource === 'manual';
    const want = manual ? r.premium : chosen.has(r.qid);
    const s = (bySubject[r.subject] ||= { total: 0, premium: 0 });
    s.total += 1;
    if (want) s.premium += 1;
    if (manual) continue;
    if (want && !r.premium) toOn.push(r.qid);
    if (!want && r.premium) toOff.push(r.qid);
  }

  if (!dryRun) {
    const CHUNK = 5000;
    for (let i = 0; i < toOn.length; i += CHUNK) {
      await col('questions').updateMany({ qid: { $in: toOn.slice(i, i + CHUNK) } }, { $set: { premium: true, premiumSource: 'auto' } });
    }
    for (let i = 0; i < toOff.length; i += CHUNK) {
      await col('questions').updateMany({ qid: { $in: toOff.slice(i, i + CHUNK) } }, { $set: { premium: false, premiumSource: 'auto' } });
    }
  }

  const total = rows.length;
  const premium = Object.values(bySubject).reduce((n, s) => n + s.premium, 0);
  return {
    dryRun,
    percent,
    includePyq,
    total,
    premium,
    free: total - premium,
    actualPercent: total ? Math.round((1000 * premium) / total) / 10 : 0,
    changed: { madePremium: toOn.length, madeFree: toOff.length },
    bySubject,
  };
}

/** Does this request's user get Pro content? (Pro plan or admin.) */
export async function hasPro(req) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  if (req._hasPro !== undefined) return req._hasPro;
  const u = await col('users').findOne({ _id: new ObjectId(req.user.id) }, { projection: { plan: 1 } });
  req._hasPro = u?.plan === 'pro';
  return req._hasPro;
}

/** Filter to keep premium questions out (for free users' tests and for public contests). */
export const FREE_ONLY = { premium: { $ne: true } };
