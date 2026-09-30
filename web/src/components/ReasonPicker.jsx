import { useState } from 'react';
import { api } from '../lib/api.js';
import { tk, useT } from '../lib/i18n.jsx';

/**
 * "Why did I lose this mark?" after a wrong answer or a skipped test question. The tags feed
 * My journey → Why you lose marks (server/src/lib/insights.js). Tap again to clear.
 *
 * path: '/problems/12/reason' (practice) or '/tests/<id>/reasons' (tests, with { qid } in the body)
 */
export const REASONS = [
  ['concept', tk("Didn't know the concept")],
  ['calculation', tk('Calculation slip')],
  ['misread', tk('Misread the question')],
  ['guess', tk('Guessed')],
  ['time', tk('Ran out of time')],
];

export function ReasonPicker({ path, qid, value, onChange, compact }) {
  const t = useT();
  const [reason, setReason] = useState(value || null);
  const [busy, setBusy] = useState(false);
  async function pick(r) {
    const next = reason === r ? null : r;
    const prev = reason;
    setReason(next);
    setBusy(true);
    try {
      await api(path, { method: 'POST', body: qid !== undefined ? { qid, reason: next } : { reason: next } });
      onChange?.(next);
    } catch {
      setReason(prev);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`reason-picker ${compact ? 'compact' : ''}`}>
      <span className="muted small">{reason ? t('Why you lost this mark:') : t('Why did you lose this mark?')}</span>
      <div className="chips">
        {REASONS.map(([k, label]) => (
          <button key={k} type="button" className={`chip sm ${reason === k ? 'on' : ''}`} aria-pressed={reason === k} disabled={busy} onClick={() => pick(k)}>
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}
