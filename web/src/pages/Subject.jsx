import { Link } from 'react-router-dom';
import { useApi, SUBJECT_LABEL, useTitle } from '../lib/hooks.js';
import { ErrorBox, Spinner } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import { useT } from '../lib/i18n.jsx';

/** /physics, /chemistry, /maths — the standard JEE chapters, grouped by unit, with question and PYQ counts. */
export default function Subject({ subject }) {
  const { data, error, loading } = useApi(`/chapters/${subject}`);
  const t = useT();
  const label = t(SUBJECT_LABEL[subject]);
  const units = (data?.units || []).map((u) => ({ ...u, chapters: u.chapters.filter((c) => c.count) })).filter((u) => u.chapters.length);
  const chapters = units.flatMap((u) => u.chapters);
  const total = data?.total || 0;
  const pyq = chapters.reduce((n, c) => n + c.pyqCount, 0);
  useTitle(
    `JEE ${label} chapter-wise questions & PYQs`,
    `Chapter-wise JEE Main & Advanced ${label} practice questions and previous-year questions with instant checking and solutions.`,
  );

  return (
    <main className="page">
      <nav className="crumbs small muted"><Link to="/">{t('Home')}</Link> › {label}</nav>
      <h1>{t('JEE {subject}: chapter-wise questions', { subject: label })}</h1>
      <p className="muted" style={{ maxWidth: 720 }}>
        {data ? (
          <>
            {t('{n} {subject} questions across {c} chapters', { n: total.toLocaleString('en-IN'), subject: label, c: chapters.length })}
            {pyq ? `, ${t('including {n} previous-year questions (PYQs)', { n: pyq.toLocaleString('en-IN') })}` : ''}. {t('Pick a chapter to see its PYQs by year, topics and where to start.')}
          </>
        ) : t('Loading chapters…')}
      </p>
      <div className="row" style={{ marginBottom: 16 }}>
        <Link className="btn primary" to={`/problems?subject=${subject}`}>{t('Practise all {n}', { n: label })}</Link>
        <Link className="btn" to={`/problems?subject=${subject}&pyq=1`}>{t('Only PYQs')}</Link>
        {['physics', 'chemistry', 'maths'].filter((s) => s !== subject).map((s) => (
          <Link key={s} className="btn ghost" to={`/${s}`}>{t(SUBJECT_LABEL[s])} <Icon.ArrowRight /></Link>
        ))}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : units.map((u) => (
        <section key={u.name} className="subject-unit">
          <h2 className="unit-title">
            {u.name} <span className="muted small">{t('{n} questions', { n: u.count.toLocaleString('en-IN') })}</span>
          </h2>
          <div className="grid grid-3">
            {u.chapters.map((c) => (
              <Link key={c.slug} to={`/${subject}/${c.slug}`} className={`card subject-card ${subject}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <h3 style={{ margin: '0 0 4px' }}>{c.chapter}</h3>
                <div className="muted small">
                  {t('Class {n}', { n: c.class })} · {t('{n} questions', { n: c.count.toLocaleString('en-IN') })}{c.pyqCount ? ` · ${c.pyqCount.toLocaleString('en-IN')} PYQs` : ''}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
