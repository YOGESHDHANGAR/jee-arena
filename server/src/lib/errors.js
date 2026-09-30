import { createHash } from 'node:crypto';
import { col } from '../db.js';

/**
 * Built-in error log (no third-party account needed): server crashes and errors from students'
 * browsers are grouped by message + top of the stack into the `errors` collection, with a count and
 * first/last seen. Admin → Errors shows them. Entries expire 30 days after they were last seen.
 */
export const RELEASE = (process.env.RENDER_GIT_COMMIT || process.env.RELEASE || 'dev').slice(0, 7);
const MAX_GROUPS = 2000; // a flood of distinct errors can't fill the free database

const clip = (s, n) => (s === undefined || s === null ? null : String(s).slice(0, n));

/** Top stack frames without column numbers, so the same bug groups together. */
function signature(where, message, stack) {
  const frames = String(stack || '')
    .split('\n')
    .filter((l) => /^\s*at\s|@/.test(l))
    .slice(0, 3)
    .map((l) => l.trim().replace(/:\d+(\)?)$/, '$1').replace(/\?[^:)]*/, ''))
    .join('|');
  const msg = String(message || '').replace(/\b[0-9a-f]{24}\b|\d+/g, '#'); // ids and numbers vary
  return createHash('sha1').update(`${where}|${msg}|${frames}`).digest('hex').slice(0, 20);
}

export async function recordError({ where = 'server', message, stack, url, method, status, userId, ua, extra } = {}) {
  try {
    const _id = signature(where, message, stack);
    const now = new Date();
    const exists = await col('errors').countDocuments({ _id }, { limit: 1 });
    if (!exists && (await col('errors').estimatedDocumentCount()) >= MAX_GROUPS) return;
    await col('errors').updateOne(
      { _id },
      {
        $inc: { count: 1 },
        $set: {
          where,
          message: clip(message, 500) || '(no message)',
          stack: clip(stack, 4000),
          lastAt: now,
          lastUrl: clip(url, 500),
          lastMethod: clip(method, 10),
          lastStatus: status ?? null,
          lastUser: userId ? String(userId) : null,
          lastUa: clip(ua, 300),
          release: RELEASE,
          ...(extra ? { extra: clip(JSON.stringify(extra), 2000) } : {}),
        },
        $setOnInsert: { firstAt: now },
      },
      { upsert: true },
    );
  } catch (e) {
    console.error('Could not record error', e.message); // never let logging break a request
  }
}

// Noise from browser extensions, old browsers and cross-origin scripts we can't do anything about.
const IGNORE = [/^Script error\.?$/i, /ResizeObserver loop/i, /chrome-extension:|moz-extension:|safari-extension:/i, /Non-Error promise rejection captured/i];
export const ignorable = (message, stack) => IGNORE.some((re) => re.test(message || '') || re.test(stack || ''));
