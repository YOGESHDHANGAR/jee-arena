import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMongoUri, isLocalUri, describeUri, LOCAL_MONGO } from '../src/lib/mongoUri.js';

const ATLAS = 'mongodb+srv://u:secret@cluster0.abc.mongodb.net/';

test('development uses local MongoDB by default', () => {
  assert.equal(pickMongoUri({}).uri, LOCAL_MONGO);
});

test('development keeps a local MONGO_URI (other port, credentials)', () => {
  assert.equal(pickMongoUri({ MONGO_URI: 'mongodb://localhost:27018' }).uri, 'mongodb://localhost:27018');
  assert.equal(pickMongoUri({ MONGO_URI: 'mongodb://me:pw@127.0.0.1:27017/?authSource=admin' }).where, 'local');
});

test('development ignores an Atlas MONGO_URI in .env', () => {
  const r = pickMongoUri({ MONGO_URI: ATLAS });
  assert.equal(r.uri, LOCAL_MONGO);
  assert.equal(r.ignoredRemote, true);
  assert.equal(pickMongoUri({ MONGO_URI: ATLAS, MONGO_URI_LOCAL: 'mongodb://127.0.0.1:27019' }).uri, 'mongodb://127.0.0.1:27019');
});

test('USE_ATLAS=1 uses Atlas on purpose', () => {
  assert.equal(pickMongoUri({ USE_ATLAS: '1', ATLAS_URI: ATLAS }).uri, ATLAS);
  assert.equal(pickMongoUri({ USE_ATLAS: '1', MONGO_URI: ATLAS }).uri, ATLAS);
  assert.throws(() => pickMongoUri({ USE_ATLAS: '1', MONGO_URI: LOCAL_MONGO }), /ATLAS_URI/);
});

test('production uses MONGO_URI and requires it', () => {
  assert.equal(pickMongoUri({ NODE_ENV: 'production', MONGO_URI: ATLAS }).uri, ATLAS);
  assert.throws(() => pickMongoUri({ NODE_ENV: 'production' }), /MONGO_URI/);
});

test('helpers', () => {
  assert.ok(isLocalUri('mongodb://localhost'));
  assert.ok(!isLocalUri('mongodb://localhost.evil.com'));
  assert.ok(!isLocalUri(ATLAS));
  assert.equal(describeUri(ATLAS), 'cluster0.abc.mongodb.net'); // never shows the password
});
