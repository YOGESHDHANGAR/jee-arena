import { ObjectId } from 'mongodb';
import { isNarrowerName, syllabusChapter } from './syllabus.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const oid = (s) => {
  if (!ObjectId.isValid(s)) throw notFound();
  return new ObjectId(s);
};

export const int = (v, def, min = -Infinity, max = Infinity) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};

/** Calendar day in India, used for streaks and the activity heatmap. */
export const dayKey = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d); // YYYY-MM-DD

/** Monday 00:00 IST of the week containing `d` (weekly leaderboard resets then). */
export function weekStart(d = new Date()) {
  const IST = 5.5 * 3600 * 1000;
  const ist = new Date(d.getTime() + IST);
  const daysSinceMonday = (ist.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysSinceMonday) - IST);
}

export const SUBJECTS = ['physics', 'chemistry', 'maths'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const TYPES = ['single', 'multi', 'numerical'];

/** What students may see of a question before answering it. */
export function publicQuestion(q) {
  return {
    qid: q.qid,
    subject: q.subject,
    chapter: q.chapter,
    chapterId: q.chapterId || null,
    chapterName: syllabusChapter(q.subject, q.chapterId)?.name || null,
    // The source's own chapter name when it's narrower than the standard one ("Rain Problem").
    chapterTopic: q.chapter && syllabusChapter(q.subject, q.chapterId) && isNarrowerName(q.chapter, syllabusChapter(q.subject, q.chapterId).name) ? q.chapter : null,
    topic: q.topic,
    difficulty: q.difficulty,
    type: q.type,
    text: q.text,
    options: q.options || [],
    pyq: q.pyq || null,
    premium: !!q.premium,
    stats: {
      attempts: q.stats?.attempts || 0,
      solved: q.stats?.solved || 0,
      avgSolveSec: q.stats?.timeCount ? Math.round(q.stats.timeSum / q.stats.timeCount) : null,
      solveTimes: q.stats?.timeCount || 0,
    },
    commentCount: q.commentCount || 0,
    // Tells the page to invite a solution in the discussion (nothing about the answer itself).
    hasSolution: !!q.solution,
  };
}

/** Answer + solution, revealed after an attempt. */
export function reveal(q) {
  const by = q.solutionSource?.type === 'comment' ? { username: q.solutionSource.username, commentId: String(q.solutionSource.commentId) } : null;
  return { answer: q.answer, solution: q.solution || '', solutionBy: by };
}

/** Questions a student can currently practise (published, not held for a live contest). */
export const practiceFilter = (now = new Date()) => ({
  status: 'published',
  $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lte: now } }],
});

/**
 * Up to `n` random qids matching `match`. Uses MongoDB's $sample; falls back to
 * sampling in JS on Mongo-compatible databases that lack it (FerretDB, some hosted clones).
 */
export async function sampleQids(collection, match, n) {
  try {
    const rows = await collection.aggregate([{ $match: match }, { $sample: { size: n } }, { $project: { qid: 1 } }]).toArray();
    return rows.map((r) => r.qid);
  } catch (e) {
    if (e.code !== 238 && !/not implemented/i.test(e.message)) throw e;
    const all = (await collection.find(match, { projection: { _id: 0, qid: 1 } }).toArray()).map((r) => r.qid);
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, n);
  }
}

/**
 * Short one-line preview of a question for lists: keeps whole $…$ math segments
 * (never cuts inside one), turns figures/structures into markers, drops HTML/tables.
 */
export function previewOf(text = '', budget = 150) {
  const clean = String(text)
    .replace(/<table[\s\S]*?<\/table>/gi, ' [table] ')
    .replace(/\{\{img:[^}]*\}\}|!\[[^\]]*\]\([^)]*\)|<img[^>]*>/gi, ' [figure] ')
    .replace(/\{\{mol:[^}]*\}\}/gi, ' [structure] ')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => `$${m.trim()}$`) // display math inline in a list
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$${m.trim()}$`)
    .replace(/<[^>]+>/g, ' ')
    .replace(/^---$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = clean.split(/((?<!\\)\$(?:\\.|[^$\\])+?\$)/g);
  let out = '';
  let used = 0;
  for (const p of parts) {
    if (!p) continue;
    const isMath = p.startsWith('$') && p.endsWith('$') && p.length > 1;
    const cost = isMath ? Math.ceil(p.length / 3) : p.length; // rendered math is much shorter than its source
    if (used + cost > budget) {
      if (!isMath) out += p.slice(0, Math.max(0, budget - used)).replace(/\s+\S*$/, '');
      return `${out.trim()}…`;
    }
    out += p;
    used += cost;
  }
  return out;
}
