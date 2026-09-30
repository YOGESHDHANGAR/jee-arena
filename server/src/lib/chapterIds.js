import { col } from '../db.js';
import { SUBJECTS } from './util.js';
import { SYLLABUS_VERSION, syllabusIdFor } from './syllabus.js';
import { clearChapterCache } from './chapters.js';

/**
 * Every question stores the standard chapter it belongs to:
 *   chapterId        'kinematics', 'p-block-elements' … (see lib/syllabus.js), or null if unknown
 *   chapterIdSource  'name'   — worked out from its raw chapter name
 *                    'auto'   — guessed from the question text (scripts/classify-chapters.js)
 *                    'manual' — chosen by an admin; never overwritten
 *                    'none'   — no idea yet
 * Filters, chapter pages, analysis and tests all use chapterId, so spelling variants and
 * topic-level names ("Rain Problem") collapse into one chapter.
 */

/** The fields to $set on a question with this subject/chapter (for importers and admin edits). */
export function chapterIdFields(subject, chapter) {
  const id = syllabusIdFor(subject, chapter);
  return id ? { chapterId: id, chapterIdSource: 'name' } : { chapterId: null, chapterIdSource: 'none' };
}

/**
 * Brings stored chapterIds up to date. Runs at startup in the background: cheap when nothing is
 * missing, and after a SYLLABUS_VERSION bump re-maps everything that wasn't set by hand.
 * Works one (subject, raw chapter) pair at a time — about a thousand updateMany calls for the whole bank.
 */
export async function syncChapterIds({ log = () => {} } = {}) {
  const meta = await col('meta').findOne({ _id: 'syllabus' });
  const full = meta?.version !== SYLLABUS_VERSION;
  const missing = full ? null : { chapterId: { $exists: false } };
  if (!full && !(await col('questions').findOne(missing, { projection: { _id: 1 } }))) return { updated: 0 };

  const pairs = await col('questions')
    .aggregate([...(missing ? [{ $match: missing }] : []), { $group: { _id: { subject: '$subject', chapter: '$chapter' } } }])
    .toArray();
  let updated = 0;
  for (const { _id } of pairs) {
    if (!SUBJECTS.includes(_id.subject)) continue;
    const where = { subject: _id.subject, chapter: _id.chapter ?? null, ...(missing || {}) };
    const id = syllabusIdFor(_id.subject, _id.chapter);
    const r = id
      ? await col('questions').updateMany({ ...where, chapterIdSource: { $ne: 'manual' } }, { $set: { chapterId: id, chapterIdSource: 'name' } })
      : await col('questions').updateMany({ ...where, chapterIdSource: { $nin: ['manual', 'auto'] } }, { $set: { chapterId: null, chapterIdSource: 'none' } });
    updated += r.modifiedCount;
  }
  await col('meta').updateOne({ _id: 'syllabus' }, { $set: { version: SYLLABUS_VERSION, syncedAt: new Date() } }, { upsert: true });
  clearChapterCache();
  log(`Standard chapters: ${updated.toLocaleString('en-IN')} questions updated (${pairs.length} chapter names)`);
  return { updated, names: pairs.length };
}
