#!/usr/bin/env node
/**
 * Places questions that have no usable chapter ("null", "Question Bank"…) into a standard chapter by
 * reading their text (server/src/lib/classifier.js), trained on every question whose chapter IS known.
 *
 *   npm run chapters:classify                    # preview: accuracy report + how many would be placed
 *   npm run chapters:classify -- --apply         # save
 *   npm run chapters:classify -- --apply --threshold=0.95 --subject=maths
 *
 * Guesses at or above the threshold (default 0.9 ≈ 92–96% right on held-out questions) are saved as
 * chapterId with chapterIdSource 'auto'. The rest keep chapterId null but store their best guess, and
 * show up in Admin → Chapters for a quick yes/no. Choices made there are never changed by this script.
 * Safe to re-run after importing more questions: it retrains and re-guesses only 'none'/'auto' questions.
 */
import { connect, close, col } from '../server/src/db.js';
import { syncChapterIds } from '../server/src/lib/chapterIds.js';
import { train, predict, evaluate } from '../server/src/lib/classifier.js';
import { SUBJECTS } from '../server/src/lib/util.js';

const args = process.argv.slice(2);
const arg = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1];
const apply = args.includes('--apply');
const threshold = Number(arg('threshold')) || 0.9;
const only = arg('subject');

await connect();
await syncChapterIds({ log: console.log }); // make sure every question has its name-based chapter first

const textOf = (q) => [q.text, ...(q.options || []).map((o) => o.text)].join(' ');
const fields = { projection: { _id: 1, text: 1, 'options.text': 1, chapterId: 1 } };
const pct = (x) => `${(100 * x).toFixed(1)}%`;

for (const subject of SUBJECTS.filter((s) => !only || s === only)) {
  const labelled = await col('questions')
    .find({ subject, chapterId: { $type: 'string' }, chapterIdSource: { $in: ['name', 'manual'] } }, fields)
    .toArray();
  if (labelled.length < 200) {
    console.log(`\n${subject}: only ${labelled.length} questions with a known chapter — too few to learn from, skipped.`);
    continue;
  }
  const docs = labelled.map((q) => ({ text: textOf(q), label: q.chapterId }));

  // Honest accuracy: learn from 90%, test on the other 10%.
  const shuffled = docs.map((d) => [Math.random(), d]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const cut = Math.floor(shuffled.length * 0.9);
  const report = evaluate(train(shuffled.slice(0, cut)), shuffled.slice(cut), [...new Set([0.5, 0.8, threshold])].sort());
  console.log(`\n${subject}: learned from ${labelled.length.toLocaleString('en-IN')} questions. On held-out questions:`);
  for (const r of report) console.log(`  guesses ≥ ${r.cut}: ${pct(r.coverage)} of questions, ${r.accuracy === null ? '-' : pct(r.accuracy)} right`);

  const model = train(docs);
  const todo = await col('questions').find({ subject, chapterIdSource: { $in: ['none', 'auto'] } }, fields).toArray();
  let placed = 0;
  let queued = 0;
  const byChapter = {};
  let ops = [];
  const flush = async () => {
    if (apply && ops.length) await col('questions').bulkWrite(ops, { ordered: false });
    ops = [];
  };
  for (const q of todo) {
    const g = predict(model, textOf(q));
    const guess = { id: g.label, p: g.p, second: g.second || null };
    if (g.label && g.p >= threshold) {
      placed++;
      byChapter[g.label] = (byChapter[g.label] || 0) + 1;
      ops.push({ updateOne: { filter: { _id: q._id }, update: { $set: { chapterId: g.label, chapterIdSource: 'auto', chapterGuess: guess } } } });
    } else {
      queued++;
      ops.push({ updateOne: { filter: { _id: q._id }, update: { $set: { chapterId: null, chapterIdSource: 'none', chapterGuess: guess } } } });
    }
    if (ops.length >= 1000) await flush();
  }
  await flush();
  console.log(`  ${todo.length.toLocaleString('en-IN')} questions without a chapter: ${apply ? '' : 'would '}place ${placed.toLocaleString('en-IN')}, leave ${queued.toLocaleString('en-IN')} for review in Admin → Chapters.`);
  const top = Object.entries(byChapter).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) console.log(`  most placed into: ${top.map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
if (!apply) console.log('\nPreview only. Run with --apply to save.');
await close();
