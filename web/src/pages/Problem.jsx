import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi, SUBJECT_LABEL, TYPE_LABEL, listContext, useVisibleSeconds, fmtShort, fmtDuration, useTitle, plainText } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Rich } from '../components/Rich.jsx';
import { AnswerInput, hasAnswer } from '../components/AnswerInput.jsx';
import { ProblemListDrawer } from '../components/ProblemListDrawer.jsx';
import { Discussion } from '../components/Discussion.jsx';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { NoAds } from '../components/AdSlot.jsx';
import { ReportButton } from '../components/ReportButton.jsx';
import { ReasonPicker } from '../components/ReasonPicker.jsx';
import { Icon } from '../components/Icon.jsx';
import { useT } from '../lib/i18n.jsx';

export default function Problem() {
  const { qid } = useParams();
  const [params] = useSearchParams();
  const ctx = listContext(Object.fromEntries(params));
  const toQ = useCallback((n) => `/problems/${n}${ctx ? `?${ctx}` : ''}`, [ctx]);

  const { user, refresh } = useAuth();
  const t = useT();
  const nav = useNavigate();
  const { data, error, loading } = useApi(`/problems/${qid}`, {}, [user?.id]);
  const navInfo = useApi(`/problems/${qid}/nav`, { query: Object.fromEntries(new URLSearchParams(ctx)) }, [user?.id]);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);
  const [revealed, setRevealed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [listOpen, setListOpen] = useState(false);
  const [sent, setSent] = useState(0); // seconds already reported to the server
  const [bookmarked, setBookmarked] = useState(false);

  const solved = data?.progress?.status === 'solved' || result?.correct;
  const done = solved || !!revealed;
  // A mistake the student can tag with why (My journey → Why you lose marks): a wrong answer, giving up,
  // or reopening a question that wasn't right first time.
  const pr = data?.progress;
  const missed = !!user && ((result && !result.correct) || (!!revealed && !solved) || (!result && !!pr && (pr.status !== 'solved' || pr.attempts > 1)));
  const [elapsed, readElapsed] = useVisibleSeconds(qid, !!data && !done);

  useEffect(() => {
    setAnswer(data?.question?.type === 'multi' ? [] : '');
    setResult(null);
    setRevealed(data?.revealed || null);
    setErr(null);
    setSent(0);
    setBookmarked(!!data?.bookmarked);
  }, [qid, data]);

  const tq = data?.question;
  useTitle(
    tq ? `${tq.chapterName || tq.chapter}${tq.pyq ? ` · ${tq.pyq.exam} ${tq.pyq.year}` : ''} · Q${tq.qid}` : error ? t('Question not found') : undefined,
    tq ? plainText(tq.teaser || tq.text) : undefined,
  );

  async function toggleBookmark() {
    if (!user) return nav(`/login?next=${encodeURIComponent(toQ(qid))}`);
    const next = !bookmarked;
    setBookmarked(next); // optimistic
    try {
      await api(`/problems/${qid}/bookmark`, { method: next ? 'PUT' : 'DELETE' });
    } catch {
      setBookmarked(!next);
    }
  }

  // Keyboard: Alt+← / Alt+→ for previous/next (when not typing).
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.altKey && e.key === 'ArrowLeft' && navInfo.data?.prevQid) { e.preventDefault(); nav(toQ(navInfo.data.prevQid)); }
      if (e.altKey && e.key === 'ArrowRight' && navInfo.data?.nextQid) { e.preventDefault(); nav(toQ(navInfo.data.nextQid)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navInfo.data, nav, toQ]);

  const takeTime = () => {
    const now = readElapsed();
    const delta = Math.max(0, now - sent);
    setSent(now);
    return delta;
  };

  async function submit() {
    if (!user) return nav(`/login?next=${encodeURIComponent(toQ(qid))}`);
    setBusy(true);
    setErr(null);
    try {
      const r = await api(`/problems/${qid}/submit`, { method: 'POST', body: { answer, timeSec: takeTime() } });
      setResult(r);
      if (r.revealed) {
        setRevealed(r.revealed);
        refresh();
      }
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function showSolution() {
    if (!user) return nav(`/login?next=${encodeURIComponent(toQ(qid))}`);
    if (!confirm(t('See the answer and solution? This question will count as attempted, not solved.'))) return;
    const r = await api(`/problems/${qid}/reveal`, { method: 'POST', body: { timeSec: takeTime() } });
    setRevealed(r.revealed);
  }

  const n = navInfo.data;
  const q = data?.question;
  const myTime = result?.solveTimeSec ?? data?.progress?.solveTimeSec ?? (data?.progress?.timeSpentSec || 0) + elapsed;

  return (
    <main className="page">
      {/* Navigation bar — list, previous, position, next, random */}
      <div className="qnav">
        <button className="btn sm" onClick={() => setListOpen(true)} aria-label={t('Problem list')}>
          <Icon.List />
          <span className="hide-sm">{t('Problem list')}</span>
        </button>
        <div className="qnav-mid">
          <button className="btn sm icon" disabled={!n?.prevQid} onClick={() => nav(toQ(n.prevQid))} title={`${t('Previous')} (Alt+←)`} aria-label={t('Previous')}><Icon.ChevronLeft /></button>
          <span className="muted small mono qnav-pos">{n ? `${n.position.toLocaleString('en-IN')} / ${n.total.toLocaleString('en-IN')}` : '…'}</span>
          <button className="btn sm icon" disabled={!n?.nextQid} onClick={() => nav(toQ(n.nextQid))} title={`${t('Next')} (Alt+→)`} aria-label={t('Next')}><Icon.ChevronRight /></button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn sm ghost hide-sm" to={`/problems${ctx ? `?${ctx}` : ''}`}>{t('Back to list')}</Link>
          <button
            className="btn sm"
            title={t('Random question from this list')}
            onClick={async () => {
              const r = await api('/problems/random', { query: Object.fromEntries(new URLSearchParams(ctx)) }).catch(() => null);
              if (r) nav(toQ(r.qid));
            }}
          ><Icon.Dices /></button>
        </div>
      </div>

      <ProblemListDrawer open={listOpen} onClose={() => setListOpen(false)} ctx={ctx} current={Number(qid)} toQ={toQ} />

      {loading && !data ? <Spinner /> : data?.locked ? (
        <Locked q={data.question} toQ={toQ} next={n?.nextQid} />
      ) : error ? (
        <div className="stack">
          {error.status === 404 && <NoAds />}
          <ErrorBox error={error} />
          {error.status === 403 && <p><Link to="/pro" className="btn primary">{t('See Pro')}</Link></p>}
        </div>
      ) : (
        <div className="solve">
          <div className="stack">
            <section className="card">
              <div className="qhead">
                <span className="mono muted">#{q.qid}</span>
                <Pill kind={q.subject}>{t(SUBJECT_LABEL[q.subject])}</Pill>
                <Pill kind={q.difficulty}>{t(q.difficulty)}</Pill>
                <Pill>{t(TYPE_LABEL[q.type])}</Pill>
                {q.pyq && <Pill>{q.pyq.exam} {q.pyq.year}{q.pyq.shift ? ` · ${q.pyq.shift}` : ''}</Pill>}
                {data.isPotd && <Pill kind="pro"><Icon.Sparkles size={12} /> {t('Problem of the Day')}</Pill>}
                {solved && <Pill kind="good"><Icon.CircleCheck size={12} /> {t('Solved')}</Pill>}
                <span className="row" style={{ gap: 2, marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className={`btn sm ghost bookmark ${bookmarked ? 'on' : ''}`}
                    onClick={toggleBookmark}
                    aria-pressed={bookmarked}
                    title={bookmarked ? t('Remove from your bookmarks') : t('Bookmark for revision')}
                  >
                    {bookmarked ? <><Icon.BookmarkCheck fill /> {t('Saved')}</> : <><Icon.Bookmark /> {t('Save')}</>}
                  </button>
                  <ReportButton qid={q.qid} />
                </span>
              </div>
              <h2 style={{ fontSize: '1rem', color: 'var(--muted)', fontWeight: 600 }}>
                {q.chapterId ? (
                  <>
                    <Link className="chapter-link" to={`/${q.subject}/${q.chapterId}`} title={`All ${q.chapterName} questions and PYQs`}>{q.chapterName}</Link>
                    {[q.chapterTopic, q.topic].filter(Boolean).map((x) => ` · ${x}`).join('')}
                  </>
                ) : <>{q.chapter}{q.topic ? ` · ${q.topic}` : ''}</>}
              </h2>

              <Rich text={q.text} className="qtext" />

              <div style={{ marginTop: 20 }}>
                <AnswerInput
                  question={q}
                  value={answer}
                  onChange={(v) => { setAnswer(v); if (result && !result.correct) setResult(null); }}
                  disabled={busy || !!revealed}
                  review={revealed}
                />
              </div>

              {result && (
                <div className={`alert result-alert ${result.correct ? 'good' : 'error'}`} style={{ marginTop: 16 }}>
                  {result.correct ? <Icon.CircleCheckBig size={18} /> : <Icon.CircleX size={18} />}
                  {result.correct
                    ? `${t('Correct! Solved in {time}', { time: fmtShort(result.solveTimeSec ?? myTime) })}${q.stats.avgSolveSec ? ` (${t('average {time}', { time: fmtShort(q.stats.avgSolveSec) })})` : ''}.`
                    : t('Not quite. Try again, or view the solution.')}
                </div>
              )}
              {missed && (
                <div style={{ marginTop: 12 }}>
                  <ReasonPicker key={qid} path={`/problems/${qid}/reason`} value={pr?.reason} />
                </div>
              )}
              <div style={{ marginTop: 12 }}><ErrorBox error={err} /></div>

              <div className="spread" style={{ marginTop: 12 }}>
                <div className="row">
                  {!revealed && (
                    <button className="btn primary" onClick={submit} disabled={busy || !hasAnswer(q.type, answer)}>
                      {busy ? t('Checking…') : t('Submit')}
                    </button>
                  )}
                  {!revealed && <button className="btn ghost" onClick={showSolution}><Icon.Lightbulb /> {t('Show solution')}</button>}
                </div>
                {n?.nextQid && (
                  <button className={`btn ${done ? 'primary' : ''}`} onClick={() => nav(toQ(n.nextQid))}>{t('Next question')} <Icon.ArrowRight /></button>
                )}
              </div>

              {revealed && (
                <div style={{ marginTop: 24 }}>
                  <h3 className="with-icon"><Icon.Lightbulb /> {t('Solution')}</h3>
                  <div className="solution">
                    {revealed.solution ? <Rich text={revealed.solution} /> : (
                      <span className="muted">
                        {t("There's no written solution for this question yet. Post yours in the discussion below — the most upvoted explanation becomes the official solution.")}
                      </span>
                    )}
                  </div>
                  {revealed.solutionBy?.username && (
                    <p className="muted small" style={{ margin: '6px 0 0' }}>
                      <Icon.CircleCheck size={13} /> {t('Solution by')} <Link to={`/u/${revealed.solutionBy.username}`}>@{revealed.solutionBy.username}</Link>, {t('chosen from the discussion.')}
                    </p>
                  )}
                </div>
              )}
            </section>

            <Discussion qid={q.qid} solved={solved} noSolution={!q.hasSolution} />
          </div>

          <aside className="stack solve-side">
            <div className="card">
              <h3 className="with-icon"><Icon.ChartColumn /> {t('Question stats')}</h3>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="stat"><b>{q.stats.attempts.toLocaleString('en-IN')}</b><span>{t('students tried')}</span></div>
                <div className="stat"><b>{q.stats.attempts ? Math.round((100 * q.stats.solved) / q.stats.attempts) : 0}%</b><span>{t('got it right')}</span></div>
                <div className="stat">
                  <b>{fmtShort(q.stats.avgSolveSec)}</b>
                  <span>{t('average solve time')}{q.stats.solveTimes ? ` (${q.stats.solveTimes})` : ''}</span>
                </div>
                <div className="stat">
                  <b className={!done && data ? 'ticking' : ''}>{solved ? fmtShort(myTime) : fmtDuration(myTime)}</b>
                  <span>{solved ? t('your solve time') : revealed ? t('your time') : t('your time so far')}</span>
                </div>
              </div>
              {q.stats.avgSolveSec && !done && myTime > q.stats.avgSolveSec * 2 && (
                <p className="muted small" style={{ margin: '12px 0 0' }}>{t('Taking longer than most — the discussion may have a hint.')}</p>
              )}
              {data.progress?.attempts ? <p className="muted small" style={{ margin: '10px 0 0' }}>{t('Your attempts: {n}', { n: data.progress.attempts })}</p> : null}
            </div>
            <div className="card">
              <h3 className="with-icon"><Icon.Rocket /> {t('Keep going')}</h3>
              <div className="stack">
                <Link className="btn" to={`/problems?subject=${q.subject}&chapter=${encodeURIComponent(q.chapterId || q.chapter)}`}><Icon.BookOpen /> {t('More from {chapter}', { chapter: q.chapterName || q.chapter })}</Link>
                <Link className="btn" to={`/practice?subject=${q.subject}&chapter=${encodeURIComponent(q.chapterId || q.chapter)}`}><Icon.Timer /> {t('Timed test on this chapter')}</Link>
              </div>
            </div>
            {!user && (
              <div className="card">
                <p className="small">{t("Log in to track what you've solved, keep a streak and appear on the leaderboard.")}</p>
                <Link className="btn primary" to={`/register?next=${encodeURIComponent(toQ(qid))}`}>{t('Create free account')}</Link>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

/** A Pro question seen by a free (or logged-out) student: what it is, and how to unlock it. */
function Locked({ q, toQ, next }) {
  const { user } = useAuth();
  const t = useT();
  const nav = useNavigate();
  return (
    <div className="solve">
      <section className="card locked-card">
        <div className="qhead">
          <span className="mono muted">#{q.qid}</span>
          <Pill kind={q.subject}>{t(SUBJECT_LABEL[q.subject])}</Pill>
          <Pill kind={q.difficulty}>{t(q.difficulty)}</Pill>
          <Pill>{t(TYPE_LABEL[q.type])}</Pill>
          {q.pyq && <Pill>{q.pyq.exam} {q.pyq.year}</Pill>}
          <Pill kind="pro"><Icon.Lock size={12} /> Pro</Pill>
        </div>
        <h2 style={{ fontSize: '1rem', color: 'var(--muted)', fontWeight: 600 }}>{q.chapter}{q.topic ? ` · ${q.topic}` : ''}</h2>
        <div className="locked-body">
          <Rich text={q.teaser} className="locked-teaser" />
          <div className="locked-blur" aria-hidden="true">
            <div /><div /><div style={{ width: '70%' }} />
            <div className="locked-opts"><span /><span /><span /><span /></div>
          </div>
          <div className="locked-cta">
            <div className="locked-icon"><Icon.Lock size={22} /></div>
            <h3 style={{ margin: 0 }}>{t('This is a Pro question')}</h3>
            <p className="muted small" style={{ margin: 0, maxWidth: 380 }}>
              {t('Pro unlocks every question with its full solution and discussion, full-length mock tests, and no ads.')}
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link className="btn primary" to="/pro"><Icon.Crown /> {t('Unlock with Pro')}</Link>
              {!user && <Link className="btn" to={`/login?next=${encodeURIComponent(toQ(q.qid))}`}>{t('I already have Pro')}</Link>}
            </div>
          </div>
        </div>
        {next && (
          <div className="spread" style={{ marginTop: 16 }}>
            <span className="muted small">{t('Or keep practising free questions.')}</span>
            <button className="btn" onClick={() => nav(toQ(next))}>{t('Next question')} <Icon.ArrowRight /></button>
          </div>
        )}
      </section>
      <aside className="stack solve-side">
        <div className="card">
          <h3 className="with-icon"><Icon.ChartColumn /> {t('Question stats')}</h3>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="stat"><b>{q.stats.attempts.toLocaleString('en-IN')}</b><span>{t('Pro students tried')}</span></div>
            <div className="stat"><b>{q.stats.attempts ? Math.round((100 * q.stats.solved) / q.stats.attempts) : 0}%</b><span>{t('got it right')}</span></div>
            <div className="stat"><b>{fmtShort(q.stats.avgSolveSec)}</b><span>{t('average solve time')}</span></div>
          </div>
        </div>
      </aside>
    </div>
  );
}
