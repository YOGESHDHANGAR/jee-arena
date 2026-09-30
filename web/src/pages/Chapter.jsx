import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, SUBJECT_LABEL, TYPE_LABEL, useTitle } from '../lib/hooks.js';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { NoAds } from '../components/AdSlot.jsx';
import { Rich } from '../components/Rich.jsx';
import { Icon } from '../components/Icon.jsx';
import { useT } from '../lib/i18n.jsx';

const DIFF = ['easy', 'medium', 'hard'];

/** /physics/rotational-motion — a chapter's landing page, mostly for students arriving from search. */
export default function Chapter({ subject }) {
  const { slug } = useParams();
  const t = useT();
  const nav = useNavigate();
  const { data: raw, error, loading } = useApi(`/chapters/${subject}/${slug}`);
  // Old URLs (/physics/rain-problem) point at their standard chapter (/physics/kinematics).
  useEffect(() => {
    if (raw?.redirect) nav(raw.redirect, { replace: true });
  }, [raw?.redirect, nav]);
  const d = raw?.redirect ? null : raw;
  const label = t(SUBJECT_LABEL[subject]);
  const years = d?.pyqByYear || [];
  const yearRange = years.length ? (years.length > 1 ? `${years[years.length - 1].year}–${years[0].year}` : String(years[0].year)) : '';
  useTitle(
    d ? `${d.chapter} JEE questions${d.pyqCount ? ' & PYQs' : ''}` : error ? 'Chapter not found' : undefined,
    d ? `${d.total.toLocaleString('en-IN')} ${d.chapter} questions for JEE Main & Advanced${d.pyqCount ? `, ${d.pyqCount} PYQs (${yearRange})` : ''}, with instant checking and solutions.` : undefined,
  );

  if ((loading && !d) || raw?.redirect) return <Spinner />;
  if (error) {
    return (
      <main className="page narrow">
        <NoAds />
        <ErrorBox error={error} />
        <p><Link className="btn" to={`/${subject}`}>{t('All {subject} chapters', { subject: label })}</Link></p>
      </main>
    );
  }

  const list = (extra = '') => `/problems?subject=${subject}&chapter=${d.slug}${extra}`;

  return (
    <main className="page">
      <nav className="crumbs small muted">
        <Link to="/">{t('Home')}</Link> › <Link to={`/${subject}`}>{label}</Link> › <span>{d.unit}</span> › {d.chapter}
      </nav>
      <h1 style={{ marginBottom: 6 }}>{d.chapter} — {t('JEE Main & Advanced questions')}</h1>
      <p className="muted" style={{ maxWidth: 760, marginTop: 0 }}>
        {t('{n} practice questions on {chapter} ({subject})', { n: d.total.toLocaleString('en-IN'), chapter: d.chapter, subject: label })}
        {d.pyqCount ? `, ${t('including {n} previous-year questions from {years}', { n: d.pyqCount.toLocaleString('en-IN'), years: yearRange })}` : ''}.
        {' '}{t('Every question is checked instantly')}{d.withSolution ? ` ${t('and {n} have a written solution', { n: d.withSolution.toLocaleString('en-IN') })}` : ''}.
      </p>

      <div className="row" style={{ margin: '14px 0 20px' }}>
        <Link className="btn primary lg" to={list()}>{t('Practise all {n}', { n: d.total.toLocaleString('en-IN') })} <Icon.ArrowRight /></Link>
        {d.pyqCount > 0 && <Link className="btn lg" to={list('&pyq=1')}><Icon.CalendarDays /> {t('Only PYQs')} ({d.pyqCount})</Link>}
        <Link className="btn lg" to={`/practice?subject=${subject}&chapter=${d.slug}`}><Icon.Timer /> {t('Timed test on this chapter')}</Link>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3 className="with-icon"><Icon.Gauge /> {t('By difficulty')}</h3>
          <div className="stack">
            {DIFF.filter((k) => d.byDifficulty[k]).map((k) => (
              <Link key={k} to={list(`&difficulty=${k}`)} className="spread small" style={{ textDecoration: 'none', color: 'inherit' }}>
                <Pill kind={k}>{t(k)}</Pill>
                <span className="mono row" style={{ gap: 4 }}>{d.byDifficulty[k].toLocaleString('en-IN')} <Icon.ChevronRight size={14} /></span>
              </Link>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="with-icon"><Icon.ListChecks /> {t('By type')}</h3>
          <div className="stack">
            {Object.entries(d.byType).map(([k, n]) => (
              <Link key={k} to={list(`&type=${k}`)} className="spread small" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span>{t(TYPE_LABEL[k] || k)}</span>
                <span className="mono row" style={{ gap: 4 }}>{n.toLocaleString('en-IN')} <Icon.ChevronRight size={14} /></span>
              </Link>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="with-icon"><Icon.CalendarDays /> {t('PYQs by year')}</h3>
          {years.length ? (
            <div className="chips">
              {years.map((y) => (
                <Link key={y.year} className="chip" to={list(`&year=${y.year}`)} style={{ textDecoration: 'none' }}>
                  {y.year} <span className="muted">· {y.count}</span>
                </Link>
              ))}
            </div>
          ) : <p className="muted small" style={{ margin: 0 }}>{t('No previous-year questions tagged in this chapter yet.')}</p>}
        </div>
      </div>

      {d.topics.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="with-icon"><Icon.Layers /> {t('Topics')}</h3>
          <div className="chips">
            {d.topics.map((t) => (
              <Link key={t.topic} className="chip" to={list(`&search=${encodeURIComponent(t.topic)}`)} style={{ textDecoration: 'none' }}>
                {t.topic} <span className="muted">· {t.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-2">
        <QuestionList title={t('Recent PYQs')} items={d.questions.recentPyq} more={d.pyqCount > 8 ? list('&pyq=1') : null} />
        <QuestionList title={d.questions.popular.length ? t('Most practised') : t('Start here (easy)')} items={d.questions.popular.length ? d.questions.popular : d.questions.starter} more={list()} />
      </div>

      {d.related.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1.1rem' }}>{t('More {subject} chapters', { subject: label })}</h2>
          <div className="chips">
            {d.related.map((c) => (
              <Link key={c.slug} className="chip" to={`/${subject}/${c.slug}`} style={{ textDecoration: 'none' }}>
                {c.chapter} <span className="muted">· {c.count.toLocaleString('en-IN')}</span>
              </Link>
            ))}
            <Link className="chip" to={`/${subject}`} style={{ textDecoration: 'none' }}>{t('All chapters')} <Icon.ArrowRight size={13} /></Link>
          </div>
        </section>
      )}
    </main>
  );
}

function QuestionList({ title, items, more }) {
  const t = useT();
  if (!items?.length) return null;
  return (
    <section className="card flush">
      <h3 style={{ padding: '14px 14px 0' }}>{title}</h3>
      <div>
        {items.map((q) => (
          <Link key={q.qid} to={`/problems/${q.qid}`} className="chapter-q">
            <Rich text={q.preview} className="qprev" />
            <div className="qmeta">
              <Pill kind={q.difficulty}>{t(q.difficulty)}</Pill>
              <span>{t(TYPE_LABEL[q.type])}</span>
              {q.pyq && <span className="pill">{q.pyq.exam} {q.pyq.year}</span>}
              {q.acceptance !== null && <span>{t('{p}% solved', { p: q.acceptance })}</span>}
            </div>
          </Link>
        ))}
      </div>
      {more && <div style={{ padding: 12 }}><Link to={more} className="btn sm">{t('See all')} <Icon.ArrowRight /></Link></div>}
    </section>
  );
}
