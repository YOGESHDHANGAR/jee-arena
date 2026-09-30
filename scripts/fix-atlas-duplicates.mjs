// Repairs Atlas after the copy: finds questions in Atlas that are NOT in your local database
// (extra copies with different _ids, e.g. from an earlier import/seed) and removes them, so
// question numbers (qid) are unique again and the live app can start.
// Your local database is only read.
//
// 1) Check what it would do (changes nothing):
//      ATLAS_URI="mongodb+srv://..." node scripts/fix-atlas-duplicates.mjs
// 2) Actually remove the extras:
//      ATLAS_URI="mongodb+srv://..." CONFIRM=1 node scripts/fix-atlas-duplicates.mjs

import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.cwd(), 'server', 'package.json'));
const { MongoClient } = require('mongodb');

const LOCAL_URI = process.env.LOCAL_URI || 'mongodb://localhost:27017';
const ATLAS_URI = process.env.ATLAS_URI;
const DB_NAME = process.env.DB_NAME || 'jee_arena';
const CONFIRM = process.env.CONFIRM === '1';

if (!ATLAS_URI) {
  console.error('Set ATLAS_URI to your Atlas connection string first.');
  process.exit(1);
}

const local = new MongoClient(LOCAL_URI);
const atlas = new MongoClient(ATLAS_URI);

try {
  await local.connect();
  await atlas.connect();
  const src = local.db(DB_NAME).collection('questions');
  const dst = atlas.db(DB_NAME).collection('questions');

  const localIds = new Set();
  for await (const d of src.find({}, { projection: { _id: 1 } })) localIds.add(String(d._id));

  const extras = [];
  for await (const d of dst.find({}, { projection: { _id: 1, qid: 1, 'source.name': 1, 'source.id': 1 } })) {
    if (!localIds.has(String(d._id))) extras.push(d);
  }
  const atlasCount = await dst.estimatedDocumentCount();
  console.log(`Local questions: ${localIds.size}`);
  console.log(`Atlas questions: ${atlasCount}`);
  console.log(`In Atlas but not local (extras): ${extras.length}`);
  for (const d of extras.slice(0, 5)) console.log(`  e.g. qid ${d.qid} · ${d.source?.name || '-'} ${d.source?.id || ''}`);

  if (!extras.length) {
    console.log('No extras. Nothing to remove.');
  } else if (!CONFIRM) {
    console.log('\nNothing changed. Run again with CONFIRM=1 to remove these extras from Atlas.');
  } else {
    let removed = 0;
    for (let i = 0; i < extras.length; i += 1000) {
      const r = await dst.deleteMany({ _id: { $in: extras.slice(i, i + 1000).map((d) => d._id) } });
      removed += r.deletedCount;
    }
    console.log(`Removed ${removed} extra questions from Atlas.`);
  }

  // Anything still duplicated would stop the app starting; report it.
  for (const [field, label] of [['qid', 'question number'], ['source', 'source']]) {
    const key = field === 'qid' ? '$qid' : { n: '$source.name', i: '$source.id' };
    const match = field === 'qid' ? { qid: { $ne: null } } : { 'source.name': { $exists: true }, 'source.id': { $exists: true } };
    const dups = await dst.aggregate([{ $match: match }, { $group: { _id: key, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'groups' }], { allowDiskUse: true }).toArray();
    const groups = dups[0]?.groups || 0;
    console.log(groups ? `Still duplicated by ${label}: ${groups} groups` : `No duplicates by ${label}.`);
  }
  if (CONFIRM) console.log('\nDone. Open the site; Render restarts the app on the next visit.');
} catch (e) {
  console.error('Failed:', e.message);
  process.exitCode = 1;
} finally {
  await local.close();
  await atlas.close();
}
