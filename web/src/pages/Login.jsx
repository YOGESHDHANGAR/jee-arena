import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { ErrorBox } from '../components/Layout.jsx';
import { Select } from '../components/Select.jsx';
import { Icon } from '../components/Icon.jsx';
import { useTitle } from '../lib/hooks.js';
import { useT } from '../lib/i18n.jsx';

export default function Login({ register = false }) {
  const { login, register: doRegister } = useAuth();
  const t = useT();
  useTitle(register ? t('Create account') : t('Log in'));
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/problems';
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', targetYear: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (register) await doRegister(form);
      else await login(form.email, form.password);
      nav(next, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const year = new Date().getFullYear();
  return (
    <main className="page auth-page">
      <aside className="auth-side">
        <span className="brand-mark lg">J</span>
        <h2>{register ? t('Your JEE practice, measured.') : t('Good to see you again.')}</h2>
        <ul>
          <li><Icon.ListChecks /> <span>{t('Chapter-wise questions and PYQs with instant checking')}</span></li>
          <li><Icon.Timer /> <span>{t('Timed tests with real +4/−1 marking and a full review')}</span></li>
          <li><Icon.CalendarDays /> <span>{t('Mistakes come back after 1, 3 and 7 days until they stick')}</span></li>
          <li><Icon.ChartColumn /> <span>{t('See your strong and weak chapters, and what to do next')}</span></li>
        </ul>
      </aside>
      <form className="card stack auth-form" onSubmit={submit}>
        <h1>{register ? t('Create your account') : t('Welcome back')}</h1>
        <ErrorBox error={error} />
        {register && (
          <>
            <label className="field"><span>{t('Name')}</span><input className="input" value={form.name} onChange={set('name')} autoComplete="name" required /></label>
            <label className="field"><span>{t('Username')}</span><input className="input" value={form.username} onChange={set('username')} autoComplete="username" placeholder={t('shown on leaderboards')} required /></label>
          </>
        )}
        <label className="field">
          <span>{register ? t('Email') : t('Email or username')}</span>
          <input className="input" type={register ? 'email' : 'text'} value={form.email} onChange={set('email')} autoComplete={register ? 'email' : 'username'} required />
        </label>
        <label className="field">
          <span>{t('Password')}</span>
          <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} required />
        </label>
        {register && (
          <label className="field">
            <span>{t('JEE attempt year')}</span>
            <Select value={form.targetYear} onChange={set('targetYear')}>
              <option value="">{t('Select')}</option>
              {[0, 1, 2, 3].map((d) => <option key={d} value={year + d}>{year + d}</option>)}
            </Select>
          </label>
        )}
        <button className="btn primary lg" style={{ width: '100%' }} disabled={busy}>
          {busy ? t('Please wait…') : register ? t('Sign up') : t('Log in')}
        </button>
        <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>
          {register ? <>{t('Already have an account?')} <Link to={`/login?next=${encodeURIComponent(next)}`}>{t('Log in')}</Link></> : <>{t('New here?')} <Link to={`/register?next=${encodeURIComponent(next)}`}>{t('Create an account')}</Link></>}
        </p>
      </form>
    </main>
  );
}
