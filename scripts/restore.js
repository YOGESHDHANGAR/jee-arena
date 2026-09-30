#!/usr/bin/env node
/**
 * Restores a backup made by `npm run backup`.
 *
 *   npm run restore -- backups/jee_arena-2026-09-29-1830.jsonl.gz
 *       -> restores into a NEW database "jee_arena_restore" so you can look before touching anything
 *   npm run restore -- <file> --to=jee_arena --replace
 *       -> replaces the live database's collections with the backup (asks you to type the name)
 *
 * Restores into your local MongoDB. To restore into Atlas: USE_ATLAS=1 npm run restore (uses ATLAS_URI).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { MongoClient, BSON } from 'mongodb';
import { mongoUri } from '../server/src/lib/mongoUri.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const val = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const replace = args.includes('--replace');

if (!file || !fs.existsSync(file)) {
  console.error('Usage: npm run restore -- <backup.jsonl.gz> [--to=<database>] [--replace]');
  process.exit(1);
}
const uri = mongoUri(); // local unless USE_ATLAS=1
const live = process.env.DB_NAME || 'jee_arena';
const target = val('to') || `${live}_restore`;

const client = new MongoClient(uri);
await client.connect();
const db = client.db(target);

const existing = (await db.listCollections({}, { nameOnly: true }).toArray()).filter((c) => !c.name.startsWith('system.'));
if (existing.length && !replace) {
  console.error(`Database "${target}" already has ${existing.length} collections. Pick another --to=… or add --replace.`);
  await client.close();
  process.exit(1);
}
if (existing.length && replace) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(`This REPLACES the collections in "${target}" on ${uri.replace(/\/\/[^@]*@/, '//***@')}. Type the database name to continue: `, r));
  rl.close();
  if (answer.trim() !== target) {
    console.log('Cancelled.');
    await client.close();
    process.exit(1);
  }
}

const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
let current = null;
let batch = [];
const counts = {};
const flush = async () => {
  if (batch.length) await db.collection(current).insertMany(batch, { ordered: false });
  counts[current] = (counts[current] || 0) + batch.length;
  batch = [];
};
const pendingIndexes = [];
for await (const line of lines) {
  if (!line.trim()) continue;
  const rec = BSON.EJSON.parse(line, { relaxed: false });
  if (rec.$backup) {
    console.log(`Backup of "${rec.$backup.db}" taken ${new Date(rec.$backup.at).toLocaleString('en-IN')} → restoring into "${target}"`);
    continue;
  }
  if (rec.$collection) {
    if (current) await flush();
    current = rec.$collection;
    if (replace) await db.collection(current).drop().catch(() => {});
    pendingIndexes.push([current, rec.indexes || []]);
    continue;
  }
  batch.push(rec.d);
  if (batch.length >= 1000) await flush();
}
if (current) await flush();

// Indexes after the data: faster, and a unique index can't fail half-way through inserting.
for (const [name, indexes] of pendingIndexes) {
  for (const { key, name: idxName, v, ns, ...opts } of indexes) {
    await db.collection(name).createIndex(key, { name: idxName, ...opts }).catch((e) => console.warn(`  index ${name}.${idxName}: ${e.message}`));
  }
}
for (const [name, n] of Object.entries(counts)) console.log(`  ${name}: ${n.toLocaleString('en-IN')}`);
console.log(`Restored into "${target}".${target !== live ? ` To use it, set DB_NAME=${target} (or restore again with --to=${live} --replace).` : ''}`);
await client.close();
