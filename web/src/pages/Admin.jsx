import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, SUBJECT_LABEL, TYPE_LABEL, useTitle, timeAgo } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { Rich } from '../components/Rich.jsx';
import { ErrorBox, Pill, Spinner } from '../components/Layout.jsx';
import { Select } from '../components/Select.jsx';
import { REPORT_REASONS } from '../components/ReportButton.jsx';
import { BarChart } from '../components/BarChart.jsx';
import { Icon } from '../components/Icon.jsx';

const REASON_LABEL = Object.fromEntries(REPORT_REASONS);

export default function Admin() {
  const { user } = useAuth();
  useTitle('Admin');
  if (user?.role !== 'admin') return <main className="page narrow"><div className="alert error">Admins only.</div></main>;
  return (
    <main className="page">
      <h1>Admin</h1>
      <div className="tabs">
        <NavLink end to="/admin" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>Overview</NavLink>
        <NavLink to="/admin/growth" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>Growth</NavLink>
        <NavLink to="/admin/questions" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>Questions</NavLink>
        <NavLink to="/admin/reports" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>Reports</NavLink>
        <NavLink to="/admin/solutions" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>Solutions</NavLink>
        <NavLink to="/admin/duplicates" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>Duplicates</NavLink>
        <NavLink to="/admin/chapters" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>Chapters</NavLink>
        <NavLink to="/admin/errors" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>Errors</NavLink>
        <NavLink to="/admin/new-test" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>New contest / mock</NavLink>
        <NavLink to="/admin/users" className={({ isActive }) => `tab ${isActive ? 'on' : ''}`} style={{ textDecoration: 'none' }}>Users</NavLink>
      </div>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="growth" element={<Growth />} />
        <Route path="questions" element={<Questions />} />
        <Route path="reports" element={<Reports />} />
        <Route path="duplicates" element={<Duplicates />} />
        <Route path="chapters" element={<Chapters />} />
        <Route path="solutions" element={<Solutions />} />
        <Route path="errors" element={<Errors />} />
        <Route path="new-test" element={<NewTest />} />
        <Route path="users" element={<Users />} />
      </Routes>
    </main>
  );
}

function Overview() {
  const { data, error } = useApi('/admin/overview');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card stat"><b>{data.users}</b><span>students</span></div>
        <div className="card stat"><b>{data.pro}</b><span>Pro students</span></div>
        <div className="card stat"><b>{data.activeToday}</b><span>active today</span></div>
        <div className="card stat"><b>{data.attemptsToday}</b><span>tests started (24h)</span></div>
        <div className="card stat"><b>{data.questions.published || 0}</b><span>published questions</span></div>
        <div className="card stat"><b>{data.questions.draft || 0}</b><span>drafts (need answers)</span></div>
        <Link to="/admin/reports" className="card stat" style={{ textDecoration: 'none', color: 'inherit', borderColor: data.openReports ? 'var(--accent)' : undefined }}>
          <b>{data.openReports || 0}</b><span>questions reported by students</span>
        </Link>
        <Link to="/admin/errors" className="card stat" style={{ textDecoration: 'none', color: 'inherit', borderColor: data.errors24h ? 'var(--bad)' : undefined }}>
          <b>{data.errors24h || 0}</b><span>kinds of error (24h)</span>
        </Link>
        <div className="card stat"><b>{data.tests.contest || 0}</b><span>contests</span></div>
        <div className="card stat"><b>{data.tests.practice || 0}</b><span>custom tests made</span></div>
      </div>
      <div className="card flush table-wrap">
        <table className="table">
          <thead><tr><th>Subject</th><th>MCQ</th><th>Multi</th><th>Numerical</th></tr></thead>
          <tbody>
            {['physics', 'chemistry', 'maths'].map((s) => {
              const n = (t) => data.publishedBySubjectType.find((r) => r.subject === s && r.type === t)?.count || 0;
              return <tr key={s}><td>{SUBJECT_LABEL[s]}</td><td className="mono">{n('single')}</td><td className="mono">{n('multi')}</td><td className="mono">{n('numerical')}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">A JEE Main mock needs 20 MCQ + 5 numerical per subject.</p>
      <PremiumMix current={data.premiumQuestions} published={data.questions.published || 0} />
      <DifficultyPanel />
    </div>
  );
}

/** Re-level questions from how students actually did (server/src/lib/difficulty.js). */
function DifficultyPanel() {
  const [min, setMin] = useState(30);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run(dryRun) {
    if (!dryRun && !confirm(`Change the difficulty of ${result?.changed ?? 'these'} questions based on students' results?`)) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api('/admin/difficulty', { method: 'POST', body: { dryRun, minAttempts: min } }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card stack" style={{ maxWidth: 720 }}>
      <h3 style={{ margin: 0 }}>Difficulty from real results</h3>
      <p className="muted small" style={{ margin: 0 }}>
        Imported difficulty labels are often wrong. For questions with enough students, this sets <b>easy</b> (70%+ solve it),
        <b> medium</b> (40–70%) or <b>hard</b> (under 40%). Slow "easy" ones become medium. Levels you set by hand in the editor are never changed,
        and re-imports won't overwrite the new levels. Run it again every few weeks as more students practise.
      </p>
      <div className="row">
        <label className="row small" style={{ gap: 8 }}>
          At least
          <input className="input" type="number" min={10} value={min} onChange={(e) => setMin(Number(e.target.value))} style={{ width: 90 }} />
          students per question
        </label>
        <button className="btn" onClick={() => run(true)} disabled={busy}>Preview</button>
        <button className="btn primary" onClick={() => run(false)} disabled={busy || !result?.changed}>Apply</button>
      </div>
      <ErrorBox error={error} />
      {result && (
        <div className={`alert ${result.dryRun ? '' : 'good'}`}>
          <b>{result.dryRun ? 'Preview' : 'Done'}:</b> {result.eligible.toLocaleString('en-IN')} questions have {result.minAttempts}+ students;
          {' '}{result.changed.toLocaleString('en-IN')} {result.dryRun ? 'would change' : 'changed'}.
          {Object.keys(result.moves).length > 0 && (
            <div className="row small" style={{ marginTop: 6, gap: 14 }}>
              {Object.entries(result.moves).map(([k, n]) => <span key={k} className="mono">{k}: <b>{n}</b></span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PremiumMix({ current, published }) {
  const [percent, setPercent] = useState(20);
  const [includePyq, setIncludePyq] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(current);

  async function run(dryRun) {
    if (!dryRun && !confirm(`Make about ${percent}% of questions Pro-only? Free students will no longer be able to open them.`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api('/admin/premium', { method: 'POST', body: { percent, includePyq, dryRun } });
      setResult(r);
      if (!dryRun) setNow(r.premium);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ maxWidth: 720 }}>
      <div className="spread">
        <h3 style={{ margin: 0 }}>Pro questions</h3>
        <span className="pill pro">{now.toLocaleString('en-IN')} Pro · {published ? Math.round((100 * now) / published) : 0}%</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Picks the chosen share in <b>every chapter</b>, preferring questions with a written solution and harder ones.
        Questions you mark Pro or free by hand (Questions → Edit) are never changed. Run it again after importing new questions.
      </p>
      <div className="row">
        <label className="row small" style={{ gap: 8 }}>
          Share
          <input className="input" type="number" min={0} max={60} value={percent} onChange={(e) => setPercent(Number(e.target.value))} style={{ width: 90 }} />
          %
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={includePyq} onChange={(e) => setIncludePyq(e.target.checked)} /> Include PYQs
        </label>
        <button className="btn" onClick={() => run(true)} disabled={busy}>Preview</button>
        <button className="btn primary" onClick={() => run(false)} disabled={busy}>Apply</button>
      </div>
      {!includePyq && <p className="muted small" style={{ margin: 0 }}>PYQs stay free: they're what students search for, so they bring sign-ups.</p>}
      <ErrorBox error={error} />
      {result && (
        <div className={`alert ${result.dryRun ? '' : 'good'}`}>
          <b>{result.dryRun ? 'Preview — nothing changed yet' : 'Done'}:</b> {result.premium.toLocaleString('en-IN')} of {result.total.toLocaleString('en-IN')} published questions
          {' '}would be Pro ({result.actualPercent}%). {result.changed.madePremium.toLocaleString('en-IN')} become Pro, {result.changed.madeFree.toLocaleString('en-IN')} become free.
          <div className="row small" style={{ marginTop: 6, gap: 16 }}>
            {Object.entries(result.bySubject).map(([s, v]) => (
              <span key={s}>{SUBJECT_LABEL[s]}: <b>{v.premium.toLocaleString('en-IN')}</b> / {v.total.toLocaleString('en-IN')}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Questions() {
  const [f, setF] = useState({ status: 'draft', subject: '', source: '', search: '', page: 1 });
  const { data, error, loading, reload } = useApi('/admin/questions', { query: f });
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, page: 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.total / 25)) : 1;

  return (
    <div className="stack">
      <div className="card grid grid-4">
        <Select value={f.status} onChange={set('status')}>
          <option value="">Any status</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="hidden">Hidden</option>
        </Select>
        <Select value={f.subject} onChange={set('subject')}>
          <option value="">Any subject</option>
          {Object.entries(SUBJECT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={f.source} onChange={set('source')}>
          <option value="">Any source</option>
          {(data?.sources || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <input className="input" placeholder="Search text or #" value={f.search} onChange={set('search')} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : (
        <div className="card flush table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Question</th><th>Chapter</th><th>Type</th><th>Source</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data?.items.map((q) => (
                <tr key={q.qid}>
                  <td className="mono">{q.qid}</td>
                  <td style={{ maxWidth: 380 }}><div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.text.slice(0, 140)}</div></td>
                  <td className="small">{SUBJECT_LABEL[q.subject]} · {q.chapter}</td>
                  <td className="small">{TYPE_LABEL[q.type]}</td>
                  <td className="small muted">{q.source?.name}</td>
                  <td><Pill kind={q.status === 'published' ? 'good' : ''}>{q.status}</Pill>{q.premium && <span className="pill pro" style={{ marginLeft: 4 }}>Pro{q.premiumSource === 'manual' ? ' ✎' : ''}</span>}</td>
                  <td><button className="btn sm" onClick={() => setEditing(q)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.items.length && <div className="empty">No questions.</div>}
        </div>
      )}
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>← Prev</button>
          <span className="muted small">Page {f.page} of {pages} · {data.total}</span>
          <button className="btn sm" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next →</button>
        </div>
      )}
      {editing && <Editor q={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

/** Questions students flagged, most-reported first. "Fix" opens the normal editor; saving resolves the reports. */
function Reports() {
  const [f, setF] = useState({ status: 'open', page: 1 });
  const { data, error, loading, reload } = useApi('/admin/reports', { query: f });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const pages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  async function close(qid, status) {
    setBusy(qid);
    try {
      await api(`/admin/reports/${qid}`, { method: 'PATCH', body: { status } });
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <div className="chips">
          {[['open', 'Open'], ['resolved', 'Fixed'], ['dismissed', 'Dismissed']].map(([k, v]) => (
            <button key={k} className={`chip ${f.status === k ? 'on' : ''}`} onClick={() => setF({ status: k, page: 1 })}>{v}</button>
          ))}
        </div>
        {data && <span className="muted small">{data.total} question{data.total === 1 ? '' : 's'}</span>}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : !data?.items.length ? (
        <div className="card empty">{f.status === 'open' ? 'No open reports. 🎉' : 'Nothing here.'}</div>
      ) : (
        data.items.map((it) => {
          const q = it.question;
          return (
            <article key={it.qid} className="card stack">
              <div className="qhead" style={{ marginBottom: 0 }}>
                <b className="mono">#{it.qid}</b>
                <Pill kind="hard">{it.count} report{it.count === 1 ? '' : 's'}</Pill>
                {Object.entries(it.byReason).map(([k, n]) => <Pill key={k}>{REASON_LABEL[k] || k}{n > 1 ? ` ×${n}` : ''}</Pill>)}
                {q && <span className="muted small">{SUBJECT_LABEL[q.subject]} · {q.chapter} · {TYPE_LABEL[q.type]} · {q.source?.name} · <Pill kind={q.status === 'published' ? 'good' : ''}>{q.status}</Pill></span>}
                <span className="muted small" style={{ marginLeft: 'auto' }}>{timeAgo(it.latest)}</span>
              </div>
              {q ? (
                <div className="grid grid-2">
                  <div className="small" style={{ maxHeight: 220, overflow: 'auto' }}><Rich text={q.text} /></div>
                  <div className="small">
                    <div className="muted">Answer key: <b className="mono">{q.answer?.keys?.join(', ') ?? q.answer?.value ?? (q.answer?.min !== undefined ? `${q.answer.min}–${q.answer.max}` : '—')}</b></div>
                    {q.options?.length > 0 && (
                      <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {q.options.map((o) => <li key={o.key} style={{ listStyle: 'none' }}><b className="mono">{o.key}.</b> <Rich text={o.text} as="span" /></li>)}
                      </ol>
                    )}
                  </div>
                </div>
              ) : <div className="alert warn">This question no longer exists.</div>}
              {it.notes.some((n) => n.note) && (
                <div className="stack" style={{ borderLeft: '3px solid var(--border)', paddingLeft: 10 }}>
                  {it.notes.filter((n) => n.note).map((n, i) => (
                    <div key={i} className="small">
                      <span className="muted">@{n.username || 'someone'} · {REASON_LABEL[n.reason] || n.reason}{n.from === 'test' ? ' · from a test' : ''}:</span> {n.note}
                    </div>
                  ))}
                </div>
              )}
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Link className="btn sm ghost" to={`/problems/${it.qid}`} target="_blank">Open as student <Icon.ExternalLink size={13} /></Link>
                {f.status === 'open' ? (
                  <>
                    <button className="btn sm" disabled={busy === it.qid} onClick={() => close(it.qid, 'dismissed')}>Dismiss (not a real problem)</button>
                    <button className="btn sm" disabled={busy === it.qid} onClick={() => close(it.qid, 'resolved')}>Mark fixed</button>
                    {q && <button className="btn sm primary" onClick={() => setEditing(q)}>Fix in editor</button>}
                  </>
                ) : (
                  <button className="btn sm" disabled={busy === it.qid} onClick={() => close(it.qid, 'open')}>Reopen</button>
                )}
              </div>
            </article>
          );
        })
      )}
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>← Prev</button>
          <span className="muted small">Page {f.page} of {pages}</span>
          <button className="btn sm" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next →</button>
        </div>
      )}
      {editing && (
        <Editor
          q={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            const qid = editing.qid;
            setEditing(null);
            await close(qid, 'resolved'); // saving from here means it's been fixed
          }}
        />
      )}
    </div>
  );
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');

/** Is the site growing, where do students come from, and do they come back? */
function Growth() {
  const [days, setDays] = useState(30);
  const { data, error, loading } = useApi('/admin/growth', { query: { days } });
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Spinner />;
  const t = data.totals;
  const r = data.retention;
  return (
    <div className="stack">
      <div className="spread">
        <div className="chips">
          {[7, 30, 90].map((d) => <button key={d} className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>Last {d} days</button>)}
        </div>
        <span className="muted small">{data.from} → {data.to} (IST)</span>
      </div>
      <div className="grid grid-4">
        <div className="card stat"><b>{t.users.toLocaleString('en-IN')}</b><span>students in total</span></div>
        <div className="card stat"><b>{t.signupsWeek.toLocaleString('en-IN')}</b><span>new in the last 7 days</span></div>
        <div className="card stat"><b>{t.activeWeek.toLocaleString('en-IN')}</b><span>active this week (solved or tested)</span></div>
        <div className="card stat"><b>{t.activeMonth.toLocaleString('en-IN')}</b><span>active in the last 30 days</span></div>
        <div className="card stat"><b>{t.visits.toLocaleString('en-IN')}</b><span>visits in this period</span></div>
        <div className="card stat"><b>{pct(t.signups, t.newVisitors)}</b><span>of new visitors signed up ({t.signups}/{t.newVisitors})</span></div>
        <div className="card stat" title="Of students who signed up 8–37 days ago">
          <b>{pct(r.d1, r.cohort)}</b><span>came back the next day{r.cohort ? ` (${r.d1}/${r.cohort})` : ''}</span>
        </div>
        <div className="card stat" title="Of students who signed up 8–37 days ago">
          <b>{pct(r.d7, r.cohort)}</b><span>came back within a week{r.cohort ? ` (${r.d7}/${r.cohort})` : ''}</span>
        </div>
      </div>
      <div className="grid grid-3">
        <BarChart title="Visits per day" data={data.series} valueKey="visits" />
        <BarChart title="Sign-ups per day" data={data.series} valueKey="signups" />
        <BarChart title="Active students per day" data={data.series} valueKey="active" />
      </div>
      <div className="grid grid-2">
        <div className="card flush table-wrap">
          <div style={{ padding: '14px 14px 0' }}><h3>Where students come from</h3></div>
          {data.sources.length ? (
            <table className="table">
              <thead><tr><th>Source</th><th>Visits</th><th>New visitors</th><th>Sign-ups</th><th>Sign-up rate</th></tr></thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.source}>
                    <td><b style={{ fontWeight: 600 }}>{s.source}</b></td>
                    <td className="mono">{s.visits.toLocaleString('en-IN')}</td>
                    <td className="mono">{s.newVisitors.toLocaleString('en-IN')}</td>
                    <td className="mono">{s.signups.toLocaleString('en-IN')}</td>
                    <td className="mono">{pct(s.signups, s.newVisitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">No visits recorded yet.</div>}
          <p className="muted small" style={{ padding: '0 14px 12px', margin: 0 }}>
            <b>share</b> = links from result share cards · <b>app</b> = opened from the installed app · <b>direct</b> = typed, bookmarked or
            from apps that hide the source (WhatsApp often does). Tag your own links, e.g. <span className="mono">?utm_source=youtube-shorts</span>, to tell them apart.
          </p>
        </div>
        <div className="card flush">
          <div style={{ padding: '14px 14px 0' }}><h3>Students who bring friends</h3></div>
          {data.referrers.length ? (
            <table className="table">
              <thead><tr><th>Student</th><th>Friends who signed up</th></tr></thead>
              <tbody>
                {data.referrers.map((u) => (
                  <tr key={u.username}><td><Link to={`/u/${u.username}`}>{u.name}</Link> <span className="muted small">@{u.username}</span></td><td className="mono">{u.referrals}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">Nobody yet. Every share card link carries the sharer's username, so sign-ups from it are credited here.</div>}
        </div>
      </div>
    </div>
  );
}

/** Well-voted discussion comments on questions without a written solution: make one the official solution. */
function Solutions() {
  const [f, setF] = useState({ min: 2, all: '', page: 1 });
  const { data, error, loading, reload } = useApi('/admin/solution-candidates', { query: f });
  const pages = data ? Math.max(1, Math.ceil(data.total / 10)) : 1;
  return (
    <div className="stack">
      <div className="spread">
        <div className="row">
          <label className="row small" style={{ gap: 8 }}>
            At least
            <input className="input" type="number" min={1} value={f.min} onChange={(e) => setF({ ...f, min: Number(e.target.value) || 1, page: 1 })} style={{ width: 80 }} />
            upvotes
          </label>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={f.all === '1'} onChange={(e) => setF({ ...f, all: e.target.checked ? '1' : '', page: 1 })} /> Include questions that already have a solution
          </label>
        </div>
        {data && <span className="muted small">{data.total} question{data.total === 1 ? '' : 's'}</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Students see "the most upvoted explanation becomes the official solution" on questions without one. Accepting copies the comment
        (you can tidy it first) into the question's solution, credits the author on it and on their profile, and the importer won't overwrite it.
      </p>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : !data?.items.length ? (
        <div className="card empty">No candidates yet. They appear when a comment on a question without a solution gets {f.min}+ upvotes.</div>
      ) : data.items.map((it) => <SolutionCandidate key={it.question.qid} it={it} onDone={reload} />)}
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>← Prev</button>
          <span className="muted small">Page {f.page} of {pages}</span>
          <button className="btn sm" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next →</button>
        </div>
      )}
    </div>
  );
}

function SolutionCandidate({ it, onDone }) {
  const q = it.question;
  const [pick, setPick] = useState(it.comments[0].id);
  const chosen = it.comments.find((c) => c.id === pick);
  const [body, setBody] = useState(chosen.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => setBody(it.comments.find((c) => c.id === pick).body), [pick, it.comments]);
  async function act(path, payload) {
    setBusy(true);
    setErr(null);
    try {
      await api(path, { method: 'POST', body: payload });
      onDone();
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  }
  return (
    <article className="card stack">
      <div className="qhead" style={{ marginBottom: 0 }}>
        <Link className="mono" to={`/problems/${q.qid}`} target="_blank">#{q.qid} <Icon.ExternalLink size={12} /></Link>
        <span className="muted small">{SUBJECT_LABEL[q.subject]} · {q.chapter} · {TYPE_LABEL[q.type]} · answer <b className="mono">{fmtAnswer(q.answer)}</b></span>
        {q.solution && <Pill>has a solution already</Pill>}
      </div>
      <div className="grid grid-2">
        <div className="small" style={{ maxHeight: 260, overflow: 'auto' }}>
          <Rich text={q.text} />
          {q.options.map((o) => <div key={o.key}><b className="mono">{o.key}.</b> <Rich text={o.text} as="span" /></div>)}
        </div>
        <div className="stack">
          {it.comments.length > 1 && (
            <div className="chips">
              {it.comments.map((c) => (
                <button key={c.id} className={`chip ${pick === c.id ? 'on' : ''}`} onClick={() => setPick(c.id)}>▲ {c.score} @{c.author.username}</button>
              ))}
            </div>
          )}
          <div className="muted small">
            ▲ {chosen.score} · by <Link to={`/u/${chosen.author.username}`}>@{chosen.author.username}</Link>
            {chosen.author.accepted ? ` · ${chosen.author.accepted} accepted before` : ''} · {timeAgo(chosen.createdAt)}
          </div>
          <textarea className="input mono small" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="card small" style={{ maxHeight: 200, overflow: 'auto' }}><Rich text={body} /></div>
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm" disabled={busy} onClick={() => act(`/admin/solution-candidates/${pick}/dismiss`)}>Not good enough</button>
        <button className="btn sm primary" disabled={busy || !body.trim()} onClick={() => act(`/admin/solution-candidates/${pick}/accept`, { body })}>Make official solution</button>
      </div>
    </article>
  );
}

/** Crashes on the server and in students' browsers, grouped. Delete = "fixed" (it comes back if it happens again). */
function Errors() {
  const [where, setWhere] = useState('');
  const { data, error, loading, reload } = useApi('/admin/errors', { query: { where } });
  const [open, setOpen] = useState(null);
  const del = async (id) => {
    await api(`/admin/errors/${id}`, { method: 'DELETE' });
    reload();
  };
  const clearAll = async () => {
    if (!confirm('Clear the whole error log?')) return;
    await api('/admin/errors', { method: 'DELETE' });
    reload();
  };
  return (
    <div className="stack">
      <div className="spread">
        <div className="chips">
          {[['', 'All'], ['server', 'Server'], ['web', 'Browser']].map(([k, v]) => (
            <button key={k} className={`chip ${where === k ? 'on' : ''}`} onClick={() => setWhere(k)}>{v}</button>
          ))}
        </div>
        <div className="row">
          <button className="btn sm" onClick={reload}>Refresh</button>
          {data?.items.length > 0 && <button className="btn sm ghost" onClick={clearAll}>Clear all</button>}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Server errors (500s, crashes) and JavaScript errors from students' browsers, grouped by cause. Kept for 30 days after they were last seen.
        Mark one fixed after deploying the fix; if it happens again it reappears.
      </p>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : !data?.items.length ? <div className="card empty">No errors. 🎉</div> : (
        <div className="card flush">
          {data.items.map((e) => (
            <div key={e._id} style={{ borderTop: '1px solid var(--border)', padding: '10px 14px' }}>
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <button onClick={() => setOpen(open === e._id ? null : e._id)} style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <Pill kind={e.where === 'server' ? 'hard' : 'medium'}>{e.where === 'server' ? 'server' : 'browser'}</Pill>
                    <b className="mono small" style={{ wordBreak: 'break-word' }}>{e.message}</b>
                  </div>
                  <div className="muted small" style={{ marginTop: 3 }}>
                    ×{e.count} · last {timeAgo(e.lastAt)} · first {timeAgo(e.firstAt)}{e.lastUrl ? ` · ${e.lastMethod ? `${e.lastMethod} ` : ''}${e.lastUrl.replace(/^https?:\/\/[^/]+/, '')}` : ''} · {e.release}
                  </div>
                </button>
                <button className="btn sm" onClick={() => del(e._id)}>Fixed</button>
              </div>
              {open === e._id && (
                <pre className="mono small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 8, marginTop: 8, maxHeight: 320, overflow: 'auto' }}>
                  {e.stack || '(no stack trace)'}{e.extra ? `\n\n${e.extra}` : ''}{e.lastUa ? `\n\n${e.lastUa}` : ''}{e.lastUser ? `\nuser ${e.lastUser}` : ''}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const fmtAnswer = (a) => (!a ? '—' : a.keys ? a.keys.join(', ') : a.value !== undefined && a.value !== null ? String(a.value) : a.min !== undefined ? `${a.min}–${a.max}` : '—');

/** Copies of the same question from different import sources. Merge = keep one, hide the rest. */
function Duplicates() {
  const [f, setF] = useState({ mode: 'exact', page: 1 });
  const { data, error, loading, reload } = useApi('/admin/duplicates', { query: f });
  const [auto, setAuto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const pages = data ? Math.max(1, Math.ceil(data.totalGroups / 10)) : 1;
  const scanning = data?.scan?.running;

  // While a scan runs, refresh every 2 s to show progress.
  useEffect(() => {
    if (!scanning) return undefined;
    const t = setTimeout(reload, 2000);
    return () => clearTimeout(t);
  }, [scanning, data, reload]);

  async function run(fn) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }
  const rescan = () => run(async () => { await api('/admin/duplicates/scan', { method: 'POST' }); reload(); });
  const previewAuto = () => run(async () => setAuto(await api('/admin/duplicates/auto', { method: 'POST', body: { dryRun: true } })));
  const applyAuto = () => run(async () => {
    if (!confirm(`Merge ${auto.merged} groups and hide ${auto.hidden} duplicate copies? Nothing is deleted; hidden copies can be re-published from Questions.`)) return;
    setAuto(await api('/admin/duplicates/auto', { method: 'POST', body: { dryRun: false } }));
    reload();
  });

  return (
    <div className="stack">
      <div className="spread">
        <div className="chips">
          <button className={`chip ${f.mode === 'exact' ? 'on' : ''}`} onClick={() => setF({ mode: 'exact', page: 1 })}>Exact (text + options)</button>
          <button className={`chip ${f.mode === 'text' ? 'on' : ''}`} onClick={() => setF({ mode: 'text', page: 1 })}>Same question text</button>
        </div>
        <div className="row">
          <button className="btn sm" onClick={rescan} disabled={busy || scanning}>{scanning ? `Scanning… ${data.scan.done.toLocaleString('en-IN')} / ${data.scan.total.toLocaleString('en-IN')}` : 'Rescan bank'}</button>
          {f.mode === 'exact' && <button className="btn sm" onClick={previewAuto} disabled={busy || scanning || !data?.totalGroups}>Auto-merge…</button>}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {f.mode === 'exact'
          ? 'Same question and same options (ignoring LaTeX formatting, option order, exam tags and picture names). Safe to merge when the answers agree.'
          : 'Same question text, options may differ. Check each one — these can be genuinely different questions sharing a long stem.'}
        {' '}Merging keeps one copy and hides the rest (nothing is deleted); the kept copy picks up a missing solution or PYQ tag, and bookmarks move over.
      </p>
      {data?.needsScan && !scanning && <div className="alert warn">Some questions haven't been fingerprinted yet. Click <b>Rescan bank</b> (takes a minute or two for 140k questions).</div>}
      {auto && (
        <div className={`alert ${auto.dryRun ? '' : 'good'}`}>
          {auto.dryRun ? (
            <>
              <b>Preview:</b> {auto.merged.toLocaleString('en-IN')} of {auto.groups.toLocaleString('en-IN')} groups agree on the answer → {auto.hidden.toLocaleString('en-IN')} copies would be hidden.
              {' '}{auto.conflicts} groups disagree and are left for you. <button className="btn sm primary" onClick={applyAuto} disabled={busy || !auto.merged}>Merge them</button>
            </>
          ) : (
            <><b>Done:</b> merged {auto.merged.toLocaleString('en-IN')} groups, hid {auto.hidden.toLocaleString('en-IN')} copies. {auto.conflicts} left to review below.</>
          )}
        </div>
      )}
      <ErrorBox error={error || err} />
      {data && <div className="muted small">{data.totalGroups.toLocaleString('en-IN')} groups · {data.extraCopies.toLocaleString('en-IN')} extra copies</div>}
      {loading && !data ? <Spinner /> : !data?.items.length ? (
        <div className="card empty">{data?.needsScan ? 'Run a scan first.' : 'No duplicates found. 🎉'}</div>
      ) : (
        data.items.map((g) => <DupGroup key={g.key} g={g} mode={f.mode} onDone={reload} />)
      )}
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>← Prev</button>
          <span className="muted small">Page {f.page} of {pages}</span>
          <button className="btn sm" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>Next →</button>
        </div>
      )}
    </div>
  );
}

function DupGroup({ g, mode, onDone }) {
  const [keep, setKeep] = useState(g.keep);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function act(path, body) {
    setBusy(true);
    setErr(null);
    try {
      await api(path, { method: 'POST', body });
      onDone();
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  }
  const cols = Math.min(3, g.questions.length);
  return (
    <article className="card stack">
      <div className="qhead" style={{ marginBottom: 0 }}>
        <b>{g.questions.length} copies</b>
        {g.answersAgree ? <Pill kind="good">Answers agree</Pill> : <Pill kind="hard">⚠ Answer keys differ</Pill>}
        <span className="muted small">{SUBJECT_LABEL[g.questions[0]?.subject]} · {g.questions[0]?.chapter}</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${cols === 3 ? 240 : 300}px, 1fr))`, gap: 10 }}>
        {g.questions.map((q) => (
          <label key={q.qid} className={`option ${keep === q.qid ? 'picked' : ''}`} style={{ display: 'block', cursor: 'pointer' }}>
            <div className="row" style={{ gap: 6, marginBottom: 6 }}>
              <input type="radio" name={`keep-${g.key}`} checked={keep === q.qid} onChange={() => setKeep(q.qid)} />
              <b className="mono">#{q.qid}</b>
              <Pill kind={q.status === 'published' ? 'good' : ''}>{q.status}</Pill>
              {q.pyq && <Pill>{q.pyq.exam} {q.pyq.year}</Pill>}
              {q.hasSolution && <Pill>solution</Pill>}
              {q.premium && <span className="pill pro">Pro</span>}
              {keep === q.qid && <span className="small" style={{ color: 'var(--accent)', fontWeight: 700 }}>keep</span>}
            </div>
            <div className="muted small">{q.source} · {TYPE_LABEL[q.type]} · {q.difficulty} · {q.attempts} tried · answer <b className="mono">{fmtAnswer(q.answer)}</b></div>
            <div className="small" style={{ maxHeight: 160, overflow: 'auto', marginTop: 6 }}><Rich text={q.text} /></div>
            {q.options.length > 0 && (
              <div className="small" style={{ marginTop: 4 }}>
                {q.options.map((o) => <div key={o.key}><b className="mono">{o.key}.</b> <Rich text={o.text} as="span" /></div>)}
              </div>
            )}
          </label>
        ))}
      </div>
      <ErrorBox error={err} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm" disabled={busy} onClick={() => act('/admin/duplicates/ignore', { mode, key: g.key })}>Not duplicates</button>
        <button
          className="btn sm primary"
          disabled={busy || !keep}
          onClick={() => act('/admin/duplicates/merge', { keep, hide: g.questions.map((q) => q.qid).filter((q) => q !== keep) })}
        >
          Keep #{keep}, hide {g.questions.length - 1}
        </button>
      </div>
    </article>
  );
}

/** The standard JEE chapter a question counts under (filters, chapter pages, analysis, tests). */
function StandardChapter({ subject, value, onChange }) {
  const meta = useApi('/problems/meta');
  const units = meta.data?.subjects?.[subject]?.units || [];
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} placeholder="Standard chapter">
      <option value="">No standard chapter</option>
      {units.map((u) => (
        <optgroup key={u.name} label={u.name}>
          {u.chapters.map((c) => <option key={c.id} value={c.id}>{c.chapter}</option>)}
        </optgroup>
      ))}
    </Select>
  );
}

function Editor({ q, onClose, onSaved }) {
  const [d, setD] = useState(() => ({
    ...q,
    options: q.options?.length ? q.options : q.type === 'numerical' ? [] : ['A', 'B', 'C', 'D'].map((key) => ({ key, text: '' })),
    answer: q.answer || (q.type === 'numerical' ? { value: '' } : { keys: [] }),
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const changeType = (type) => {
    setD((x) => ({
      ...x,
      type,
      answer: type === 'numerical' ? { value: '' } : { keys: (x.answer?.keys || []).slice(0, type === 'single' ? 1 : 8) },
      options: type === 'numerical' ? [] : x.options.length ? x.options : ['A', 'B', 'C', 'D'].map((key) => ({ key, text: '' })),
    }));
  };
  const toggleKey = (k) => {
    const keys = new Set(d.answer.keys || []);
    if (d.type === 'single') return set('answer', { keys: [k] });
    keys.has(k) ? keys.delete(k) : keys.add(k);
    set('answer', { keys: [...keys].sort() });
  };

  async function save(status) {
    setBusy(true);
    setError(null);
    try {
      const answer = d.type === 'numerical'
        ? (d.answer.value === '' || d.answer.value === undefined ? null : { value: Number(d.answer.value), tolerance: d.answer.tolerance ? Number(d.answer.tolerance) : undefined })
        : d.answer.keys?.length ? { keys: d.answer.keys } : null;
      await api(`/admin/questions/${q.qid}`, {
        method: 'PATCH',
        body: {
          subject: d.subject, chapter: d.chapter, topic: d.topic, difficulty: d.difficulty, type: d.type,
          text: d.text, options: d.options, solution: d.solution, premium: d.premium,
          ...(answer ? { answer } : {}),
          ...(status ? { status } : {}),
          ...((d.chapterId || null) !== (q.chapterId || null) ? { chapterId: d.chapterId || null } : {}),
        },
      });
      onSaved();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal stack" style={{ maxWidth: 1000, maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h2 style={{ margin: 0 }}>Question #{q.qid}</h2>
          <span className="muted small">
            source: {q.source?.name} / {q.source?.id}
            {q.duplicateOf ? ` · duplicate of #${q.duplicateOf}` : ''}
            {q.difficultySource === 'data' ? ` · level from ${q.stats?.attempts} students (${q.solveRate}% solve${q.difficultyOriginal ? `; source said ${q.difficultyOriginal}` : ''})` : ''}
          </span>
        </div>
        <div className="grid grid-4">
          <Select value={d.subject} onChange={(e) => set('subject', e.target.value)}>
            {Object.entries(SUBJECT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <input className="input" value={d.chapter || ''} onChange={(e) => set('chapter', e.target.value)} placeholder="Chapter (as imported)" title="The chapter name from the source" />
          <StandardChapter subject={d.subject} value={d.chapterId || ''} onChange={(v) => set('chapterId', v)} />
          <Select value={d.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
            <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
          </Select>
          <Select value={d.type} onChange={(e) => changeType(e.target.value)}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div className="grid grid-2">
          <label className="field"><span>Question text (LaTeX in $…$)</span>
            <textarea className="input mono" rows={7} value={d.text} onChange={(e) => set('text', e.target.value)} />
          </label>
          <div className="card"><div className="muted small">Preview</div><Rich text={d.text} /></div>
        </div>
        {d.type !== 'numerical' ? (
          <div className="stack">
            <div className="small" style={{ fontWeight: 600 }}>Options — tick the correct {d.type === 'multi' ? 'ones' : 'one'}</div>
            {d.options.map((o, i) => (
              <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                <input type={d.type === 'single' ? 'radio' : 'checkbox'} name="ans" checked={(d.answer.keys || []).includes(o.key)} onChange={() => toggleKey(o.key)} />
                <b className="mono">{o.key}</b>
                <input className="input" value={o.text} onChange={(e) => set('options', d.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <div style={{ minWidth: 160 }}><Rich text={o.text} className="small" /></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-3">
            <label className="field"><span>Correct value</span>
              <input className="input mono" value={d.answer.value ?? ''} onChange={(e) => set('answer', { ...d.answer, value: e.target.value })} />
            </label>
            <label className="field"><span>Tolerance (default 0.01)</span>
              <input className="input mono" value={d.answer.tolerance ?? ''} onChange={(e) => set('answer', { ...d.answer, tolerance: e.target.value })} />
            </label>
          </div>
        )}
        <div className="grid grid-2">
          <label className="field"><span>Solution</span>
            <textarea className="input mono" rows={5} value={d.solution || ''} onChange={(e) => set('solution', e.target.value)} />
          </label>
          <div className="card"><div className="muted small">Preview</div><Rich text={d.solution || ''} /></div>
        </div>
        <label className="row small"><input type="checkbox" checked={!!d.premium} onChange={(e) => set('premium', e.target.checked)} /> Pro-only question</label>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {q.status !== 'hidden' && <button className="btn" onClick={() => save('hidden')} disabled={busy}>Hide</button>}
          <button className="btn" onClick={() => save()} disabled={busy}>Save</button>
          <button className="btn primary" onClick={() => save('published')} disabled={busy}>Save & publish</button>
        </div>
      </div>
    </div>
  );
}

function NewTest() {
  const nav = useNavigate();
  const nextSunday = () => {
    const d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
    d.setHours(10, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [f, setF] = useState({
    kind: 'contest', title: '', description: '', startAt: nextSunday(), durationMin: 60, windowMin: 60,
    pattern: 'custom', scheme: 'jee_main', rated: true, premium: false,
    sections: [{ subject: 'physics', type: 'single', count: 10 }, { subject: 'chemistry', type: 'single', count: 10 }, { subject: 'maths', type: 'single', count: 10 }],
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setSec = (i, k, v) => set('sections', f.sections.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, startAt: f.kind === 'contest' ? new Date(f.startAt).toISOString() : undefined };
      if (f.pattern === 'jee_main') delete body.sections;
      const r = await api('/admin/tests', { method: 'POST', body });
      nav(`/test/${r.slug || r.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ maxWidth: 820 }}>
      <div className="chips">
        <button className={`chip ${f.kind === 'contest' ? 'on' : ''}`} onClick={() => set('kind', 'contest')}>Contest (scheduled, rated)</button>
        <button className={`chip ${f.kind === 'mock' ? 'on' : ''}`} onClick={() => setF({ ...f, kind: 'mock', pattern: 'jee_main', durationMin: 180 })}>Mock test (any time)</button>
      </div>
      <label className="field"><span>Title</span><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder={f.kind === 'contest' ? 'Weekly Contest 12' : 'JEE Main Full Mock 3'} /></label>
      <label className="field"><span>Description (optional)</span><input className="input" value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
      <div className="grid grid-4">
        {f.kind === 'contest' && <label className="field"><span>Starts</span><input className="input" type="datetime-local" value={f.startAt} onChange={(e) => set('startAt', e.target.value)} /></label>}
        <label className="field"><span>Duration (min)</span><input className="input" type="number" value={f.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))} /></label>
        {f.kind === 'contest' && <label className="field"><span>Entry window (min)</span><input className="input" type="number" value={f.windowMin} onChange={(e) => set('windowMin', Number(e.target.value))} /></label>}
        <label className="field"><span>Marking</span>
          <Select value={f.scheme} onChange={(e) => set('scheme', e.target.value)}>
            <option value="jee_main">JEE Main</option><option value="jee_adv">JEE Advanced</option><option value="practice">No negative</option>
          </Select>
        </label>
      </div>
      {f.kind === 'contest' && <p className="muted small" style={{ margin: 0 }}>Entry window = how long after the start people can still join. Equal to duration means everyone writes together (LeetCode-style).</p>}
      <div className="row">
        {f.kind === 'contest' && <label className="row small"><input type="checkbox" checked={f.rated} onChange={(e) => set('rated', e.target.checked)} /> Rated</label>}
        {f.kind === 'mock' && <label className="row small"><input type="checkbox" checked={f.premium} onChange={(e) => set('premium', e.target.checked)} /> Pro only</label>}
      </div>

      <div className="chips">
        <button className={`chip ${f.pattern === 'jee_main' ? 'on' : ''}`} onClick={() => setF({ ...f, pattern: 'jee_main', durationMin: 180 })}>Full JEE Main pattern (75 Q)</button>
        <button className={`chip ${f.pattern === 'custom' ? 'on' : ''}`} onClick={() => set('pattern', 'custom')}>Custom sections</button>
      </div>
      {f.pattern === 'custom' && (
        <div className="stack">
          {f.sections.map((s, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <Select value={s.subject} onChange={(e) => setSec(i, 'subject', e.target.value)}>
                {Object.entries(SUBJECT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select value={s.type} onChange={(e) => setSec(i, 'type', e.target.value)}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select value={s.difficulty || ''} onChange={(e) => setSec(i, 'difficulty', e.target.value)}>
                <option value="">Any level</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </Select>
              <input className="input" type="number" min={1} style={{ maxWidth: 90 }} value={s.count} onChange={(e) => setSec(i, 'count', Number(e.target.value))} />
              <button className="btn sm ghost" onClick={() => set('sections', f.sections.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div><button className="btn sm" onClick={() => set('sections', [...f.sections, { subject: 'physics', type: 'single', count: 5 }])}>+ Section</button></div>
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>Questions are picked at random from published ones. Contest questions are hidden from the practice list until the contest ends.</p>
      <ErrorBox error={error} />
      <div><button className="btn primary lg" onClick={create} disabled={busy || f.title.trim().length < 3}>{busy ? 'Creating…' : 'Create'}</button></div>
    </div>
  );
}

function Users() {
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  async function setPlan(plan) {
    setMsg(null);
    setError(null);
    try {
      const r = await api(`/admin/users/${encodeURIComponent(username.trim())}`, { method: 'PATCH', body: { plan } });
      setMsg(`@${r.username} is now on ${r.plan}.`);
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="card stack" style={{ maxWidth: 520 }}>
      <h3>Grant or remove Pro</h3>
      <p className="muted small" style={{ margin: 0 }}>Until online payment is connected, activate Pro here after a student pays.</p>
      <input className="input" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <div className="row">
        <button className="btn primary" onClick={() => setPlan('pro')} disabled={!username.trim()}>Make Pro</button>
        <button className="btn" onClick={() => setPlan('free')} disabled={!username.trim()}>Set to Free</button>
        {username.trim() && <Link className="btn ghost" to={`/u/${username.trim()}`}>View profile</Link>}
      </div>
      {msg && <div className="alert good">{msg}</div>}
      <ErrorBox error={error} />
    </div>
  );
}

/**
 * Questions the importer couldn't place in a standard chapter. `npm run chapters:classify` guesses one
 * from the text; confident guesses are placed automatically, the rest wait here for a one-click yes.
 */
function Chapters() {
  const [f, setF] = useState({ subject: 'maths', status: 'none', page: 1 });
  const { data, error, loading, reload } = useApi('/admin/chapters', { query: f });
  const meta = useApi('/problems/meta');
  const [done, setDone] = useState({});
  const [busy, setBusy] = useState(null);
  const [minP, setMinP] = useState('0.8');
  const [msg, setMsg] = useState(null);
  const pages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;
  const units = meta.data?.subjects?.[f.subject]?.units || [];

  useEffect(() => setDone({}), [f]);

  async function setChapter(qid, chapterId) {
    setBusy(qid);
    try {
      await api(`/admin/chapters/${qid}`, { method: 'POST', body: { chapterId } });
      setDone((d) => ({ ...d, [qid]: chapterId || 'none' }));
    } finally {
      setBusy(null);
    }
  }
  async function acceptAll() {
    setBusy('all');
    try {
      const r = await api('/admin/chapters-accept', { method: 'POST', body: { subject: f.subject, minP: Number(minP) } });
      setMsg(`Accepted ${r.accepted.toLocaleString('en-IN')} guesses.`);
      reload();
    } finally {
      setBusy(null);
    }
  }
  const nameOf = (id) => units.flatMap((u) => u.chapters).find((c) => c.id === id)?.chapter || id;

  return (
    <div className="stack">
      {data && (
        <div className="card flush">
          <table className="table">
            <thead><tr><th>Subject</th><th>From chapter name</th><th>Guessed from text</th><th>Set by admin</th><th>Not placed</th></tr></thead>
            <tbody>
              {Object.entries(data.summary).map(([s, c]) => (
                <tr key={s}>
                  <td>{SUBJECT_LABEL[s]}</td>
                  <td className="mono">{(c.name || 0).toLocaleString('en-IN')}</td>
                  <td className="mono">{(c.auto || 0).toLocaleString('en-IN')}</td>
                  <td className="mono">{(c.manual || 0).toLocaleString('en-IN')}</td>
                  <td className="mono">{(c.none || 0).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        Run <code>npm run chapters:classify -- --apply</code> after importing: it learns from the questions whose chapter is known and places
        the rest when it is at least 90% sure. Everything else is listed here with its best guess. Your choices are never overwritten.
      </p>
      <div className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <div className="chips">
            {Object.entries(SUBJECT_LABEL).map(([k, v]) => (
              <button key={k} className={`chip ${f.subject === k ? 'on' : ''}`} onClick={() => setF({ ...f, subject: k, page: 1 })}>{v}</button>
            ))}
          </div>
          <div className="chips">
            {[['none', 'Not placed'], ['auto', 'Guessed (spot-check)']].map(([k, v]) => (
              <button key={k} className={`chip ${f.status === k ? 'on' : ''}`} onClick={() => setF({ ...f, status: k, page: 1 })}>{v}</button>
            ))}
          </div>
        </div>
        {f.status === 'none' && (
          <div className="row" style={{ gap: 6 }}>
            <span className="small muted">Accept all guesses ≥</span>
            <div style={{ width: 90 }}>
              <Select value={minP} onChange={(e) => setMinP(e.target.value)}>
                {['0.6', '0.7', '0.8', '0.85'].map((p) => <option key={p} value={p}>{Math.round(p * 100)}%</option>)}
              </Select>
            </div>
            <button className="btn sm" disabled={busy === 'all'} onClick={acceptAll}>{busy === 'all' ? 'Saving…' : 'Accept'}</button>
          </div>
        )}
      </div>
      {msg && <div className="alert">{msg}</div>}
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : !data?.items.length ? (
        <div className="card empty">{f.status === 'none' ? 'Every question has a chapter. 🎉' : 'Nothing guessed yet — run the classify script.'}</div>
      ) : (
        <>
          <span className="muted small">{data.total.toLocaleString('en-IN')} questions</span>
          {data.items.map((it) => {
            const set = done[it.qid];
            return (
              <article key={it.qid} className={`card stack chapter-review ${set ? 'is-done' : ''}`}>
                <div className="qhead" style={{ marginBottom: 0 }}>
                  <Link to={`/problems/${it.qid}`} className="mono" target="_blank" rel="noreferrer">#{it.qid}</Link>
                  {it.chapter && <Pill>source: {it.chapter}</Pill>}
                  {it.chapterName && <Pill kind="easy">now: {it.chapterName}</Pill>}
                  {it.status !== 'published' && <Pill>{it.status}</Pill>}
                </div>
                <Rich text={it.text} />
                {it.options.length > 0 && <div className="small muted">{it.options.map((o) => `${o.key}) ${o.text}`).join('   ')}</div>}
                {set ? (
                  <div className="small"><Icon.CircleCheck size={14} style={{ color: 'var(--good)' }} /> {set === 'none' ? 'Marked: no JEE chapter' : `Saved: ${nameOf(set)}`}</div>
                ) : (
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {it.guess && (
                      <button className="btn sm primary" disabled={busy === it.qid} onClick={() => setChapter(it.qid, it.guess.id)}>
                        <Icon.Check /> {it.guess.name} <span style={{ opacity: 0.8 }}>{Math.round(it.guess.p * 100)}%</span>
                      </button>
                    )}
                    {it.guess?.second && (
                      <button className="btn sm" disabled={busy === it.qid} onClick={() => setChapter(it.qid, it.guess.second)}>{it.guess.secondName}</button>
                    )}
                    <div style={{ minWidth: 220 }}>
                      <Select value="" onChange={(e) => setChapter(it.qid, e.target.value)} placeholder="Other chapter…">
                        <option value="">Other chapter…</option>
                        {units.map((u) => (
                          <optgroup key={u.name} label={u.name}>
                            {u.chapters.map((c) => <option key={c.id} value={c.id}>{c.chapter}</option>)}
                          </optgroup>
                        ))}
                      </Select>
                    </div>
                    <button className="btn sm ghost" disabled={busy === it.qid} onClick={() => setChapter(it.qid, null)}>No JEE chapter</button>
                  </div>
                )}
              </article>
            );
          })}
          {pages > 1 && (
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}><Icon.ChevronLeft /> Previous</button>
              <span className="muted small">Page {f.page} of {pages}</span>
              <button className="btn sm" disabled={f.page >= pages} onClick={() => { setF({ ...f, page: f.page + 1 }); }}>Next <Icon.ChevronRight /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
