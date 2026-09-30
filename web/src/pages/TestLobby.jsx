import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, useNow, fmtCountdown, fmtDate, fmtDuration, useTitle } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import { useT } from '../lib/i18n.jsx';

// Keys are translated with tr() where shown.
const SCHEME_TEXT = {
  jee_main: '+4 for correct, −1 for wrong (MCQ and numerical), 0 if left blank.',
  jee_adv: 'Single-correct +3/−1. Multi-correct +4 full, partial +1 per correct option, −2 if any wrong option. Numerical +4/0.',
  practice: '+4 for correct, no negative marking.',
};

export default function TestLobby() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const tr = useT(); // `t` is the test in this file
  const now = useNow(1000);
  const { data: t, error, loading, reload } = useApi(`/tests/${id}`, {}, [user?.id]);
  const [tab, setTab] = useState('info');
  useTitle(t ? t.title : error ? tr('Test not found') : undefined, t?.description || undefined);

  // Flip to "live" by itself when the start time arrives.
  useEffect(() => {
    if (t?.state !== 'upcoming' || !t.startAt) return;
    const ms = new Date(t.startAt) - Date.now();
    if (ms > 864e5) return;
    const timer = setTimeout(reload, Math.max(500, ms + 500));
    return () => clearTimeout(timer);
  }, [t, reload]);

  if (loading && !t) return <Spinner />;
  if (error) return <main className="page narrow"><ErrorBox error={error} /></main>;

  const startsIn = t.startAt ? new Date(t.startAt) - now : 0;
  const canStart = t.state !== 'upcoming' && t.state !== 'ended' && !t.mine?.submitted;
  const showBoard = t.kind === 'mock' || t.state === 'ended';

  return (
    <main className="page narrow">
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <Pill>{tr(t.kind === 'contest' ? 'Contest' : t.kind === 'mock' ? 'Mock test' : 'Custom test')}</Pill>
        {t.state === 'live' && <Pill kind="live">{tr('Live')}</Pill>}
        {t.rated && <Pill>{tr('Rated')}</Pill>}
        {t.premium && <Pill kind="pro">Pro</Pill>}
      </div>
      <h1>{t.title}</h1>
      {t.description && <p className="muted">{t.description}</p>}

      {showBoard && (
        <div className="tabs">
          <button className={`tab ${tab === 'info' ? 'on' : ''}`} onClick={() => setTab('info')}>{tr('Overview')}</button>
          <button className={`tab ${tab === 'board' ? 'on' : ''}`} onClick={() => setTab('board')}>{tr('Leaderboard')}</button>
        </div>
      )}

      {tab === 'board' && showBoard ? (
        <Board id={id} />
      ) : (
        <div className="stack">
          <div className="card grid grid-4">
            <div className="stat"><b>{t.questionCount}</b><span>{tr('questions')}</span></div>
            <div className="stat"><b>{t.durationMin}</b><span>{tr('minutes')}</span></div>
            {t.startAt && <div className="stat"><b style={{ fontSize: '1.05rem' }}>{fmtDate(t.startAt)}</b><span>{tr('starts')}</span></div>}
            {t.endAt && <div className="stat"><b style={{ fontSize: '1.05rem' }}>{fmtDate(t.endAt)}</b><span>{tr('window closes')}</span></div>}
            {!!t.participants && <div className="stat"><b>{t.participants.toLocaleString('en-IN')}</b><span>{tr('participants')}</span></div>}
          </div>

          <div className="card">
            <h3 className="with-icon"><Icon.Info /> {tr('Rules')}</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>{tr('Marking:')} {tr(SCHEME_TEXT[t.scheme] || SCHEME_TEXT.jee_main)}</li>
              <li>{tr('The timer starts when you press Start and does not pause. Answers save automatically.')}</li>
              {t.kind === 'contest' && <li>{tr('Rank is by score, then by less time taken. Results and solutions open when the contest window closes.')}</li>}
              {t.kind === 'contest' && t.rated && <li>{tr('Your rating updates after the contest ends.')}</li>}
              <li>{tr("Don't open the paper in two tabs — the last save wins.")}</li>
            </ul>
          </div>

          <div className="card" style={{ textAlign: 'center' }}>
            {!user ? (
              <Link className="btn primary lg" to={`/login?next=/test/${id}`}>{tr('Log in to take this test')}</Link>
            ) : t.mine?.submitted ? (
              <>
                <p>{tr("You've submitted this test.")}</p>
                <Link className="btn primary lg" to={`/test/${id}/result`}>
                  {t.kind === 'contest' && t.state !== 'ended' ? tr('Results open when the contest ends') : tr('View result & solutions')}
                </Link>
              </>
            ) : t.state === 'upcoming' ? (
              <div className="stat" style={{ alignItems: 'center' }}>
                <span>{tr('Starts')}</span>
                <b className="mono">{startsIn > 864e5 ? fmtCountdown(startsIn, tr) : fmtDuration(startsIn / 1000)}</b>
              </div>
            ) : t.state === 'ended' ? (
              <p className="muted" style={{ margin: 0 }}>{tr('This contest has ended. Its questions are back in the problem list for practice.')}</p>
            ) : canStart ? (
              <button className="btn primary lg" onClick={() => nav(`/test/${id}/take`)}>
                <Icon.Rocket /> {t.mine?.started ? tr('Resume test') : tr('Start test')}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}

function Board({ id }) {
  const [page, setPage] = useState(1);
  const { user } = useAuth();
  const t = useT();
  const { data, error, loading } = useApi(`/tests/${id}/leaderboard`, { query: { page } });
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (data.pending) return <div className="card empty">{t('The leaderboard appears when the contest ends.')}</div>;
  if (!data.items.length) return <div className="card empty">{t('No submissions yet.')}</div>;
  const pages = Math.ceil(data.total / 50);
  return (
    <>
      <div className="card flush table-wrap">
        <table className="table">
          <thead>
            <tr><th>{t('Rank')}</th><th>{t('Student')}</th><th>{t('Score')}</th><th className="hide-sm">✓ / ✗</th><th>{t('Time')}</th><th>Δ {t('Rating')}</th></tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.username} style={r.username === user?.username ? { background: 'var(--accent-2)' } : undefined}>
                <td className="mono"><b>{r.rank}</b></td>
                <td><Link to={`/u/${r.username}`}>{r.name}</Link> <span className="muted small">@{r.username}</span></td>
                <td className="mono">{r.score}<span className="muted">/{r.maxScore}</span></td>
                <td className="hide-sm mono small">{r.correct} / {r.wrong}</td>
                <td className="mono small">{fmtDuration(r.timeTakenSec)}</td>
                <td className="mono small" style={{ color: r.ratingDelta > 0 ? 'var(--good)' : r.ratingDelta < 0 ? 'var(--bad)' : undefined }}>
                  {r.ratingDelta === undefined || r.ratingDelta === null ? '—' : `${r.ratingDelta > 0 ? '+' : ''}${r.ratingDelta}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><Icon.ChevronLeft /> {t('Previous')}</button>
          <span className="muted small">{t('Page {a} of {b}', { a: page, b: pages })}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('Next')} <Icon.ChevronRight /></button>
        </div>
      )}
    </>
  );
}
