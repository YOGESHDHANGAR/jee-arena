// Copy the local jee_arena database into another MongoDB (e.g. Atlas). Local data is only read.
//   node scripts/copy-db.js --to="mongodb+srv://user:pass@cluster.xxxx.mongodb.net" --dry-run
//   node scripts/copy-db.js --to="mongodb+srv://..."            (refuses if target collections have data)
//   node scripts/copy-db.js --to="mongodb+srv://..." --replace  (empties each target collection first)
import { MongoClient } from 'mongodb';
import { mongoUri } from '../server/src/lib/mongoUri.js';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const has = (k) => process.argv.includes(`--${k}`);
const fromUri = arg('from') || mongoUri();
const toUri = arg('to');
const dbName = arg('db') || process.env.DB_NAME || 'jee_arena';
if (!toUri) { console.error('Pass --to="<target mongodb uri>"'); process.exit(1); }
if (toUri === fromUri) { console.error('Target is the same as source'); process.exit(1); }

const src = await MongoClient.connect(fromUri);
const dst = await MongoClient.connect(toUri);
const sdb = src.db(dbName), ddb = dst.db(dbName);
const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
const stats = await sdb.stats();
console.log(`Source ${dbName}: data ${mb(stats.dataSize)}, storage ${mb(stats.storageSize)} (Atlas free = 512 MB)`);

const cols = (await sdb.listCollections({ type: 'collection' }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
for (const name of cols) {
  const n = await sdb.collection(name).estimatedDocumentCount();
  const existing = await ddb.collection(name).estimatedDocumentCount();
  console.log(`${name}: ${n} docs${existing ? ` (target has ${existing})` : ''}`);
  if (has('dry-run')) continue;
  if (existing && !has('replace')) { console.error(`  target ${name} not empty; use --replace`); process.exit(1); }
  if (existing) await ddb.collection(name).deleteMany({});
  let batch = [], done = 0;
  for await (const doc of sdb.collection(name).find()) {
    batch.push(doc);
    if (batch.length === 1000) { await ddb.collection(name).insertMany(batch, { ordered: false }); done += batch.length; batch = []; process.stdout.write(`\r  ${done}/${n}`); }
  }
  if (batch.length) { await ddb.collection(name).insertMany(batch, { ordered: false }); done += batch.length; }
  console.log(`\r  copied ${done}/${n}`);
}
await src.close(); await dst.close();
console.log(has('dry-run') ? 'Dry run: nothing written.' : 'Done. Indexes are created by the app on first start.');
