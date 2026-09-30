import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Link, useParams } from 'react-router-dom';
import { useApi, fmtDate, fmtDuration, fmtShort, SUBJECT_LABEL, TYPE_LABEL, useTitle } from '../lib/hooks.js';
import { Rich } from '../components/Rich.jsx';
import { AnswerInput } from '../components/AnswerInput.jsx';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { ReportButton } from '../components/ReportButton.jsx';
import { ShareResult } from '../components/ShareCard.jsx';
import { ReasonPicker } from '../components/ReasonPicker.jsx';
import { Icon } from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { tk, useT } from '../lib/i18n.jsx';
import { estimatePercentile, fmtPercentile, fmtRank, isFullJeeMain, SOURCE } from '../lib/percentile.js';

const CONF_LABEL = { sure: tk('Sure'), maybe: tk('50-50'), guess: tk('Guess') };

const STATUS = {
  correct: ['good', 'Correct'],
  partial: ['medium', 'Partly correct'],
  wrong: ['hard', 'Wrong'],
  unattempted: ['', 'Skipped'],
};

export default function TestResult() {
  const { id } = useParams();
  const { data: r, error, loading } = useApi(`/tests/${id}/result`);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('list'); // 'list' | 'step'
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(() => new Set());
  useEffect(() => {
    if (r?.inRevision) setSaved(new Set(r.inRevision));
  }, [r?.inRevision]);
  const toggleSave = async (qid) => {
    const on = saved.has(qid);
    setSaved((cur) => {
      const next = new Set(cur);
      on ? next.delete(qid) : next.add(qid);
      return next;
    });
    try {
      await api(`/reviews/${qid}`, { method: on ? 'DELETE' : 'POST' });
    } catch {
      setSaved((cur) => {
        const next = new Set(cur);
        on ? next.add(qid) : next.delete(qid);
        return next;
      });
    }
  };
  const { user } = useAuth();
  const t = useT();
  useTitle(r?.test ? `${t('Result')} · ${r.test.title}` : error ? t('Result') : undefined);

  if (loading && !r) return <Spinner />;
  if (error) return <main className="page narrow"><ErrorBox error={error} /></main>;
  if (r.pending) {
    return (
      <main className="page narrow">
        <div className="card empty">
          <div className="empty-icon good"><Icon.CircleCheckBig size={26} /></div>
          <h2>{t('Submitted')}</h2>
          <p>{t('Your score, rank and solutions will be available when the contest ends ({when}).', { when: fmtDate(r.endAt) })}</p>
          <Link className="btn" to={`/test/${id}`}>{t('Back to contest')}</Link>
        </div>
      </main>
    );
  }

  const pct = r.maxScore ? Math.max(0, Math.round((100 * r.score) / r.maxScore)) : 0;
  const hasTimes = r.questions.some((q) => q.result?.timeSec !== undefined);
  const qs = filter === 'slowest'
    ? [...r.questions].sort((a, b) => (b.result?.timeSec || 0) - (a.result?.timeSec || 0))
    : r.questions.filter((q) => filter === 'all' || q.result?.status === filter);

  return (
    <main className="page">
      <div className="spread" style={{ marginBottom: 16 }}>
        <div>
          <div className="muted small">{t('Result')}</div>
          <h1 style={{ margin: 0 }}>{r.test.title}</h1>
        </div>
        <div className="row">
          {user && <Link className="btn ghost" to="/progress?tab=analysis"><Icon.ChartColumn /> {t('My analysis')}</Link>}
          {r.test.kind !== 'practice' && <ShareResult r={r} testPath={`/test/${r.test.slug || r.test.id}`} />}
          <Link className="btn" to={`/test/${id}`}>{r.test.kind === 'practice' ? t('Test details') : t('Leaderboard')}</Link>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat"><b>{r.score}<span className="muted" style={{ fontSize: '1rem' }}> / {r.maxScore}</span></b><span>{t('score')} ({pct}%)</span></div>
        {r.rank?.rank && <div className="card stat"><b>#{r.rank.rank}</b><span>{t('rank of {n}', { n: r.rank.of?.toLocaleString('en-IN') })}</span></div>}
        {r.rating && (
          <div className="card stat">
            <b style={{ color: r.rating.delta >= 0 ? 'var(--good)' : 'var(--bad)' }}>{r.rating.delta >= 0 ? '+' : ''}{r.rating.delta}</b>
            <span>{t('rating')} {r.rating.before} → {r.rating.after}</span>
          </div>
        )}
        <div className="card stat"><b>{r.correct}<span className="muted" style={{ fontSize: '1rem' }}> ✓ · {r.wrong} ✗ · {r.unattempted} –</span></b><span>{t('correct · wrong · skipped')}</span></div>
        <div className="card stat"><b>{fmtDuration(r.timeTakenSec)}</b><span>{t('time taken')}</span></div>
      </div>

      {isFullJeeMain(r) && <PercentileCard score={r.score} />}

      {r.bySubject && Object.keys(r.bySubject).length > 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="with-icon"><Icon.Layers /> {t('By subject')}</h3>
          <div className="stack">
            {Object.entries(r.bySubject).map(([s, v]) => (
              <div key={s}>
                <div className="spread small">
                  <b>{t(SUBJECT_LABEL[s])}</b>
                  <span className="mono">{v.score}/{v.max} · {v.correct}✓ {v.wrong}✗ {v.unattempted}–</span>
                </div>
                <div className="bar"><i style={{ width: `${Math.max(0, (100 * v.score) / v.max)}%`, background: `var(--${s === 'physics' ? 'phy' : s === 'chemistry' ? 'chem' : 'math'})` }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasTimes && <TimeAnalysis r={r} />}
      {r.replay && <Replay replay={r.replay} />}

      <div className="spread review-head">
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{t('Review your answers')}</h2>
        <div className="seg">
          <button className={view === 'step' ? 'on' : ''} onClick={() => { setView('step'); setStep(0); }}><Icon.ArrowRight size={14} /> {t('One by one')}</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><Icon.List size={14} /> {t('All at once')}</button>
        </div>
      </div>

      <div className="tabs">
        {['all', 'wrong', 'unattempted', 'correct', ...(hasTimes && view === 'list' ? ['slowest'] : [])].map((f) => (
          <button key={f} className={`tab ${filter === f ? 'on' : ''}`} onClick={() => { setFilter(f); setStep(0); }}>
            {f === 'all' ? t('All questions') : f === 'slowest' ? t('Slowest first') : t(STATUS[f][1])}
            {f !== 'all' && f !== 'slowest' && <span className="muted"> {r.questions.filter((q) => (q.result?.status || 'unattempted') === f).length}</span>}
          </button>
        ))}
      </div>

      {view === 'step' ? (
        qs.length ? (
          <ReviewStepper
            qs={qs}
            all={r.questions}
            step={Math.min(step, qs.length - 1)}
            setStep={setStep}
            saved={saved}
            toggleSave={toggleSave}
            testId={r.test.id}
            reasons={r.reasons}
          />
        ) : <div className="card empty">{t('Nothing here.')}</div>
      ) : (
        <div className="stack">
          {qs.map((q) => (
            <QuestionReview key={q.qid} q={q} n={r.questions.indexOf(q) + 1} saved={saved.has(q.qid)} onSave={() => toggleSave(q.qid)} testId={r.test.id} reason={r.reasons?.[q.qid]} />
          ))}
          {!qs.length && <div className="card empty">{t('Nothing here.')}</div>}
        </div>
      )}
    </main>
  );
}

const EXAM_PACE_SEC = 144; // JEE Main: 180 min / 75 questions

/** Time to compare against: how long students who got it right took, else the question's average, else exam pace. */
function benchmark(q) {
  if (q.others?.avgCorrectSec) return { sec: q.others.avgCorrectSec, label: tk('others who got it right') };
  if (q.stats?.avgSolveSec) return { sec: q.stats.avgSolveSec, label: tk('average solve time') };
  return { sec: EXAM_PACE_SEC, label: tk('JEE Main pace') };
}

/** One question of the paper, reviewed: your answer vs the right one, time vs benchmark, solution, save. */
function QuestionReview({ q, n, saved, onSave, open, testId, reason }) {
  const t = useT();
  const status = q.result?.status || 'unattempted';
  const [cls, label] = STATUS[status];
  const bench = benchmark(q);
  const mine = q.result?.timeSec;
  const ratio = mine !== undefined && bench.sec ? mine / bench.sec : null;
  return (
    <article id={`q${n}`} className={`card review-card ${status}`}>
      <div className="qhead">
        <b>Q{n}</b>
        <Pill kind={cls}>{t(label)} {q.result ? `(${q.result.marks > 0 ? '+' : ''}${q.result.marks})` : ''}</Pill>
        <Pill kind={q.subject}>{t(SUBJECT_LABEL[q.subject])}</Pill>
        <Pill>{q.chapterName || q.chapter}</Pill>
        <Pill>{t(TYPE_LABEL[q.type])}</Pill>
        {q.result?.conf && <Pill>{t('You said: {level}', { level: t(CONF_LABEL[q.result.conf]) })}</Pill>}
        <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
          <ReportButton qid={q.qid} from="test" />
          <Link to={`/problems/${q.qid}`} className="small muted">#{q.qid}</Link>
        </span>
      </div>
      <Rich text={q.text} />
      <div style={{ marginTop: 14 }}>
        <AnswerInput question={q} value={q.result?.answer ?? (q.type === 'multi' ? [] : '')} onChange={() => {}} disabled review={{ answer: q.answer }} />
        {q.type === 'numerical' && q.result?.answer && <div className="small" style={{ marginTop: 6 }}>{t('Your answer:')} <b className="mono">{q.result.answer}</b></div>}
      </div>

      <div className="review-facts">
        {mine !== undefined && (
          <div className={`review-fact ${ratio > 2 ? 'bad' : ratio > 1.3 ? 'warn' : ratio !== null ? 'good' : ''}`}>
            <Icon.Timer size={15} />
            <span>
              {t('You took {time}', { time: fmtShort(mine) })} · {t('{what}: {time}', { what: t(bench.label), time: fmtShort(bench.sec) })}
              {ratio > 1.3 && <b> ({t('{x}× slower', { x: ratio.toFixed(1) })})</b>}
            </span>
          </div>
        )}
        {q.others && q.others.takers > 1 && (
          <div className="review-fact"><Icon.Trophy size={15} /><span>{t('{p}% got it right', { p: q.others.correctPct })} ({t('{n} students', { n: q.others.takers })})</span></div>
        )}
        <button className={`btn sm ${saved ? 'good' : ''}`} onClick={onSave} style={{ marginLeft: 'auto' }} title={t('It comes back after 1, 3 and 7 days until you get it right')}>
          {saved ? <><Icon.CircleCheck /> {t('In revision')}</> : <><Icon.Bookmark /> {t('Save to revise')}</>}
        </button>
      </div>

      {status !== 'correct' && testId && (
        <div style={{ marginTop: 12 }}>
          <ReasonPicker key={q.qid} path={`/tests/${testId}/reasons`} qid={q.qid} value={reason} compact />
        </div>
      )}

      {q.solution && (
        <details style={{ marginTop: 14 }} open={open}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('Solution')}</summary>
          <div className="solution" style={{ marginTop: 10 }}><Rich text={q.solution} /></div>
        </details>
      )}
    </article>
  );
}

/** Step through the paper one question at a time, with a palette to jump around (← → keys work too). */
function ReviewStepper({ qs, all, step, setStep, saved, toggleSave, testId, reasons }) {
  const t = useT();
  const q = qs[step];
  const n = all.indexOf(q) + 1;
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowRight') setStep((i) => Math.min(qs.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setStep((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qs.length, setStep]);
  useEffect(() => {
    document.querySelector('.review-stepper')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [step]);
  return (
    <div className="review-stepper">
      <div className="review-palette">
        {qs.map((x, i) => (
          <button
            key={x.qid}
            className={`pbtn ${x.result?.status || 'unattempted'} ${i === step ? 'current' : ''} ${saved.has(x.qid) ? 'saved' : ''}`}
            onClick={() => setStep(i)}
            title={t(STATUS[x.result?.status || 'unattempted'][1])}
          >
            {all.indexOf(x) + 1}
          </button>
        ))}
      </div>
      <QuestionReview q={q} n={n} saved={saved.has(q.qid)} onSave={() => toggleSave(q.qid)} open testId={testId} reason={reasons?.[q.qid]} />
      <div className="spread review-nav">
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}><Icon.ChevronLeft /> {t('Previous')}</button>
        <span className="muted small">{t('{a} of {b}', { a: step + 1, b: qs.length })}</span>
        <button className="btn primary" disabled={step >= qs.length - 1} onClick={() => setStep(step + 1)}>{t('Next')} <Icon.ChevronRight /></button>
      </div>
    </div>
  );
}

/** Where the time went: per subject, on wrong answers, and the slowest questions. */
function TimeAnalysis({ r }) {
  const t = useT();
  const rows = r.questions.map((q, i) => ({ n: i + 1, q, t: q.result?.timeSec || 0, status: q.result?.status || 'unattempted' }));
  const total = rows.reduce((s, x) => s + x.t, 0) || 1;
  const sum = (f) => rows.filter(f).reduce((s, x) => s + x.t, 0);
  const onWrong = sum((x) => x.status === 'wrong');
  const onSkipped = sum((x) => x.status === 'unattempted');
  const wrongN = rows.filter((x) => x.status === 'wrong').length;
  const subjects = [...new Set(rows.map((x) => x.q.subject))];
  const slowest = [...rows].sort((a, b) => b.t - a.t).slice(0, 5).filter((x) => x.t > 0);
  const jump = (n) => document.getElementById(`q${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="grid grid-2" style={{ marginBottom: 16 }}>
      <div className="card">
        <h3 className="with-icon"><Icon.Hourglass /> {t('Where your time went')}</h3>
        <div className="stack">
          {subjects.length > 1 && subjects.map((s) => {
            const secs = sum((x) => x.q.subject === s);
            return (
              <div key={s}>
                <div className="spread small"><b>{t(SUBJECT_LABEL[s])}</b><span className="mono">{fmtShort(secs)} · {Math.round((100 * secs) / total)}%</span></div>
                <div className="bar"><i style={{ width: `${(100 * secs) / total}%`, background: `var(--${s === 'physics' ? 'phy' : s === 'chemistry' ? 'chem' : 'math'})` }} /></div>
              </div>
            );
          })}
          {onWrong > 0 && (
            <div className="alert error small">
              {t('{time} on {n} questions you got wrong ({p}% of your time) — and they cost negative marks too.', { time: fmtShort(onWrong), n: wrongN, p: Math.round((100 * onWrong) / total) })}
            </div>
          )}
          {onSkipped > 60 && (
            <div className="alert warn small">{t('{time} on questions you ended up skipping. Decide sooner: attempt it or move on.', { time: fmtShort(onSkipped) })}</div>
          )}
        </div>
      </div>
      <div className="card">
        <h3 className="with-icon"><Icon.Timer /> {t('Slowest questions')}</h3>
        <div className="stack">
          {slowest.map((x) => {
            const [cls, label] = STATUS[x.status];
            return (
              <button key={x.n} className="spread small" onClick={() => jump(x.n)} style={{ width: '100%', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}>
                <span><b>Q{x.n}</b> <span className="muted">{x.q.chapter}</span></span>
                <span className="row" style={{ gap: 6 }}>
                  <Pill kind={cls}>{t(label)}</Pill>
                  <b className="mono">{fmtShort(x.t)}</b>
                  {x.q.others?.avgCorrectSec ? <span className="muted">{t('vs {time}', { time: fmtShort(x.q.others.avgCorrectSec) })}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const STATUS_COLOR = { correct: 'var(--good)', partial: 'var(--warn)', wrong: 'var(--bad)', unattempted: 'var(--muted)' };
const SUBJ_COLOR = { physics: 'var(--phy)', chemistry: 'var(--chem)', maths: 'var(--math)' };

/**
 * Test strategy replay (server/src/lib/insights.js testReplay): the order you moved through the paper,
 * time sunk into questions that didn't pay, easy questions left behind, and where you got stuck.
 */
function Replay({ replay: x }) {
  const t = useT();
  const [hover, setHover] = useState(null);
  const jump = (n) => document.getElementById(`q${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const tips = [];
  if (x.wrongMinutes >= 5) tips.push(['error', t('{m} min went on answers that turned out wrong. If a question is still unclear after 3 minutes, mark it and move on.', { m: x.wrongMinutes })]);
  if (x.easyLeft.length) tips.push(['warn', t('{n} easy questions were left blank. Do a quick first pass for the easy ones before the hard ones.', { n: x.easyLeft.length })]);
  if (x.neverSeen > 0) tips.push(['warn', x.neverSeen === 1 ? t('1 question you never opened. Every question deserves a 20-second look.') : t('{n} questions you never opened. Every question deserves a 20-second look.', { n: x.neverSeen })]);
  if (x.hasOrder && x.quarters[3] > x.quarters[0] && x.quarters[3] >= 5) tips.push(['warn', t('You opened more questions in the last quarter than the first: a slow start meant a rush at the end.')]);
  const total = x.duration;
  const h = hover !== null ? x.timeline?.[hover] : null;
  return (
    <div className="card replay" style={{ marginBottom: 16 }}>
      <h3 className="with-icon"><Icon.Route /> {t('How you took this test')}</h3>
      <div className="grid grid-4" style={{ marginBottom: 12 }}>
        <div className="stat"><b>{x.wrongMinutes} {t('min')}</b><span>{t('on {n} wrong answers', { n: x.wrongCount })}</span></div>
        <div className="stat"><b>{x.blankSeenMinutes} {t('min')}</b><span>{t('on {n} questions you then left blank', { n: x.blankSeenCount })}</span></div>
        <div className="stat"><b>{x.easyLeft.length}</b><span>{t('easy questions left blank')}</span></div>
        <div className="stat"><b>{x.hasOrder ? x.revisited : '—'}</b><span>{t('questions you came back to')}</span></div>
      </div>

      {x.hasOrder && x.subjectOrder.length > 0 && (
        <p className="small" style={{ margin: '0 0 10px' }}>
          {t('Your order:')} <b>{x.subjectOrder.map((s) => t(SUBJECT_LABEL[s])).join(' → ')}</b>
        </p>
      )}

      {x.timeline && x.timeline.length > 0 && (
        <div className="replay-strip-wrap">
          <svg className="replay-strip" viewBox="0 0 1000 36" preserveAspectRatio="none" role="img" aria-label={t('Timeline of the test: each block is time on one question, coloured by result')} onMouseLeave={() => setHover(null)}>
            {x.timeline.map((v, i) => (
              <rect key={i} x={(1000 * v.start) / total} width={Math.max(1.5, (1000 * v.secs) / total)} y={v.status === 'correct' ? 4 : 0} height={v.status === 'correct' ? 28 : 36}
                fill={STATUS_COLOR[v.status]} opacity={hover === null || hover === i ? 1 : 0.35} onMouseEnter={() => setHover(i)} onClick={() => jump(v.n)} style={{ cursor: 'pointer' }} />
            ))}
          </svg>
          <div className="spread small muted"><span>0:00</span><span>{h ? `Q${h.n} · ${t(SUBJECT_LABEL[h.subject])} · ${fmtShort(h.secs)} · ${t(STATUS[h.status][1])}` : t('Hover a block to see the question; click to jump to it.')}</span><span>{fmtShort(total)}</span></div>
          <div className="legend small" style={{ marginTop: 6 }}>
            {['correct', 'wrong', 'unattempted'].map((k) => <span key={k}><i style={{ background: STATUS_COLOR[k], borderColor: STATUS_COLOR[k] }} />{t(STATUS[k][1])}</span>)}
          </div>
        </div>
      )}

      {x.hasOrder && (
        <div style={{ marginTop: 12 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>{t('New questions opened in each quarter of the time')}</div>
          <div className="quarters">
            {x.quarters.map((n, i) => (
              <div key={i} className="quarter">
                <div className="bar" style={{ height: 8 }}><i style={{ width: `${(100 * n) / Math.max(1, ...x.quarters)}%` }} /></div>
                <span className="small mono">{i + 1}/4: {n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {x.stuck.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>{t('Where you got stuck (over 4 minutes, not solved)')}</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {x.stuck.map((q) => (
              <button key={q.n} className="chip sm" onClick={() => jump(q.n)} style={{ borderColor: SUBJ_COLOR[q.subject] }}>Q{q.n} · {fmtShort(q.secs)}</button>
            ))}
          </div>
        </div>
      )}

      {tips.length > 0 && (
        <div className="stack" style={{ gap: 6, marginTop: 12 }}>
          {tips.map(([kind, text]) => <div key={text} className={`alert ${kind} small`}>{text}</div>)}
        </div>
      )}
      {!x.hasOrder && <p className="muted small" style={{ margin: '10px 0 0' }}>{t('The order you moved through the paper is recorded on tests taken from now on.')}</p>}
    </div>
  );
}

/** Rough JEE Main percentile for a full 300-mark paper (lib/percentile.js). */
function PercentileCard({ score }) {
  const t = useT();
  const e = estimatePercentile(score);
  if (!e) return null;
  const next = [150, 180, 200, 250].find((m) => m > score);
  const nextE = next ? estimatePercentile(next) : null;
  return (
    <div className="card percentile-card" style={{ marginBottom: 16 }}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="muted small">{t('If this were the real JEE Main')}</div>
          <div className="row" style={{ gap: 14, alignItems: 'baseline' }}>
            <b style={{ fontSize: '1.8rem' }}>≈ {fmtPercentile(e.percentile)} <span style={{ fontSize: '1rem' }}>{t('percentile')}</span></b>
            <span className="muted">{t('AIR around')} <b>{fmtRank(e.rank).replace('lakh', t('lakh'))}</b></span>
          </div>
        </div>
        {nextE && (
          <div className="small" style={{ textAlign: 'right' }}>
            {t('{n} more marks → ≈ {p} percentile', { n: next - score, p: fmtPercentile(nextE.percentile) })}
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        {t("Estimate from the {source}. Real percentiles vary by a few points with each shift's difficulty, and a mock is not the real paper.", { source: SOURCE })}
      </p>
    </div>
  );
}
