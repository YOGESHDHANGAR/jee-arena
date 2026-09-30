import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SUBJECT_LABEL, TYPE_LABEL, fmtDuration, useNow } from '../lib/hooks.js';
import { Rich } from '../components/Rich.jsx';
import { AnswerInput, hasAnswer } from '../components/AnswerInput.jsx';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { Icon } from '../components/Icon.jsx';
import { useT } from '../lib/i18n.jsx';

const SAVE_EVERY_MS = 20000;
const backupKey = (id) => `jee_arena_attempt_${id}`;

function readBackup(id) {
  try {
    return JSON.parse(localStorage.getItem(backupKey(id)) || 'null');
  } catch {
    return null;
  }
}
function writeBackup(id, v) {
  try {
    localStorage.setItem(backupKey(id), JSON.stringify(v));
  } catch {
    /* storage blocked: server autosave still covers us */
  }
}
function clearBackup(id) {
  try {
    localStorage.removeItem(backupKey(id));
  } catch {
    /* ignore */
  }
}

export default function TestRunner() {
  const { id } = useParams();
  const nav = useNavigate();
  const t = useT();
  const [paper, setPaper] = useState(null);
  const [error, setError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [marked, setMarked] = useState(new Set());
  const [visited, setVisited] = useState(new Set());
  const [idx, setIdx] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useState('saved'); // saved | pending | saving | offline
  const offset = useRef(0); // serverTime - clientTime
  const dirty = useRef(false);
  const latest = useRef({ answers: {}, marked: [], times: {} });
  // Seconds spent on each question (only while the tab is visible), for the result's time analysis.
  const times = useRef({});
  const timesDirty = useRef(false);
  const currentQid = useRef(null);
  const now = useNow(500);

  // ---- load / resume ----
  useEffect(() => {
    let cancelled = false;
    api(`/tests/${id}/start`, { method: 'POST' })
      .then((r) => {
        if (cancelled) return;
        if (r.submitted) {
          clearBackup(id);
          return nav(`/test/${id}/result`, { replace: true });
        }
        offset.current = new Date(r.serverTime).getTime() - Date.now();
        // Prefer the local backup if it is newer than what the server has (e.g. we lost connection).
        const local = readBackup(id);
        const useLocal = local && local.deadline === r.deadline;
        const ans = useLocal ? { ...r.answers, ...local.answers } : r.answers;
        setAnswers(ans);
        setMarked(new Set(useLocal ? local.marked : r.marked));
        setVisited(new Set([...Object.keys(ans).map(Number), r.questions[0]?.qid]));
        // Keep whichever time record is larger per question (local backup may be ahead of the server).
        const t = { ...(r.times || {}) };
        for (const [k, v] of Object.entries((useLocal && local.times) || {})) t[k] = Math.max(t[k] || 0, v);
        times.current = t;
        dirty.current = !!useLocal;
        setPaper(r);
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [id, nav]);

  // ---- local backup on every change ----
  useEffect(() => {
    if (!paper) return;
    latest.current = { answers, marked: [...marked], times: times.current };
    writeBackup(id, { deadline: paper.deadline, answers, marked: [...marked], times: times.current });
  }, [answers, marked, paper, id]);

  // ---- time per question: +1 s to the question on screen, while the tab is visible ----
  useEffect(() => {
    if (!paper) return undefined;
    const tick = setInterval(() => {
      const qid = currentQid.current;
      if (!qid || document.visibilityState !== 'visible') return;
      times.current[qid] = (times.current[qid] || 0) + 1;
      timesDirty.current = true;
      latest.current.times = times.current;
      if (times.current[qid] % 10 === 0) writeBackup(id, { deadline: paper.deadline, ...latest.current });
    }, 1000);
    return () => clearInterval(tick);
  }, [paper, id]);

  const save = useCallback(
    async (keepalive = false) => {
      if (!dirty.current) {
        // Nothing the student changed, only timings: send them quietly with the next autosave.
        if (!timesDirty.current) return;
        timesDirty.current = false;
        const body = { ...latest.current, times: times.current };
        if (keepalive) {
          const token = localStorage.getItem('jee_arena_token');
          fetch(`/api/tests/${id}/answers`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
        } else {
          api(`/tests/${id}/answers`, { method: 'PUT', body }).catch(() => { timesDirty.current = true; });
        }
        return;
      }
      dirty.current = false;
      timesDirty.current = false;
      latest.current.times = times.current;
      setSaveState('saving');
      try {
        if (keepalive) {
          // Page is closing: fire-and-forget request that survives the unload.
          const token = localStorage.getItem('jee_arena_token');
          fetch(`/api/tests/${id}/answers`, {
            method: 'PUT',
            keepalive: true,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(latest.current),
          });
          return;
        }
        await api(`/tests/${id}/answers`, { method: 'PUT', body: latest.current });
        setSaveState(dirty.current ? 'pending' : 'saved');
      } catch {
        dirty.current = true;
        setSaveState('offline');
      }
    },
    [id],
  );

  // ---- periodic autosave + save when tab hides ----
  useEffect(() => {
    if (!paper) return;
    const t = setInterval(() => save(), SAVE_EVERY_MS);
    const onHide = () => document.visibilityState === 'hidden' && save(true);
    const onUnload = (e) => {
      if (!submitting) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [paper, save, submitting]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api(`/tests/${id}/submit`, { method: 'POST', body: { answers: latest.current.answers, times: times.current } });
      clearBackup(id);
      nav(`/test/${id}/result`, { replace: true });
    } catch (e) {
      setError(e);
      setSubmitting(false);
    }
  }, [id, nav, submitting]);

  // ---- timer ----
  const remaining = paper ? (new Date(paper.deadline).getTime() - (now + offset.current)) / 1000 : 0;
  useEffect(() => {
    if (paper && remaining <= 0 && !submitting) submit();
  }, [paper, remaining, submitting, submit]);

  const questions = paper?.questions || [];
  const q = questions[idx];
  currentQid.current = q?.qid ?? null;
  const subjects = useMemo(() => [...new Set(questions.map((x) => x.subject))], [questions]);

  const counts = useMemo(() => {
    let answered = 0;
    let markedN = 0;
    for (const x of questions) {
      if (hasAnswer(x.type, answers[x.qid])) answered++;
      if (marked.has(x.qid)) markedN++;
    }
    return { answered, marked: markedN, notAnswered: questions.length - answered };
  }, [questions, answers, marked]);

  if (error && !paper) {
    return (
      <main className="page narrow">
        <ErrorBox error={error} />
        <button className="btn" style={{ marginTop: 12 }} onClick={() => nav(`/test/${id}`)}>{t('Back')}</button>
      </main>
    );
  }
  if (!paper) return <Spinner />;

  const go = (i) => {
    const n = Math.max(0, Math.min(questions.length - 1, i));
    setIdx(n);
    setVisited((v) => new Set(v).add(questions[n].qid));
  };
  const setAnswer = (v) => {
    dirty.current = true;
    setSaveState('pending');
    setAnswers((a) => {
      const next = { ...a };
      if (hasAnswer(q.type, v)) next[q.qid] = v;
      else delete next[q.qid];
      return next;
    });
  };
  const toggleMark = () => {
    dirty.current = true;
    setMarked((m) => {
      const s = new Set(m);
      s.has(q.qid) ? s.delete(q.qid) : s.add(q.qid);
      return s;
    });
  };

  const low = remaining < 300;
  const saveLabel = t({ saved: 'All answers saved', pending: 'Unsaved changes', saving: 'Saving…', offline: 'Offline — answers kept on this device' }[saveState]);

  return (
    <div className="runner">
      <div className="runner-top">
        <div className="inner">
          <b style={{ fontSize: '1.05rem' }}>{paper.test.title}</b>
          <span className="muted small hide-sm">{saveLabel}</span>
          <div style={{ marginLeft: 'auto' }} className="row">
            <span className={`timer ${low ? 'low' : ''}`} aria-live="off">{fmtDuration(remaining)}</span>
            <button className="btn primary" onClick={() => { save(); setConfirming(true); }}>{t('Submit')}</button>
          </div>
        </div>
      </div>

      <div className="runner-body">
        <section className="card">
          {subjects.length > 1 && (
            <div className="tabs">
              {subjects.map((s) => (
                <button key={s} className={`tab ${q.subject === s ? 'on' : ''}`} onClick={() => go(questions.findIndex((x) => x.subject === s))}>
                  {t(SUBJECT_LABEL[s])}
                </button>
              ))}
            </div>
          )}
          <div className="qhead">
            <b>{t('Question {n}', { n: idx + 1 })}</b>
            <Pill>{t(TYPE_LABEL[q.type])}</Pill>
            {marked.has(q.qid) && <Pill kind="pro"><Icon.Flag size={12} /> {t('Marked for review')}</Pill>}
          </div>
          <Rich text={q.text} />
          <div style={{ marginTop: 20 }}>
            <AnswerInput question={q} value={answers[q.qid] ?? (q.type === 'multi' ? [] : '')} onChange={setAnswer} />
          </div>
          <div className="spread" style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="row">
              <button className="btn" onClick={() => setAnswer(q.type === 'multi' ? [] : '')}>{t('Clear')}</button>
              <button className="btn" onClick={() => { toggleMark(); go(idx + 1); }}>
                {marked.has(q.qid) ? t('Unmark & next') : t('Mark for review & next')}
              </button>
            </div>
            <div className="row">
              <button className="btn" onClick={() => go(idx - 1)} disabled={idx === 0}><Icon.ChevronLeft /> {t('Back')}</button>
              <button className="btn good" onClick={() => go(idx + 1)} disabled={idx === questions.length - 1}>{t('Save & next')} <Icon.ChevronRight /></button>
            </div>
          </div>
          <ErrorBox error={error} />
        </section>

        <aside className="card stack" style={{ alignSelf: 'start', position: 'sticky', top: 70 }}>
          <div className="legend">
            <span><i style={{ background: 'var(--good)', borderColor: 'var(--good)' }} />{t('Answered')} {counts.answered}</span>
            <span><i style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad)' }} />{t('Not answered')}</span>
            <span><i />{t('Not visited')}</span>
            <span><i style={{ background: 'var(--info)', borderColor: 'var(--info)' }} />{t('Marked')} {counts.marked}</span>
          </div>
          {subjects.map((s) => (
            <div key={s}>
              {subjects.length > 1 && <div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>{t(SUBJECT_LABEL[s])}</div>}
              <div className="palette">
                {questions.map((x, i) => {
                  if (x.subject !== s) return null;
                  const a = hasAnswer(x.type, answers[x.qid]);
                  const cls = ['pbtn', visited.has(x.qid) && 'visited', a && 'answered', marked.has(x.qid) && 'marked', i === idx && 'current'].filter(Boolean).join(' ');
                  return <button key={x.qid} className={cls} onClick={() => go(i)}>{i + 1}</button>;
                })}
              </div>
            </div>
          ))}
        </aside>
      </div>

      {confirming && (
        <div className="modal-back" onClick={() => !submitting && setConfirming(false)}>
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h2>{t('Submit test?')}</h2>
            <div className="grid grid-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="stat"><b>{counts.answered}</b><span>{t('answered')}</span></div>
              <div className="stat"><b>{counts.notAnswered}</b><span>{t('left blank')}</span></div>
              <div className="stat"><b>{counts.marked}</b><span>{t('marked')}</span></div>
            </div>
            <p className="muted small" style={{ margin: 0 }}>{t("Time left: {time}. You can't change answers after submitting.", { time: fmtDuration(remaining) })}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirming(false)} disabled={submitting}>{t('Keep going')}</button>
              <button className="btn primary" onClick={submit} disabled={submitting}>{submitting ? t('Submitting…') : t('Submit now')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
