import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Open the viewer from anywhere: openImage(src, alt) */
export const openImage = (src, alt = '') => window.dispatchEvent(new CustomEvent('jee:open-image', { detail: { src, alt } }));

const MIN = 1;
const MAX = 6;

/**
 * Full-screen picture viewer. Mounted once at the app root.
 * Zoom: mouse wheel, pinch, +/− buttons or keys, double-click/tap. Pan: drag.
 * Close: Esc, ✕, or clicking the dark background.
 */
export function ImageViewer() {
  const [img, setImg] = useState(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const pinch = useRef(null);
  const stage = useRef(null);

  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };
  const close = useCallback(() => setImg(null), []);

  useEffect(() => {
    const onOpen = (e) => {
      reset();
      setImg(e.detail);
    };
    window.addEventListener('jee:open-image', onOpen);
    return () => window.removeEventListener('jee:open-image', onOpen);
  }, []);

  // Zoom towards a point (clientX/Y), keeping that point under the cursor.
  const zoomAt = useCallback((next, cx, cy) => {
    setScale((s) => {
      const ns = Math.min(MAX, Math.max(MIN, next(s)));
      const r = stage.current?.getBoundingClientRect();
      if (r && cx !== undefined) {
        const ox = cx - (r.left + r.width / 2);
        const oy = cy - (r.top + r.height / 2);
        setPos((p) => (ns === 1 ? { x: 0, y: 0 } : { x: ox - ((ox - p.x) * ns) / s, y: oy - ((oy - p.y) * ns) / s }));
      } else if (ns === 1) setPos({ x: 0, y: 0 });
      return ns;
    });
  }, []);

  useEffect(() => {
    if (!img) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === '+' || e.key === '=') zoomAt((s) => s * 1.4);
      else if (e.key === '-') zoomAt((s) => s / 1.4);
      else if (e.key === '0') reset();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [img, close, zoomAt]);

  if (!img) return null;

  const onWheel = (e) => {
    // (page scroll is already locked while the viewer is open)
    zoomAt((s) => s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  };
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || scale === 1) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setPos({ x: d.px + dx, y: d.py + dy });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  // Two-finger pinch on phones.
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinch.current = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), scale };
      drag.current = null;
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinch.current) {
      const [a, b] = e.touches;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const start = pinch.current;
      zoomAt(() => (start.scale * dist) / start.dist, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    }
  };

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Image viewer" onWheel={onWheel}>
      <div className="viewer-bar">
        <span className="viewer-zoom mono">{Math.round(scale * 100)}%</span>
        <button className="viewer-btn" onClick={() => zoomAt((s) => s / 1.4)} aria-label="Zoom out" disabled={scale <= MIN}>−</button>
        <button className="viewer-btn" onClick={() => zoomAt((s) => s * 1.4)} aria-label="Zoom in" disabled={scale >= MAX}>+</button>
        <button className="viewer-btn wide" onClick={reset} disabled={scale === 1}>Fit</button>
        <a className="viewer-btn wide" href={img.src} target="_blank" rel="noreferrer">Open original</a>
        <button className="viewer-btn" onClick={close} aria-label="Close">✕</button>
      </div>
      <div
        ref={stage}
        className={`viewer-stage ${scale > 1 ? 'zoomed' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <img
          src={img.src}
          alt={img.alt}
          draggable={false}
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={() => (pinch.current = null)}
          onDoubleClick={(e) => (scale > 1 ? reset() : zoomAt(() => 2.5, e.clientX, e.clientY))}
        />
      </div>
      <div className="viewer-hint">Scroll or pinch to zoom · drag to move · double-click to zoom · Esc to close</div>
    </div>,
    document.body,
  );
}
