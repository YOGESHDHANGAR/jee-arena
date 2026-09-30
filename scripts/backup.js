#!/usr/bin/env node
/**
 * Backs up the whole JEE Arena database to ONE compressed file (MongoDB Atlas's free tier has no backups).
 *
 *   npm run backup                          # -> backups/jee_arena-2026-09-29-1830.jsonl.gz
 *   npm run backup -- --upload              # also copy it to your R2 bucket (backups/…)
 *   npm run backup -- --keep=8              # keep only the newest 8 files in backups/
 *   npm run backup -- --out=D:/Backups      # somewhere else
 *
 * Format: gzip'd JSON lines. First a header line per collection with its indexes, then one line
 * per document in MongoDB Extended JSON (ObjectIds and dates survive). Restore with `npm run restore`.
 * Works with only the Node mongodb driver — no mongodump needed, so it also runs on GitHub Actions.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient, BSON } from 'mongodb';
import { mongoUri } from '../server/src/lib/mongoUri.js';
import { request as r2Put, settings as r2Settings } from './upload-media.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const val = (name) => arg(name)?.split('=').slice(1).join('=');

const uri = mongoUri(); // local unless USE_ATLAS=1
const dbName = process.env.DB_NAME || 'jee_arena';
const outDir = path.resolve(val('out') || path.join(ROOT, 'backups'));
const keep = Number(val('keep')) || 0;

const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16).replace(' ', '-').replace(':', '');
const file = path.join(outDir, `${dbName}-${stamp}.jsonl.gz`);

fs.mkdirSync(outDir, { recursive: true });
const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const gzip = zlib.createGzip({ level: 6 });
const out = fs.createWriteStream(file);
gzip.pipe(out);
const write = async (obj) => {
  if (!gzip.write(`${BSON.EJSON.stringify(obj, { relaxed: false })}\n`)) await once(gzip, 'drain');
};

const started = Date.now();
const counts = {};
await write({ $backup: { db: dbName, at: new Date(), version: 1 } });
const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')).sort();
for (const name of collections) {
  const indexes = (await db.collection(name).indexes()).filter((i) => i.name !== '_id_');
  await write({ $collection: name, indexes });
  let n = 0;
  for await (const doc of db.collection(name).find({}).batchSize(1000)) {
    await write({ c: name, d: doc });
    n++;
  }
  counts[name] = n;
  process.stdout.write(`\r  ${name}: ${n.toLocaleString('en-IN')}                    \n`);
}
gzip.end();
await once(out, 'finish');
await client.close();

const size = fs.statSync(file).size;
console.log(`Backup written: ${file} (${(size / 1048576).toFixed(1)} MB, ${Math.round((Date.now() - started) / 1000)}s)`);

if (arg('upload')) {
  const { s, missing } = r2Settings();
  if (missing.length) {
    console.error(`--upload needs ${missing.join(', ')} in .env`);
    process.exit(1);
  }
  const key = `backups/${path.basename(file)}`;
  const res = await r2Put(s, 'PUT', key, fs.readFileSync(file));
  if (!res.ok) {
    console.error(`Upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`Uploaded to R2: ${s.bucket}/${key}  (tip: add a lifecycle rule on the backups/ prefix to delete old ones)`);
}

if (keep > 0) {
  const mine = fs.readdirSync(outDir).filter((f) => f.startsWith(`${dbName}-`) && f.endsWith('.jsonl.gz')).sort().reverse();
  for (const old of mine.slice(keep)) {
    try {
      fs.unlinkSync(path.join(outDir, old));
      console.log(`Removed old backup ${old}`);
    } catch (e) {
      console.warn(`Could not remove ${old}: ${e.message}`);
    }
  }
}
