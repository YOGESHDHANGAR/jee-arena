import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Icon } from './Icon.jsx';
import { fmtDuration, SUBJECT_LABEL } from '../lib/hooks.js';
import { estimatePercentile, fmtPercentile, isFullJeeMain } from '../lib/percentile.js';
import { useT } from '../lib/i18n.jsx';

const W = 1200;
const H = 630; // 1.91:1 — the size WhatsApp, Instagram stories (letterboxed), X and LinkedIn all preview well
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const COLORS = { bg: '#141412', panel: '#1c1c1a', text: '#ecebe7', muted: '#9d998f', accent: '#ff7a33', good: '#51cf66', bad: '#ff6b6b', physics: '#4dabf7', chemistry: '#51cf66', maths: '#b197fc' };

/** Draws the result card and resolves to a PNG Blob. */
export async function drawResultCard({ r, username, link }) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  // Background with a soft accent glow.
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W - 120, 80, 10, W - 120, 80, 520);
  glow.addColorStop(0, 'rgba(255,122,51,0.35)');
  glow.addColorStop(1, 'rgba(255,122,51,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Brand.
  roundRect(g, 60, 52, 48, 48, 12, COLORS.accent);
  g.fillStyle = '#fff';
  g.font = `800 28px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('J', 84, 77);
  g.textAlign = 'left';
  g.fillStyle = COLORS.text;
  g.font = `700 28px ${FONT}`;
  g.fillText('JEE Arena', 124, 77);
  if (username) {
    g.textAlign = 'right';
    g.fillStyle = COLORS.muted;
    g.font = `500 26px ${FONT}`;
    g.fillText(`@${username}`, W - 60, 77);
    g.textAlign = 'left';
  }

  // Test title.
  g.fillStyle = COLORS.muted;
  g.font = `600 30px ${FONT}`;
  g.fillText(fit(g, r.test.title, W - 120), 60, 150);

  // Headline: rank if we have one, else score.
  const rank = r.rank?.rank;
  g.textBaseline = 'alphabetic';
  if (rank) {
    const label = `AIR ${rank.toLocaleString('en-IN')}`;
    let size = 132;
    do g.font = `800 ${size}px ${FONT}`; while (g.measureText(label).width > 700 && (size -= 6) > 60);
    g.fillStyle = COLORS.accent;
    g.fillText(label, 56, 300);
    g.fillStyle = COLORS.muted;
    g.font = `500 28px ${FONT}`;
    g.fillText(r.rank.of ? `out of ${r.rank.of.toLocaleString('en-IN')} students` : '', 62, 345);
  } else {
    const pct = r.maxScore ? Math.max(0, Math.round((100 * r.score) / r.maxScore)) : 0;
    g.fillStyle = COLORS.accent;
    g.font = `800 132px ${FONT}`;
    g.fillText(`${pct}%`, 56, 300);
  }

  // Score block on the right: "186 / 300".
  g.textAlign = 'right';
  g.fillStyle = COLORS.muted;
  g.font = `600 52px ${FONT}`;
  const outOf = `/ ${r.maxScore}`;
  const outOfW = g.measureText(outOf).width;
  g.fillText(outOf, W - 60, 290);
  g.fillStyle = COLORS.text;
  g.font = `800 96px ${FONT}`;
  g.fillText(`${r.score}`, W - 60 - outOfW - 14, 290);
  g.fillStyle = COLORS.muted;
  g.font = `500 26px ${FONT}`;
  g.fillText('score', W - 60, 330);
  g.textAlign = 'left';

  // Stat chips.
  const chips = [
    [`✓ ${r.correct} correct`, COLORS.good],
    [`✗ ${r.wrong} wrong`, COLORS.bad],
    [`⏱ ${fmtDuration(r.timeTakenSec)}`, COLORS.text],
  ];
  const est = isFullJeeMain(r) ? estimatePercentile(r.score) : null;
  if (est) chips.push([`≈ ${fmtPercentile(est.percentile)} %ile`, COLORS.accent]);
  if (r.rating) chips.push([`Rating ${r.rating.delta >= 0 ? '+' : ''}${r.rating.delta} → ${r.rating.after}`, r.rating.delta >= 0 ? COLORS.good : COLORS.bad]);
  let x = 60;
  g.font = `650 26px ${FONT}`;
  for (const [label, color] of chips) {
    const w = g.measureText(label).width + 36;
    roundRect(g, x, 385, w, 50, 25, COLORS.panel);
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.fillText(label, x + 18, 411);
    x += w + 14;
  }

  // Subject bars.
  const subs = Object.entries(r.bySubject || {});
  if (subs.length > 1) {
    const colW = (W - 120 - (subs.length - 1) * 24) / subs.length;
    subs.forEach(([s, v], i) => {
      const bx = 60 + i * (colW + 24);
      g.fillStyle = COLORS.muted;
      g.font = `600 22px ${FONT}`;
      g.textBaseline = 'alphabetic';
      g.fillText(`${SUBJECT_LABEL[s] || s}  ${v.score}/${v.max}`, bx, 490);
      roundRect(g, bx, 502, colW, 12, 6, COLORS.panel);
      const frac = v.max ? Math.max(0, Math.min(1, v.score / v.max)) : 0;
      if (frac > 0) roundRect(g, bx, 502, Math.max(12, colW * frac), 12, 6, COLORS[s] || COLORS.accent);
    });
  }

  // Call to action.
  g.textBaseline = 'alphabetic';
  g.fillStyle = COLORS.text;
  g.font = `700 30px ${FONT}`;
  g.fillText('Can you beat me?', 60, 580);
  g.textAlign = 'right';
  g.fillStyle = COLORS.accent;
  g.font = `600 26px ${FONT}`;
  g.fillText(fit(g, link.replace(/^https?:\/\//, '').replace(/\?.*$/, ''), 700), W - 60, 580);

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

function roundRect(g, x, y, w, h, r, fill) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** "Share result" button + preview dialog, for mock tests and contests. */
export function ShareResult({ r, testPath }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState(null); // { blob, url }
  const [msg, setMsg] = useState('');
  const t = useT();

  const link = `${window.location.origin}${testPath}?ref=${encodeURIComponent(user?.username || 'share')}`;
  const vars = { rank: r.rank?.rank?.toLocaleString('en-IN'), score: r.score, max: r.maxScore, title: r.test.title, link };
  const text = r.rank?.rank
    ? t('I got AIR {rank} ({score}/{max}) in "{title}" on JEE Arena. Can you beat me? {link}', vars)
    : t('I scored {score}/{max} in "{title}" on JEE Arena. Can you beat me? {link}', vars);

  useEffect(() => {
    if (!open) return undefined;
    let url;
    drawResultCard({ r, username: user?.username, link }).then((blob) => {
      if (!blob) return;
      url = URL.createObjectURL(blob);
      setImg({ blob, url });
    });
    return () => url && URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const file = img && new File([img.blob], 'jee-arena-result.png', { type: 'image/png' });
  const canShareFile = !!(file && navigator.canShare?.({ files: [file] }));

  async function nativeShare() {
    try {
      if (canShareFile) await navigator.share({ files: [file], text, title: 'My JEE Arena result' });
      else await navigator.share({ text, url: link, title: 'My JEE Arena result' });
    } catch {
      /* cancelled */
    }
  }
  function download() {
    const a = document.createElement('a');
    a.href = img.url;
    a.download = 'jee-arena-result.png';
    a.click();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(t('Copied — paste it anywhere.'));
    } catch {
      setMsg(text);
    }
  }

  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}><Icon.Share2 /> {t('Share result')}</button>
      {open && (
        <div className="modal-back" onClick={() => setOpen(false)}>
          <div className="modal stack" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <div className="spread">
              <h3 style={{ margin: 0 }}>{t('Share your result')}</h3>
              <button className="btn sm ghost" onClick={() => setOpen(false)} aria-label={t('Close')}><Icon.X /></button>
            </div>
            {img ? <img src={img.url} alt={t('Your result card')} style={{ width: '100%', borderRadius: 10, display: 'block' }} /> : <div className="spinner" />}
            <div className="row">
              {navigator.share && <button className="btn primary" onClick={nativeShare} disabled={!img}><Icon.Share2 /> {t('Share…')}</button>}
              <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Icon.MessageCircle /> WhatsApp</a>
              <button className="btn" onClick={download} disabled={!img}><Icon.Download /> {t('Download image')}</button>
              <button className="btn" onClick={copy}><Icon.Copy /> {t('Copy text + link')}</button>
            </div>
            {msg && <div className="alert good small">{msg}</div>}
            <p className="muted small" style={{ margin: 0 }}>{t('Tip: post the image to your story and put the link in the caption.')}</p>
          </div>
        </div>
      )}
    </>
  );
}
