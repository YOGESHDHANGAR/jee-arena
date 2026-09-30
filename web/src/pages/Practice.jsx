import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, fmtDate, SUBJECT_LABEL, useTitle } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import { useT } from '../lib/i18n.jsx';

const SUBJECT_ICON = { physics: Icon.Atom, chemistry: Icon.FlaskConical, maths: Icon.Sigma };
const COUNTS = [10, 15, 30, 45, 75];
const minutes = (n) => Math.ceil(n * 2.4);
const chaptersLabel = (t, n) => (n === 1 ? t('1 chapter') : t('{n} chapters', { n }));

/**
 * Take a test: one-tap papers (full JEE Main pattern, Class 11, Class 12, my mistakes), or build
 * your own from the standard JEE chapter list grouped by unit.
 */
export default function Practice() {
  useTitle('Take a test');
  const nav = useNavigate();
  const t = useT();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const prefillSubject = ['physics', 'chemistry', 'maths'].includes(params.get('subject')) ? params.get('subject') : null;
  const builder = useApi('/tests/builder', { query: prefillSubject && params.get('chapter') ? { subject: prefillSubject, chapter: params.get('chapter') } : {} });
  const mine = useApi(user ? '/tests/mine' : null);

  const [subjects, setSubjects] = useState(() => (prefillSubject ? [prefillSubject] : ['physics', 'chemistry', 'maths']));
  const [tab, setTab] = useState(prefillSubject || 'physics');
  const [picked, setPicked] = useState(() => new Set());
  const [classLevel, setClassLevel] = useState(0);
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(30);
  const [difficulty, setDifficulty] = useState('');
  const [negative, setNegative] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null); // { from: 'custom' | quick-start key, error }

  // /practice?subject=physics&chapter=Rotational%20Motion (from a chapter page) ticks that chapter.
  const prefill = builder.data?.prefill;
  useEffect(() => {
    if (prefill) setPicked(new Set([prefill]));
  }, [prefill]);

  const syllabus = builder.data?.subjects;
  const chaptersOf = (s) => (syllabus?.[s]?.units || []).flatMap((u) => u.chapters);
  const pickedIn = (s) => [...picked].filter((k) => k.startsWith(`${s}:`));

  const ORDER = ['physics', 'chemistry', 'maths'];
  const toggleSubject = (s) => {
    if (subjects.includes(s)) {
      const next = subjects.filter((x) => x !== s);
      setSubjects(next);
      setPicked((cur) => new Set([...cur].filter((k) => !k.startsWith(`${s}:`))));
      if (tab === s && next.length) setTab(next[0]);
    } else {
      setSubjects([...subjects, s].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)));
      setTab(s);
    }
  };
  const toggleChapter = (key) => setPicked((cur) => {
    const next = new Set(cur);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const setMany = (keys, on) => setPicked((cur) => {
    const next = new Set(cur);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    return next;
  });
  const chooseClass = (c) => {
    setClassLevel(c);
    if (c) setPicked((cur) => new Set([...cur].filter((k) => {
      const [s, id] = k.split(':');
      return chaptersOf(s).find((ch) => ch.id === id)?.class === c;
    })));
  };

  // How many questions the current choice can draw from, per subject.
  const pool = useMemo(() => {
    const out = {};
    for (const s of subjects) {
      const chosen = pickedIn(s);
      const list = chaptersOf(s).filter((c) => (!classLevel || c.class === classLevel) && (!chosen.length || chosen.includes(`${s}:${c.id}`)));
      out[s] = list.reduce((n, c) => n + c.count, 0);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, picked, classLevel, syllabus]);
  const poolTotal = Object.values(pool).reduce((a, b) => a + b, 0);
  const willGet = Math.min(count, poolTotal);

  async function start(body, key) {
    if (!user) return nav('/login?next=/practice');
    setBusy(key);
    setError(null);
    try {
      const r = await api('/tests/practice', { method: 'POST', body: { negative, ...body } });
      nav(`/test/${r.id}/take`);
    } catch (e) {
      setError({ from: key, error: e });
      setBusy(null);
    }
  }

  const custom = () => start({ mode: 'custom', subjects, syllabus: [...picked], classLevel: classLevel || undefined, count, difficulty: difficulty || undefined }, 'custom');

  const q = query.trim().toLowerCase();
  const units = (syllabus?.[tab]?.units || [])
    .map((u) => ({ ...u, chapters: u.chapters.filter((c) => (!classLevel || c.class === classLevel) && (!q || c.name.toLowerCase().includes(q))) }))
    .filter((u) => u.chapters.length);

  return (
    <main className="page">
      <h1 style={{ marginBottom: 4 }}>{t('Take a test')}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{t('Start a ready-made paper in one tap, or pick exactly the chapters you want to revise.')}</p>

      <section className="quick-grid">
        <QuickCard
          icon={<Icon.Rocket />} tone="accent" busy={busy === 'main'}
          title={t('Full JEE Main paper')}
          lines={[t('75 questions · 3 hours'), t('20 MCQ + 5 numerical per subject')]}
          onClick={() => start({ mode: 'jee-main' }, 'main')}
        />
        <QuickCard
          icon={<Icon.BookOpen />} tone="phy" busy={busy === 'c11'}
          title={t('Class 11 revision')}
          lines={[t('{n} questions · {m} min', { n: 30, m: minutes(30) }), t('All subjects, Class 11 chapters')]}
          onClick={() => start({ mode: 'custom', subjects: ['physics', 'chemistry', 'maths'], classLevel: 11, count: 30 }, 'c11')}
        />
        <QuickCard
          icon={<Icon.GraduationCap />} tone="math" busy={busy === 'c12'}
          title={t('Class 12 revision')}
          lines={[t('{n} questions · {m} min', { n: 30, m: minutes(30) }), t('All subjects, Class 12 chapters')]}
          onClick={() => start({ mode: 'custom', subjects: ['physics', 'chemistry', 'maths'], classLevel: 12, count: 30 }, 'c12')}
        />
        <QuickCard
          icon={<Icon.RotateCcw />} tone="bad" busy={busy === 'mistakes'}
          title={t('Revise my mistakes')}
          lines={user
            ? builder.data?.mistakes ? [t('{n} questions you got wrong', { n: builder.data.mistakes }), t('Up to 30 per test')] : [t('Nothing to revise yet'), t('Wrong answers collect here')]
            : [t('Questions you got wrong'), t('Log in to use this')]}
          disabled={user && !builder.data?.mistakes}
          onClick={() => start({ mode: 'mistakes', count: 30 }, 'mistakes')}
        />
        <WeakCard weak={builder.data?.weak} user={user} busy={busy === 'weak'} onStart={() => start({ mode: 'weak', count: 30 }, 'weak')} />
        <QuickCard
          icon={<Icon.CalendarDays />} tone="good" busy={busy === 'due'}
          title={t('Due for revision')}
          lines={user
            ? builder.data?.due ? [t('{n} questions due today', { n: builder.data.due }), t('Mistakes come back after 1, 3 and 7 days')] : [t('Nothing due today'), t('Mistakes come back after 1, 3 and 7 days')]
            : [t('Mistakes come back after 1, 3 and 7 days'), t('Log in to use this')]}
          disabled={user && !builder.data?.due}
          onClick={() => start({ mode: 'due', count: 30 }, 'due')}
        />
      </section>
      {error && error.from !== 'custom' && <ErrorBox error={error.error} />}

      <h2 className="section-title">{t('Build your own')}</h2>
      <div className="builder">
        <div className="card builder-main">
          <div className="builder-row">
            <div className="builder-subjects">
              {Object.entries(SUBJECT_LABEL).map(([k, v]) => {
                const I = SUBJECT_ICON[k];
                const on = subjects.includes(k);
                const n = pickedIn(k).length;
                return (
                  <button key={k} className={`subj-toggle ${k} ${on ? 'on' : ''}`} onClick={() => toggleSubject(k)} aria-pressed={on}>
                    <span className="ck">{on && <Icon.Check size={13} />}</span>
                    <I size={17} />
                    <span className="subj-name">{t(v)}</span>
                    <span className="subj-sub">{on ? (n ? chaptersLabel(t, n) : t('All chapters')) : t('Not included')}</span>
                  </button>
                );
              })}
            </div>
            <div className="seg" role="group" aria-label={t('Class')}>
              {[[0, t('Class 11 + 12')], [11, t('Class 11')], [12, t('Class 12')]].map(([c, label]) => (
                <button key={c} className={classLevel === c ? 'on' : ''} onClick={() => chooseClass(c)}>{label}</button>
              ))}
            </div>
          </div>

          {subjects.length > 0 && (
            <>
              <div className="picker-head">
                <div className="picker-tabs" role="tablist">
                  {subjects.map((s) => (
                    <button key={s} role="tab" aria-selected={tab === s} className={`tab ${tab === s ? 'on' : ''}`} onClick={() => setTab(s)}>
                      {t(SUBJECT_LABEL[s])} {pickedIn(s).length > 0 && <span className="tab-badge">{pickedIn(s).length}</span>}
                    </button>
                  ))}
                </div>
                <label className="picker-search">
                  <Icon.Search size={15} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Find a chapter')} />
                </label>
              </div>

              {builder.loading && !syllabus ? <Spinner /> : (
                <div className="units">
                  <p className="muted small" style={{ margin: '0 0 2px' }}>
                    {pickedIn(tab).length
                      ? t('Only the ticked chapters are used for {subject}.', { subject: t(SUBJECT_LABEL[tab]) })
                      : t('Nothing ticked: questions come from every {subject} chapter{cls}.', { subject: t(SUBJECT_LABEL[tab]), cls: classLevel ? ` (${t('Class {n}', { n: classLevel })})` : '' })}
                    {pickedIn(tab).length > 0 && <> <button className="linkish" onClick={() => setMany(pickedIn(tab), false)}>{t('Clear')}</button></>}
                  </p>
                  {units.map((u) => {
                    const keys = u.chapters.filter((c) => c.count).map((c) => `${tab}:${c.id}`);
                    const all = keys.length > 0 && keys.every((k) => picked.has(k));
                    const some = keys.some((k) => picked.has(k));
                    return (
                      <section key={u.name} className="unit">
                        <button className="unit-head" onClick={() => setMany(keys, !all)}>
                          <span className={`ck ${all ? 'on' : some ? 'some' : ''}`}>{all ? <Icon.Check size={13} /> : some ? <i /> : null}</span>
                          <span className="unit-name">{u.name}</span>
                          <span className="muted small">{u.chapters.reduce((n, c) => n + c.count, 0).toLocaleString('en-IN')} {t('questions')}</span>
                        </button>
                        <div className="unit-chapters">
                          {u.chapters.map((c) => {
                            const key = `${tab}:${c.id}`;
                            const on = picked.has(key);
                            return (
                              <button key={c.id} className={`chapter-opt ${on ? 'on' : ''}`} onClick={() => toggleChapter(key)} disabled={!c.count} aria-pressed={on}>
                                <span className={`ck ${on ? 'on' : ''}`}>{on && <Icon.Check size={13} />}</span>
                                <span className="chapter-name">{c.name}</span>
                                <span className="cls">{c.class}</span>
                                <span className="chapter-n">{c.count.toLocaleString('en-IN')}</span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                  {!units.length && <div className="empty">{t('No chapter matches “{q}”.', { q: query })}</div>}
                </div>
              )}
            </>
          )}
        </div>

        <aside className="card builder-side">
          <h3 style={{ margin: 0 }}>{t('Your test')}</h3>
          <ul className="summary-list">
            {subjects.length ? subjects.map((s) => {
              const I = SUBJECT_ICON[s];
              const n = pickedIn(s).length;
              return (
                <li key={s}>
                  <I size={15} className={`subj-ic ${s}`} />
                  <span>{t(SUBJECT_LABEL[s])}</span>
                  <span className="muted">{n ? chaptersLabel(t, n) : classLevel ? t('Class {n}', { n: classLevel }) : t('All chapters')}</span>
                </li>
              );
            }) : <li className="muted">{t('Pick at least one subject.')}</li>}
          </ul>

          <div className="side-field">
            <span>{t('Questions')}</span>
            <div className="seg full">
              {COUNTS.map((n) => <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>{n}</button>)}
            </div>
          </div>
          <div className="side-field">
            <span>{t('Difficulty')}</span>
            <div className="seg full">
              {[['', t('Mixed')], ['easy', t('Easy')], ['medium', t('Medium')], ['hard', t('Hard')]].map(([k, label]) => (
                <button key={k || 'mixed'} className={`${difficulty === k ? 'on' : ''} ${k}`} onClick={() => setDifficulty(k)}>{label}</button>
              ))}
            </div>
          </div>
          <label className="switch-row">
            <span>
              <b>{t('Negative marking')}</b>
              <span className="muted small">{negative ? t('+4 correct, −1 wrong (JEE Main)') : t('+4 correct, 0 wrong')}</span>
            </span>
            <input type="checkbox" className="switch" checked={negative} onChange={(e) => setNegative(e.target.checked)} />
          </label>

          <div className="side-total">
            <div><Icon.ListChecks size={16} /> <b>{difficulty ? count : willGet}</b> {t('questions')}</div>
            <div><Icon.Timer size={16} /> <b>{minutes(difficulty ? count : willGet || count)}</b> {t('min')}</div>
          </div>
          {syllabus && !difficulty && poolTotal < count && poolTotal > 0 && (
            <p className="small warn-text">{t('Only {n} questions match, so the test will be shorter.', { n: poolTotal })}</p>
          )}
          {error?.from === 'custom' && <ErrorBox error={error.error} />}
          <button className="btn primary lg block" onClick={custom} disabled={!!busy || !subjects.length || (syllabus && !poolTotal)}>
            {busy === 'custom' ? t('Building…') : <><Icon.Rocket /> {t('Start test')}</>}
          </button>
        </aside>
      </div>

      <div className="mobile-start">
        <span><b>{difficulty ? count : willGet}</b> {t('questions')} · {minutes(difficulty ? count : willGet || count)} {t('min')}</span>
        <button className="btn primary" onClick={custom} disabled={!!busy || !subjects.length || (syllabus && !poolTotal)}>
          {busy === 'custom' ? t('Building…') : <><Icon.Rocket /> {t('Start test')}</>}
        </button>
      </div>

      {user && (
        <div className="card flush" style={{ marginTop: 20 }}>
          <div style={{ padding: '16px 18px 0' }}><h3>{t('Your recent tests')}</h3></div>
          {mine.loading && !mine.data ? <Spinner /> : !mine.data?.length ? (
            <div className="empty">{t('No tests taken yet.')}</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('Test')}</th><th>{t('Date')}</th><th>{t('Score')}</th><th>{t('Rank')}</th></tr></thead>
                <tbody>
                  {mine.data.map((a) => (
                    <tr key={a.test.id}>
                      <td>
                        <Link to={a.submittedAt ? `/test/${a.test.id}/result` : `/test/${a.test.id}`}>{a.test.title}</Link>{' '}
                        <Pill>{t(a.test.kind)}</Pill>
                      </td>
                      <td className="small muted">{fmtDate(a.startedAt)}</td>
                      <td className="mono">{a.score === undefined ? (a.submittedAt ? t('pending') : t('in progress')) : `${a.score}/${a.maxScore}`}</td>
                      <td className="mono">{a.rank ? `#${a.rank}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

/** "Fix my weak spots": Pro builds a paper from the chapters the analysis marks weak; free sees how many. */
function WeakCard({ weak, user, busy, onStart }) {
  const t = useT();
  const nav = useNavigate();
  const names = weak?.chapters?.map((c) => c.chapter) || [];
  if (weak?.locked) {
    return (
      <QuickCard
        icon={<Icon.Target />} tone="warn" title={t('Fix my weak spots')} pro
        lines={[weak.count ? t('{n} chapters need work', { n: weak.count }) : t('Built from your analysis'), t('A paper from your weakest chapters')]}
        go={<><Icon.Crown size={14} /> {t('Unlock with Pro')}</>}
        onClick={() => nav('/pro')}
      />
    );
  }
  return (
    <QuickCard
      icon={<Icon.Target />} tone="warn" busy={busy} title={t('Fix my weak spots')} pro
      lines={!user ? [t('A paper from your weakest chapters'), t('Log in to use this')]
        : names.length ? [names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : ''), t('30 new questions from these chapters')]
          : [t('Not enough data yet'), t('Try 5+ questions in a few chapters')]}
      disabled={user && !names.length}
      onClick={onStart}
    />
  );
}

function QuickCard({ icon, tone, title, lines, onClick, busy, disabled, pro, go }) {
  const t = useT();
  return (
    <button className={`quick-card ${tone}`} onClick={onClick} disabled={busy || disabled}>
      <span className="quick-ic">{icon}</span>
      <span className="quick-title">{title}{pro && <span className="pill pro" style={{ marginLeft: 6, verticalAlign: 2 }}>Pro</span>}</span>
      {lines.map((l, i) => <span key={i} className={i ? 'muted small' : 'quick-line'}>{l}</span>)}
      <span className="quick-go">{busy ? t('Building…') : go || <>{t('Start')} <Icon.ArrowRight size={15} /></>}</span>
    </button>
  );
}
