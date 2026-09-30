import { col } from '../db.js';
import { practiceFilter, previewOf, SUBJECTS } from './util.js';
import { ttlCache } from './search.js';
import { isNarrowerName, syllabusChapter, syllabusChapters, syllabusIdFor } from './syllabus.js';

/**
 * Chapters as students see them: the standard JEE chapters of lib/syllabus.js, counted by the
 * `chapterId` stored on each question (lib/chapterIds.js). Used by the Problems filter, the
 * chapter landing pages (/physics/kinematics), the sitemap, analysis and the test builder.
 */

/** "Work, Energy & Power" -> "work-energy-and-power". Keep in sync with web/src/lib/hooks.js. */
export const chapterSlug = (name = '') =>
  String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const cache = ttlCache(10 * 60 * 1000, 200);
export const clearChapterCache = () => cache.clear?.();

/** { subject: { chapterId|'' : { count, pyqCount, numerical } } } for published, practisable questions. */
export function chapterCounts() {
  return cache.get('counts', async () => {
    const group = (match) =>
      col('questions')
        .aggregate([{ $match: { ...practiceFilter(), ...match } }, { $group: { _id: { subject: '$subject', id: '$chapterId' }, count: { $sum: 1 } } }])
        .toArray();
    const [all, pyq, num] = await Promise.all([group({}), group({ 'pyq.year': { $exists: true } }), group({ type: 'numerical' })]);
    const out = Object.fromEntries(SUBJECTS.map((s) => [s, {}]));
    const add = (rows, key) => {
      for (const r of rows) {
        if (!out[r._id.subject]) continue;
        const c = (out[r._id.subject][r._id.id || ''] ||= { count: 0, pyqCount: 0, numerical: 0 });
        c[key] += r.count;
      }
    };
    add(all, 'count');
    add(pyq, 'pyqCount');
    add(num, 'numerical');
    return out;
  });
}

/** Standard chapters of a subject in syllabus order, with counts (chapters with no questions included). */
export async function subjectChapters(subject) {
  const counts = (await chapterCounts())[subject] || {};
  return syllabusChapters(subject).map((c) => ({
    slug: c.id,
    id: c.id,
    chapter: c.name,
    name: c.name,
    class: c.class,
    unit: c.unit,
    count: counts[c.id]?.count || 0,
    pyqCount: counts[c.id]?.pyqCount || 0,
  }));
}

/** Units of a subject, each with its chapters and counts; plus questions not placed in any chapter. */
export async function subjectUnits(subject) {
  const chapters = await subjectChapters(subject);
  const counts = (await chapterCounts())[subject] || {};
  const units = [];
  for (const c of chapters) {
    let u = units.find((x) => x.name === c.unit);
    if (!u) units.push((u = { name: c.unit, count: 0, chapters: [] }));
    u.chapters.push(c);
    u.count += c.count;
  }
  const total = Object.values(counts).reduce((n, c) => n + c.count, 0);
  return { units, total, unplaced: counts['']?.count || 0 };
}

/** Raw chapter names of a subject (as imported), for old URLs and links. */
function rawNames(subject) {
  return cache.get(`raw:${subject}`, async () => (await col('questions').distinct('chapter', { subject })).filter(Boolean));
}

/**
 * Standard chapter id for anything a URL or old link might carry: an id ("kinematics"),
 * a raw chapter name ("Rotational motion"), or the slug of one ("rain-problem"). Null if unknown.
 */
export async function resolveChapter(subject, value) {
  if (!SUBJECTS.includes(subject) || !value) return null;
  const v = String(value);
  if (syllabusChapter(subject, v)) return v;
  const direct = syllabusIdFor(subject, v);
  if (direct) return direct;
  const raw = (await rawNames(subject)).find((n) => chapterSlug(n) === v);
  return raw ? syllabusIdFor(subject, raw) : null;
}

const acceptance = (q) => (q.stats?.attempts ? Math.round((100 * q.stats.solved) / q.stats.attempts) : null);
const card = (q) => ({
  qid: q.qid,
  preview: previewOf(q.text, 160),
  difficulty: q.difficulty,
  type: q.type,
  topic: q.topic || null,
  pyq: q.pyq || null,
  acceptance: acceptance(q),
});

/**
 * Everything the chapter page shows. `slug` must be a standard chapter id; for anything else
 * returns { redirect } (an old raw-name URL) or null.
 */
export async function chapterDetail(subject, slug) {
  if (!SUBJECTS.includes(subject)) return null;
  const std = syllabusChapter(subject, slug);
  if (!std) {
    const id = await resolveChapter(subject, slug);
    return id ? { redirect: `/${subject}/${id}` } : null;
  }
  return cache.get(`c:${subject}:${slug}`, async () => {
    const match = { ...practiceFilter(), subject, chapterId: slug };
    // One chapter is at most a few thousand small rows: count everything in JS (portable, one query).
    const rows = await col('questions')
      .find(match, { projection: { _id: 0, qid: 1, difficulty: 1, type: 1, topic: 1, chapter: 1, 'pyq.year': 1, premium: 1, solution: 1 } })
      .toArray();
    const tally = (key) => {
      const m = {};
      for (const r of rows) {
        const k = key(r);
        if (k !== undefined && k !== null && k !== '') m[k] = (m[k] || 0) + 1;
      }
      return m;
    };
    const years = tally((r) => r.pyq?.year);
    // Topics: the question's own topic, else its raw chapter name when that's narrower than the chapter
    // ("Rain Problem" inside Kinematics).
    const topics = tally((r) => r.topic || (r.chapter && isNarrowerName(r.chapter, std.name) ? r.chapter : null));
    const free = { ...match, premium: { $ne: true } };
    const fields = { projection: { qid: 1, text: 1, difficulty: 1, type: 1, topic: 1, pyq: 1, stats: 1 } };
    const [recentPyq, popular, starter] = await Promise.all([
      col('questions').find({ ...free, 'pyq.year': { $exists: true } }, fields).sort({ 'pyq.year': -1, qid: 1 }).limit(8).toArray(),
      col('questions').find({ ...free, 'stats.attempts': { $gt: 0 } }, fields).sort({ 'stats.attempts': -1, qid: 1 }).limit(8).toArray(),
      col('questions').find({ ...free, difficulty: 'easy' }, fields).sort({ qid: 1 }).limit(8).toArray(),
    ]);
    const all = await subjectChapters(subject);
    // Related: the rest of this unit first, then the biggest other chapters.
    const related = [
      ...all.filter((c) => c.unit === std.unit && c.id !== slug),
      ...all.filter((c) => c.unit !== std.unit).sort((a, b) => b.count - a.count),
    ].filter((c) => c.count).slice(0, 12);
    return {
      subject,
      slug,
      chapter: std.name,
      unit: std.unit,
      class: std.class,
      total: rows.length,
      free: rows.filter((r) => !r.premium).length,
      withSolution: rows.filter((r) => r.solution).length,
      byDifficulty: tally((r) => r.difficulty),
      byType: tally((r) => r.type),
      pyqByYear: Object.entries(years).map(([year, count]) => ({ year: Number(year), count })).sort((a, b) => b.year - a.year),
      pyqCount: Object.values(years).reduce((a, b) => a + b, 0),
      topics: Object.entries(topics).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 24),
      questions: { recentPyq: recentPyq.map(card), popular: popular.map(card), starter: starter.map(card) },
      related: related.map(({ slug: s, chapter, count }) => ({ slug: s, chapter, count })),
    };
  });
}
