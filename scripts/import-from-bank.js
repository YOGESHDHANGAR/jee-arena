#!/usr/bin/env node
/**
 * One-way copy: JEE Video Studio's question bank (SQLite)  ->  JEE Arena's MongoDB.
 *
 * Opens bank/jee-bank.db READ-ONLY. Nothing in JEE Studio is changed. Diagrams the
 * imported questions need are COPIED into jee-arena/media (the arena never links into Studio).
 *
 *   npm run import -- --dry-run          # counts only, writes nothing
 *   npm run import                       # import everything
 *   npm run import -- --source=eqourse   # one source tag: doubtnut | ai-import | eqourse | pw-dataset
 *   npm run import -- --subject=Physics --limit=2000
 *   npm run import -- --published-only   # skip questions that would be drafts
 *
 * Re-running is safe: matched on the Studio id, so each question keeps its public number
 * and stats, and questions you edited in Admin are never overwritten.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MongoClient } from 'mongodb';
import { mapStudioRow } from './lib/studio-bank.js';
import { fingerprint } from '../server/src/lib/fingerprint.js';
import { chapterIdFields } from '../server/src/lib/chapterIds.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const STUDIO = path.resolve(ROOT, process.env.STUDIO_PATH || '../jee-video-studio');
const BANK = path.join(STUDIO, 'bank', 'jee-bank.db');
const STUDIO_IMAGES = path.join(STUDIO, 'public', 'images');
const MEDIA = path.join(ROOT, 'media');
const DST_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DST_DB = process.env.DB_NAME || 'jee_arena';
const dryRun = !!args['dry-run'];
const limit = args.limit ? Number(args.limit) : Infinity;
const BATCH = 1000;

if (!fs.existsSync(BANK)) {
  console.error(`Question bank not found at ${BANK}\nSet STUDIO_PATH in .env to your jee-video-studio folder.`);
  process.exit(1);
}

const sqlite = new DatabaseSync(BANK, { readOnly: true });
const where = [];
const params = [];
if (args.subject) {
  where.push('q.subject = ? COLLATE NOCASE');
  params.push(String(args.subject));
}
if (args.source) {
  where.push('EXISTS (SELECT 1 FROM question_tags s WHERE s.question_id = q.id AND s.tag = ?)');
  params.push(String(args.source));
}
const total = sqlite.prepare(`SELECT COUNT(*) AS n FROM questions q ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...params).n;
console.log(`Studio bank: ${BANK}\n${total.toLocaleString('en-IN')} questions to scan${dryRun ? ' (dry run)' : ''}`);

// Keyset pagination on rowid keeps memory flat for 100k+ rows.
const page = sqlite.prepare(`
  SELECT q.rowid AS rid, q.id, q.num, q.subject, q.chapter, q.topic, q.difficulty, q.exam, q.year, q.type, q.format, q.data,
         (SELECT group_concat(tag, char(31)) FROM question_tags t WHERE t.question_id = q.id) AS tags
  FROM questions q
  WHERE q.rowid > ? ${where.length ? 'AND ' + where.join(' AND ') : ''}
  ORDER BY q.rowid LIMIT ${BATCH}`);

let mongo;
let questions;
let counters;
if (!dryRun) {
  mongo = new MongoClient(DST_URI);
  await mongo.connect();
  const db = mongo.db(DST_DB);
  questions = db.collection('questions');
  counters = db.collection('counters');
  await questions.createIndex({ qid: 1 }, { unique: true });
  await questions.createIndex({ 'source.name': 1, 'source.id': 1 }, { unique: true, sparse: true });
  fs.mkdirSync(MEDIA, { recursive: true });
}

const stats = { scanned: 0, inserted: 0, updated: 0, keptManual: 0, published: 0, draft: 0, images: 0, missingImages: 0, bySource: {}, bySubject: {}, skipped: {} };
const started = Date.now();
let lastRid = 0;

while (stats.scanned < limit) {
  const rows = page.all(lastRid, ...params);
  if (!rows.length) break;
  lastRid = rows[rows.length - 1].rid;

  const batch = [];
  for (const row of rows) {
    if (stats.scanned >= limit) break;
    stats.scanned++;
    const r = mapStudioRow(row);
    if (!r.ok) {
      stats.skipped[r.reason] = (stats.skipped[r.reason] || 0) + 1;
      continue;
    }
    if (args['published-only'] && r.question.status !== 'published') {
      stats.skipped['draft (published-only)'] = (stats.skipped['draft (published-only)'] || 0) + 1;
      continue;
    }
    batch.push(r);
  }
  await flush(batch);
  const pct = Math.round((100 * stats.scanned) / Math.min(total, limit));
  process.stdout.write(`\r  ${stats.scanned.toLocaleString('en-IN')} scanned (${pct}%) · ${stats.inserted.toLocaleString('en-IN')} new · ${stats.updated.toLocaleString('en-IN')} updated   `);
}

console.log(`\n\nDone in ${Math.round((Date.now() - started) / 1000)}s${dryRun ? ' — dry run, nothing written' : ''}`);
console.log(`  new: ${stats.inserted}   updated: ${stats.updated}   kept (edited in Admin): ${stats.keptManual}`);
console.log(`  published (has a usable answer): ${stats.published}   draft (needs answer/check): ${stats.draft}`);
console.log('  by subject:', stats.bySubject);
console.log('  by source:', stats.bySource);
if (!dryRun) console.log(`  diagrams copied: ${stats.images}${stats.missingImages ? `   missing in Studio: ${stats.missingImages}` : ''}`);
if (Object.keys(stats.skipped).length) console.log('  skipped:', stats.skipped);

sqlite.close();
await mongo?.close();

async function flush(items) {
  if (!items.length) return;
  for (const { question: q } of items) {
    stats.bySource[q.source.name] = (stats.bySource[q.source.name] || 0) + 1;
    stats.bySubject[q.subject] = (stats.bySubject[q.subject] || 0) + 1;
  }
  if (dryRun) {
    for (const { question: q } of items) stats[q.status]++;
    return;
  }

  const ids = items.map((i) => i.question.source.id);
  const existing = await questions
    .find({ 'source.id': { $in: ids } }, { projection: { _id: 1, source: 1, manual: 1, status: 1, answer: 1, difficultySource: 1, chapterIdSource: 1 } })
    .toArray();
  const byId = new Map(existing.map((e) => [e.source.id, e]));

  const fresh = items.filter((i) => !byId.has(i.question.source.id));
  let nextQid = 0;
  if (fresh.length) {
    const c = await counters.findOneAndUpdate({ _id: 'qid' }, { $inc: { seq: fresh.length } }, { upsert: true, returnDocument: 'after' });
    nextQid = c.seq - fresh.length + 1;
  }

  const ops = [];
  for (const { question: q, images } of items) {
    for (const img of images) copyImage(img);
    Object.assign(q, fingerprint(q)); // duplicate detection (Admin → Duplicates)
    const prev = byId.get(q.source.id);
    // Standard chapter (lib/chapterIds.js). Keep an admin's choice, and a text-based guess when the name says nothing.
    const ch = chapterIdFields(q.subject, q.chapter);
    if (!(prev?.chapterIdSource === 'manual' || (prev?.chapterIdSource === 'auto' && !ch.chapterId))) Object.assign(q, ch);
    if (!prev) {
      stats.inserted++;
      stats[q.status]++;
      ops.push({ insertOne: { document: { ...q, qid: nextQid++, stats: { attempts: 0, solved: 0 }, createdAt: new Date(), importedAt: new Date() } } });
      continue;
    }
    if (prev.manual) {
      // Edited by hand in Admin: leave content, status and answer alone.
      stats.keptManual++;
      stats[prev.status] = (stats[prev.status] || 0) + 1;
      continue;
    }
    const { status, ...content } = q;
    // Difficulty worked out from students' results (or set by hand) beats the source's label.
    if (prev.difficultySource) delete content.difficulty;
    const set = { ...content, importedAt: new Date() };
    // Don't un-publish or re-hide something an admin changed; only promote drafts that now have answers.
    set.status = prev.status === 'hidden' ? 'hidden' : prev.status === 'published' ? 'published' : status;
    stats.updated++;
    stats[set.status] = (stats[set.status] || 0) + 1;
    ops.push({ updateOne: { filter: { _id: prev._id }, update: { $set: set } } });
  }
  if (ops.length) await questions.bulkWrite(ops);
}

function copyImage(name) {
  const safe = path.basename(name);
  const to = path.join(MEDIA, safe);
  if (fs.existsSync(to)) return;
  const from = path.join(STUDIO_IMAGES, safe);
  try {
    fs.copyFileSync(from, to);
    stats.images++;
  } catch {
    stats.missingImages++;
  }
}
