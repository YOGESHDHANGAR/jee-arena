import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ErrorBox } from './Layout.jsx';
import { Icon } from './Icon.jsx';
import { useT } from '../lib/i18n.jsx';

export const REPORT_REASONS = [
  ['wrong-answer', 'Answer key is wrong'],
  ['wrong-question', 'Question is incomplete or wrong'],
  ['bad-render', 'Maths / formatting looks broken'],
  ['figure', 'Figure missing or wrong'],
  ['solution', 'Solution is wrong or unclear'],
  ['other', 'Something else'],
];

/** Small "Report" link + dialog. Reports go to Admin → Reports. */
export function ReportButton({ qid, from = 'practice', className = 'btn sm ghost' }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const t = useT();

  useEffect(() => setDone(false), [qid]);

  const click = () => {
    if (!user) return nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`);
    setOpen(true);
  };

  return (
    <>
      <button type="button" className={className} onClick={click} disabled={done} title={t('Report a problem with this question')}>
        {done ? <><Icon.Check /> {t('Reported')}</> : <><Icon.Flag /> {t('Report')}</>}
      </button>
      {open && <ReportDialog qid={qid} from={from} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setDone(true); }} />}
    </>
  );
}

function ReportDialog({ qid, from, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const t = useT();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/problems/${qid}/report`, { method: 'POST', body: { reason, note, from } });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form className="modal stack" onClick={(e) => e.stopPropagation()} onSubmit={send} role="dialog" aria-label="Report a problem">
        <div className="spread">
          <h3 style={{ margin: 0 }}>{t('Report a problem')} · #{qid}</h3>
          <button type="button" className="btn sm ghost" onClick={onClose} aria-label={t('Close')}><Icon.X /></button>
        </div>
        <div className="options">
          {REPORT_REASONS.map(([k, label]) => (
            <label key={k} className={`option ${reason === k ? 'picked' : ''}`} style={{ padding: '8px 12px', alignItems: 'center' }}>
              <input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
              {t(label)}
            </label>
          ))}
        </div>
        <label className="field">
          <span>{t('Details')} {reason === 'other' ? '' : t('(optional)')}</span>
          <textarea
            className="input"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={reason === 'wrong-answer' ? t('e.g. The answer should be (C) because…') : t('What looks wrong?')}
          />
        </label>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" disabled={busy || !reason || (reason === 'other' && note.trim().length < 5)}>
            {busy ? t('Sending…') : t('Send report')}
          </button>
        </div>
      </form>
    </div>
  );
}
