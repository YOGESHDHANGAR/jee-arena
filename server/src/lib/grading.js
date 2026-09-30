/**
 * Answer checking and JEE marking schemes.
 *
 * Question shapes (stored in `questions`):
 *   type 'single'    -> answer: { keys: ['B'] }
 *   type 'multi'     -> answer: { keys: ['A', 'C'] }
 *   type 'numerical' -> answer: { value: 2.5, tolerance?: 0.01 }  or { min: 2.4, max: 2.6 }
 *
 * User answers:
 *   single    -> 'B'
 *   multi     -> ['A', 'C']
 *   numerical -> '2.5' or 2.5
 */

export const SCHEMES = {
  // JEE Main (2024+): Section A MCQ +4/-1, Section B numerical +4/-1
  jee_main: { single: [4, -1], numerical: [4, -1], multi: 'adv' },
  // JEE Advanced (typical recent papers)
  jee_adv: { single: [3, -1], numerical: [4, 0], multi: 'adv' },
  // No negative marking, handy for practice tests
  practice: { single: [4, 0], numerical: [4, 0], multi: [4, 0] },
};

const norm = (k) => String(k).trim().toUpperCase();

export function isAnswered(type, ans) {
  if (ans === undefined || ans === null) return false;
  if (type === 'multi') return Array.isArray(ans) && ans.length > 0;
  return String(ans).trim() !== '';
}

function correctKeys(q) {
  return (q.answer?.keys || []).map(norm);
}

function numericMatch(q, raw) {
  const x = Number(String(raw).trim());
  if (!Number.isFinite(x)) return false;
  const a = q.answer || {};
  if (Number.isFinite(a.min) && Number.isFinite(a.max)) return x >= a.min && x <= a.max;
  if (!Number.isFinite(a.value)) return false;
  const tol = Number.isFinite(a.tolerance) ? a.tolerance : 0.01;
  return Math.abs(x - a.value) <= tol + 1e-9;
}

/** Plain right/wrong, used for single-problem practice. */
export function isCorrect(q, ans) {
  if (!isAnswered(q.type, ans)) return false;
  if (q.type === 'numerical') return numericMatch(q, ans);
  const keys = correctKeys(q);
  if (q.type === 'single') return keys.length > 0 && keys.includes(norm(ans));
  const chosen = [...new Set(ans.map(norm))];
  return chosen.length === keys.length && chosen.every((k) => keys.includes(k));
}

/**
 * Marks for one question under a scheme.
 * Returns { status: 'correct'|'partial'|'wrong'|'unattempted', marks, max }.
 */
export function markQuestion(q, ans, schemeName = 'jee_main') {
  const scheme = SCHEMES[schemeName] || SCHEMES.jee_main;
  const rule = scheme[q.type] || scheme.single;
  const max = Array.isArray(rule) ? rule[0] : 4;

  if (!isAnswered(q.type, ans)) return { status: 'unattempted', marks: 0, max };

  if (q.type === 'multi' && rule === 'adv') {
    // JEE Advanced partial marking:
    // +4 all correct options chosen; +1 per chosen option if every chosen option
    // is correct but not all correct ones were chosen; -2 if any wrong option chosen.
    const keys = correctKeys(q);
    const chosen = [...new Set(ans.map(norm))];
    if (chosen.some((k) => !keys.includes(k))) return { status: 'wrong', marks: -2, max: 4 };
    if (chosen.length === keys.length) return { status: 'correct', marks: 4, max: 4 };
    return { status: 'partial', marks: chosen.length, max: 4 };
  }

  const ok = isCorrect(q, ans);
  return { status: ok ? 'correct' : 'wrong', marks: ok ? rule[0] : rule[1], max };
}

/** Grades a whole paper. `answers` is { [qid]: answer }. */
export function gradePaper(questions, answers = {}, schemeName = 'jee_main') {
  let score = 0;
  let maxScore = 0;
  const counts = { correct: 0, partial: 0, wrong: 0, unattempted: 0 };
  const bySubject = {};
  const perQuestion = questions.map((q) => {
    const ans = answers[q.qid];
    const r = markQuestion(q, ans, schemeName);
    score += r.marks;
    maxScore += r.max;
    counts[r.status] += 1;
    const s = (bySubject[q.subject] ||= { score: 0, max: 0, correct: 0, wrong: 0, unattempted: 0 });
    s.score += r.marks;
    s.max += r.max;
    if (r.status === 'correct' || r.status === 'partial') s.correct += 1;
    else if (r.status === 'wrong') s.wrong += 1;
    else s.unattempted += 1;
    return { qid: q.qid, answer: ans ?? null, ...r };
  });
  return { score, maxScore, ...counts, bySubject, perQuestion };
}
