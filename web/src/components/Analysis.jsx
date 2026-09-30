import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi, fmtShort, SUBJECT_LABEL, TYPE_LABEL } from '../lib/hooks.js';
import { tk, useT } from '../lib/i18n.jsx';
import { ErrorBox, Pill, Spinner } from './Layout.jsx';
import { BarChart } from './BarChart.jsx';
import { Icon } from './Icon.jsx';

/**
 * "My analysis" on the student's own profile (server: lib/analysis.js).
 * Everything is built from their practice history and test results; nothing to fill in.
 */
const SUBJ_VAR = { physics: 'var(--phy)', chemistry: 'var(--chem)', maths: 'var(--math)' };
const VERDICT = {
  strong: ['good', tk('Strong')],
  improving: ['medium', tk('Getting there')],
  slow: ['', tk('Accurate but slow')],
  rushed: ['hard', tk('Fast but careless')],
  weak: ['hard', tk('Weak')],
};

const ACTION_ICON = {
  'more-data': <Icon.ListChecks />,
  'weak-chapter': <Icon.TriangleAlert />,
  'revise-mistakes': <Icon.RotateCcw />,
  'rushed-chapter': <Icon.Zap />,
  'slow-chapter': <Icon.Hourglass />,
  'negative-marks': <Icon.CircleAlert />,
  'attempt-more': <Icon.Target />,
  'try-hard': <Icon.TrendingUp />,
  'exam-pace': <Icon.Timer />,
  'not-started': <Icon.BookOpen />,
  consistency: <Icon.Flame />,
};
const ACTION_TONE = { 'weak-chapter': 'bad', 'negative-marks': 'bad', 'rushed-chapter': 'warn', 'slow-chapter': 'warn', 'exam-pace': 'warn', 'try-hard': 'good', consistency: 'warn' };

// Wording for each recommendation id from the server (tk marks them for the Hindi check).
const ACTIONS = {
  'more-data': [tk("Solve {n} more questions to unlock a reliable analysis."), tk("Start solving")],
  'weak-chapter': [tk("{chapter}: only {acc}% right on the first try. Rebuild the basics with questions you haven't tried yet."), tk("Practise {chapter}")],
  'revise-mistakes': [tk("{n} questions you got wrong are still unsolved. Retry them — mistakes are the fastest way to improve."), tk("Revise mistakes")],
  'rushed-chapter': [tk("{chapter}: you answer faster than most students but get only {acc}% right. Slow down and re-read the question."), tk("Practise carefully")],
  'slow-chapter': [tk("{chapter}: accurate, but you take {x}× as long as other students. Timed practice will build speed."), tk("Timed test")],
  'negative-marks': [tk("In tests you lost {lost} marks to wrong answers ({acc}% accuracy) and spent {mins} min on them. Go through each wrong answer's solution."), tk("Review last test")],
  'attempt-more': [tk("In tests you attempt only {rate}% of questions but get {acc}% right. With +4/−1 marking, attempting more would raise your score."), tk("Take a test")],
  'try-hard': [tk("You're solid on easy questions. Start mixing in hard ones — that's what separates ranks."), tk("Try hard questions")],
  'exam-pace': [tk("{subject}: you average {sec} per question; the exam allows about {pace}. Practise under a timer."), tk("Timed test")],
  'not-started': [tk("You haven't started {chapter} yet — it has {n} previous-year questions."), tk("Open chapter")],
  consistency: [tk("You practised on {n} of the last 14 days. A little every day beats a lot once a week."), tk("Problem of the Day")],
};

export function Analysis({ username }) {
  const t = useT();
  const { data: a, error, loading } = useApi(`/users/${username}/analysis`);
  if (error) return <ErrorBox error={error} />;
  if (loading && !a) return <Spinner />;
  const o = a.overall;
  if (!o.attempted) {
    return (
      <div className="card empty stack">
        <div className="empty-icon"><Icon.ChartColumn size={26} /></div>
        <h3 style={{ margin: 0 }}>{t('Your analysis appears after you solve a few questions')}</h3>
        <p className="muted small" style={{ margin: 0 }}>{t('Solve questions and take tests — this page will show your strong and weak chapters, your speed and what to do next.')}</p>
        <div><Link className="btn primary" to="/problems">{t('Start solving')}</Link></div>
      </div>
    );
  }
  const pace = a.examPaceSec;
  return (
    <div className="stack analysis">
      <p className="muted small" style={{ margin: 0 }}><Icon.Lock size={13} /> {t('Only you can see this page.')} {t('Based on {n} questions you practised and {m} tests.', { n: o.attempted, m: a.tests?.count || 0 })}</p>

      <div className="grid grid-4">
        <Tile icon={<Icon.Target />} big={`${o.accuracy}%`} label={t('first-try accuracy')} hint={t('Solved on the first submission without opening the solution — the closest thing to exam conditions.')} />
        <Tile
          icon={<Icon.Timer />}
          big={fmtShort(o.avgSolveSec)}
          label={t('average time to solve · exam pace {pace}', { pace: fmtShort(pace) })}
          tone={o.avgSolveSec ? (o.avgSolveSec <= pace ? 'good' : 'bad') : ''}
          hint={t('JEE Main gives 180 minutes for 75 questions: about 2 min 24 s each.')}
        />
        {a.pro ? (
          <Tile icon={<Icon.Gauge />} big={o.speedRatio ? speedText(o.speedRatio, t) : '—'} label={t('compared with other students on the same questions')} tone={o.speedRatio ? (o.speedRatio <= 1.05 ? 'good' : o.speedRatio > 1.3 ? 'bad' : '') : ''} />
        ) : (
          <Tile icon={<Icon.Gauge />} big={<><Icon.Lock size={20} /> Pro</>} label={t('your speed compared with other students on the same questions')} link="/pro" />
        )}
        {a.tests ? (
          <Tile
            icon={<Icon.ClipboardCheck />}
            big={`${a.tests.accuracy}%`}
            label={a.tests.locked ? t('accuracy in tests') : t('accuracy in tests · {n} marks lost to wrong answers', { n: a.tests.marksLost })}
            tone={a.tests.accuracy >= 70 ? 'good' : a.tests.accuracy < 50 ? 'bad' : ''}
          />
        ) : (
          <Tile icon={<Icon.ClipboardCheck />} big="—" label={t('Take a timed test to see how you do under exam conditions')} link="/practice" />
        )}
      </div>

      {a.actions.length > 0 && (
        <section className="card action-plan">
          <h3 className="with-icon"><Icon.Rocket /> {t('What to do next')}</h3>
          <ol className="stack action-list">
            {a.actions.map((x, i) => {
              const [text, cta] = ACTIONS[x.id] || [x.id, 'Open'];
              const vars = { ...x.vars };
              if (vars.subject) vars.subject = t(SUBJECT_LABEL[vars.subject]);
              if (vars.sec) vars.sec = fmtShort(vars.sec);
              if (vars.pace) vars.pace = fmtShort(vars.pace);
              return (
                <li key={i} className="action-item">
                  <span className={`action-icon ${ACTION_TONE[x.id] || ''}`}>{ACTION_ICON[x.id] || <Icon.Sparkles />}</span>
                  <div className="spread" style={{ alignItems: 'flex-start', flex: 1 }}>
                    <span style={{ flex: '1 1 300px' }}>{t(text, vars)}</span>
                    <Link className="btn sm" to={x.link}>{t(cta, vars)} <Icon.ArrowRight /></Link>
                  </div>
                </li>
              );
            })}
          </ol>
          {a.actionsLocked > 0 && (
            <ProLock inline text={t('{n} more steps in your plan, based on your speed, test mistakes and weak topics.', { n: a.actionsLocked })} />
          )}
        </section>
      )}

      <div className="grid grid-3">
        {['physics', 'chemistry', 'maths'].map((s) => <SubjectCard key={s} s={s} d={a.subjects[s]} pace={pace} pro={a.pro} />)}
      </div>

      {a.syllabus && <SyllabusMap syllabus={a.syllabus} pro={a.pro} />}

      <ChapterSection chapters={a.chapters} pro={a.pro} />

      <div className="grid grid-2">
        <Breakdown title={t('By difficulty')} rows={['easy', 'medium', 'hard'].map((k) => [t(k), a.difficulty[k], `/problems?difficulty=${k}`])} />
        <Breakdown title={t('By question type')} rows={['single', 'multi', 'numerical'].map((k) => [t(TYPE_LABEL[k]), a.type[k], `/problems?type=${k}`])} />
      </div>

      {!a.pro && a.topicsLocked > 0 && (
        <ProLock title={t('Topics to work on')} text={t('{n} topics where you get less than 60% right — see exactly which ones.', { n: a.topicsLocked })} />
      )}
      {a.topics.filter((x) => x.accuracy !== null && x.accuracy < 60).length > 0 && (
        <section className="card">
          <h3 className="with-icon"><Icon.Layers /> {t('Topics to work on')}</h3>
          <div className="stack">
            {a.topics.filter((x) => x.accuracy !== null && x.accuracy < 60).slice(0, 8).map((x) => (
              <Link key={`${x.subject}${x.slug}${x.topic}`} to={`/problems?subject=${x.subject}&search=${encodeURIComponent(x.topic)}`} className="spread small plain-link">
                <span><b>{x.topic}</b> <span className="muted">· {t(SUBJECT_LABEL[x.subject])}</span></span>
                <span className="mono">{x.accuracy}% · {t('{n} tried', { n: x.attempted })}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {a.tests && <TestsSection tests={a.tests} />}

      <div className="grid grid-2">
        <BarChart title={t('Questions solved per week')} data={a.weeks} valueKey="solved" totalLabel={t('total')} maxLabel={(v) => t('max {n} a week', { n: v })} />
        <section className="card">
          <h3 className="with-icon"><Icon.CalendarDays /> {t('Consistency')}</h3>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="stat"><b>{a.consistency.active30}</b><span>{t('days practised in the last 30')}</span></div>
            <div className="stat"><b>{a.consistency.practisedToday ? '✓' : '—'}</b><span>{t('practised today')}</span></div>
          </div>
          <h3 style={{ marginTop: 16 }}>{t("Chapters you haven't started")}</h3>
          <div className="stack small">
            {['physics', 'chemistry', 'maths'].flatMap((s) => a.subjects[s].coverage.notStarted.slice(0, 2).map((c) => ({ ...c, s }))).slice(0, 6).map((c) => (
              <Link key={c.s + c.slug} to={`/${c.s}/${c.slug}`} className="spread plain-link">
                <span>{c.chapter} <span className="muted">· {t(SUBJECT_LABEL[c.s])}</span></span>
                <span className="muted">{c.pyqCount ? `${c.pyqCount} PYQs` : t('{n} questions', { n: c.count })}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <details className="card small">
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('How these numbers are worked out')}</summary>
        <ul className="muted" style={{ marginBottom: 0 }}>
          <li>{t('First-try accuracy: questions solved on the first submission without opening the solution, out of all questions you tried.')}</li>
          <li>{t('Speed: your solve time compared with the average time of all students who solved the same questions. 1.2× means 20% slower.')}</li>
          <li>{t('Exam pace: JEE Main gives 180 minutes for 75 questions, about 2 min 24 s each, and you also need time to read and check.')}</li>
          <li>{t('A chapter is rated after 5 questions: strong = 70%+ first-try accuracy; weak = under 45%; accurate but slow = strong accuracy but 1.3× slower than others; fast but careless = weak accuracy while faster than others.')}</li>
          <li>{t('Under +4/−1 marking an answer adds marks on average when you are more than 20% sure; your net marks per attempt are shown in the tests section.')}</li>
        </ul>
      </details>
    </div>
  );
}

function speedText(r, t) {
  if (r <= 0.95) return t('{p}% faster', { p: Math.round((1 - r) * 100) });
  if (r >= 1.05) return t('{p}% slower', { p: Math.round((r - 1) * 100) });
  return t('average speed');
}

function Tile({ big, label, hint, tone = '', link, icon }) {
  const body = (
    <>
      {icon && <span className="tile-icon">{icon}</span>}
      <b className={tone ? `tone-${tone}` : ''}>{big}</b>
      <span>{label}</span>
    </>
  );
  return link ? (
    <Link to={link} className="card stat plain-link" title={hint}>{body}</Link>
  ) : (
    <div className="card stat" title={hint}>{body}</div>
  );
}

/** Bar with the student's value and a marker for the target. */
function PaceBar({ value, target, color }) {
  const max = Math.max(value || 0, target) * 1.25;
  return (
    <div className="pace-bar" aria-hidden="true">
      <i style={{ width: `${(100 * (value || 0)) / max}%`, background: color }} />
      <em style={{ left: `${(100 * target) / max}%` }} />
    </div>
  );
}

function SubjectCard({ s, d, pace, pro }) {
  const t = useT();
  const color = SUBJ_VAR[s];
  return (
    <section className={`card subject-card ${s}`}>
      <div className="spread">
        <h3 style={{ margin: 0 }}>{t(SUBJECT_LABEL[s])}</h3>
        <span className="muted small">{t('{a}/{b} chapters started', { a: d.coverage.started, b: d.coverage.chapters })}</span>
      </div>
      {!d.attempted ? (
        <p className="muted small">{t('Not started yet.')} <Link to={`/${s}`}>{t('Pick a chapter')} <Icon.ArrowRight size={13} /></Link></p>
      ) : (
        <div className="stack small" style={{ marginTop: 10 }}>
          <div>
            <div className="spread"><span>{t('First-try accuracy')}</span><b className="mono">{d.accuracy}%</b></div>
            <div className="bar"><i style={{ width: `${d.accuracy}%`, background: color }} /></div>
          </div>
          <div>
            <div className="spread">
              <span>{t('Avg time to solve')}</span>
              <b className={`mono ${d.avgSolveSec && d.avgSolveSec > pace ? 'tone-bad' : 'tone-good'}`}>{fmtShort(d.avgSolveSec)}</b>
            </div>
            {d.avgSolveSec && <PaceBar value={d.avgSolveSec} target={pace} color={color} />}
            <div className="muted" style={{ fontSize: '.75rem' }}>
              {t('marker = exam pace {pace}', { pace: fmtShort(pace) })}
              {d.speedRatio ? ` · ${t('vs other students: {x}', { x: speedText(d.speedRatio, t) })}` : ''}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {['easy', 'medium', 'hard'].map((k) => (
              <span key={k} className={`pill ${k}`} title={t('first-try accuracy')}>
                {t(k)} {d.byDifficulty[k].attempted ? `${d.byDifficulty[k].accuracy}%` : '—'}
              </span>
            ))}
          </div>
          {d.strongest && (
            <div className="row" style={{ gap: 6 }}><Icon.TrendingUp style={{ color: 'var(--good)' }} /> {t('Strongest:')} <Link to={`/${s}/${d.strongest.slug}`}>{d.strongest.chapter}</Link> <span className="muted">({d.strongest.accuracy}%)</span></div>
          )}
          {d.weakest && (
            <div className="row" style={{ gap: 6 }}><Icon.TriangleAlert style={{ color: 'var(--bad)' }} /> {t('Weakest:')} <Link to={`/problems?subject=${s}&chapter=${d.weakest.slug}`}>{d.weakest.chapter}</Link> <span className="muted">({d.weakest.accuracy}%)</span></div>
          )}
          {d.tests && !d.tests.locked && (
            <div className="muted">
              {t('In tests: {acc}% right, {n} marks lost, {time} per question', { acc: d.tests.accuracy ?? '—', n: d.tests.marksLost, time: fmtShort(d.tests.avgTimeSec) })}
            </div>
          )}
          {!pro && (
            <Link to="/pro" className="muted plain-link" style={{ fontSize: '.8rem' }}><Icon.Lock size={12} /> {t('Speed vs other students and test mistakes for {subject} — Pro', { subject: t(SUBJECT_LABEL[s]) })}</Link>
          )}
        </div>
      )}
    </section>
  );
}

const MAP_STATE = {
  none: tk('Not started'),
  started: tk('Started'),
  strong: tk('Strong'),
  improving: tk('Improving'),
  slow: tk('Accurate but slow'),
  rushed: tk('Fast but careless'),
  weak: tk('Weak'),
};

/**
 * Every chapter of the syllabus as a tile: grey = not started, then coloured by how well it's going
 * (strong / improving / slow / rushed / weak — Pro), with how many questions were tried and the accuracy.
 * The "what's left before the exam" view.
 */
function SyllabusMap({ syllabus, pro }) {
  const t = useT();
  const [tab, setTab] = useState('physics');
  const units = syllabus[tab] || [];
  const all = units.flatMap((u) => u.chapters);
  const started = all.filter((c) => c.attempted > 0).length;
  const state = (c) => (!c.attempted ? 'none' : c.verdict || 'started');
  const counts = {};
  for (const s of ['physics', 'chemistry', 'maths']) {
    const list = (syllabus[s] || []).flatMap((u) => u.chapters);
    counts[s] = [list.filter((c) => c.attempted).length, list.length];
  }
  const legend = pro ? ['none', 'started', 'weak', 'rushed', 'improving', 'slow', 'strong'] : ['none', 'started'];
  return (
    <section className="card syllabus-map">
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h3 className="with-icon" style={{ margin: 0 }}><Icon.Layers /> {t('Syllabus map')}</h3>
        <div className="seg">
          {['physics', 'chemistry', 'maths'].map((s) => (
            <button key={s} className={tab === s ? 'on' : ''} onClick={() => setTab(s)}>
              {t(SUBJECT_LABEL[s])} <span className="muted">{counts[s][0]}/{counts[s][1]}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="muted small" style={{ margin: '6px 0 12px' }}>
        {t('{a} of {b} chapters started.', { a: started, b: all.length })} {pro ? t('Colours show how each chapter is going (after 5 questions).') : ''}
      </p>
      <div className="map-legend">
        {legend.map((k) => <span key={k} className={`map-key ${k}`}><i />{t(MAP_STATE[k])}</span>)}
        {!pro && <Link to="/pro" className="map-key pro-key"><Icon.Lock size={12} /> {t('Strong / weak colours with Pro')}</Link>}
      </div>
      {units.map((u) => (
        <div key={u.name} className="map-unit">
          <div className="map-unit-name">{u.name}</div>
          <div className="map-tiles">
            {u.chapters.map((c) => (
              <Link key={c.slug} to={`/problems?subject=${tab}&chapter=${c.slug}`} className={`map-tile ${state(c)}`} title={`${c.chapter}: ${t(MAP_STATE[state(c)])}`}>
                <span className="map-name">{c.chapter}</span>
                <span className="map-meta">
                  {c.attempted ? <>{t('{n} tried', { n: c.attempted })}{c.accuracy !== null ? ` · ${c.accuracy}%` : ''}</> : t('{n} questions', { n: c.count.toLocaleString('en-IN') })}
                </span>
                <span className="map-bar"><i style={{ width: `${Math.min(100, Math.max(c.attempted ? 3 : 0, (100 * c.attempted) / Math.min(c.count, 60)))}%` }} /></span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ChapterSection({ chapters, pro }) {
  const t = useT();
  const [sort, setSort] = useState('accuracy');
  const rated = chapters.filter((c) => c.verdict);
  const rows = [...chapters].sort((a, b) =>
    sort === 'accuracy' ? (a.accuracy ?? 101) - (b.accuracy ?? 101) : sort === 'speed' ? (b.speedRatio ?? 0) - (a.speedRatio ?? 0) : b.attempted - a.attempted,
  );
  return (
    <section className="card">
      <div className="spread">
        <h3 style={{ margin: 0 }} className="with-icon"><Icon.BookOpen /> {t('Chapter by chapter')}</h3>
        <div className="chips">
          {[['accuracy', tk('Weakest first')], ...(pro ? [['speed', tk('Slowest first')]] : []), ['attempted', tk('Most practised')]].map(([k, v]) => (
            <button key={k} className={`chip ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{t(v)}</button>
          ))}
        </div>
      </div>
      {pro && rated.filter((c) => c.speedRatio).length >= 2 && <ChapterMap chapters={rated.filter((c) => c.speedRatio)} />}
      {!pro && chapters.length > 0 && (
        <ProLock
          text={t('Pro rates every chapter — strong, accurate but slow, fast but careless or weak — on a map of accuracy against speed, so you know exactly what to fix.')}
        />
      )}
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="table">
          <thead>
            <tr><th>{t('Chapter')}</th><th>{t('Tried')}</th><th>{t('First-try')}</th><th className="hide-sm">{t('Avg time')}</th><th className="hide-sm">{t('Speed')}</th><th>{t('Verdict')}</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const v = VERDICT[c.verdict];
              return (
                <tr key={c.subject + c.slug}>
                  <td>
                    <Link to={`/problems?subject=${c.subject}&chapter=${c.slug}`}>{c.chapter}</Link>{' '}
                    <span className={`pill ${c.subject}`}>{t(SUBJECT_LABEL[c.subject])[0]}</span>
                  </td>
                  <td className="mono">{c.attempted}</td>
                  <td className="mono">{c.accuracy}%</td>
                  <td className="mono hide-sm">{fmtShort(c.avgSolveSec)}</td>
                  <td className="mono hide-sm">{c.locked ? <Icon.Lock size={13} className="muted" /> : c.speedRatio ? `${c.speedRatio}×` : '—'}</td>
                  <td>
                    {c.locked ? (
                      <Link to="/pro" className="muted small plain-link row" style={{ gap: 4 }}><Icon.Lock size={12} /> Pro</Link>
                    ) : v ? (
                      <Pill kind={v[0]}>{t(v[1])}</Pill>
                    ) : (
                      <span className="muted small">{t('need {n} more', { n: 5 - c.attempted })}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Accuracy (up) vs speed compared with other students (left = faster). One dot per chapter, coloured by subject. */
function ChapterMap({ chapters }) {
  const t = useT();
  const nav = useNavigate();
  const [hover, setHover] = useState(null);
  const W = 640;
  const H = 300;
  const P = { l: 40, r: 12, t: 12, b: 32 };
  const lo = Math.log(0.4);
  const hi = Math.log(2.5);
  const x = (r) => P.l + ((Math.log(Math.min(2.5, Math.max(0.4, r))) - lo) / (hi - lo)) * (W - P.l - P.r);
  const y = (acc) => P.t + (1 - acc / 100) * (H - P.t - P.b);
  const h = hover !== null ? chapters[hover] : null;
  const subjects = ['physics', 'chemistry', 'maths'].filter((s) => chapters.some((c) => c.subject === s));
  return (
    <div className="chapter-map" style={{ position: 'relative', marginTop: 12, maxWidth: 760, marginInline: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('Chapters by accuracy and speed')} onMouseLeave={() => setHover(null)}>
        {/* quadrants */}
        <rect x={P.l} y={P.t} width={x(1) - P.l} height={y(70) - P.t} fill="var(--good-bg)" opacity="0.6" />
        <rect x={x(1)} y={y(70)} width={W - P.r - x(1)} height={H - P.b - y(70)} fill="var(--bad-bg)" opacity="0.5" />
        <line x1={x(1)} x2={x(1)} y1={P.t} y2={H - P.b} stroke="var(--border)" strokeDasharray="4 4" />
        <line x1={P.l} x2={W - P.r} y1={y(70)} y2={y(70)} stroke="var(--border)" strokeDasharray="4 4" />
        <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--border)" />
        <text x={P.l + 6} y={P.t + 14} fontSize="11" fill="var(--muted)">{t('Strong: accurate and quick')}</text>
        <text x={W - P.r - 6} y={P.t + 14} fontSize="11" fill="var(--muted)" textAnchor="end">{t('Accurate but slow')}</text>
        <text x={P.l + 6} y={H - P.b - 6} fontSize="11" fill="var(--muted)">{t('Fast but careless')}</text>
        <text x={W - P.r - 6} y={H - P.b - 6} fontSize="11" fill="var(--muted)" textAnchor="end">{t('Needs the most work')}</text>
        {[0, 50, 70, 100].map((v) => (
          <text key={v} x={P.l - 6} y={y(v) + 4} fontSize="10" fill="var(--muted)" textAnchor="end">{v}%</text>
        ))}
        {[0.5, 1, 2].map((v) => (
          <text key={v} x={x(v)} y={H - P.b + 14} fontSize="10" fill="var(--muted)" textAnchor="middle">{v === 1 ? t('average') : `${v}×`}</text>
        ))}
        <text x={(W + P.l) / 2} y={H - 4} fontSize="10" fill="var(--muted)" textAnchor="middle">{t('← faster than other students · slower →')}</text>
        {chapters.map((c, i) => (
          <g key={c.subject + c.slug} style={{ cursor: 'pointer' }} onMouseEnter={() => setHover(i)} onClick={() => nav(`/problems?subject=${c.subject}&chapter=${c.slug}`)}>
            <circle cx={x(c.speedRatio)} cy={y(c.accuracy)} r="14" fill="transparent" />
            <circle cx={x(c.speedRatio)} cy={y(c.accuracy)} r={hover === i ? 8 : 6} fill={SUBJ_VAR[c.subject]} stroke="var(--surface)" strokeWidth="2" />
          </g>
        ))}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(100 * x(h.speedRatio)) / W}%`, top: `${Math.max(0, (100 * y(h.accuracy)) / H - 16)}%` }}>
          <b>{h.chapter}</b> · {h.accuracy}% · {h.speedRatio}× · {t('{n} tried', { n: h.attempted })}
        </div>
      )}
      <div className="row small" style={{ gap: 14, justifyContent: 'center' }}>
        {subjects.map((s) => (
          <span key={s} className="row" style={{ gap: 6 }}><i className="legend-dot" style={{ background: SUBJ_VAR[s] }} />{t(SUBJECT_LABEL[s])}</span>
        ))}
      </div>
    </div>
  );
}

function Breakdown({ title, rows }) {
  const t = useT();
  return (
    <section className="card">
      <h3>{title}</h3>
      <div className="stack small">
        {rows.map(([label, d, link]) => (
          <Link key={label} to={link} className="plain-link" style={{ display: 'block' }}>
            <div className="spread">
              <span>{label}</span>
              <span className="mono">
                {d.attempted ? `${d.accuracy}% · ${fmtShort(d.avgSolveSec)}` : '—'} <span className="muted">({t('{n} tried', { n: d.attempted })})</span>
              </span>
            </div>
            <div className="bar"><i style={{ width: `${d.accuracy || 0}%` }} /></div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TestsSection({ tests }) {
  const t = useT();
  const mins = Math.round(tests.wrongTimeSec / 60);
  return (
    <section className="card">
      <h3 className="with-icon"><Icon.ClipboardCheck /> {t('Under exam conditions (your last {n} tests)', { n: tests.count })}</h3>
      <div className="grid grid-4">
        <div className="stat"><b>{tests.attemptRate}%</b><span>{t('of questions attempted')}</span></div>
        <div className="stat"><b>{tests.accuracy}%</b><span>{t('of attempted answers right')}</span></div>
        {tests.locked ? (
          <>
            <Link to="/pro" className="stat plain-link"><b><Icon.Lock size={20} /></b><span>{t('marks lost to negative marking')}</span></Link>
            <Link to="/pro" className="stat plain-link"><b><Icon.Lock size={20} /></b><span>{t('spent on answers that were wrong')}</span></Link>
          </>
        ) : (
          <>
            <div className="stat"><b className={tests.marksLost ? 'tone-bad' : ''}>−{tests.marksLost}</b><span>{t('marks lost to negative marking')}</span></div>
            <div className="stat"><b>{mins} {t('min')}</b><span>{t('spent on answers that were wrong')}</span></div>
          </>
        )}
      </div>
      {tests.locked && <ProLock inline text={t('See how many marks negative marking costs you, the minutes lost on wrong answers, and your net marks per attempt.')} />}
      {!tests.locked && tests.netPerAttempt !== null && (
        <p className="small" style={{ margin: '12px 0 0' }}>
          {t('At your test accuracy each attempted question earns {n} marks on average (+4 right, −1 wrong).', { n: tests.netPerAttempt > 0 ? `+${tests.netPerAttempt}` : tests.netPerAttempt })}{' '}
          <span className="muted">{t('Raising accuracy by 10% adds about +0.5 marks per attempt — 37 marks over a 75-question paper.')}</span>
        </p>
      )}
      <div className="stack small" style={{ marginTop: 14 }}>
        {tests.recent.map((r) => (
          <Link key={r.id + r.at} to={`/test/${r.id}/result`} className="plain-link" style={{ display: 'block' }}>
            <div className="spread">
              <span>{r.title} <span className="muted">· {new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></span>
              <span className="mono">{r.score}/{r.maxScore} · {t('{p}% right', { p: r.accuracy ?? '—' })}</span>
            </div>
            <div className="bar"><i style={{ width: `${Math.max(0, r.percent || 0)}%` }} /></div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** A Pro-only part of the analysis: what it would show, and the way to unlock it. */
function ProLock({ title, text, inline }) {
  const t = useT();
  const body = (
    <div className="pro-lock-body">
      <span className="pro-lock-icon" aria-hidden="true"><Icon.Lock size={18} /></span>
      <span style={{ flex: '1 1 240px' }}>{text}</span>
      <Link to="/pro" className="btn sm primary"><Icon.Crown /> {t('Unlock with Pro')}</Link>
    </div>
  );
  if (inline) return <div className="pro-lock inline">{body}</div>;
  return (
    <section className="card pro-lock">
      {title && <h3 className="with-icon"><Icon.Layers /> {title} <span className="pill pro"><Icon.Crown size={11} /> Pro</span></h3>}
      {body}
    </section>
  );
}
