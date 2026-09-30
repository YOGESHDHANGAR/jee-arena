import { ObjectId } from 'mongodb';
import { col } from '../db.js';
import { bad, practiceFilter, sampleQids, SUBJECTS, DIFFICULTIES } from './util.js';
import { syllabusChapters } from './syllabus.js';
import { resolveChapter, subjectUnits } from './chapters.js';
import { cachedAnalysis, weakChapters } from './analysis.js';

/**
 * The custom-test builder: the syllabus with question counts, and turning a student's choices
 * (standard chapters, class 11/12, JEE Main pattern, "my mistakes") into a paper.
 */

/** Subject -> units -> chapters, with question counts. What the builder page shows. */
export async function syllabusOverview() {
  const subjects = {};
  for (const subject of SUBJECTS) subjects[subject] = await subjectUnits(subject);
  return { subjects };
}

/** Standard chapter id for an old link's raw chapter name (pre-fills the builder from a chapter page). */
export const resolveChapterFor = (subject, raw) => resolveChapter(subject, raw);

/**
 * Splits `total` over sections as evenly as possible without asking any section for more
 * questions than it has; whatever a small section can't take moves to the others.
 */
export function allocate(total, available) {
  const give = available.map(() => 0);
  let left = total;
  let open = available.map((_, i) => i).filter((i) => available[i] > 0);
  while (left > 0 && open.length) {
    const share = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      if (left <= 0) break;
      const take = Math.min(share, available[i] - give[i], left);
      give[i] += take;
      left -= take;
    }
    open = open.filter((i) => give[i] < available[i]);
  }
  return give;
}

/**
 * Builds the question list and title for POST /tests/practice.
 * body: { mode?: 'custom'|'jee-main'|'mistakes', subjects, syllabus?: ['physics:kinematics'…],
 *         classLevel?: 11|12, count, difficulty?, chapters? (legacy raw names) }
 */
export async function buildPractice(body, { pro, userId }) {
  const extra = pro ? {} : { premium: { $ne: true } }; // free students never get Pro questions in a paper
  const mode = ['jee-main', 'mistakes', 'weak', 'due'].includes(body.mode) ? body.mode : 'custom';
  const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : undefined;
  const classLevel = [11, 12].includes(Number(body.classLevel)) ? Number(body.classLevel) : null;
  let subjects = (body.subjects || []).filter((s) => SUBJECTS.includes(s));
  if (mode === 'jee-main' || (!subjects.length && ['mistakes', 'weak', 'due'].includes(mode))) subjects = [...SUBJECTS];

  // Fix my weak spots (Pro): the chapters the analysis marks weak / careless / improving / slow,
  // new questions only (nothing already solved), split evenly across them.
  if (mode === 'weak') {
    if (!pro) throw bad('“Fix my weak spots” is part of Pro.');
    const weak = weakChapters(await cachedAnalysis(new ObjectId(userId)));
    if (!weak.length) throw bad('Try at least 5 questions in a few chapters first, so we can tell which ones need work.');
    const solved = (await col('progress').find({ userId: new ObjectId(userId), status: 'solved' }, { projection: { qid: 1 } }).toArray()).map((r) => r.qid);
    const count = Math.max(5, Math.min(90, Number(body.count) || 30));
    const matches = weak.map((c) => ({ ...practiceFilter(), ...extra, subject: c.subject, chapterId: c.slug, qid: { $nin: solved } }));
    const plan = allocate(count, await Promise.all(matches.map((m) => col('questions').countDocuments(m))));
    const qids = [];
    for (let i = 0; i < matches.length; i++) {
      if (plan[i]) qids.push(...(await sampleQids(col('questions'), qids.length ? { ...matches[i], qid: { $nin: [...solved, ...qids] } } : matches[i], plan[i])));
    }
    if (!qids.length) throw bad('You have solved every question in your weak chapters. Impressive!');
    return { questionIds: qids, title: `Weak spots: ${weak.slice(0, 2).map((c) => c.chapter).join(', ')}${weak.length > 2 ? ` +${weak.length - 2}` : ''}`, durationMin: Math.ceil(qids.length * 2.4) };
  }

  // Due for revision (lib/reviews.js): mistakes whose 1/3/7-day revision date has come.
  if (mode === 'due') {
    const { dueQids } = await import('./reviews.js');
    const count = Math.max(1, Math.min(90, Number(body.count) || 30));
    const due = await dueQids(userId, 500);
    const qids = await sampleQids(col('questions'), { ...practiceFilter(), ...extra, qid: { $in: due } }, count);
    if (!qids.length) throw bad('Nothing is due for revision today.');
    return { questionIds: qids, title: 'Revision: due today', durationMin: Math.ceil(qids.length * 2.4) };
  }
  if (!subjects.length) throw bad('Pick at least one subject');

  // Revise mistakes: questions this student attempted but hasn't solved yet.
  if (mode === 'mistakes') {
    const count = Math.max(1, Math.min(90, Number(body.count) || 30));
    const rows = await col('progress').find({ userId: new ObjectId(userId), status: 'attempted' }, { projection: { qid: 1 } }).toArray();
    const match = { ...practiceFilter(), ...extra, subject: { $in: subjects }, qid: { $in: rows.map((r) => r.qid) } };
    const qids = await sampleQids(col('questions'), match, count);
    if (!qids.length) throw bad('No mistakes to revise yet. Questions you get wrong will show up here.');
    return { questionIds: qids, title: 'Mistakes revision', durationMin: Math.ceil(qids.length * 2.4) };
  }

  // Which standard chapters each subject is restricted to (none = the whole subject).
  const picked = {};
  for (const key of Array.isArray(body.syllabus) ? body.syllabus.slice(0, 120) : []) {
    const [s, id] = String(key).split(':');
    if (subjects.includes(s) && syllabusChapters(s).some((c) => c.id === id)) (picked[s] ||= []).push(id);
  }
  // Old clients send raw chapter names; map them onto standard chapters.
  for (const raw of Array.isArray(body.chapters) ? body.chapters.map(String).slice(0, 50) : []) {
    for (const s of subjects) {
      const id = await resolveChapter(s, raw);
      if (id && !(picked[s] ||= []).includes(id)) picked[s].push(id);
    }
  }

  const sections = [];
  for (const subject of subjects) {
    let ids = picked[subject] || [];
    if (classLevel) {
      const inClass = syllabusChapters(subject).filter((c) => c.class === classLevel).map((c) => c.id);
      ids = ids.length ? ids.filter((id) => inClass.includes(id)) : inClass;
    }
    sections.push({ subject, chapterIds: ids.length ? ids : undefined, names: ids });
  }

  const base = (s, more = {}) => {
    const m = { ...practiceFilter(), ...extra, subject: s.subject, ...more };
    if (difficulty) m.difficulty = difficulty;
    if (s.chapterIds) m.chapterId = { $in: s.chapterIds };
    return m;
  };

  const chosen = [];
  const take = async (match, n) => {
    if (n <= 0) return 0;
    const got = await sampleQids(col('questions'), chosen.length ? { ...match, qid: { $nin: chosen } } : match, n);
    chosen.push(...got);
    return got.length;
  };

  if (mode === 'jee-main') {
    // Per subject: 20 single-correct MCQs + 5 numericals; numericals the bank lacks become MCQs.
    for (const s of sections) {
      const num = await take(base(s, { type: 'numerical' }), 5);
      const single = await take(base(s, { type: 'single' }), 25 - num);
      if (num + single < 25) await take(base(s), 25 - num - single);
    }
    if (chosen.length < 30) throw bad('Not enough questions in the bank for a full paper with these settings.');
    const label = classLevel ? `Class ${classLevel} ` : '';
    return { questionIds: chosen, title: `${label}JEE Main pattern paper`, durationMin: classLevel ? Math.ceil(chosen.length * 2.4) : 180 };
  }

  const count = Math.max(5, Math.min(90, Number(body.count) || 15));
  const available = await Promise.all(sections.map((s) => col('questions').countDocuments(base(s))));
  const plan = allocate(count, available);
  for (let i = 0; i < sections.length; i++) await take(base(sections[i]), plan[i]);
  if (!chosen.length) throw bad('No questions match these choices. Try more chapters or "Mixed" difficulty.');

  const names = sections.flatMap((s) => s.names.map((id) => syllabusChapters(s.subject).find((c) => c.id === id)?.name)).filter(Boolean);
  const subjectLabel = subjects.map((s) => s[0].toUpperCase() + s.slice(1)).join(', ');
  const title = names.length
    ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`
    : classLevel
      ? `Class ${classLevel} · ${subjectLabel}`
      : `Custom test · ${subjectLabel}`;
  return { questionIds: chosen, title, durationMin: Math.ceil(chosen.length * 2.4), short: chosen.length < count ? count : undefined };
}

/** What the "Fix my weak spots" card shows: the chapters for Pro, just how many for everyone else. */
export async function weakPreview(userId, pro) {
  const weak = weakChapters(await cachedAnalysis(new ObjectId(userId)));
  return pro ? { chapters: weak } : { count: weak.length, locked: true };
}

/** How many unsolved mistakes the student has, per subject (for the "Revise mistakes" card). */
export async function mistakeCount(userId) {
  const rows = await col('progress').find({ userId: new ObjectId(userId), status: 'attempted' }, { projection: { qid: 1 } }).toArray();
  if (!rows.length) return 0;
  return col('questions').countDocuments({ ...practiceFilter(), qid: { $in: rows.map((r) => r.qid) } });
}
