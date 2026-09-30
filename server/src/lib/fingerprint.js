import { createHash } from 'node:crypto';

/**
 * Duplicate detection across import sources (doubtnut, pw-dataset, eqourse, ai-import…).
 *
 * The same question usually differs only in formatting: LaTeX spacing, \text{} vs plain text,
 * option order, a "[JEE Main 2019]" tag, a different picture file name. We normalise all that away
 * and hash what's left:
 *   fp      = question text + the set of option texts   ("exact" duplicates, very reliable)
 *   fpText  = question text alone, only when it's long enough to be distinctive
 *             (catches copies whose options were typed differently; needs a human look)
 */

const SUB = [
  [/\{\{(img|mol):[^}]*\}\}|!\[[^\]]*\]\([^)]*\)|<img[^>]*>/gi, ' '], // pictures: file names differ by source
  [/<[^>]+>/g, ' '],
  [/&nbsp;|&#160;/gi, ' '],
  [/\\(?:left|right|displaystyle|textstyle|limits|mathrm|mathbf|mathit|rm|bf|it|operatorname|text|mbox|quad|qquad)\b/g, ' '],
  [/\\[,;:! ]/g, ' '],
  [/\\(?:d|t)frac/g, '\\frac'],
  [/\\(?:times|cdot)/g, '*'],
  [/[×·]/g, '*'],
  [/[−–—]/g, '-'],
  // Exam/source tags: "(JEE Main 2019, 9 Jan Shift 1)", "[AIEEE 2008]", "JEE Adv. 2016 Paper 2"
  [/[([][^()[\]]{0,60}\b(?:19|20)\d\d\b[^()[\]]{0,60}[)\]]/g, ' '],
  // Leading numbering: "Q12.", "12)", "(3)"
  [/^\s*(?:q(?:uestion)?\s*)?\(?\d{1,3}[.)]\s+/i, ' '],
];

export function normalizeText(s = '') {
  let t = String(s).normalize('NFKC').toLowerCase();
  for (const [re, rep] of SUB) t = t.replace(re, rep);
  // Keep letters, digits and maths operators; drop braces, $, punctuation and spacing.
  return t.replace(/[^\p{L}\p{N}+\-*/=^<>]+/gu, '');
}

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 20);

/** { fp, fpText } for a question ({ text, options }). fpText is null for short, generic stems. */
export function fingerprint(q) {
  const text = normalizeText(q.text);
  if (text.length < 12) return { fp: null, fpText: null }; // "Find x." — too little to compare
  const opts = (q.options || []).map((o) => normalizeText(o.text)).filter(Boolean).sort();
  return {
    fp: sha(`${q.type === 'numerical' ? 'n' : 'o'}|${text}|${opts.join('|')}`),
    fpText: text.length >= 60 ? sha(text) : null,
  };
}

/** Which copy to keep: published, with a solution, tagged PYQ, most used, then oldest. */
export function keeperScore(q) {
  return (q.status === 'published' ? 1000 : 0) + (q.solution ? 100 : 0) + (q.pyq?.year ? 50 : 0) + Math.min(40, q.stats?.attempts || 0);
}

/**
 * Stable string for a question's correct answer, to spot copies that disagree. Uses the TEXT of the
 * correct options, not their letters, because sources order options differently.
 */
export function answerKey(q) {
  const a = q.answer;
  if (!a) return '';
  if (Array.isArray(a.keys)) {
    const byKey = new Map((q.options || []).map((o) => [String(o.key).toUpperCase(), normalizeText(o.text)]));
    return a.keys.map((k) => byKey.get(String(k).toUpperCase()) ?? `?${k}`).sort().join('|');
  }
  if (a.value !== undefined && a.value !== null) return `=${Number(a.value)}`;
  if (a.min !== undefined) return `${a.min}..${a.max}`;
  return '';
}
