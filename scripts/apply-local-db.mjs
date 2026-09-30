// One-time: local development always uses your LOCAL MongoDB (see server/src/lib/mongoUri.js).
// Run from the jee-arena folder:  node scripts/apply-local-db.mjs      (safe to run twice)
import fs from 'node:fs';

const newFiles = {
 "server/src/lib/mongoUri.js": "/**\n * Which MongoDB to use, the same way for the server and every script.\n *\n *  - Production (NODE_ENV=production, i.e. Render): MONGO_URI, which must be set.\n *  - Development (your computer): ALWAYS your local MongoDB, even if MONGO_URI in .env points at\n *    Atlas. A remote MONGO_URI is ignored with a warning, so local work can never touch the live\n *    database by accident.\n *  - Development, on purpose against Atlas: USE_ATLAS=1 (uses ATLAS_URI, or MONGO_URI if that's remote),\n *    e.g.  USE_ATLAS=1 npm run backup\n *\n * Local address: MONGO_URI if it's local, else MONGO_URI_LOCAL, else mongodb://127.0.0.1:27017.\n */\nexport const LOCAL_MONGO = 'mongodb://127.0.0.1:27017';\n\nconst LOCAL_HOSTS = /^mongodb:\\/\\/(?:[^@/]*@)?(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|0\\.0\\.0\\.0)(?::\\d+)?(?:[/?]|$)/i;\nexport const isLocalUri = (uri) => LOCAL_HOSTS.test(String(uri || ''));\n\nexport function pickMongoUri(env = process.env) {\n  const mongo = (env.MONGO_URI || '').trim();\n  const atlas = (env.ATLAS_URI || '').trim();\n\n  if (env.NODE_ENV === 'production') {\n    if (!mongo) throw new Error('Missing env var MONGO_URI (required in production)');\n    return { uri: mongo, where: isLocalUri(mongo) ? 'local' : 'remote' };\n  }\n\n  if (env.USE_ATLAS === '1') {\n    const remote = [atlas, mongo].find((u) => u && !isLocalUri(u));\n    if (!remote) throw new Error('USE_ATLAS=1 but no remote connection string: set ATLAS_URI in .env');\n    return { uri: remote, where: 'remote' };\n  }\n\n  if (mongo && isLocalUri(mongo)) return { uri: mongo, where: 'local' };\n  const local = (env.MONGO_URI_LOCAL || '').trim() || LOCAL_MONGO;\n  return { uri: local, where: 'local', ignoredRemote: !!mongo && !isLocalUri(mongo) };\n}\n\n/** Host part only, never the password: \"127.0.0.1:27017\" or \"cluster0.xxxx.mongodb.net\". */\nexport function describeUri(uri) {\n  const m = String(uri).match(/^mongodb(?:\\+srv)?:\\/\\/(?:[^@/]*@)?([^/?]+)/i);\n  return m ? m[1] : 'unknown host';\n}\n\nlet announced = false;\n/** Picks the URI and says once, on the console, which database this process is using. */\nexport function mongoUri(env = process.env) {\n  const r = pickMongoUri(env);\n  if (!announced) {\n    announced = true;\n    if (r.ignoredRemote) console.warn('MONGO_URI in .env points at a remote database; ignored in development. Use USE_ATLAS=1 to use it on purpose.');\n    console.log(`Database: ${r.where === 'local' ? 'LOCAL' : 'REMOTE (Atlas)'} ${describeUri(r.uri)}`);\n  }\n  return r.uri;\n}\n",
 "server/test/mongoUri.test.js": "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { pickMongoUri, isLocalUri, describeUri, LOCAL_MONGO } from '../src/lib/mongoUri.js';\n\nconst ATLAS = 'mongodb+srv://u:secret@cluster0.abc.mongodb.net/';\n\ntest('development uses local MongoDB by default', () => {\n  assert.equal(pickMongoUri({}).uri, LOCAL_MONGO);\n});\n\ntest('development keeps a local MONGO_URI (other port, credentials)', () => {\n  assert.equal(pickMongoUri({ MONGO_URI: 'mongodb://localhost:27018' }).uri, 'mongodb://localhost:27018');\n  assert.equal(pickMongoUri({ MONGO_URI: 'mongodb://me:pw@127.0.0.1:27017/?authSource=admin' }).where, 'local');\n});\n\ntest('development ignores an Atlas MONGO_URI in .env', () => {\n  const r = pickMongoUri({ MONGO_URI: ATLAS });\n  assert.equal(r.uri, LOCAL_MONGO);\n  assert.equal(r.ignoredRemote, true);\n  assert.equal(pickMongoUri({ MONGO_URI: ATLAS, MONGO_URI_LOCAL: 'mongodb://127.0.0.1:27019' }).uri, 'mongodb://127.0.0.1:27019');\n});\n\ntest('USE_ATLAS=1 uses Atlas on purpose', () => {\n  assert.equal(pickMongoUri({ USE_ATLAS: '1', ATLAS_URI: ATLAS }).uri, ATLAS);\n  assert.equal(pickMongoUri({ USE_ATLAS: '1', MONGO_URI: ATLAS }).uri, ATLAS);\n  assert.throws(() => pickMongoUri({ USE_ATLAS: '1', MONGO_URI: LOCAL_MONGO }), /ATLAS_URI/);\n});\n\ntest('production uses MONGO_URI and requires it', () => {\n  assert.equal(pickMongoUri({ NODE_ENV: 'production', MONGO_URI: ATLAS }).uri, ATLAS);\n  assert.throws(() => pickMongoUri({ NODE_ENV: 'production' }), /MONGO_URI/);\n});\n\ntest('helpers', () => {\n  assert.ok(isLocalUri('mongodb://localhost'));\n  assert.ok(!isLocalUri('mongodb://localhost.evil.com'));\n  assert.ok(!isLocalUri(ATLAS));\n  assert.equal(describeUri(ATLAS), 'cluster0.abc.mongodb.net'); // never shows the password\n});\n"
};
const edits = [
 {
  "file": ".env.example",
  "find": "MONGO_URI=mongodb://127.0.0.1:27017\n",
  "replace": "MONGO_URI=mongodb://127.0.0.1:27017\n# Development always uses your LOCAL MongoDB, even if MONGO_URI points elsewhere.\n# Put the Atlas string here and add USE_ATLAS=1 to a command to run it against Atlas on purpose,\n# e.g.  USE_ATLAS=1 npm run backup      (Render sets NODE_ENV=production and uses MONGO_URI.)\nATLAS_URI=\n"
 },
 {
  "file": "scripts/backup.js",
  "find": "import { MongoClient, BSON } from 'mongodb';\n",
  "replace": "import { MongoClient, BSON } from 'mongodb';\nimport { mongoUri } from '../server/src/lib/mongoUri.js';\n"
 },
 {
  "file": "scripts/backup.js",
  "find": "const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';\n",
  "replace": "const uri = mongoUri(); // local unless USE_ATLAS=1\n"
 },
 {
  "file": "scripts/copy-db.js",
  "find": "import { MongoClient } from 'mongodb';\n",
  "replace": "import { MongoClient } from 'mongodb';\nimport { mongoUri } from '../server/src/lib/mongoUri.js';\n"
 },
 {
  "file": "scripts/copy-db.js",
  "find": "const fromUri = arg('from') || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';\n",
  "replace": "const fromUri = arg('from') || mongoUri();\n"
 },
 {
  "file": "scripts/import-from-bank.js",
  "find": "import { MongoClient } from 'mongodb';\n",
  "replace": "import { MongoClient } from 'mongodb';\nimport { mongoUri } from '../server/src/lib/mongoUri.js';\n"
 },
 {
  "file": "scripts/import-from-bank.js",
  "find": "const DST_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';\n",
  "replace": "const DST_URI = mongoUri(); // local unless USE_ATLAS=1\n"
 },
 {
  "file": "scripts/make-admin.js",
  "find": "import { MongoClient } from 'mongodb';\n",
  "replace": "import { MongoClient } from 'mongodb';\nimport { mongoUri } from '../server/src/lib/mongoUri.js';\n"
 },
 {
  "file": "scripts/make-admin.js",
  "find": "const client = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017');\n",
  "replace": "const client = new MongoClient(mongoUri());\n"
 },
 {
  "file": "scripts/restore.js",
  "find": " * Uses MONGO_URI from .env (point it at Atlas to restore there).\n",
  "replace": " * Restores into your local MongoDB. To restore into Atlas: USE_ATLAS=1 npm run restore (uses ATLAS_URI).\n"
 },
 {
  "file": "scripts/restore.js",
  "find": "import { MongoClient, BSON } from 'mongodb';\n",
  "replace": "import { MongoClient, BSON } from 'mongodb';\nimport { mongoUri } from '../server/src/lib/mongoUri.js';\n"
 },
 {
  "file": "scripts/restore.js",
  "find": "const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';\n",
  "replace": "const uri = mongoUri(); // local unless USE_ATLAS=1\n"
 },
 {
  "file": "scripts/seed.js",
  "find": "import { MongoClient } from 'mongodb';\n",
  "replace": "import { MongoClient } from 'mongodb';\nimport { mongoUri } from '../server/src/lib/mongoUri.js';\n"
 },
 {
  "file": "scripts/seed.js",
  "find": "const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';\n",
  "replace": "const uri = mongoUri(); // local unless USE_ATLAS=1\n"
 },
 {
  "file": "server/src/config.js",
  "find": "const required = (name, fallback) => {\n",
  "replace": "import { mongoUri } from './lib/mongoUri.js';\n\nconst required = (name, fallback) => {\n"
 },
 {
  "file": "server/src/config.js",
  "find": "  mongoUri: required('MONGO_URI', 'mongodb://127.0.0.1:27017'),\n",
  "replace": "  // Local MongoDB in development, MONGO_URI in production (lib/mongoUri.js).\n  mongoUri: mongoUri(),\n"
 }
];

let changed = 0;
for (const [file, text] of Object.entries(newFiles)) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') === text) { console.log(`already there: ${file}`); continue; }
  fs.writeFileSync(file, text); changed++; console.log(`created: ${file}`);
}
for (const e of edits) {
  let s = fs.readFileSync(e.file, 'utf8');
  const crlf = s.includes('\r\n');
  if (crlf) s = s.replace(/\r\n/g, '\n');
  if (s.includes(e.replace)) { console.log(`already done: ${e.file}`); continue; }
  if (s.split(e.find).length !== 2) { console.error(`Could not find the spot to edit in ${e.file}; nothing changed there.`); process.exitCode = 1; continue; }
  s = s.replace(e.find, () => e.replace);
  fs.writeFileSync(e.file, crlf ? s.replace(/\n/g, '\r\n') : s);
  changed++; console.log(`updated: ${e.file}`);
}
console.log(changed ? 'Done. Local development now uses your local MongoDB.' : 'Nothing to change.');
