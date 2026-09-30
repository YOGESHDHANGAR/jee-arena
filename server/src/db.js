import { MongoClient } from 'mongodb';
import { config } from './config.js';
import { setTextIndex } from './lib/search.js';

let client;
let db;

export async function connect(uri = config.mongoUri, dbName = config.dbName) {
  if (db) return db;
  client = new MongoClient(uri, { maxPoolSize: 20 });
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes(db);
  ensureTextIndex(db); // not awaited: the first build on a big bank shouldn't delay startup
  // Not awaited either: maps questions onto standard chapters (lib/chapterIds.js), only when needed.
  import('./lib/chapterIds.js')
    .then(({ syncChapterIds }) => syncChapterIds({ log: console.log }))
    .catch((e) => console.error('Standard chapter sync failed:', e.message));
  return db;
}

export const getDb = () => {
  if (!db) throw new Error('DB not connected');
  return db;
};

export const col = (name) => getDb().collection(name);

export async function close() {
  await client?.close();
  client = undefined;
  db = undefined;
}

/**
 * Atomic counter, used for short public question numbers (/problems/123).
 */
export async function nextSeq(name, by = 1) {
  const r = await col('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: by } },
    { upsert: true, returnDocument: 'after' },
  );
  return r.seq;
}

async function ensureIndexes(d) {
  await Promise.all([
    d.collection('users').createIndex({ email: 1 }, { unique: true }),
    d.collection('users').createIndex({ username: 1 }, { unique: true }),
    d.collection('users').createIndex({ rating: -1 }),
    d.collection('users').createIndex({ solvedCount: -1 }),
    d.collection('users').createIndex({ createdAt: -1 }), // Admin → Growth
    d.collection('users').createIndex({ referrals: -1 }, { sparse: true }),
    d.collection('visits').createIndex({ day: 1 }),
    d.collection('activity').createIndex({ day: 1 }),

    d.collection('questions').createIndex({ qid: 1 }, { unique: true }),
    d.collection('questions').createIndex({ 'source.name': 1, 'source.id': 1 }, { unique: true, sparse: true }),
    d.collection('questions').createIndex({ status: 1, subject: 1, chapter: 1, difficulty: 1, qid: 1 }),
    d.collection('questions').createIndex({ lockedUntil: 1 }, { sparse: true }),
    d.collection('questions').createIndex({ status: 1, subject: 1, chapterId: 1, difficulty: 1, qid: 1 }), // standard chapters
    d.collection('questions').createIndex({ chapterIdSource: 1, subject: 1 }), // Admin → Chapters review queue
    // Spaced revision (lib/reviews.js): what's due, per student.
    d.collection('reviews').createIndex({ userId: 1, qid: 1 }, { unique: true }),
    d.collection('reviews').createIndex({ userId: 1, due: 1 }),

    d.collection('progress').createIndex({ userId: 1, qid: 1 }, { unique: true }),
    d.collection('progress').createIndex({ solvedAt: -1 }, { sparse: true }), // weekly leaderboard
    d.collection('activity').createIndex({ userId: 1, day: 1 }, { unique: true }),

    d.collection('tests').createIndex({ kind: 1, startAt: -1 }),
    d.collection('tests').createIndex({ slug: 1 }, { unique: true, sparse: true }),
    d.collection('testAttempts').createIndex({ testId: 1, userId: 1 }, { unique: true }),
    d.collection('testAttempts').createIndex({ testId: 1, score: -1, timeTakenSec: 1 }),
    d.collection('testAttempts').createIndex({ userId: 1, startedAt: -1 }),

    d.collection('comments').createIndex({ qid: 1, parentId: 1, score: -1, createdAt: -1 }),
    d.collection('comments').createIndex({ parentId: 1, createdAt: 1 }),

    // "Report a problem with this question": one open report per student per question.
    d.collection('reports').createIndex({ qid: 1, userId: 1, status: 1 }),
    d.collection('reports').createIndex({ status: 1, createdAt: -1 }),
    d.collection('bookmarks').createIndex({ userId: 1, qid: 1 }, { unique: true }),
    d.collection('bookmarks').createIndex({ userId: 1, createdAt: -1 }),
    // Problem of the Day: _id is the IST day key (YYYY-MM-DD).
    d.collection('potd').createIndex({ qid: 1 }),
    // Duplicate detection (lib/fingerprint.js)
    d.collection('questions').createIndex({ fp: 1 }, { sparse: true }),
    d.collection('questions').createIndex({ fpText: 1 }, { sparse: true }),
    d.collection('dupIgnored').createIndex({ mode: 1, key: 1 }, { unique: true }),
    // My journey (lib/insights.js): weekly predicted-score snapshots per student.
    d.collection('predictions').createIndex({ userId: 1, week: -1 }),
  ]);
  // Error log (lib/errors.js): forget errors not seen for 30 days. Optional: some Mongo-compatible
  // databases have no TTL indexes (the log is capped at 2,000 groups anyway).
  await d.collection('errors').createIndex({ lastAt: 1 }, { expireAfterSeconds: 30 * 86400 }).catch(() => {});
}

/**
 * Full-text index for question search (chapter/topic weigh more than the question text).
 * Built once in the background on first start (a minute or two for 140k questions); until it's
 * ready, search uses the regex scan.
 * Mongo-compatible databases without text indexes just keep using the slower regex search.
 */
async function ensureTextIndex(d) {
  try {
    await d.collection('questions').createIndex(
      { chapter: 'text', topic: 'text', text: 'text' },
      { name: 'question_search', weights: { chapter: 5, topic: 3, text: 1 }, default_language: 'english', language_override: 'searchLanguage' },
    );
    setTextIndex(true);
  } catch (e) {
    setTextIndex(false);
    console.warn(`Text search index unavailable (${e.codeName || e.message}); search will scan instead.`);
  }
}
