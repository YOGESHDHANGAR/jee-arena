import { Rich } from './Rich.jsx';
import { useT } from '../lib/i18n.jsx';

/**
 * Answer area for all three question types.
 *   value: 'B' (single) | ['A','C'] (multi) | '2.5' (numerical)
 *   review: { answer } to colour right/wrong options after checking
 */
export function AnswerInput({ question, value, onChange, disabled, review }) {
  const { type, options = [] } = question;
  const t = useT();

  if (type === 'numerical') {
    const correct = review?.answer;
    return (
      <div className="stack" style={{ maxWidth: 320 }}>
        <label className="field">
          <span>{t('Your answer (numerical value)')}</span>
          <input
            className="input mono"
            inputMode="decimal"
            value={value ?? ''}
            disabled={disabled}
            placeholder={t('e.g. 12 or 2.5')}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9.\-eE]/g, '').slice(0, 20))}
            style={{ fontSize: '1.1rem' }}
          />
        </label>
        {correct && (
          <div className="small">
            {t('Correct answer:')}{' '}
            <b className="mono">{Number.isFinite(correct.min) ? t('{a} to {b}', { a: correct.min, b: correct.max }) : correct.value}</b>
          </div>
        )}
      </div>
    );
  }

  const multi = type === 'multi';
  const picked = multi ? new Set(value || []) : new Set(value ? [value] : []);
  const right = new Set(review?.answer?.keys || []);

  const toggle = (key) => {
    if (disabled) return;
    if (!multi) return onChange(value === key ? '' : key);
    const s = new Set(picked);
    s.has(key) ? s.delete(key) : s.add(key);
    onChange([...s].sort());
  };

  return (
    <div className="options">
      {multi && <div className="muted small">{t('One or more options are correct.')}</div>}
      {options.map((o) => {
        let cls = 'option' + (multi ? ' multi' : '');
        if (review) {
          if (right.has(o.key)) cls += ' right';
          else if (picked.has(o.key)) cls += ' wrong';
        } else if (picked.has(o.key)) cls += ' picked';
        return (
          <button type="button" key={o.key} className={cls} onClick={() => toggle(o.key)} disabled={disabled} aria-pressed={picked.has(o.key)}>
            <span className="key">{o.key}</span>
            <Rich text={o.text} />
          </button>
        );
      })}
    </div>
  );
}

export const hasAnswer = (type, v) => (type === 'multi' ? Array.isArray(v) && v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '');
