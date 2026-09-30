// Copies every collection of the local jee_arena database to Atlas.
// Local data is only read, never changed.
//
// Usage (from the jee-arena folder):
//   ATLAS_URI="mongodb+srv://..." node scripts/copy-to-atlas.mjs
//
// Optional: LOCAL_URI (default mongodb://localhost:27017), DB_NAME (default jee_arena)

import { createRequire } from 'node:module';
import path from 'node:path';

// Resolve the mongodb driver from the project (works with npm workspaces).
const require = createRequire(path.join(process.cwd(), 'server', 'package.json'));
const { MongoClient } = require('mongodb');

const LOCAL_URI = process.env.LOCAL_URI || 'mongodb://localhost:27017';
const ATLAS_URI = process.env.ATLAS_URI;
const DB_NAME = process.env.DB_NAME || 'jee_arena';
const BATCH = 500;

if (!ATLAS_URI) {
  console.error('Set ATLAS_URI to your Atlas connection string first.');
  process.exit(1);
}

const local = new MongoClient(LOCAL_URI);
const atlas = new MongoClient(ATLAS_URI);

try {
  await local.connect();
  await atlas.connect();
  const src = local.db(DB_NAME);
  const dst = atlas.db(DB_NAME);

  const collections = (await src.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'));

  console.log(`Copying ${collections.length} collections from local ${DB_NAME} to Atlas...`);

  for (const name of collections) {
    const from = src.collection(name);
    const to = dst.collection(name);

    // Atlas is the copy target: drop its secondary indexes (the live app may have
    // created some) so they can't block the copy. Local indexes are rebuilt below.
    await to.dropIndexes().catch(() => {});

    // Upsert by _id so re-running is safe and never duplicates.
    let copied = 0;
    let ops = [];
    for await (const doc of from.find()) {
      ops.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
      if (ops.length === BATCH) {
        await to.bulkWrite(ops, { ordered: false });
        copied += ops.length;
        ops = [];
      }
    }
    if (ops.length) {
      await to.bulkWrite(ops, { ordered: false });
      copied += ops.length;
    }

    // Recreate indexes (skip the default _id index).
    const indexes = (await from.indexes()).filter((i) => i.name !== '_id_');
    for (const { key, name: idxName, v, ns, ...opts } of indexes) {
      try {
        await to.createIndex(key, { name: idxName, ...opts });
      } catch (e) {
        console.warn(`  index ${idxName} on ${name}: ${e.message}`);
      }
    }

    console.log(`  ${name}: ${copied} documents`);
  }

  console.log('Done.');
} catch (e) {
  console.error('Copy failed:', e.message);
  process.exitCode = 1;
} finally {
  await local.close();
  await atlas.close();
}
