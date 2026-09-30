/**
 * Question search that stays fast on 140k+ questions.
 *
 * With a MongoDB text index (created in db.js) the database finds candidate questions through the
 * index ($text: any of the words, with stemming), and every word must then also appear in the text,
 * chapter or topic (so "rotational motion" means both words, not either). Without a text index
 * (e.g. a Mongo-compatible database that lacks them) it falls back to the old regex scan.
 */

let textIndex = false;
export const setTextIndex = (on) => {
  textIndex = !!on;
};
export const hasTextIndex = () => textIndex;

// Common English stop words (a subset of MongoDB's list — enough to catch what students type).
const STOP = new Set(
  'a about above after again all am an and any are as at be been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with you your'.split(' '),
);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fieldsMatch = (w) => ({
  $or: [
    { text: { $regex: escapeRe(w), $options: 'i' } },
    { chapter: { $regex: escapeRe(w), $options: 'i' } },
    { topic: { $regex: escapeRe(w), $options: 'i' } },
  ],
});

/**
 * Returns the filter parts for a free-text search: { $text?, $and: [...] }.
 * Merge into a query with `Object.assign(filter, parts.$text ? { $text: parts.$text } : {})`
 * and push `parts.$and` onto the query's $and.
 */
export function searchParts(raw) {
  const s = String(raw || '').trim().slice(0, 80);
  if (!s) return null;
  const words = [...new Set(s.split(/\s+/).map((w) => w.replace(/["\\]/g, '')).filter((w) => w.length > 0))].slice(0, 6);
  if (!words.length) return null;
  const and = words.map(fieldsMatch);
  // Stop words ("the", "which", …) aren't in the text index, so a $text on them alone finds nothing.
  // Only use the index when a real word remains; the regex conditions still apply to every word.
  const indexable = words.filter((w) => w.length >= 3 && /[a-z]/i.test(w) && !STOP.has(w.toLowerCase()));
  if (textIndex && indexable.length) return { $text: { $search: indexable.join(' ') }, $and: and };
  return { $and: and };
}

/** Adds a search to an existing filter object (mutates and returns it). */
export function applySearch(filter, raw) {
  const p = searchParts(raw);
  if (!p) return filter;
  if (p.$text) filter.$text = p.$text;
  filter.$and = [...(filter.$and || []), ...p.$and];
  return filter;
}

/** Tiny TTL cache for list counts (same filters are counted over and over while paging). */
export function ttlCache(ms, max = 500) {
  const m = new Map();
  return {
    async get(key, compute) {
      const hit = m.get(key);
      if (hit && Date.now() - hit.at < ms) return hit.value;
      const value = await compute();
      if (m.size >= max) m.delete(m.keys().next().value);
      m.set(key, { at: Date.now(), value });
      return value;
    },
    clear: () => m.clear(),
  };
}

/**
 * The text index matches whole (stemmed) words, so a partial word like "thermo" finds nothing
 * through it. If the indexed search finds nothing, drop $text and let the regex conditions
 * (always present) do a normal scan — same results as before, just slower for that one query.
 */
export async function textOrScan(collection, filter) {
  if (!filter.$text) return filter;
  const hit = await collection.countDocuments(filter, { limit: 1 });
  if (hit) return filter;
  const { $text, ...rest } = filter;
  return rest;
}
