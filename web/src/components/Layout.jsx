import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { AdRails, AdBottom } from './AdSlot.jsx';
import { InstallButton } from './InstallButton.jsx';
import { UserMenu } from './UserMenu.jsx';
import { Icon } from './Icon.jsx';
import { LangToggle, useT } from '../lib/i18n.jsx';

export function Layout() {
  const { user } = useAuth();
  const t = useT();
  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">J</span>
            <span>JEE Arena</span>
          </Link>
          <nav className="nav-links">
            <NavLink to="/problems"><Icon.ListChecks /> <span>{t('Problems')}</span></NavLink>
            <NavLink to="/contests"><Icon.Trophy /> <span>{t('Contests')}</span></NavLink>
            <NavLink to="/mocks"><Icon.ClipboardList /> <span>{t('Mock tests')}</span></NavLink>
            <NavLink to="/practice"><Icon.Target /> <span>{t('Practice')}</span></NavLink>
            <NavLink to="/leaderboard"><Icon.ChartNoAxesColumn /> <span>{t('Ranks')}</span></NavLink>
          </nav>
          <div className="nav-right">
            {user ? (
              <>
                {user.plan !== 'pro' && user.role !== 'admin' && (
                  <Link to="/pro" className="btn sm go-pro" title={t('Go Pro')}>
                    <Icon.Crown /> <span className="hide-sm">{t('Go Pro')}</span>
                  </Link>
                )}
                <UserMenu />
              </>
            ) : (
              <>
                <LangToggle />
                <Link to="/login" className="btn sm ghost"><Icon.LogIn /> {t('Log in')}</Link>
                <Link to="/register" className="btn sm primary">{t('Sign up')}</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <AdRails />
      <Outlet />
      <AdBottom />
      {/* Phones: the main sections as an app-style bar at the bottom (the top bar keeps logo, Pro and account). */}
      <nav className="tabbar" aria-label={t('Main')}>
        <NavLink to="/problems"><Icon.ListChecks /><span>{t('Problems')}</span></NavLink>
        <NavLink to="/practice"><Icon.Target /><span>{t('Practice')}</span></NavLink>
        <NavLink to="/contests"><Icon.Trophy /><span>{t('Contests')}</span></NavLink>
        <NavLink to="/mocks"><Icon.ClipboardList /><span>{t('Mocks')}</span></NavLink>
        <NavLink to="/leaderboard"><Icon.ChartNoAxesColumn /><span>{t('Ranks')}</span></NavLink>
      </nav>
      <footer className="footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} JEE Arena</span>
          <nav>
            <InstallButton className="btn sm" />
            <Link to="/physics">{t('Physics')}</Link>
            <Link to="/chemistry">{t('Chemistry')}</Link>
            <Link to="/maths">{t('Maths')}</Link>
            <Link to="/pro">Pro</Link>
            <Link to="/privacy">{t('Privacy')}</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

export function Spinner() {
  return <div className="spinner" />;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert error">{error.message || String(error)}</div>;
}

export function Pill({ kind, children }) {
  return <span className={`pill ${kind || ''}`}>{children}</span>;
}
