import { lazy, Suspense } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Analysis } from '../components/Analysis.jsx';
import { Spinner } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useTitle } from '../lib/hooks.js';
import { useT } from '../lib/i18n.jsx';
import Leaderboard from './Leaderboard.jsx';

// My journey is loaded only when opened (it also brings the college data).
const Insights = lazy(() => import('../components/Insights.jsx').then((m) => ({ default: m.Insights })));

/**
 * Progress (the "Ranks" section in the nav): the student's own insights and analysis next to the
 * All-India ranks. /leaderboard opens straight on the ranks tab; logged-out visitors only see ranks.
 */
const TABS = ['journey', 'analysis', 'ranks'];

export default function Progress() {
  const { user, ready } = useAuth();
  const t = useT();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab = TABS.includes(asked) ? asked : pathname === '/leaderboard' || !user ? 'ranks' : 'journey';
  useTitle(tab === 'ranks' ? t('All-India ranks') : t('My progress'));
  if (!ready) return <Spinner />;
  const needLogin = !user && tab !== 'ranks';

  return (
    <main className="page">
      <h1 style={{ marginBottom: 8 }}>{t('My progress')}</h1>
      <div className="tabs progress-tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'journey' ? 'on' : ''}`} onClick={() => setParams({ tab: 'journey' })}><Icon.Route /> {t('My journey')}</button>
        <button className={`tab ${tab === 'analysis' ? 'on' : ''}`} onClick={() => setParams({ tab: 'analysis' })}><Icon.ChartColumn /> {t('My analysis')}</button>
        <button className={`tab ${tab === 'ranks' ? 'on' : ''}`} onClick={() => setParams({ tab: 'ranks' })}><Icon.Trophy /> <span className="hide-sm">{t('All-India ranks')}</span><span className="show-sm">{t('Ranks')}</span></button>
      </div>
      {needLogin ? (
        <div className="card empty stack">
          <div className="empty-icon"><Icon.ChartColumn size={26} /></div>
          <h3 style={{ margin: 0 }}>{t('Log in to see your progress')}</h3>
          <p className="muted small" style={{ margin: 0 }}>{t('Your predicted score, the colleges it could get, your strong and weak chapters and what to study next.')}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn primary" to={`/login?next=${encodeURIComponent(`/progress?tab=${tab}`)}`}>{t('Log in')}</Link>
            <Link className="btn" to="/register">{t('Sign up')}</Link>
          </div>
        </div>
      ) : tab === 'journey' ? (
        <Suspense fallback={<Spinner />}><Insights username={user.username} /></Suspense>
      ) : tab === 'analysis' ? (
        <Analysis username={user.username} />
      ) : (
        <Leaderboard embedded />
      )}
    </main>
  );
}
