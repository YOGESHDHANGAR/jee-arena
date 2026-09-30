import { col } from '../db.js';
import { answerKey, fingerprint, keeperScore } from './fingerprint.js';

/**
 * Finding and merging duplicate questions. Duplicates are never deleted: the extra copies are set to
 * status 'hidden' with duplicateOf = <kept qid>, so tests that already used them still work and
 * the importer won't bring them back (it never un-hides).
 */

const FIELD = { exact: 'fp', text: 'fpText' };

// ---- (re)compute fingerprints for the whole bank -----------------------------------------------

let scan = { running: false, done: 0, total: 0, changed: 0, finishedAt: null, error: null };
export const scanStatus = () => ({ ...scan });

/** Recomputes fp/fpText for every question. Streams the collection, writes in batches of 1000. */
export async function scanFingerprints({ onProgress } = {}) {
  if (scan.running) return scanStatus();
  scan = { running: true, done: 0, total: await col('questions').estimatedDocumentCount(), changed: 0, finishedAt: null, error: null };
  try {
    const cursor = col('questions').find({}, { projection: { _id: 1, type: 1, text: 1, options: 1, fp: 1, fpText: 1 } }).batchSize(1000);
    let ops = [];
    for await (const q of cursor) {
      const f = fingerprint(q);
      if (f.fp !== (q.fp ?? null) || f.fpText !== (q.fpText ?? null)) {
        ops.push({ updateOne: { filter: { _id: q._id }, update: { $set: f } } });
        scan.changed++;
      }
      scan.done++;
      if (ops.length >= 1000) {
        await col('questions').bulkWrite(ops, { ordered: false });
        ops = [];
        onProgress?.(scanStatus());
      }
    }
    if (ops.length) await col('questions').bulkWrite(ops, { ordered: false });
    groupsCache = {};
  } catch (e) {
    scan.error = e.message;
    throw e;
  } finally {
    scan.running = false;
    scan.finishedAt = new Date();
  }
  return scanStatus();
}

// ---- groups ---------------------------------------------------------------------------------------

let groupsCache = {}; // mode -> { at, groups }
export const clearDuplicateCache = () => {
  groupsCache = {};
};

/**
 * All groups of 2+ live copies (not already merged) sharing a fingerprint, biggest first.
 * Grouped in JS so it runs on any Mongo-compatible database; only small fields are loaded.
 */
export async function duplicateGroups(mode = 'exact') {
  const field = FIELD[mode] || 'fp';
  const hit = groupsCache[mode];
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.groups;
  const [rows, ignored] = await Promise.all([
    col('questions')
      .find({ [field]: { $type: 'string' }, duplicateOf: { $exists: false } }, { projection: { _id: 0, qid: 1, [field]: 1 } })
      .toArray(),
    col('dupIgnored').find({ mode }, { projection: { key: 1 } }).toArray(),
  ]);
  const skip = new Set(ignored.map((r) => r.key));
  const m = new Map();
  for (const r of rows) {
    const k = r[field];
    if (skip.has(k)) continue;
    const g = m.get(k);
    if (g) g.push(r.qid);
    else m.set(k, [r.qid]);
  }
  const groups = [...m.entries()]
    .filter(([, q]) => q.length > 1)
    .map(([key, qids]) => ({ key, qids: qids.sort((a, b) => a - b) }))
    .sort((a, b) => b.qids.length - a.qids.length || a.qids[0] - b.qids[0]);
  groupsCache[mode] = { at: Date.now(), groups };
  return groups;
}

/** Loads the questions of some groups and works out the suggested keeper and whether answers agree. */
export async function describeGroups(groups) {
  const qids = groups.flatMap((g) => g.qids);
  const docs = await col('questions')
    .find({ qid: { $in: qids } }, { projection: { qid: 1, status: 1, subject: 1, chapter: 1, type: 1, difficulty: 1, text: 1, options: 1, answer: 1, solution: 1, pyq: 1, premium: 1, source: 1, stats: 1 } })
    .toArray();
  const byQid = new Map(docs.map((d) => [d.qid, d]));
  return groups.map((g) => {
    const qs = g.qids.map((id) => byQid.get(id)).filter(Boolean);
    const keeper = [...qs].sort((a, b) => keeperScore(b) - keeperScore(a) || a.qid - b.qid)[0];
    const answers = new Set(qs.map(answerKey).filter(Boolean));
    return {
      key: g.key,
      keep: keeper?.qid ?? null,
      answersAgree: answers.size <= 1,
      questions: qs.map((q) => ({
        qid: q.qid,
        status: q.status,
        subject: q.subject,
        chapter: q.chapter,
        type: q.type,
        difficulty: q.difficulty,
        text: q.text,
        options: q.options || [],
        answer: q.answer || null,
        hasSolution: !!q.solution,
        pyq: q.pyq || null,
        premium: !!q.premium,
        source: q.source?.name || null,
        attempts: q.stats?.attempts || 0,
      })),
    };
  });
}

/**
 * Keeps `keep`, hides the others as its duplicates. The kept copy inherits a PYQ tag or a written
 * solution from a hidden copy if it lacks one, and students' bookmarks move over.
 */
export async function mergeGroup(keep, hide) {
  hide = [...new Set(hide.map(Number))].filter((q) => q !== keep);
  if (!hide.length) return { hidden: 0 };
  const [kept, others] = await Promise.all([
    col('questions').findOne({ qid: keep }),
    col('questions').find({ qid: { $in: hide } }).toArray(),
  ]);
  if (!kept) throw new Error(`Question #${keep} not found`);

  const inherit = {};
  if (!kept.solution) {
    const withSol = others.find((o) => o.solution);
    if (withSol) Object.assign(inherit, { solution: withSol.solution, solutionFrom: withSol.qid });
  }
  if (!kept.pyq?.year) {
    const withPyq = others.find((o) => o.pyq?.year);
    if (withPyq) inherit.pyq = withPyq.pyq;
  }
  if (Object.keys(inherit).length) await col('questions').updateOne({ qid: keep }, { $set: inherit });

  const r = await col('questions').updateMany(
    { qid: { $in: hide } },
    { $set: { status: 'hidden', duplicateOf: keep, mergedAt: new Date() } },
  );

  // Bookmarks follow the question; duplicates of an existing bookmark are simply dropped.
  const marks = await col('bookmarks').find({ qid: { $in: hide } }).toArray();
  if (marks.length) {
    await col('bookmarks')
      .bulkWrite(
        marks.map((b) => ({ updateOne: { filter: { userId: b.userId, qid: keep }, update: { $setOnInsert: { createdAt: b.createdAt } }, upsert: true } })),
        { ordered: false },
      )
      .catch(() => {});
    await col('bookmarks').deleteMany({ qid: { $in: hide } });
  }
  clearDuplicateCache();
  return { hidden: r.modifiedCount, inherited: Object.keys(inherit) };
}

/**
 * Merges every exact-duplicate group whose copies agree on the answer, keeping the suggested copy.
 * Groups that disagree are left for a human. dryRun just counts.
 */
export async function autoMerge({ dryRun = true, mode = 'exact' } = {}) {
  const groups = await duplicateGroups(mode);
  let merged = 0;
  let hidden = 0;
  let conflicts = 0;
  for (let i = 0; i < groups.length; i += 200) {
    const described = await describeGroups(groups.slice(i, i + 200));
    for (const g of described) {
      if (!g.answersAgree || g.keep === null) {
        conflicts++;
        continue;
      }
      merged++;
      const rest = g.questions.map((q) => q.qid).filter((q) => q !== g.keep);
      hidden += rest.length;
      if (!dryRun) await mergeGroup(g.keep, rest);
    }
  }
  clearDuplicateCache();
  return { dryRun, groups: groups.length, merged, hidden, conflicts };
}
