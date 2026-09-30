import { lazy, Suspense, useMemo } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Analysis } from '../components/Analysis.jsx';
// My journey is loaded only when opened (it also brings the college data).
const Insights = lazy(() => import('../components/Insights.jsx').then((m) => ({ default: m.Insights })));
import { Icon } from '../components/Icon.jsx';
import { useApi, SUBJECT_LABEL, fmtDate, useTitle } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { useT } from '../lib/i18n.jsx';

const SUBJ_VAR = { physics: 'phy', chemistry: 'chem', maths: 'math' };

export default function Profile() {
  const { username } = useParams();
  const { user: me } = useAuth();
  const { data, error, loading } = useApi(`/users/${username}`);
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');
  useTitle(data?.user ? `${data.user.name} (@${data.user.username})` : error ? t('Profile') : undefined);

  if (loading && !data) return <Spinner />;
  if (error) return <main className="page narrow"><ErrorBox error={error} /></main>;
  const { user: u, totals, ratingHistory, activity, chapterStats, weak } = data;
  const isMe = me?.username === u.username;
  // Your own analysis and journey live on the Progress page; admins can still open another student's here.
  const canAnalyse = !isMe && me?.role === 'admin';
  if (isMe && (tab === 'analysis' || tab === 'journey')) return <Navigate to={`/progress?tab=${tab}`} replace />;

  return (
    <main className="page">
      <div className="spread" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>{u.name}</h1>
          <div className="muted">
            @{u.username} · {t('joined')} {new Date(u.joinedAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
            {u.targetYear ? ` · JEE ${u.targetYear}` : ''}
          </div>
        </div>
        {isMe && (
          <div className="row">
            <Link className="btn primary" to="/progress"><Icon.ChartColumn /> {t('My progress')}</Link>
            <Link className="btn" to="/problems?status=bookmarked"><Icon.Bookmark /> {t('Bookmarks')}</Link>
            <Link className="btn" to="/problems?status=attempted"><Icon.CircleX /> {t('My mistakes')}</Link>
            <Link className="btn" to="/practice"><Icon.Target /> {t('Take a custom test')}</Link>
          </div>
        )}
      </div>

      {canAnalyse && (
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button className={`tab ${tab !== 'analysis' && tab !== 'journey' ? 'on' : ''}`} onClick={() => setParams({})}><Icon.User /> {t('Overview')}</button>
          <button className={`tab ${tab === 'analysis' ? 'on' : ''}`} onClick={() => setParams({ tab: 'analysis' })}><Icon.ChartColumn /> {t('My analysis')}</button>
          <button className={`tab ${tab === 'journey' ? 'on' : ''}`} onClick={() => setParams({ tab: 'journey' })}><Icon.Route /> {t('My journey')}</button>
        </div>
      )}
      {canAnalyse && tab === 'journey' ? (
        <Suspense fallback={<Spinner />}><Insights username={u.username} /></Suspense>
      ) : canAnalyse && tab === 'analysis' ? (
        <Analysis username={u.username} />
      ) : (
      <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card stat"><b>{u.rating}</b><span>{t('contest rating')}{u.globalRank ? ` · ${t('#{n} in India', { n: u.globalRank.toLocaleString('en-IN') })}` : ''}</span></div>
        <div className="card stat"><b>{u.solvedCount}</b><span>{t('questions solved')}</span></div>
        <div className="card stat"><b>{u.contestsPlayed}</b><span>{t('contests')}</span></div>
        <div className="card stat"><b className="streak"><Icon.Flame size={22} fill /> {u.streak.current || 0}</b><span>{t('day streak')} · {t('best {n}', { n: u.streak.best || 0 })}</span></div>
      </div>
      {(u.solutionsAccepted > 0 || u.referrals > 0) && (
        <div className="row" style={{ marginBottom: 16 }}>
          {u.solutionsAccepted > 0 && <span className="pill good"><Icon.CircleCheck size={12} /> {t('{n} official solutions written', { n: u.solutionsAccepted })}</span>}
          {u.referrals > 0 && <span className="pill pro"><Icon.UserPlus size={12} /> {t('invited {n} friends', { n: u.referrals })}</span>}
        </div>
      )}

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3 className="with-icon"><Icon.Layers /> {t('Solved by subject')}</h3>
          <div className="stack">
            {['physics', 'chemistry', 'maths'].map((s) => {
              const n = u.solvedBySubject?.[s] || 0;
              const tot = totals[s] || 0;
              return (
                <div key={s}>
                  <div className="spread small"><b>{t(SUBJECT_LABEL[s])}</b><span className="mono">{n} / {tot}</span></div>
                  <div className="bar"><i style={{ width: `${tot ? (100 * n) / tot : 0}%`, background: `var(--${SUBJ_VAR[s]})` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <h3 className="with-icon"><Icon.TrendingUp /> {t('Rating')}</h3>
          {ratingHistory.length ? <RatingChart points={ratingHistory} /> : <p className="muted small">{t('No rated contests yet.')}</p>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="spread"><h3 style={{ margin: 0 }} className="with-icon"><Icon.CalendarDays /> {t('Activity')}</h3><span className="muted small">{t('{n} submissions in the last year', { n: activity.reduce((s, a) => s + a.count, 0) })}</span></div>
        <Heatmap activity={activity} />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3 className="with-icon"><Icon.TriangleAlert /> {t('Needs work')}</h3>
          {weak.length ? (
            <div className="stack">
              {weak.map((c) => (
                <div key={c.subject + c.chapter} className="spread">
                  <div>
                    <Link to={`/problems?subject=${c.subject}&chapter=${c.slug}`}><b style={{ fontWeight: 550 }}>{c.chapter}</b></Link>{' '}
                    <Pill kind={c.subject}>{t(SUBJECT_LABEL[c.subject])}</Pill>
                  </div>
                  <span className="mono small" style={{ color: 'var(--bad)' }}>{c.accuracy}% {t('first-try')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">{t('Attempt at least 3 questions in a chapter to see weak spots here.')}</p>
          )}
        </div>
        <div className="card flush">
          <div style={{ padding: '16px 18px 0' }}><h3>{t('Chapters')}</h3></div>
          {chapterStats.length ? (
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="table">
                <thead><tr><th>{t('Chapter')}</th><th>{t('Solved')}</th><th>{t('First-try')}</th></tr></thead>
                <tbody>
                  {chapterStats.sort((a, b) => b.attempted - a.attempted).map((c) => (
                    <tr key={c.subject + c.chapter}>
                      <td><Link to={`/${c.subject}/${c.slug}`} className="plain-link">{c.chapter}</Link> <span className={`pill ${c.subject}`}>{t(SUBJECT_LABEL[c.subject])[0]}</span></td>
                      <td className="mono">{c.solved}/{c.attempted}</td>
                      <td>
                        <div className="acc-cell">
                          <span className="mono">{c.accuracy}%</span>
                          <span className="acc-bar"><i style={{ width: `${c.accuracy}%`, background: c.accuracy >= 70 ? 'var(--good)' : c.accuracy >= 45 ? 'var(--warn)' : 'var(--bad)' }} /></span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty">{t('Nothing yet.')}</div>}
        </div>
      </div>
      </>
      )}
    </main>
  );
}

function Heatmap({ activity }) {
  const cells = useMemo(() => {
    const map = new Map(activity.map((a) => [a.day, a.count]));
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 364 - start.getDay()); // begin on a Sunday
    const out = [];
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
      const n = map.get(key) || 0;
      out.push({ key, n, lvl: n === 0 ? 0 : n < 3 ? 1 : n < 6 ? 2 : n < 12 ? 3 : 4 });
    }
    return out;
  }, [activity]);
  return (
    <div className="heat" style={{ marginTop: 12 }}>
      {cells.map((c) => <i key={c.key} className={c.lvl ? `l${c.lvl}` : ''} title={`${c.key}: ${c.n}`} />)}
    </div>
  );
}

function RatingChart({ points }) {
  const W = 480;
  const H = 150;
  const P = 28;
  const ys = points.map((p) => p.rating);
  const min = Math.min(...ys, 1500) - 40;
  const max = Math.max(...ys, 1500) + 40;
  const x = (i) => P + (points.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (points.length - 1));
  const y = (v) => H - P / 2 - ((v - min) / (max - min)) * (H - P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Rating history, now ${last.rating}`}>
      <line x1={P} x2={W - P} y1={y(1500)} y2={y(1500)} stroke="var(--border)" strokeDasharray="4 4" />
      <text x={2} y={y(1500) + 4} fontSize="10" fill="var(--muted)">1500</text>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.rating)} r="3.5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2">
          <title>{`${p.title}: ${p.rating} (${p.delta >= 0 ? '+' : ''}${p.delta}), rank #${p.rank} · ${fmtDate(p.at)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
