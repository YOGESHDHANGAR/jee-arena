import { Link } from 'react-router-dom';
import { useApi, useNow, fmtCountdown, fmtDate, useTitle } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import { useT } from '../lib/i18n.jsx';

export default function Tests({ kind }) {
  const { user } = useAuth();
  const t = useT();
  const { data, error, loading } = useApi('/tests', { query: { kind } }, [user?.id, kind]);
  const now = useNow(1000);
  const isContest = kind === 'contest';
  useTitle(isContest ? 'Weekly JEE contests' : 'Free JEE Main mock tests', isContest ? 'Timed JEE contests with +4/−1 marking, live leaderboards and an All-India rating.' : 'Full-length JEE Main mock tests in an exam-style interface with All-India rank and subject-wise analysis.');

  const list = data || [];
  const groups = isContest
    ? [
        [t('Live now'), list.filter((t) => t.state === 'live')],
        [t('Upcoming'), list.filter((t) => t.state === 'upcoming').sort((a, b) => new Date(a.startAt) - new Date(b.startAt))],
        [t('Past contests'), list.filter((t) => t.state === 'ended')],
      ]
    : [[t('Mock tests'), list]];

  return (
    <main className="page">
      <h1>{isContest ? t('Contests') : t('Mock tests')}</h1>
      <p className="muted">
        {isContest
          ? t('Timed papers with JEE marking. Everyone takes the same questions in the same window, and rated contests change your rating.')
          : t('Full-length papers you can take any time, in an exam-style interface. See your All-India rank among everyone who took the same paper.')}
      </p>
      <ErrorBox error={error} />
      {loading && !data && <Spinner />}
      {data && list.length === 0 && (
        <div className="card empty empty-rich">
          <div className="empty-icon">{isContest ? <Icon.Trophy size={24} /> : <Icon.ClipboardList size={24} />}</div>
          <h3>{isContest ? t('No contest scheduled right now') : t('No mock tests published yet')}</h3>
          <p>{t('Meanwhile, a timed paper of your own works just as well: same JEE marking, instant result and review.')}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to="/practice" className="btn primary"><Icon.Timer /> {t('Take a test')}</Link>
            <Link to="/problems" className="btn"><Icon.ListChecks /> {t('Practise questions')}</Link>
          </div>
        </div>
      )}

      {groups.map(([title, items]) =>
        items.length ? (
          <section key={title} style={{ marginTop: 24 }}>
            {isContest && <h2>{title}</h2>}
            <div className="grid grid-2">
              {items.map((test) => (
                <Link key={test.id} to={`/test/${test.slug || test.id}`} className="card" style={{ textDecoration: 'none', display: 'block' }}>
                  <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                    {test.state === 'live' && <Pill kind="live">{t('Live')}</Pill>}
                    {test.rated && <Pill><Icon.TrendingUp size={12} /> {t('Rated')}</Pill>}
                    {test.premium && <Pill kind="pro"><Icon.Crown size={11} /> Pro</Pill>}
                    {test.mine?.submitted && <Pill kind="good"><Icon.CircleCheck size={12} /> {t('Taken')}</Pill>}
                  </div>
                  <h3 style={{ marginBottom: 4 }}>{test.title}</h3>
                  <div className="muted small">
                    {isContest && <><Icon.CalendarDays size={13} /> {fmtDate(test.startAt)} · </>}
                    <Icon.ListChecks size={13} /> {t('{n} questions', { n: test.questionCount })} · <Icon.Clock size={13} /> {t('{n} min', { n: test.durationMin })}
                    {test.participants ? ` · ${t('{n} participants', { n: test.participants.toLocaleString('en-IN') })}` : ''}
                  </div>
                  {test.state === 'upcoming' && <div className="small" style={{ marginTop: 8, color: 'var(--accent)', fontWeight: 600 }}>{t('Starts {when}', { when: fmtCountdown(new Date(test.startAt) - now, t) })}</div>}
                  {test.state === 'live' && <div className="small" style={{ marginTop: 8, color: 'var(--bad)', fontWeight: 600 }}>{t('Ends {when}', { when: fmtCountdown(new Date(test.endAt) - now, t) })}</div>}
                  {test.mine?.rank && <div className="small" style={{ marginTop: 8 }}>{t('Your rank:')} <b>#{test.mine.rank}</b></div>}
                </Link>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </main>
  );
}
