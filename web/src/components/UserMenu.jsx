import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { useLang, useT } from '../lib/i18n.jsx';
import { Icon } from './Icon.jsx';
import { InstallButton } from './InstallButton.jsx';

/**
 * Round avatar in the top bar that opens the account menu: profile, analysis, bookmarks, mistakes,
 * Pro, language, admin, install, log out. Keeps the bar itself uncluttered.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const { lang, setLang } = useLang();
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState(0);
  const box = useRef(null);
  const button = useRef(null);

  // Revision due today: a dot on the avatar and a count in the menu. Refreshed on page change and on open.
  useEffect(() => {
    if (!user) return;
    api('/reviews').then((r) => setDue(r.due || 0)).catch(() => {});
  }, [user, loc.pathname, open]);

  // Close on navigation, outside click and Escape.
  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const initial = (user.name || user.username || '?').trim()[0].toUpperCase();
  const isPro = user.plan === 'pro';

  return (
    <div className="user-menu" ref={box}>
      <button
        ref={button}
        className={`avatar-btn ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('Your account')}
      >
        <span className={`avatar-circle ${isPro ? 'pro' : ''}`}>{initial}</span>
        {due > 0 && <span className="avatar-dot" aria-label={t('{n} questions due for revision', { n: due })} />}
        <Icon.ChevronDown size={14} className="hide-sm" />
      </button>

      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <span className={`avatar-circle lg ${isPro ? 'pro' : ''}`}>{initial}</span>
            <div style={{ minWidth: 0 }}>
              <div className="menu-name">{user.name}</div>
              <div className="muted small">
                @{user.username} · {t('rating')} <b className="mono">{user.rating}</b>
              </div>
              {isPro && <span className="pill pro" style={{ marginTop: 4 }}><Icon.Crown size={11} /> Pro</span>}
            </div>
          </div>

          <div className="menu-group">
            <Link role="menuitem" to={`/u/${user.username}`} className="menu-item"><Icon.User /> {t('View profile')}</Link>
            <Link role="menuitem" to={`/u/${user.username}?tab=analysis`} className="menu-item"><Icon.ChartColumn /> {t('My analysis')}</Link>
            <Link role="menuitem" to="/problems?status=bookmarked" className="menu-item"><Icon.Bookmark /> {t('Bookmarks')}</Link>
            <Link role="menuitem" to="/problems?status=due" className="menu-item"><Icon.CalendarDays /> {t('Due for revision')}{due > 0 && <span className="menu-badge">{due}</span>}</Link>
            <Link role="menuitem" to="/problems?status=attempted" className="menu-item"><Icon.CircleX /> {t('My mistakes')}</Link>
            <Link role="menuitem" to="/practice" className="menu-item"><Icon.Target /> {t('Take a custom test')}</Link>
          </div>

          <div className="menu-group">
            <button role="menuitemradio" aria-checked={lang === 'hi'} className="menu-item" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}>
              <Icon.Languages /> {t('Language')}
              <span className="lang-pill">{lang === 'hi' ? 'हिन्दी' : 'English'}</span>
            </button>
            <InstallButton className="menu-item" />
            {user.role === 'admin' && <Link role="menuitem" to="/admin" className="menu-item"><Icon.Layers /> Admin</Link>}
          </div>

          <div className="menu-group">
            <button
              role="menuitem"
              className="menu-item danger"
              onClick={() => {
                setOpen(false);
                logout();
                nav('/');
              }}
            >
              <Icon.LogOut /> {t('Log out')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
