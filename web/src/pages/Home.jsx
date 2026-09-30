import { Link } from 'react-router-dom';
import { useApi, useNow, fmtCountdown, fmtDate, SUBJECT_LABEL, TYPE_LABEL, useTitle } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { Pill } from '../components/Layout.jsx';
import { Rich } from '../components/Rich.jsx';
import { Icon } from '../components/Icon.jsx';

const SUBJECT_ICON = { physics: <Icon.Atom size={18} />, chemistry: <Icon.FlaskConical size={18} />, maths: <Icon.Sigma size={18} /> };
import { useLang, useT } from '../lib/i18n.jsx';

export default function Home() {
  const { user } = useAuth();
  const t = useT();
  const meta = useApi('/problems/meta');
  const contests = useApi('/tests', { query: { kind: 'contest' } });
  const potd = useApi('/problems/potd', {}, [user?.id]);
  const now = useNow(1000);
  useTitle(null);

  const list = contests.data || [];
  const live = list.filter((c) => c.state === 'live');
  const upcoming = list.filter((c) => c.state === 'upcoming').sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const next = live[0] || upcoming[0];

  return (
    <main className="page">
      {user ? <Dashboard user={user} /> : (
      <section className="hero">
        <h1>{t('Practise JEE questions, compete every week, and know exactly where you stand.')}</h1>
        <p>
          {t('Solve {n} Physics, Chemistry and Maths questions with instant checking and solutions. Take timed contests with real JEE marking and earn an All-India rating.', { n: meta.data?.total ? meta.data.total.toLocaleString('en-IN') : t('thousands of') })}
        </p>
        <div className="row" style={{ marginTop: 18 }}>
          <Link to="/problems" className="btn primary lg">{t('Start solving')} <Icon.ArrowRight /></Link>
          {!user && <Link to="/register" className="btn lg"><Icon.UserPlus /> {t('Create free account')}</Link>}
          {user && <Link to="/practice" className="btn lg"><Icon.Target /> {t('Build a custom test')}</Link>}
          {user && <Link to="/progress?tab=analysis" className="btn lg ghost"><Icon.ChartColumn /> {t('My analysis')}</Link>}
        </div>
      </section>
      )}

      {potd.data?.question && <PotdCard data={potd.data} loggedIn={!!user} />}

      {next && (
        <Link to={`/test/${next.slug || next.id}`} className="card" style={{ display: 'block', textDecoration: 'none', marginBottom: 24, borderColor: 'var(--accent)' }}>
          <div className="spread">
            <div>
              <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                {next.state === 'live' ? <Pill kind="live">{t('Live now')}</Pill> : <Pill><Icon.CalendarDays size={12} /> {t('Next contest')}</Pill>}
                {next.rated && <Pill>{t('Rated')}</Pill>}
              </div>
              <h2 style={{ margin: 0 }}>{next.title}</h2>
              <div className="muted small">
                {fmtDate(next.startAt)} · {t('{n} questions', { n: next.questionCount })} · {t('{n} min', { n: next.durationMin })}
              </div>
            </div>
            <div className="btn primary">
              {next.state === 'live' ? t('Enter contest') : t('Starts {when}', { when: fmtCountdown(new Date(next.startAt) - now, t) })}
            </div>
          </div>
        </Link>
      )}

      <div className="grid grid-3">
        {['physics', 'chemistry', 'maths'].map((s) => {
          const chapters = (meta.data?.subjects?.[s]?.units || []).flatMap((u) => u.chapters).filter((c) => c.count);
          const total = meta.data?.subjects?.[s]?.total || 0;
          return (
            <div key={s} className={`card subject-card ${s}`}>
              <Link to={`/${s}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <h3 className="row" style={{ gap: 8 }}><span className={`subject-icon ${s}`}>{SUBJECT_ICON[s]}</span>{t(SUBJECT_LABEL[s])}</h3>
              <div className="muted small">{t('{n} questions', { n: total.toLocaleString('en-IN') })} · {t('{n} chapters', { n: chapters.length })}</div>
              </Link>
              <div className="chips" style={{ marginTop: 12 }}>
                {chapters
                  .slice()
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 4)
                  .map((c) => <Link key={c.id} to={`/${s}/${c.id}`} className="pill" style={{ textDecoration: 'none' }}>{c.chapter}</Link>)}
                <Link to={`/${s}`} className="pill" style={{ textDecoration: 'none' }}>{t('All chapters')} <Icon.ArrowRight size={12} /></Link>
              </div>
            </div>
          );
        })}
      </div>

      {!user && (
      <div className="grid grid-3" style={{ marginTop: 24 }}>
        <div className="card">
          <div className="feature-icon"><Icon.ListChecks size={20} /></div>
          <h3>{t('Solve like LeetCode')}</h3>
          <p className="muted small">{t('Filter by chapter, difficulty and PYQ year. Instant right/wrong, step-by-step solutions, streaks and a solved-heatmap.')}</p>
        </div>
        <div className="card">
          <div className="feature-icon"><Icon.Trophy size={20} /></div>
          <h3>{t('Weekly rated contests')}</h3>
          <p className="muted small">{t('Real +4/−1 marking. Your rating moves with every contest, so you always know your standing against other aspirants.')}</p>
        </div>
        <div className="card">
          <div className="feature-icon"><Icon.ClipboardList size={20} /></div>
          <h3>{t('Full mock tests')}</h3>
          <p className="muted small">{t('75-question JEE Main papers in an exam-style interface, with subject-wise analysis and All-India rank.')}</p>
        </div>
      </div>
      )}
    </main>
  );
}

/** Logged-in home: a greeting, today's numbers, and four places to pick up from. */
function Dashboard({ user }) {
  const t = useT();
  const { data: d } = useApi('/users/me/today', {}, [user.id]);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  const hello = hour >= 5 && hour < 12 ? t('Good morning') : hour >= 12 && hour < 17 ? t('Good afternoon') : t('Good evening');
  const first = (d?.name || user.name || '').split(' ')[0];
  const solvedToday = d?.today.solved || 0;
  const streak = d?.streak?.current || 0;
  return (
    <section className="dash">
      <div className="dash-head">
        <div>
          <h1>{hello}, {first} <span className="wave">👋</span></h1>
          <p className="muted">
            {!d ? '\u00a0' : solvedToday
              ? t('{n} solved today. Nice work, keep it rolling.', { n: solvedToday })
              : streak
                ? t('Solve one question today to keep your {n}-day streak.', { n: streak })
                : t('Start a streak today: one question is enough.')}
          </p>
        </div>
        <div className="dash-stats">
          <div className={`dash-stat ${streak ? 'hot' : ''}`}><Icon.Flame fill={streak > 0} /><b>{streak}</b><span>{t('day streak')}</span></div>
          <div className="dash-stat"><Icon.CircleCheck /><b>{d?.solvedCount ?? '–'}</b><span>{t('solved')}</span></div>
          <div className="dash-stat"><Icon.Target /><b>{d?.accuracy ?? '–'}{d?.accuracy !== null && d?.accuracy !== undefined ? '%' : ''}</b><span>{t('first-try')}</span></div>
        </div>
      </div>

      <div className="dash-grid">
        {d?.continueAt ? (
          <Link to={`/problems?subject=${d.continueAt.subject}&chapter=${d.continueAt.slug}&status=todo`} className="dash-card accent">
            <span className="dash-ic"><Icon.ArrowRight /></span>
            <span className="dash-k">{t('Continue')}</span>
            <b>{d.continueAt.chapter}</b>
            <span className="muted small">{t('Questions you have not tried yet')}</span>
          </Link>
        ) : (
          <Link to="/problems" className="dash-card accent">
            <span className="dash-ic"><Icon.ArrowRight /></span>
            <span className="dash-k">{t('Start here')}</span>
            <b>{t('Pick any chapter')}</b>
            <span className="muted small">{t('Instant checking and solutions')}</span>
          </Link>
        )}
        <Link to={d?.due ? '/problems?status=due' : '/problems?status=attempted'} className={`dash-card ${d?.due ? 'good' : ''}`}>
          <span className="dash-ic"><Icon.CalendarDays /></span>
          <span className="dash-k">{t('Revision')}</span>
          <b>{d?.due ? t('{n} due today', { n: d.due }) : d?.mistakesOpen ? t('{n} mistakes to fix', { n: d.mistakesOpen }) : t('All caught up')}</b>
          <span className="muted small">{t('Mistakes come back after 1, 3 and 7 days')}</span>
        </Link>
        {d?.weakest ? (
          <Link to={`/problems?subject=${d.weakest.subject}&chapter=${d.weakest.slug}&difficulty=easy&status=todo`} className="dash-card bad">
            <span className="dash-ic"><Icon.TriangleAlert /></span>
            <span className="dash-k">{t('Weakest chapter')}</span>
            <b>{d.weakest.chapter}</b>
            <span className="muted small">{t('{p}% right on the first try. Start with easy ones.', { p: d.weakest.accuracy })}</span>
          </Link>
        ) : (
          <Link to="/progress?tab=analysis" className="dash-card">
            <span className="dash-ic"><Icon.ChartColumn /></span>
            <span className="dash-k">{t('My analysis')}</span>
            <b>{t('Strong and weak chapters')}</b>
            <span className="muted small">{t('Try 5+ questions in a few chapters')}</span>
          </Link>
        )}
        <Link to="/practice" className="dash-card">
          <span className="dash-ic"><Icon.Timer /></span>
          <span className="dash-k">{t('Take a test')}</span>
          <b>{t('Timed paper, JEE marking')}</b>
          <span className="muted small">{t('Full paper, a class, or your own chapters')}</span>
        </Link>
      </div>
    </section>
  );
}

/** Problem of the Day, pinned on the home page. */
function PotdCard({ data, loggedIn }) {
  const q = data.question;
  const t = useT();
  const { lang } = useLang();
  const solved = data.mine?.status === 'solved';
  const streak = data.mine?.streak;
  const date = new Date(`${data.day}T00:00:00+05:30`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
  return (
    <Link to={`/problems/${q.qid}`} className="card potd" style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginBottom: 24 }}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: '1 1 300px' }}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <Pill kind="pro"><Icon.Sparkles size={12} /> {t('Problem of the Day')}</Pill>
            <span className="muted small">{date}</span>
            <Pill kind={q.subject}>{t(SUBJECT_LABEL[q.subject])}</Pill>
            <Pill kind={q.difficulty}>{t(q.difficulty)}</Pill>
            <Pill>{t(TYPE_LABEL[q.type])}</Pill>
            {q.pyq && <Pill>{q.pyq.exam} {q.pyq.year}</Pill>}
          </div>
          <div className="muted small" style={{ fontWeight: 600 }}>{q.chapter}{q.topic ? ` · ${q.topic}` : ''}</div>
          <Rich text={q.preview} className="potd-preview" />
          <div className="muted small" style={{ marginTop: 6 }}>
            {q.attempts ? t('{n} tried · {p}% got it right', { n: q.attempts.toLocaleString('en-IN'), p: q.acceptance }) : t('Be the first to solve it today')}
          </div>
        </div>
        <div className="stack" style={{ textAlign: 'right', minWidth: 150 }}>
          <span className={`btn ${solved ? 'good' : 'primary'}`}>{solved ? <><Icon.CircleCheck /> {t('Solved today')}</> : <>{t('Solve now')} <Icon.ArrowRight /></>}</span>
          {loggedIn ? (
            <div className="small">
              <b className="streak"><Icon.Flame fill /> {streak?.current || 0}</b> <span className="muted">{t('day POTD streak')}{streak?.best ? ` · ${t('best {n}', { n: streak.best })}` : ''}</span>
            </div>
          ) : (
            <div className="muted small">{t('Log in to keep a streak')}</div>
          )}
        </div>
      </div>
    </Link>
  );
}
