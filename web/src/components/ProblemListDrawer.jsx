import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SUBJECT_LABEL } from '../lib/hooks.js';
import { Rich } from './Rich.jsx';
import { Icon } from './Icon.jsx';
import { useT } from '../lib/i18n.jsx';

const STATUS = {
  solved: <span className="st solved" title="Solved"><Icon.CircleCheck size={15} /></span>,
  attempted: <span className="st tried" title="Attempted"><Icon.CircleDot size={15} /></span>,
};

/**
 * LeetCode-style slide-over list of questions for the current filters.
 * `ctx` is the filter querystring the student came from; `current` is the open question.
 */
export function ProblemListDrawer({ open, onClose, ctx, current, toQ }) {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const t = useT();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const loadedFor = useRef(null);

  const load = async (p, reset = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = Object.fromEntries(new URLSearchParams(ctx));
      const r = await api('/problems', { query: { ...params, page: p, limit: 50 } });
      setItems((cur) => (reset ? r.items : [...cur, ...r.items]));
      setTotal(r.total);
      setPage(p);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  // First open (or new filters): start on the page that contains the current question.
  useEffect(() => {
    if (!open || loadedFor.current === ctx) return;
    loadedFor.current = ctx;
    (async () => {
      let startPage = 1;
      try {
        const params = Object.fromEntries(new URLSearchParams(ctx));
        const n = await api(`/problems/${current}/nav`, { query: params });
        startPage = Math.max(1, Math.ceil(n.position / 50));
      } catch {
        /* fall back to page 1 */
      }
      await load(startPage, true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ctx]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // Bring the open question into view.
    setTimeout(() => listRef.current?.querySelector('.pl-row.current')?.scrollIntoView({ block: 'center' }), 50);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, items.length]);

  const params = Object.fromEntries(new URLSearchParams(ctx));
  const label = [params.subject && t(SUBJECT_LABEL[params.subject]), params.chapter, params.difficulty && t(params.difficulty), params.year && `PYQ ${params.year}`, params.search && `“${params.search}”`]
    .filter(Boolean)
    .join(' · ') || t('All questions');
  const firstIndex = (page - Math.ceil(items.length / 50)) * 50; // index of items[0] in the full list

  return (
    <>
      <div className={`drawer-back ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Problem list">
        <div className="drawer-head">
          <div>
            <b>{t('Problem list')}</b>
            <div className="muted small">{label} · {total.toLocaleString('en-IN')}</div>
          </div>
          <button className="btn sm ghost" onClick={onClose} aria-label="Close list"><Icon.X /></button>
        </div>
        <div className="drawer-body" ref={listRef}>
          {firstIndex > 0 && (
            <button className="btn sm ghost pl-more" disabled={loading} onClick={async () => {
              const prevPage = page - Math.ceil(items.length / 50);
              const params2 = Object.fromEntries(new URLSearchParams(ctx));
              setLoading(true);
              const r = await api('/problems', { query: { ...params2, page: prevPage, limit: 50 } }).catch(() => null);
              if (r) setItems((cur) => [...r.items, ...cur]);
              setLoading(false);
            }}><Icon.ArrowUp /> {t('Earlier questions')}</button>
          )}
          {items.map((p, i) => (
            <button
              key={p.qid}
              className={`pl-row ${p.qid === current ? 'current' : ''}`}
              onClick={() => { nav(toQ(p.qid)); onClose(); }}
            >
              <span className="pl-status">{p.locked ? <span className="lock" title="Pro question"><Icon.Lock size={14} /></span> : STATUS[p.status] || ''}</span>
              <span className="pl-num mono">{firstIndex + i + 1}.</span>
              <span className="pl-title">
                <Rich text={p.preview || p.chapter} className="pl-prev" as="span" />
                <span className="pl-sub">{p.chapter}{p.pyq ? ` · ${p.pyq.year}` : ''}</span>
              </span>
              <span className={`pl-diff ${p.difficulty}`}>{p.difficulty[0].toUpperCase() + p.difficulty.slice(1, 3)}</span>
            </button>
          ))}
          {error && <div className="alert error">{error.message}</div>}
          {firstIndex + items.length < total && (
            <button className="btn sm ghost pl-more" disabled={loading} onClick={() => load(page + 1)}>
              {loading ? t('Loading…') : <><Icon.ArrowDown /> {t('Load more')}</>}
            </button>
          )}
          {!loading && !items.length && !error && <div className="empty">{t('No questions.')}</div>}
        </div>
      </aside>
    </>
  );
}
