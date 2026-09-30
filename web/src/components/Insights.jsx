import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, SUBJECT_LABEL } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { tk, useT } from '../lib/i18n.jsx';
import { fmtPercentile, fmtRank, SOURCE } from '../lib/percentile.js';
import { ErrorBox, Pill, Spinner } from './Layout.jsx';
import { Icon } from './Icon.jsx';
import { REASONS } from './ReasonPicker.jsx';
import { CollegePredictor } from './CollegePredictor.jsx';

/**
 * My journey (server/src/lib/insights.js): a predicted score and the colleges it could get, why marks are
 * lost, whether guessing pays, what to study next by marks, syllabus pace, test strategy, retention and
 * where the time goes. Private: the student (and admins) only.
 */
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const SUBJ_VAR = { physics: 'phy', chemistry: 'chem', maths: 'math' };
const REASON_COLOR = { concept: 'var(--bad)', calculation: 'var(--warn)', misread: 'var(--info)', guess: 'var(--phy)', time: 'var(--muted)' };
const REASON_ADVICE = {
  concept: tk('Most lost marks are concepts you did not know. Go back to theory for your weakest chapters before doing more questions.'),
  calculation: tk('Most lost marks are calculation slips. Write every step, and re-check units and signs before you mark an answer.'),
  misread: tk('Most lost marks come from misreading. Underline what is asked (the unit, "not", "incorrect") before you start solving.'),
  guess: tk('Most lost marks come from guesses. Under −1 marking, only guess when you can rule out at least two options.'),
  time: tk('Most lost marks come from running out of time. Do a first pass for the easy questions, and mark long ones for later.'),
};
const PACE_TEXT = {
  ahead: ['good', tk('Ahead of schedule')],
  'on-track': ['good', tk('On track')],
  behind: ['bad', tk('Behind schedule')],
  'not-started': ['bad', tk('Not started yet')],
  done: ['good', tk('Syllabus covered')],
  passed: ['', tk('Exam date has passed')],
};
// NIT home states, for the college predictor.
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

export function Insights({ username }) {
  const t = useT();
  const { refresh } = useAuth();
  const { data: x, error, loading, reload } = useApi(`/users/${username}/insights`);
  const [settings, setSettings] = useState(null);
  if (error) return <ErrorBox error={error} />;
  if (loading && !x) return <Spinner />;
  const s = settings || x.settings;
  const saveSettings = async (patch) => {
    setSettings({ ...s, ...patch });
    try {
      await api('/users/me', { method: 'PATCH', body: patch });
      refresh();
      if (patch.examDate !== undefined) reload();
    } catch {
      setSettings(s);
    }
  };

  return (
    <div className="stack insights">
      <p className="muted small" style={{ margin: 0 }}><Icon.Lock size={13} /> {t('Only you can see this page.')} {t('It updates as you practise and take tests.')}</p>
      <Predicted p={x.predicted} />
      {x.predicted?.score !== null && x.predicted?.score !== undefined && (
        <CollegePredictor predicted={x.predicted} settings={s} onSettings={saveSettings} states={STATES} />
      )}
      <div className="grid grid-2">
        <LostMarks m={x.lostMarks} />
        <Guessing g={x.guessing} />
      </div>
      <StudyNext rows={x.studyNext} locked={x.studyNextLocked} />
      <Pace p={x.pace} settings={s} onSettings={saveSettings} />
      <div className="grid grid-2">
        <TestStrategy ts={x.tests} />
        <Retention r={x.retention} />
      </div>
      <Effort e={x.effort} />
    </div>
  );
}

function Locked({ title, icon, text }) {
  const t = useT();
  return (
    <section className="card">
      <h3 className="with-icon">{icon} {title} <span className="pill pro"><Icon.Crown size={11} /> Pro</span></h3>
      <p className="muted small">{text}</p>
      <Link className="btn sm" to="/pro">{t('See Pro')} <Icon.ArrowRight /></Link>
    </section>
  );
}

// ---- predicted score -------------------------------------------------------------------------------

function Predicted({ p }) {
  const t = useT();
  if (!p || p.score === null || p.score === undefined) {
    return (
      <section className="card empty stack">
        <div className="empty-icon"><Icon.Target size={26} /></div>
        <h3 style={{ margin: 0 }}>{t('Your predicted JEE Main score appears here')}</h3>
        <p className="muted small" style={{ margin: 0 }}>{t('Solve {n} more questions, or take a full JEE Main mock, to see a predicted score, rank and the colleges it could get.', { n: p?.need || 20 })}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn primary" to="/problems">{t('Start solving')}</Link>
          <Link className="btn" to="/practice">{t('Take a mock')}</Link>
        </div>
      </section>
    );
  }
  const hist = p.history || [];
  const lo = Math.min(...hist.map((h) => h.score)) - 5;
  const hi = Math.max(...hist.map((h) => h.score)) + 5;
  const trend = hist.length >= 2 ? hist[hist.length - 1].score - hist[0].score : null;
  return (
    <section className="card predicted">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="muted small">{t('If JEE Main were today')}</div>
          <div className="row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <b className="big-score">{p.score}<span className="muted"> / 300</span></b>
            <span className="muted">{t('likely {low}–{high}', { low: p.low, high: p.high })}</span>
            <Pill kind={p.confidence === 'high' ? 'good' : p.confidence === 'low' ? 'hard' : 'medium'}>{t({ high: tk('High confidence'), medium: tk('Medium confidence'), low: tk('Low confidence') }[p.confidence])}</Pill>
          </div>
          {p.percentile && (
            <div style={{ marginTop: 6 }}>
              ≈ <b>{fmtPercentile(p.percentile.percentile)}</b> {t('percentile')} · {t('AIR around')} <b>{fmtRank(p.percentile.rank).replace('lakh', t('lakh'))}</b>
              <span className="muted small"> ({fmtRank(p.best.rank)} – {fmtRank(p.worst.rank)})</span>
            </div>
          )}
        </div>
        {hist.length >= 2 && (
          <div className="trend" title={t('Your predicted score, week by week')}>
            <svg viewBox={`0 0 ${hist.length * 14} 40`} width="140" height="40" preserveAspectRatio="none" role="img" aria-label={t('Predicted score trend: {from} to {to}', { from: hist[0].score, to: hist[hist.length - 1].score })}>
              <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={hist.map((h, i) => `${i * 14 + 7},${37 - (32 * (h.score - lo)) / (hi - lo || 1)}`).join(' ')} />
            </svg>
            <div className={`small ${trend >= 0 ? 'good-text' : 'bad-text'}`}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)} {t('marks in {n} weeks', { n: hist.length - 1 })}</div>
          </div>
        )}
      </div>
      <div className="grid grid-3" style={{ marginTop: 12 }}>
        {['physics', 'chemistry', 'maths'].map((s) => (
          <div key={s}>
            <div className="spread small"><b>{t(SUBJECT_LABEL[s])}</b><span className="mono">{p.subjects[s]} / 100</span></div>
            <div className="bar"><i style={{ width: `${p.subjects[s]}%`, background: `var(--${SUBJ_VAR[s]})` }} /></div>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        {p.fromMocks
          ? t('Blends your last {n} full mocks (average {avg}) with your chapter accuracy weighted by how often each chapter comes in the paper.', { n: p.fromMocks.count, avg: p.fromMocks.average })
          : t('From your chapter accuracy, weighted by how often each chapter comes in the paper, and adjusted for how you do under time pressure. Take a full mock to make it sharper.')}
        {' '}{t('Percentile and rank from the {source}.', { source: SOURCE })}
      </p>
    </section>
  );
}

// ---- why marks are lost ------------------------------------------------------------------------------

function LostMarks({ m }) {
  const t = useT();
  const label = Object.fromEntries(REASONS);
  const any = m.taggedCount > 0;
  return (
    <section className="card">
      <h3 className="with-icon"><Icon.CircleX /> {t('Why you lose marks')}</h3>
      {any ? (
        <>
          <div className="stackbar" role="img" aria-label={REASONS.map(([k, l]) => `${t(l)} ${m.share[k]}%`).join(', ')}>
            {REASONS.filter(([k]) => m.share[k] > 0).map(([k]) => <i key={k} style={{ width: `${m.share[k]}%`, background: REASON_COLOR[k] }} title={`${t(label[k])}: ${m.share[k]}%`} />)}
          </div>
          <div className="stack small" style={{ gap: 4, marginTop: 8 }}>
            {REASONS.map(([k, l]) => (
              <div key={k} className="spread">
                <span><i className="legend-dot" style={{ background: REASON_COLOR[k] }} /> {t(l)}</span>
                <span className="mono">{m.share[k]}%{m.tests[k].marks ? ` · ${t('{n} marks in tests', { n: m.tests[k].marks })}` : ''}</span>
              </div>
            ))}
          </div>
          {m.top && <div className="alert warn small" style={{ marginTop: 10 }}>{t(REASON_ADVICE[m.top])}</div>}
          {m.sillyPerTest >= 4 && <p className="small" style={{ margin: '8px 0 0' }}>{t('Silly mistakes (calculation + misreading) cost you about {n} marks per test: the cheapest marks to win back.', { n: m.sillyPerTest })}</p>}
        </>
      ) : (
        <p className="muted small">{t('After a wrong answer, tap why you got it wrong: concept, calculation, misread, guess or time. After a few, this shows where your marks really go.')}</p>
      )}
      {m.toTag.length > 0 && (
        <details style={{ marginTop: 10 }} open={!any}>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>{t('{n} mistakes waiting for a reason', { n: m.untaggedCount })}</summary>
          <div className="stack small" style={{ gap: 4, marginTop: 6 }}>
            {m.toTag.map((q) => (
              <Link key={`${q.kind}${q.testId || ''}${q.qid}`} className="spread plain-link" to={q.kind === 'test' ? `/test/${q.testId}/result` : `/problems/${q.qid}`}>
                <span>{q.chapter || `#${q.qid}`} <span className="muted">· {q.kind === 'test' ? q.testTitle : t('practice')}</span></span>
                <span className="muted">{q.status === 'unattempted' ? t('Skipped') : t('Wrong')} <Icon.ArrowRight size={12} /></span>
              </Link>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// ---- guessing --------------------------------------------------------------------------------------

function Guessing({ g }) {
  const t = useT();
  if (g.locked) return <Locked icon={<Icon.CircleHelp />} title={t('Should you guess?')} text={t('You marked how sure you were on {n} answers. See how often your guesses are right and whether they gain or lose you marks.', { n: g.tagged })} />;
  const rows = [['sure', tk('Sure')], ['maybe', tk('50-50')], ['guess', tk('Guess')]];
  return (
    <section className="card">
      <h3 className="with-icon"><Icon.CircleHelp /> {t('Should you guess?')}</h3>
      {!g.tagged ? (
        <p className="muted small">{t('In tests, tap Sure, 50-50 or Guess after answering. Under +4/−1 a guess pays only if it is right more than {p}% of the time; this shows whether yours are.', { p: g.breakEvenPct })}</p>
      ) : (
        <>
          <table className="table small">
            <thead><tr><th>{t('You said')}</th><th>{t('Answers')}</th><th>{t('Right')}</th><th>{t('Marks')}</th></tr></thead>
            <tbody>
              {rows.map(([k, l]) => {
                const v = g.levels[k];
                return (
                  <tr key={k}>
                    <td><b>{t(l)}</b></td>
                    <td className="mono">{v.attempted}</td>
                    <td className="mono">{v.accuracy === null ? '—' : `${v.accuracy}%`}</td>
                    <td className={`mono ${v.net < 0 ? 'bad-text' : v.net > 0 ? 'good-text' : ''}`}>{v.net > 0 ? '+' : ''}{v.net}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {g.levels.guess.verdict === 'skip' && <div className="alert error small">{t('Your guesses are right {p}% of the time, below the {b}% break-even. Leaving them blank would gain you about {n} marks per test.', { p: g.levels.guess.accuracy, b: g.breakEvenPct, n: g.gainSkipGuesses })}</div>}
          {g.levels.guess.verdict === 'keep' && <div className="alert good small">{t('Your guesses are right {p}% of the time, above the {b}% break-even: educated guessing is helping you.', { p: g.levels.guess.accuracy, b: g.breakEvenPct })}</div>}
          {g.levels.maybe.verdict === 'skip' && <div className="alert warn small">{t('Even your 50-50 answers lose marks. Skip them until you can rule out more options.')}</div>}
          {!g.levels.guess.verdict && <p className="muted small">{t('A verdict appears after 5 answers marked Guess.')}</p>}
        </>
      )}
    </section>
  );
}

// ---- what to study next -------------------------------------------------------------------------------

function StudyNext({ rows, locked }) {
  const t = useT();
  if (!rows.length) return null;
  const stateLabel = { 'not-started': tk('Not started'), weak: tk('Weak'), rushed: tk('Careless'), improving: tk('Improving'), slow: tk('Slow'), strong: tk('Strong'), few: tk('Just started') };
  return (
    <section className="card flush table-wrap">
      <div style={{ padding: '14px 14px 0' }}>
        <h3 className="with-icon" style={{ marginBottom: 4 }}><Icon.Rocket /> {t('What to study next, by marks')}</h3>
        <p className="muted small" style={{ margin: 0 }}>{t('Marks you could add to your score by getting each chapter to 80%, given how many questions it usually gets in JEE Main.')}</p>
      </div>
      <table className="table">
        <thead><tr><th>{t('Chapter')}</th><th>{t('Qs per paper')}</th><th>{t('Your accuracy')}</th><th>{t('Marks to gain')}</th><th /></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.subject + c.slug}>
              <td><b style={{ fontWeight: 600 }}>{c.chapter}</b> <span className="muted small">· {t(SUBJECT_LABEL[c.subject])} · {t(stateLabel[c.state] || c.state)}</span></td>
              <td className="mono">{c.questionsPerPaper}</td>
              <td className="mono">{c.accuracy === null ? '—' : `${c.accuracy}%`}</td>
              <td className="mono good-text"><b>+{c.gain}</b></td>
              <td><Link className="btn sm" to={`/problems?subject=${c.subject}&chapter=${c.slug}&status=todo`}>{t('Practise')}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      {locked > 0 && <p className="small" style={{ padding: '0 14px 12px', margin: 0 }}><Icon.Lock size={12} /> {t('{n} more chapters in the full list with Pro.', { n: locked })} <Link to="/pro">{t('See Pro')}</Link></p>}
    </section>
  );
}

// ---- syllabus pace ------------------------------------------------------------------------------------

function Pace({ p, settings, onSettings }) {
  const t = useT();
  const [cls, label] = PACE_TEXT[p.status] || ['', p.status];
  return (
    <section className="card">
      <div className="spread">
        <h3 className="with-icon" style={{ margin: 0 }}><Icon.CalendarDays /> {t('Syllabus pace')}</h3>
        <label className="small row" style={{ gap: 6 }}>
          {t('Exam date')}
          <input type="date" className="input sm" value={p.examDate} onChange={(e) => e.target.value && onSettings({ examDate: e.target.value })} />
          {settings?.examDateIsDefault && <span className="muted">({t('JEE Main Jan session; change if needed')})</span>}
        </label>
      </div>
      <div className="spread small" style={{ marginTop: 10 }}>
        <span><b>{p.covered}</b> {t('of {n} chapters covered', { n: p.total })} ({p.coveredPct}%)</span>
        {p.weeksLeft > 0 && <span className="muted">{t('{n} weeks to go', { n: Math.round(p.weeksLeft) })}</span>}
      </div>
      <div className="bar" style={{ height: 10 }}>
        <i style={{ width: `${p.coveredPct}%` }} />
      </div>
      {p.status !== 'passed' && p.status !== 'done' && (
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <div className="stat"><b>{p.perWeek}</b><span>{t('chapters a week (your pace)')}</span></div>
          <div className="stat"><b>{p.needPerWeek}</b><span>{t('chapters a week needed, keeping {w} weeks for revision', { w: Math.round(p.revisionWeeks) })}</span></div>
          <div className="stat"><b>{p.projectedPct}%</b><span>{t('covered by the exam at this pace')}</span></div>
        </div>
      )}
      <div className={`alert ${cls === 'good' ? 'good' : cls === 'bad' ? 'error' : ''} small`} style={{ marginTop: 10 }}>
        <b>{t(label)}.</b>{' '}
        {p.status === 'behind' && t('At {a} chapters a week you finish around {date}. Aim for {b} a week.', { a: p.perWeek, b: p.needPerWeek, date: p.finishDate ? day(p.finishDate) : '—' })}
        {p.status === 'not-started' && t('A chapter counts as covered after about 10 questions solved in it. {b} chapters a week gets you there with time to revise.', { b: p.needPerWeek })}
        {(p.status === 'on-track' || p.status === 'ahead') && t('At this pace you cover the syllabus by {date}, with time left to revise.', { date: p.finishDate ? day(p.finishDate) : '—' })}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        {['physics', 'chemistry', 'maths'].map((s) => `${t(SUBJECT_LABEL[s])} ${p.bySubject[s].covered}/${p.bySubject[s].total}`).join(' · ')}
      </p>
    </section>
  );
}

// ---- test strategy ---------------------------------------------------------------------------------------

function TestStrategy({ ts }) {
  const t = useT();
  if (!ts) {
    return (
      <section className="card">
        <h3 className="with-icon"><Icon.Route /> {t('How you take tests')}</h3>
        <p className="muted small">{t('Take a timed test: each result shows the order you moved through the paper, time lost on wrong answers and easy questions left behind.')}</p>
        <Link className="btn sm" to="/practice">{t('Take a test')} <Icon.ArrowRight /></Link>
      </section>
    );
  }
  if (ts.locked) return <Locked icon={<Icon.Route />} title={t('How you take tests')} text={t('Patterns across your last {n} tests: time sunk into wrong answers, easy questions left blank, where you get stuck.', { n: ts.count })} />;
  return (
    <section className="card">
      <h3 className="with-icon"><Icon.Route /> {t('How you take tests')}</h3>
      <p className="muted small" style={{ marginTop: 0 }}>{t('Average over your last {n} tests', { n: ts.count })}</p>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="stat"><b>{ts.wrongMinutes} {t('min')}</b><span>{t('on answers that were wrong')}</span></div>
        <div className="stat"><b>{ts.easyLeft}</b><span>{t('easy questions left blank')}</span></div>
        <div className="stat"><b>{ts.stuck}</b><span>{t('questions stuck on for 4+ min')}</span></div>
        <div className="stat"><b>{ts.blankSeenMinutes} {t('min')}</b><span>{t('on questions then left blank')}</span></div>
      </div>
      <div className="stack small" style={{ gap: 4, marginTop: 10 }}>
        {ts.recent.map((r) => (
          <Link key={r.testId} className="spread plain-link" to={`/test/${r.testId}/result`}>
            <span>{r.title}</span>
            <span className="muted">{t('{m} min on wrong · {e} easy left', { m: r.wrongMinutes, e: r.easyLeft })} <Icon.ArrowRight size={12} /></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---- retention -------------------------------------------------------------------------------------------

function Retention({ r }) {
  const t = useT();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const check = async () => {
    setBusy(true);
    setErr(null);
    try {
      const x = await api('/tests/practice', { method: 'POST', body: { mode: 'retention', count: 20 } });
      nav(`/test/${x.id}/take`);
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  };
  const button = r.readyToCheck >= 5 && (
    <button className="btn sm" onClick={check} disabled={busy}>{busy ? t('Starting…') : t('Take a 20-question retention check')}</button>
  );
  if (r.locked) return <Locked icon={<Icon.RotateCcw />} title={t('What you still remember')} text={t('{n} questions you solved came back in tests later. See which chapters you are forgetting.', { n: r.checked })} />;
  return (
    <section className="card">
      <h3 className="with-icon"><Icon.RotateCcw /> {t('What you still remember')}</h3>
      {r.checked ? (
        <>
          <div className="stat"><b>{r.pct}%</b><span>{t('of questions you had solved were still right in a test a week or more later ({k}/{n})', { k: r.kept, n: r.checked })}</span></div>
          {r.chapters.length > 0 && (
            <div className="stack small" style={{ gap: 4, marginTop: 10 }}>
              <div className="muted">{t('Chapters fading fastest')}</div>
              {r.chapters.map((c) => (
                <Link key={c.subject + c.slug} className="spread plain-link" to={`/${c.subject}/${c.slug}`}>
                  <span>{c.chapter} <span className="muted">· {t(SUBJECT_LABEL[c.subject])}</span></span>
                  <span className={`mono ${c.pct < 60 ? 'bad-text' : ''}`}>{c.pct}% ({c.kept}/{c.checked})</span>
                </Link>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="muted small">{t('Questions you solved come back in tests after a while. When they do, this shows how much has stuck, chapter by chapter.')}</p>
      )}
      <div style={{ marginTop: 10 }}>{button}</div>
      {r.readyToCheck < 5 && <p className="muted small" style={{ margin: '6px 0 0' }}>{t('A retention check uses questions you solved 2 weeks to 3 months ago.')}</p>}
      <ErrorBox error={err} />
    </section>
  );
}

// ---- effort vs result ----------------------------------------------------------------------------------------

function Effort({ e }) {
  const t = useT();
  if (!e) return null;
  if (e.locked) return <Locked icon={<Icon.Clock />} title={t('Where your time goes')} text={t('Your study time per subject next to the marks each subject brings you.')} />;
  const mismatch = e.subjects.filter((s) => s.marksPct !== null && s.timePct - s.marksPct >= 12);
  return (
    <section className="card">
      <h3 className="with-icon"><Icon.Clock /> {t('Where your time goes')}</h3>
      <p className="muted small" style={{ marginTop: 0 }}>{t('{h} hours of practice and tests, split by subject, next to your predicted marks.', { h: e.hours })}</p>
      <div className="stack">
        {e.subjects.map((s) => (
          <div key={s.subject}>
            <div className="spread small"><b>{t(SUBJECT_LABEL[s.subject])}</b><span className="mono">{s.hours} h · {t('{p}% of time', { p: s.timePct })}{s.marksPct !== null ? ` · ${t('{p}% of marks', { p: s.marksPct })}` : ''}</span></div>
            <div className="effort-bars">
              <div className="bar"><i style={{ width: `${s.timePct}%`, background: `var(--${SUBJ_VAR[s.subject]})` }} /></div>
              {s.marksPct !== null && <div className="bar marks"><i style={{ width: `${s.marksPct}%` }} /></div>}
            </div>
          </div>
        ))}
      </div>
      <div className="legend small" style={{ marginTop: 8 }}>
        <span><i style={{ background: 'var(--muted)', borderColor: 'var(--muted)' }} />{t('time (subject colour)')}</span>
        <span><i style={{ background: 'var(--text)', borderColor: 'var(--text)' }} />{t('marks')}</span>
      </div>
      {mismatch.map((s) => (
        <div key={s.subject} className="alert warn small" style={{ marginTop: 8 }}>
          {t('{subject} takes {a}% of your time but brings {b}% of your marks. Check "What to study next" for where that time pays more.', { subject: t(SUBJECT_LABEL[s.subject]), a: s.timePct, b: s.marksPct })}
        </div>
      ))}
    </section>
  );
}
