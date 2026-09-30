/**
 * Small pieces of self-reported data that the insights (lib/insights.js) are built on:
 *
 *  reason      why a mark was lost, tagged by the student after a wrong answer / skipped question
 *              (practice: progress.reason, tests: testAttempts.reasons[qid])
 *  confidence  how sure the student was when answering in a test: sure / maybe (50-50) / guess
 *              (testAttempts.confidence[qid], copied to perQuestion[].conf when graded)
 *  visits      the order the student moved through a test: [[qid, startSec, seconds], ...]
 *              (testAttempts.visits), for the test strategy replay
 *
 * Everything is validated here so the routes stay short.
 */
export const REASONS = ['concept', 'calculation', 'misread', 'guess', 'time'];
export const CONFIDENCE = ['sure', 'maybe', 'guess'];
export const MAX_VISITS = 1500; // a 3-hour paper rarely has more than a few hundred moves

export const cleanReason = (r) => (REASONS.includes(r) ? r : null);

/** { qid: 'sure'|'maybe'|'guess' } for questions on this paper; anything else is dropped. */
export function cleanConfidence(t, raw) {
  const allowed = new Set(t.questionIds.map(String));
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) if (allowed.has(k) && CONFIDENCE.includes(v)) out[k] = v;
  return out;
}

/**
 * [[qid, startSec, seconds], ...] in the order they happened. Unknown questions, negative or impossible
 * times are dropped; the list is capped. The client sends the whole list each time (it's small).
 */
export function cleanVisits(t, raw) {
  if (!Array.isArray(raw)) return undefined;
  const allowed = new Set(t.questionIds);
  const cap = (t.durationMin || 180) * 60;
  const out = [];
  for (const v of raw.slice(0, MAX_VISITS)) {
    if (!Array.isArray(v) || v.length < 3) continue;
    const [qid, start, secs] = v.map(Number);
    if (!allowed.has(qid) || !Number.isFinite(start) || !Number.isFinite(secs)) continue;
    if (start < 0 || start > cap || secs < 0 || secs > cap) continue;
    out.push([qid, Math.round(start), Math.round(secs)]);
  }
  return out;
}
