import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApi, SUBJECT_LABEL, TYPE_LABEL, listContext, useTitle, chapterSlug } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { Select } from '../components/Select.jsx';
import { Rich } from '../components/Rich.jsx';
import { Icon } from '../components/Icon.jsx';
import { useT } from '../lib/i18n.jsx';

const SUBJECT_TABS = [
  ['', 'All subjects', Icon.LayoutGrid],
  ['physics', 'Physics', Icon.Atom],
  ['chemistry', 'Chemistry', Icon.FlaskConical],
  ['maths', 'Maths', Icon.Sigma],
];
const BRANCH_TABS = [
  ['', 'All chemistry', Icon.FlaskConical],
  ['physical', 'Physical', Icon.Thermometer],
  ['organic', 'Organic', Icon.Hexagon],
  ['inorganic', 'Inorganic', Icon.Gem],
];
const BRANCH_LABEL = { physical: 'Physical Chemistry', organic: 'Organic Chemistry', inorganic: 'Inorganic Chemistry' };
const FILTER_KEYS = ['subject', 'branch', 'chapter', 'difficulty', 'type', 'pyq', 'year', 'status', 'access', 'search'];
/** 25,940 -> "25.9k" for the small counts on the tabs. */
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));

const STATUS_ICON = { solved: <Icon.CircleCheck size={16} style={{ color: 'var(--good)' }} />, attempted: <Icon.CircleDot size={16} style={{ color: 'var(--warn)' }} /> };

export default function Problems() {
  const { user } = useAuth();
  const t = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = Object.fromEntries(params);
  const meta = useApi('/problems/meta');
  const list = useApi('/problems', { query: { ...q, limit: 30 } });
  const [search, setSearch] = useState(q.search || '');

  useEffect(() => setSearch(q.search || ''), [q.search]);

  // Old links carry a raw chapter name (?chapter=Rotational%20motion): swap in the standard chapter id
  // so the dropdown shows it. The list itself already works either way (the server maps it).
  const knownIds = meta.data && q.subject ? (meta.data.subjects?.[q.subject]?.units || []).flatMap((u) => u.chapters.map((c) => c.id)) : null;
  useEffect(() => {
    if (!knownIds || !q.chapter || knownIds.includes(q.chapter)) return;
    api(`/chapters/${q.subject}/${chapterSlug(q.chapter)}`)
      .then((d) => {
        const id = (d.redirect || '').split('/').pop() || d.slug;
        if (id && id !== q.chapter) setParams(Object.fromEntries(Object.entries({ ...q, chapter: id }).filter(([, v]) => v)), { replace: true });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!knownIds, q.subject, q.chapter]);

  // Standard chapters grouped by unit; for chemistry, only the chosen branch's unit.
  const units = (q.subject ? meta.data?.subjects?.[q.subject]?.units || [] : [])
    .filter((u) => q.subject !== 'chemistry' || !q.branch || u.name === BRANCH_LABEL[q.branch])
    .map((u) => ({ ...u, chapters: u.chapters.filter((c) => c.count) }))
    .filter((u) => u.chapters.length);
  const chapterName = q.chapter && q.subject
    ? (meta.data?.subjects?.[q.subject]?.units || []).flatMap((u) => u.chapters).find((c) => c.id === q.chapter)?.chapter || q.chapter
    : q.chapter;
  const LIST_TITLE = { bookmarked: t('Bookmarked questions'), attempted: t('My mistakes'), due: t('Due for revision') };
  useTitle(
    LIST_TITLE[q.status] || (!q.chapter && q.subject === 'chemistry' && BRANCH_LABEL[q.branch] ? t('JEE {subject} questions', { subject: t(BRANCH_LABEL[q.branch]) }) : q.chapter ? t('{chapter} — JEE {subject} questions', { chapter: chapterName, subject: t(SUBJECT_LABEL[q.subject] || '') }) : q.subject ? t('JEE {subject} questions', { subject: t(SUBJECT_LABEL[q.subject]) }) : q.pyq || q.year ? `${t('JEE PYQs')}${q.year ? ` ${q.year}` : ''}` : t('JEE practice questions')),
    q.chapter ? `Practise ${chapterName} questions for JEE Main & Advanced with instant checking and solutions.` : undefined,
  );

  const update = (patch) => {
    const next = { ...q, ...patch, page: patch.page || '' };
    if (patch.subject !== undefined) Object.assign(next, { chapter: '', branch: '' });
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
  };

  const subjectCount = (k) => {
    if (!meta.data) return null;
    if (!k) return meta.data.total;
    return meta.data.subjects?.[k]?.total ?? 0;
  };
  const activeFilters = FILTER_KEYS.filter((k) => q[k]).length;
  // Carry the current filters to the question page so Prev/Next and the list drawer follow them.
  const ctx = listContext(q);
  const toQ = (qid) => `/problems/${qid}${ctx ? `?${ctx}` : ''}`;
  const page = Number(q.page || 1);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.limit)) : 1;

  async function random() {
    try {
      const r = await api('/problems/random', { query: { subject: q.subject, branch: q.branch, chapter: q.chapter, difficulty: q.difficulty, type: q.type } });
      nav(toQ(r.qid));
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <main className="page">
      <div className="spread" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{q.status === 'bookmarked' ? t('Bookmarks') : q.status === 'attempted' ? t('My mistakes') : q.status === 'due' ? t('Due for revision') : t('Problems')}</h1>
        <div className="row">
          {user && (
            <>
              <button className={`chip ${q.status === 'bookmarked' ? 'on' : ''}`} onClick={() => update({ status: q.status === 'bookmarked' ? '' : 'bookmarked' })}><Icon.Bookmark size={14} /> {t('Bookmarks')}</button>
              <button className={`chip ${q.status === 'attempted' ? 'on' : ''}`} onClick={() => update({ status: q.status === 'attempted' ? '' : 'attempted' })}><Icon.CircleX size={14} /> {t('My mistakes')}</button>
            </>
          )}
          <button className="btn" onClick={random}><Icon.Dices /> {t('Pick one for me')}</button>
        </div>
      </div>
      {q.status === 'due' && (
        <p className="muted small" style={{ marginTop: -8 }}>{t('Questions you got wrong come back after 1 day, then 3, then 7. Get one right when it is due and it moves to the next step.')}</p>
      )}
      {q.status === 'attempted' && (
        <p className="muted small" style={{ marginTop: -8 }}>{t("Questions you got wrong or gave up on and haven't solved yet. Solve one and it leaves this list.")}</p>
      )}

      <section className="card filters">
        <form className="fsearch" onSubmit={(e) => { e.preventDefault(); update({ search }); }}>
          <Icon.Search size={17} />
          <input
            placeholder={t('Search questions, or type #number')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('Search')}
          />
          {(search || q.search) && (
            <button type="button" className="fsearch-clear" title={t('Clear search')} onClick={() => { setSearch(''); update({ search: '' }); }}><Icon.X size={15} /></button>
          )}
          <button type="submit" className="btn sm primary hide-sm">{t('Search')}</button>
        </form>

        <div className="stabs" role="tablist">
          {SUBJECT_TABS.map(([k, label, I]) => (
            <button key={k || 'all'} role="tab" aria-selected={(q.subject || '') === k} className={`stab ${k} ${(q.subject || '') === k ? 'on' : ''}`} onClick={() => update({ subject: k })}>
              <I size={16} /> {t(label)}
              {subjectCount(k) !== null && <span className="stab-n">{compact(subjectCount(k))}</span>}
            </button>
          ))}
        </div>

        {q.subject === 'chemistry' && (
          <div className="branches" role="tablist" aria-label={t('Branch of chemistry')}>
            {BRANCH_TABS.map(([k, label, I]) => (
              <button key={k || 'all'} role="tab" aria-selected={(q.branch || '') === k} className={`branch ${k} ${(q.branch || '') === k ? 'on' : ''}`} onClick={() => update({ branch: k, chapter: '' })}>
                <I size={15} /> {t(label)}
                {k && meta.data?.branches?.[k] ? <span className="stab-n">{compact(meta.data.branches[k])}</span> : null}
              </button>
            ))}
          </div>
        )}

        <div className="frow">
          <span className="frow-label hide-sm"><Icon.SlidersHorizontal size={15} /> {t('Filters')}</span>
          <Select className={`fsel wide ${q.chapter ? 'set' : ''}`} value={q.chapter || ''} onChange={(e) => update({ chapter: e.target.value })} disabled={!q.subject}>
            <option value="">{q.subject ? t('All chapters') : t('Pick a subject for chapters')}</option>
            {units.map((u) => (
              <optgroup key={u.name} label={u.name}>
                {u.chapters.map((c) => <option key={c.id} value={c.id}>{`${c.chapter} (${c.count.toLocaleString('en-IN')})`}</option>)}
              </optgroup>
            ))}
          </Select>
          <Select className={`fsel ${q.difficulty ? 'set' : ''}`} value={q.difficulty || ''} onChange={(e) => update({ difficulty: e.target.value })}>
            <option value="">{t('Any difficulty')}</option>
            <option value="easy">{t('Easy')}</option>
            <option value="medium">{t('Medium')}</option>
            <option value="hard">{t('Hard')}</option>
          </Select>
          <Select className={`fsel ${q.type ? 'set' : ''}`} value={q.type || ''} onChange={(e) => update({ type: e.target.value })}>
            <option value="">{t('Any type')}</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </Select>
          <Select className={`fsel ${q.year || q.pyq ? 'set' : ''}`} value={q.year || (q.pyq ? 'any' : '')} onChange={(e) => update(e.target.value === 'any' ? { pyq: '1', year: '' } : { year: e.target.value, pyq: '' })}>
            <option value="">{t('All questions')}</option>
            <option value="any">{t('Only PYQs')}</option>
            {(meta.data?.years || []).map((y) => <option key={y} value={y}>PYQ {y}</option>)}
          </Select>
          {user && (
            <Select className={`fsel ${q.status ? 'set' : ''}`} value={q.status || ''} onChange={(e) => update({ status: e.target.value })}>
              <option value="">{t('Any status')}</option>
              <option value="todo">{t('Not tried')}</option>
              <option value="attempted">{t('Attempted, not solved (mistakes)')}</option>
              <option value="solved">{t('Solved')}</option>
              <option value="bookmarked">{t('Bookmarked')}</option>
              <option value="due">{t('Due for revision')}</option>
            </Select>
          )}
          <Select className={`fsel ${q.access ? 'set' : ''}`} value={q.access || ''} onChange={(e) => update({ access: e.target.value })}>
            <option value="">{t('Free + Pro')}</option>
            <option value="free">{t('Free only')}</option>
            <option value="premium">{t('Pro only')}</option>
          </Select>
          {activeFilters > 0 && (
            <button className="fclear" onClick={() => { setSearch(''); setParams({}); }}>
              <Icon.FunnelX size={15} /> {t('Clear all')}
            </button>
          )}
          {list.data && <span className="fcount">{t('{n} questions', { n: list.data.total.toLocaleString('en-IN') })}</span>}
        </div>
      </section>

      <ErrorBox error={list.error} />
      <div className="card flush">
        {list.loading && !list.data ? <Spinner /> : list.data?.items.length === 0 ? (
          <div className="empty">
            {q.status === 'bookmarked' ? t('No bookmarks yet — tap Save on any question to keep it here for revision.')
              : q.status === 'attempted' ? <><Icon.PartyPopper size={18} /> {t('No mistakes to revise.')}</>
              : q.status === 'due' ? <><Icon.PartyPopper size={18} /> {t('Nothing due today. Come back tomorrow.')}</>
              : t('No questions match these filters.')}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>#</th>
                  <th>{t('Question')}</th>
                  <th className="hide-sm">{t('Subject')}</th>
                  <th>{t('Level')}</th>
                  <th className="hide-sm">{t('Type')}</th>
                  <th className="hide-sm">{t('Solved by')}</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((p, i) => (
                  <Fragment key={p.qid}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => nav(toQ(p.qid))}>
                    <td>{p.locked ? <span title={t('Pro question')} className="lock"><Icon.Lock size={14} /></span> : STATUS_ICON[p.status] || ''}</td>
                    <td className="mono muted">{p.qid}</td>
                    <td className="qcell">
                      <Link to={toQ(p.qid)} onClick={(e) => e.stopPropagation()} className="qprev-link">
                        <Rich text={p.preview || p.chapter} className="qprev" />
                      </Link>
                      <div className="qmeta">
                        <span>{p.chapter}{p.topic ? ` · ${p.topic}` : ''}</span>
                        {p.pyq && <span className="pill">{p.pyq.exam} {p.pyq.year}</span>}
                        {p.premium && <span className="pill pro">{p.locked && <Icon.Lock size={11} />}Pro</span>}
                      </div>
                    </td>
                    <td className="hide-sm"><Pill kind={p.subject}>{t(SUBJECT_LABEL[p.subject])}</Pill></td>
                    <td><Pill kind={p.difficulty}>{t(p.difficulty)}</Pill></td>
                    <td className="hide-sm muted small">{t(TYPE_LABEL[p.type])}</td>
                    <td className="hide-sm muted small mono">{p.acceptance === null ? '—' : `${p.acceptance}%`}</td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}><Icon.ChevronLeft /> {t('Previous')}</button>
          <span className="muted small">{t('Page {a} of {b}', { a: page, b: pages })} · {t('{n} questions', { n: list.data.total.toLocaleString('en-IN') })}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>{t('Next')} <Icon.ChevronRight /></button>
        </div>
      )}
    </main>
  );
}
