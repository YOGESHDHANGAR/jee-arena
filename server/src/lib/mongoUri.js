/**
 * Which MongoDB to use, the same way for the server and every script.
 *
 *  - Production (NODE_ENV=production, i.e. Render): MONGO_URI, which must be set.
 *  - Development (your computer): ALWAYS your local MongoDB, even if MONGO_URI in .env points at
 *    Atlas. A remote MONGO_URI is ignored with a warning, so local work can never touch the live
 *    database by accident.
 *  - Development, on purpose against Atlas: USE_ATLAS=1 (uses ATLAS_URI, or MONGO_URI if that's remote),
 *    e.g.  USE_ATLAS=1 npm run backup
 *
 * Local address: MONGO_URI if it's local, else MONGO_URI_LOCAL, else mongodb://127.0.0.1:27017.
 */
export const LOCAL_MONGO = 'mongodb://127.0.0.1:27017';

const LOCAL_HOSTS = /^mongodb:\/\/(?:[^@/]*@)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:[/?]|$)/i;
export const isLocalUri = (uri) => LOCAL_HOSTS.test(String(uri || ''));

export function pickMongoUri(env = process.env) {
  const mongo = (env.MONGO_URI || '').trim();
  const atlas = (env.ATLAS_URI || '').trim();

  if (env.NODE_ENV === 'production') {
    if (!mongo) throw new Error('Missing env var MONGO_URI (required in production)');
    return { uri: mongo, where: isLocalUri(mongo) ? 'local' : 'remote' };
  }

  if (env.USE_ATLAS === '1') {
    const remote = [atlas, mongo].find((u) => u && !isLocalUri(u));
    if (!remote) throw new Error('USE_ATLAS=1 but no remote connection string: set ATLAS_URI in .env');
    return { uri: remote, where: 'remote' };
  }

  if (mongo && isLocalUri(mongo)) return { uri: mongo, where: 'local' };
  const local = (env.MONGO_URI_LOCAL || '').trim() || LOCAL_MONGO;
  return { uri: local, where: 'local', ignoredRemote: !!mongo && !isLocalUri(mongo) };
}

/** Host part only, never the password: "127.0.0.1:27017" or "cluster0.xxxx.mongodb.net". */
export function describeUri(uri) {
  const m = String(uri).match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i);
  return m ? m[1] : 'unknown host';
}

let announced = false;
/** Picks the URI and says once, on the console, which database this process is using. */
export function mongoUri(env = process.env) {
  const r = pickMongoUri(env);
  if (!announced) {
    announced = true;
    if (r.ignoredRemote) console.warn('MONGO_URI in .env points at a remote database; ignored in development. Use USE_ATLAS=1 to use it on purpose.');
    console.log(`Database: ${r.where === 'local' ? 'LOCAL' : 'REMOTE (Atlas)'} ${describeUri(r.uri)}`);
  }
  return r.uri;
}
