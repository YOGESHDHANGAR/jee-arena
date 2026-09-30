import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useTitle, useNow, fmtCountdown } from '../lib/hooks.js';
import { ErrorBox, Spinner } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Icon } from '../components/Icon.jsx';
import { useT } from '../lib/i18n.jsx';

export default function Leaderboard() {
  useTitle('Rankings', 'All-India JEE Arena rankings by contest rating and questions solved.');
  const [by, setBy] = useState('week');
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi(by === 'week' ? '/leaderboard/week' : '/leaderboard', { query: by === 'week' ? { page } : { by, page } });
  const now = useNow(30000);
  const { user } = useAuth();
  const t = useT();
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;

  return (
    <main className="page narrow">
      <div className="spread">
        <h1 style={{ margin: 0 }}>{t('All-India ranks')}</h1>
        {data?.me && <span className="pill pro">{t('Your rank:')} #{data.me.rank.toLocaleString('en-IN')}{by === 'week' ? ` · ${t('{n} solved', { n: data.me.solvedThisWeek })}` : ''}</span>}
      </div>
      <div className="tabs" style={{ marginTop: 16 }}>
        <button className={`tab ${by === 'week' ? 'on' : ''}`} onClick={() => { setBy('week'); setPage(1); }}><Icon.CalendarDays /> {t('This week')}</button>
        <button className={`tab ${by === 'rating' ? 'on' : ''}`} onClick={() => { setBy('rating'); setPage(1); }}><Icon.Trophy /> {t('Contest rating')}</button>
        <button className={`tab ${by === 'solved' ? 'on' : ''}`} onClick={() => { setBy('solved'); setPage(1); }}><Icon.ListChecks /> {t('Most solved')}</button>
      </div>
      <ErrorBox error={error} />
      {by === 'week' && data?.resetsAt && (
        <>
          <p className="muted small" style={{ margin: '0 0 12px' }}>
            {t('Questions solved since Monday. Everyone starts from zero each week — resets {when} (Monday 12:00 am IST).', { when: fmtCountdown(new Date(data.resetsAt) - now, t) })}
          </p>
          {data.lastWeek?.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="muted small" style={{ fontWeight: 600, marginBottom: 6 }}>{t("Last week's top solvers")}</div>
              <div className="row" style={{ gap: 18 }}>
                {data.lastWeek.map((u, i) => (
                  <Link key={u.id} to={`/u/${u.username}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <Icon.Medal className={`medal m${i + 1}`} size={18} /> <b>{u.name}</b> <span className="muted small">{t('{n} solved', { n: u.solvedThisWeek })}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {loading && !data ? <Spinner /> : by === 'week' && data?.items ? (
        !data.items.length ? (
          <div className="card empty">{t('Nobody has solved anything this week yet.')} <Link to="/problems">{t('Be first on the board')} <Icon.ArrowRight size={13} /></Link></div>
        ) : (
          <div className="card flush table-wrap">
            <table className="table">
              <thead><tr><th>#</th><th>{t('Student')}</th><th>{t('Solved this week')}</th><th className="hide-sm">{t('Rating')}</th><th className="hide-sm">{t('Streak')}</th></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} style={u.username === user?.username ? { background: 'var(--accent-2)' } : undefined}>
                    <td className="mono"><b>{u.rank <= 3 ? <Icon.Medal className={`medal m${u.rank}`} size={18} title={`#${u.rank}`} /> : u.rank}</b></td>
                    <td><Link to={`/u/${u.username}`}><b style={{ fontWeight: 550 }}>{u.name}</b></Link> <span className="muted small">@{u.username}</span></td>
                    <td className="mono"><b>{u.solvedThisWeek}</b></td>
                    <td className="mono hide-sm">{u.rating}</td>
                    <td className="mono hide-sm">{u.streak ? <span className="streak"><Icon.Flame size={14} fill /> {u.streak}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : !data?.items.length ? (
        <div className="card empty">{by === 'rating' ? t('Ratings appear after the first rated contest.') : t('No one has solved anything yet — be the first.')}</div>
      ) : (
        <div className="card flush table-wrap">
          <table className="table">
            <thead>
              <tr><th>#</th><th>{t('Student')}</th><th>{t('Rating')}</th><th>{t('Solved')}</th><th className="hide-sm">{t('Contests')}</th><th className="hide-sm">{t('Streak')}</th></tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id}>
                  <td className="mono"><b>{u.rank}</b></td>
                  <td><Link to={`/u/${u.username}`}><b style={{ fontWeight: 550 }}>{u.name}</b></Link> <span className="muted small">@{u.username}</span></td>
                  <td className="mono">{u.rating}</td>
                  <td className="mono">{u.solvedCount}</td>
                  <td className="mono hide-sm">{u.contestsPlayed}</td>
                  <td className="mono hide-sm">{u.streak ? <span className="streak"><Icon.Flame size={14} fill /> {u.streak}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><Icon.ChevronLeft /> {t('Previous')}</button>
          <span className="muted small">{t('Page {a} of {b}', { a: page, b: pages })}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('Next')} <Icon.ChevronRight /></button>
        </div>
      )}
    </main>
  );
}
