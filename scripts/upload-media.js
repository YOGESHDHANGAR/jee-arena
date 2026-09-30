/**
 * Uploads jee-arena/media/* to Cloudflare R2 (or any S3-compatible bucket), so the app can
 * serve question pictures from a CDN instead of from the Node server / git repo.
 *
 *   npm run media:upload -- --dry-run     # list what would be uploaded
 *   npm run media:upload                  # upload new/changed files (skips ones already there)
 *   npm run media:upload -- --force       # re-upload everything
 *
 * Needs in .env:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *   (or S3_ENDPOINT=https://… instead of R2_ACCOUNT_ID for another S3-compatible store)
 * Then set MEDIA_BASE_URL to the bucket's public address and restart the server.
 *
 * No SDK dependency: requests are signed with AWS Signature V4 using node:crypto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = path.join(ROOT, 'media');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const FORCE = args.has('--force');
const CONCURRENCY = 8;

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
// RFC 3986 encoding of one path segment, as S3 expects.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Signs an S3 request (AWS Signature Version 4). Exported for tests. */
export function signS3({ method, url, headers = {}, payloadHash, accessKeyId, secretAccessKey, region = 'auto', now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const all = { ...headers, host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalHeaders = names.map((k) => `${k}:${lower[k]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...u.searchParams].map(([k, v]) => `${enc(k)}=${enc(v)}`).sort().join('&');
  const canonical = [method, u.pathname, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function settings() {
  const e = process.env;
  const endpoint = (e.S3_ENDPOINT || (e.R2_ACCOUNT_ID ? `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '')).replace(/\/+$/, '');
  const s = {
    endpoint,
    bucket: e.R2_BUCKET || e.S3_BUCKET,
    accessKeyId: e.R2_ACCESS_KEY_ID || e.S3_ACCESS_KEY_ID,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY || e.S3_SECRET_ACCESS_KEY,
    region: e.S3_REGION || 'auto',
  };
  const missing = Object.entries({ 'R2_ACCOUNT_ID (or S3_ENDPOINT)': s.endpoint, R2_BUCKET: s.bucket, R2_ACCESS_KEY_ID: s.accessKeyId, R2_SECRET_ACCESS_KEY: s.secretAccessKey })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return { s, missing };
}

function listFiles(dir, base = '') {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...listFiles(path.join(dir, d.name), rel));
    else if (d.isFile() && !d.name.startsWith('.')) out.push(rel);
  }
  return out;
}

export async function request(s, method, key, body) {
  const url = `${s.endpoint}/${enc(s.bucket)}/${key.split('/').map(enc).join('/')}`;
  const headers = body
    ? { 'content-type': TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' }
    : {};
  const signed = signS3({ method, url, headers, payloadHash: body ? sha256(body) : sha256(''), ...s });
  delete signed.host; // fetch sets it
  return fetch(url, { method, headers: signed, body });
}

async function main() {
  if (!fs.existsSync(MEDIA)) {
    console.log('No media/ folder — nothing to upload.');
    return;
  }
  const files = listFiles(MEDIA);
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(MEDIA, f)).size, 0);
  console.log(`${files.length} files in media/ (${(bytes / 1048576).toFixed(1)} MB)`);
  const { s, missing } = settings();
  if (DRY) {
    if (missing.length) console.log(`(dry run) Not configured yet — set ${missing.join(', ')} in .env`);
    else console.log(`(dry run) Would upload to ${s.endpoint}/${s.bucket}, skipping files already there.`);
    return;
  }
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')} in .env — see the comments at the top of scripts/upload-media.js`);
    process.exit(1);
  }

  let done = 0;
  let uploaded = 0;
  let skipped = 0;
  const failed = [];
  const queue = [...files];
  async function worker() {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const file = path.join(MEDIA, f);
      try {
        const size = fs.statSync(file).size;
        if (!FORCE) {
          const head = await request(s, 'HEAD', f);
          if (head.ok && Number(head.headers.get('content-length')) === size) {
            skipped++;
            continue;
          }
          if (head.status === 403 || head.status === 401) throw new Error(`access denied (${head.status}) — check the keys and bucket name`);
        }
        const res = await request(s, 'PUT', f, fs.readFileSync(file));
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        uploaded++;
      } catch (e) {
        failed.push([f, e.message]);
        if (/access denied/.test(e.message)) queue.length = 0; // no point continuing
      } finally {
        done++;
        if (done % 100 === 0 || done === files.length) process.stdout.write(`\r${done}/${files.length}  uploaded ${uploaded}  already there ${skipped}  failed ${failed.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('');
  for (const [f, m] of failed.slice(0, 20)) console.log(`  ✗ ${f}: ${m}`);
  if (failed.length) process.exit(1);
  console.log('Done. Set MEDIA_BASE_URL to the bucket\'s public URL (e.g. https://media.yourdomain.in) and restart the server.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
