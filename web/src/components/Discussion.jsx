import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { timeAgo } from '../lib/hooks.js';
import { Rich } from './Rich.jsx';
import { Icon } from './Icon.jsx';
import { useT } from '../lib/i18n.jsx';

/** Discussion under a question: comments, one level of replies, upvotes, spoiler hiding. */
export function Discussion({ qid, solved, noSolution }) {
  const { user } = useAuth();
  const [sort, setSort] = useState('top');
  const t = useT();
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = (p = page, s = sort) =>
    api(`/problems/${qid}/comments`, { query: { sort: s, page: p } })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch(setError);

  useEffect(() => {
    setPage(1);
    setData(null);
    load(1, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qid, sort, user?.id]);

  const patch = (id, fn) =>
    setData((d) => ({
      ...d,
      items: d.items.map((c) => (c.id === id ? fn(c) : { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) })),
    }));

  const onPosted = (c) => setData((d) => ({ ...d, total: (d?.total || 0) + 1, items: [c, ...(d?.items || [])] }));
  const onReplied = (parentId, r) => patch(parentId, (c) => ({ ...c, replyCount: c.replyCount + 1, replies: [...c.replies, r] }));
  const onDeleted = (id, parentId) => {
    if (parentId) patch(parentId, (c) => ({ ...c, replyCount: c.replyCount - 1, replies: c.replies.filter((r) => r.id !== id) }));
    else setData((d) => ({ ...d, total: d.total - 1, items: d.items.filter((c) => c.id !== id) }));
  };

  return (
    <section className="card discussion">
      <div className="spread">
        <h3 style={{ margin: 0 }}>{t('Discussion')} {data ? <span className="muted">({data.total})</span> : null}</h3>
        <div className="chips">
          <button className={`chip ${sort === 'top' ? 'on' : ''}`} onClick={() => setSort('top')}>{t('Top')}</button>
          <button className={`chip ${sort === 'new' ? 'on' : ''}`} onClick={() => setSort('new')}>{t('Newest')}</button>
        </div>
      </div>

      {noSolution && (
        <div className="alert small" style={{ marginTop: 12 }}>
          <Icon.PenLine /> {t('This question has no written solution yet. Explain how you solved it — the most upvoted explanation becomes the official solution, with your name on it.')}
        </div>
      )}
      {user ? (
        <Composer
          qid={qid}
          onDone={onPosted}
          placeholder={noSolution ? t('Explain your solution step by step (tick "Contains answer")…') : t('Share your approach, ask a doubt, or point out a mistake…')}
          defaultSpoiler={false}
          solved={solved}
        />
      ) : (
        <p className="muted small" style={{ margin: '14px 0' }}>
          <Link to={`/login?next=/problems/${qid}`}>{t('Log in')}</Link> {t('to join the discussion.')}
        </p>
      )}

      {error && <div className="alert error">{error.message}</div>}
      {!data && !error && <div className="spinner" />}
      {data && !data.items.length && <p className="muted small empty">{t('No comments yet. Be the first to share how you solved it.')}</p>}

      <div className="comments">
        {data?.items.map((c) => (
          <Comment key={c.id} c={c} qid={qid} onPatch={patch} onReplied={onReplied} onDeleted={onDeleted} />
        ))}
      </div>

      {data && data.pages > 1 && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => { setPage(page - 1); load(page - 1); }}><Icon.ChevronLeft /> {t('Newer')}</button>
          <span className="muted small">{t('Page {a} of {b}', { a: page, b: data.pages })}</span>
          <button className="btn sm" disabled={page >= data.pages} onClick={() => { setPage(page + 1); load(page + 1); }}>{t('Older')} <Icon.ChevronRight /></button>
        </div>
      )}
    </section>
  );
}

function Composer({ qid, parentId, onDone, onCancel, placeholder, autoFocus, initial = '', initialSpoiler = false, editId }) {
  const [body, setBody] = useState(initial);
  const t = useT();
  const [spoiler, setSpoiler] = useState(initialSpoiler);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = editId
        ? await api(`/comments/${editId}`, { method: 'PATCH', body: { body, spoiler } })
        : await api(`/problems/${qid}/comments`, { method: 'POST', body: { body, spoiler, parentId } });
      onDone(r);
      if (!editId) {
        setBody('');
        setSpoiler(false);
        setPreview(false);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      {preview ? (
        <div className="composer-preview">{body.trim() ? <Rich text={body} /> : <span className="muted">{t('Nothing to preview')}</span>}</div>
      ) : (
        <textarea
          className="input"
          rows={parentId || editId ? 2 : 3}
          value={body}
          autoFocus={autoFocus}
          maxLength={2000}
          placeholder={placeholder}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
          }}
        />
      )}
      <div className="spread composer-bar">
        <div className="row small" style={{ gap: 14 }}>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }} title={t("Hide this comment behind a click so it doesn't spoil the answer")}>
            <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} /> {t('Contains answer')}
          </label>
          <button type="button" className="linkish" onClick={() => setPreview(!preview)}>{preview ? t('Edit') : t('Preview')}</button>
          <span className="muted hide-sm">{t('LaTeX with $…$ · Ctrl+Enter to post')}</span>
        </div>
        <div className="row">
          {onCancel && <button type="button" className="btn sm ghost" onClick={onCancel}>{t('Cancel')}</button>}
          <button className="btn sm primary" disabled={busy || !body.trim()}>{busy ? t('Posting…') : editId ? t('Save') : parentId ? t('Reply') : t('Post')}</button>
        </div>
      </div>
      {error && <div className="alert error small">{error.message}</div>}
    </form>
  );
}

function Comment({ c, qid, onPatch, onReplied, onDeleted, isReply }) {
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [showSpoiler, setShowSpoiler] = useState(false);

  async function vote() {
    if (!user) return;
    const r = await api(`/comments/${c.id}/vote`, { method: 'POST' }).catch(() => null);
    if (r) onPatch(c.id, (x) => ({ ...x, voted: r.voted, score: r.score }));
  }
  async function remove() {
    if (!confirm(t('Delete this comment?'))) return;
    await api(`/comments/${c.id}`, { method: 'DELETE' });
    if (c.replies?.length) onPatch(c.id, (x) => ({ ...x, deleted: true, body: '', author: null }));
    else onDeleted(c.id, c.parentId);
  }

  return (
    <div className={`comment ${isReply ? 'reply' : ''}`}>
      <div className="comment-head">
        {c.deleted ? (
          <span className="muted small">{t('[deleted]')}</span>
        ) : (
          <>
            <Link to={`/u/${c.author?.username}`} className="avatar" aria-hidden="true">{(c.author?.name || '?')[0].toUpperCase()}</Link>
            <Link to={`/u/${c.author?.username}`} className="comment-author">{c.author?.name}</Link>
            <span className="muted small mono">{c.author?.rating}</span>
            <span className="muted small">· {timeAgo(c.createdAt, t)}{c.editedAt ? ` · ${t('edited')}` : ''}</span>
            {c.accepted && <span className="pill good" title={t("Chosen as this question's official solution")}><Icon.CircleCheck size={13} /> {t('Official solution')}</span>}
          </>
        )}
      </div>

      {!c.deleted && (
        editing ? (
          <Composer qid={qid} editId={c.id} initial={c.body} initialSpoiler={c.spoiler} autoFocus onCancel={() => setEditing(false)}
            onDone={(r) => { onPatch(c.id, (x) => ({ ...x, body: r.body, spoiler: r.spoiler ?? x.spoiler, editedAt: r.editedAt })); setEditing(false); }} />
        ) : c.spoiler && !showSpoiler ? (
          <button className="spoiler" onClick={() => setShowSpoiler(true)}>{t('Contains the answer — click to show')}</button>
        ) : (
          <Rich text={c.body} className="comment-body" />
        )
      )}

      {!c.deleted && !editing && (
        <div className="comment-actions">
          <button className={`vote ${c.voted ? 'on' : ''}`} onClick={vote} disabled={!user} title={user ? t('Helpful') : t('Log in to vote')}>
            <Icon.ArrowBigUp size={15} fill={c.voted} /> {c.score}
          </button>
          {user && !isReply && <button className="linkish" onClick={() => setReplying(!replying)}>{t('Reply')}</button>}
          {c.mine && <button className="linkish" onClick={() => setEditing(true)}>{t('Edit')}</button>}
          {(c.mine || user?.role === 'admin') && <button className="linkish danger" onClick={remove}>{t('Delete')}</button>}
        </div>
      )}

      {replying && (
        <div className="reply-box">
          <Composer qid={qid} parentId={c.id} autoFocus placeholder={t('Reply to {name}…', { name: c.author?.name })} onCancel={() => setReplying(false)}
            onDone={(r) => { onReplied(c.id, r); setReplying(false); }} />
        </div>
      )}

      {c.replies?.length > 0 && (
        <div className="replies">
          {c.replies.map((r) => (
            <Comment key={r.id} c={r} qid={qid} isReply onPatch={onPatch} onReplied={onReplied} onDeleted={onDeleted} />
          ))}
        </div>
      )}
    </div>
  );
}
