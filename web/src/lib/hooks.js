import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** Small data hook: const { data, error, loading, reload } = useApi('/path', { query }) */
export function useApi(path, opts = {}, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const key = JSON.stringify([path, opts.query]);
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path, opts)
      .then((data) => n === seq.current && setState({ data, error: null, loading: false }))
      .catch((error) => n === seq.current && setState({ data: null, error, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  useEffect(load, [load]);
  return { ...state, reload: load };
}

/** Re-renders every `ms` so countdowns tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export const SUBJECT_LABEL = { physics: 'Physics', chemistry: 'Chemistry', maths: 'Maths' };
export const TYPE_LABEL = { single: 'MCQ', multi: 'Multi-correct', numerical: 'Numerical' };

export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Pass the page's `t` (from useT) to get Hindi; without it these stay English.
const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? String(v[k]) : m)) : s);

export function fmtCountdown(ms, t = fill) {
  if (ms <= 0) return t('now');
  const d = Math.floor(ms / 864e5);
  if (d >= 1) return t(d > 1 ? 'in {n} days' : 'in {n} day', { n: d });
  return t('in {time}', { time: fmtDuration(ms / 1000) });
}

export const fmtDate = (d) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Filter keys that define a problem list (shared by the list page and the question page). */
export const LIST_KEYS = ['subject', 'branch', 'chapter', 'difficulty', 'type', 'pyq', 'year', 'status', 'access', 'search'];
export const listContext = (params) =>
  new URLSearchParams(Object.entries(params).filter(([k, v]) => LIST_KEYS.includes(k) && v)).toString();

/** Seconds the page has been visible (pauses while the tab is hidden). */
export function useVisibleSeconds(key, running = true) {
  const [sec, setSec] = useState(0);
  const acc = useRef(0);
  const since = useRef(null);
  useEffect(() => {
    acc.current = 0;
    since.current = document.visibilityState === 'visible' ? Date.now() : null;
    setSec(0);
  }, [key]);
  useEffect(() => {
    if (!running) {
      if (since.current) acc.current += (Date.now() - since.current) / 1000;
      since.current = null;
      return;
    }
    if (document.visibilityState === 'visible' && !since.current) since.current = Date.now();
    const onVis = () => {
      if (document.visibilityState === 'hidden' && since.current) {
        acc.current += (Date.now() - since.current) / 1000;
        since.current = null;
      } else if (document.visibilityState === 'visible' && !since.current) since.current = Date.now();
    };
    const tick = setInterval(() => setSec(Math.floor(acc.current + (since.current ? (Date.now() - since.current) / 1000 : 0))), 1000);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [running, key]);
  const read = () => Math.floor(acc.current + (since.current ? (Date.now() - since.current) / 1000 : 0));
  return [sec, read];
}

export function fmtShort(sec) {
  if (sec == null) return '—';
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m < 60 ? `${m}m ${String(s).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function timeAgo(d, t = fill) {
  const s = Math.max(1, Math.round((Date.now() - new Date(d)) / 1000));
  if (s < 60) return t('just now');
  const m = Math.round(s / 60);
  if (m < 60) return t('{n}m ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('{n}h ago', { n: h });
  const days = Math.round(h / 24);
  if (days < 30) return t('{n}d ago', { n: days });
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const SITE = 'JEE Arena';
const DEFAULT_TITLE = 'JEE Arena — practise, compete, rank';
const DEFAULT_DESC = 'Practise JEE Main & Advanced questions, take timed contests and mock tests, and see your All-India rank.';

/**
 * Sets the browser tab title and meta description for the current page.
 * (Google also gets these server-rendered for /problems/:n and /test/:id — see server/src/lib/seo.js.)
 * Pass a falsy title while data is loading to keep the previous one.
 */
export function useTitle(title, description) {
  useEffect(() => {
    if (title === undefined) return;
    document.title = title ? `${title} · ${SITE}` : DEFAULT_TITLE;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', description || DEFAULT_DESC);
  }, [title, description]);
}

/** Plain one-line text from question markup, for titles/descriptions (no $…$, tags or LaTeX commands). */
export function plainText(text = '', max = 155) {
  const s = String(text)
    .replace(/\{\{(img|mol):[^}]*\}\}|!\[[^\]]*\]\([^)]*\)|<img[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\(?:left|right|displaystyle|mathrm|text|mathbf|operatorname)\b/g, '')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\(sqrt)\{([^{}]*)\}/g, '√($2)')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[$^_{}\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s;
}

/** "Work, Energy & Power" -> "work-energy-and-power". Keep in sync with server/src/lib/chapters.js. */
export const chapterSlug = (name = '') =>
  String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Link to a chapter's landing page. */
export const chapterPath = (subject, chapter) => `/${subject}/${chapterSlug(chapter)}`;
