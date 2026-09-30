import { Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Themed dropdown that replaces the native <select>.
 * Drop-in: takes the same <option value="…">label</option> children, and calls
 * onChange with a select-like event ({ target: { value } }) so existing handlers keep working.
 * Long lists (over 10 options) get a search box. <optgroup label="…"> children show as section headings.
 */
export function Select({ value, onChange, children, disabled, className = '', searchable, placeholder, 'aria-label': ariaLabel }) {
  const options = useMemo(() => {
    const out = [];
    const walk = (nodes) =>
      Children.toArray(nodes).forEach((c) => {
        if (!isValidElement(c)) return;
        if (c.type === 'optgroup') {
          out.push({ value: `\u0000${c.props.label}`, label: String(c.props.label), header: true, disabled: true });
          walk(c.props.children);
        } else if (c.type === 'option') {
          const label = Children.toArray(c.props.children).join('');
          out.push({ value: String(c.props.value ?? label), label, disabled: !!c.props.disabled });
        } else if (c.props?.children) walk(c.props.children);
      });
    walk(children);
    return out;
  }, [children]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const list = useRef(null);
  const search = useRef(null);
  const id = useId();

  const current = options.find((o) => o.value === String(value ?? ''));
  const showSearch = searchable ?? options.length > 10;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => !o.header && o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const want = Math.min(360, 44 + options.length * 38);
    const below = window.innerHeight - r.bottom - 8;
    const up = below < Math.min(want, 220) && r.top > below;
    const MAX_W = Math.min(420, window.innerWidth - 16);
    const fitsRight = r.left + MAX_W <= window.innerWidth - 8;
    setPos({
      left: fitsRight ? r.left : undefined,
      right: fitsRight ? undefined : Math.max(8, window.innerWidth - r.right),
      minWidth: Math.min(Math.max(r.width, 180), MAX_W),
      maxWidth: MAX_W,
      top: up ? undefined : r.bottom + 6,
      bottom: up ? window.innerHeight - r.top + 6 : undefined,
      maxHeight: Math.max(160, Math.min(360, (up ? r.top : below) - 12)),
    });
  };

  const openList = () => {
    if (disabled) return;
    place();
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === String(value ?? ''))));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };
  const choose = (o) => {
    if (!o || o.disabled) return;
    if (o.value !== String(value ?? '')) onChange?.({ target: { value: o.value } });
    close();
  };

  // Close on outside click; keep position on resize; close if the page scrolls under it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!btn.current?.contains(e.target) && !list.current?.contains(e.target)) close(false);
    };
    const onScroll = (e) => {
      if (!list.current?.contains(e.target)) close(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (showSearch) search.current?.focus();
    else list.current?.focus();
  }, [open, showSearch]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => setActive(0), [query]);

  const onKey = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    const step = (d) => {
      let i = active;
      for (let n = 0; n < shown.length; n++) {
        i = (i + d + shown.length) % shown.length;
        if (!shown[i].disabled) break;
      }
      setActive(i);
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (!showSearch && e.key.length === 1) {
      // Type-to-jump when there's no search box.
      const i = shown.findIndex((o) => !o.header && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };

  const isPlaceholder = !current || current.value === '';

  return (
    <>
      <button
        type="button"
        ref={btn}
        className={`select ${open ? 'open' : ''} ${isPlaceholder ? 'placeholder' : ''} ${className}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
      >
        <span className="select-value">{current?.label ?? placeholder ?? 'Select'}</span>
        <svg className="select-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={list}
            className="select-menu"
            style={{ left: pos.left, right: pos.right, minWidth: pos.minWidth, maxWidth: pos.maxWidth, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            tabIndex={-1}
            onKeyDown={onKey}
          >
            {showSearch && (
              <div className="select-search">
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-controls={id} />
              </div>
            )}
            <ul role="listbox" id={id} className="select-options">
              {shown.map((o, i) => {
                const selected = o.value === String(value ?? '');
                if (o.header) return <li key={o.value + i} data-i={i} role="presentation" className="select-group">{o.label}</li>;
                return (
                  <li
                    key={o.value + i}
                    data-i={i}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={o.disabled}
                    className={`select-option ${i === active ? 'active' : ''} ${selected ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                  >
                    <span>{o.label}</span>
                    {selected && (
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </li>
                );
              })}
              {!shown.length && <li className="select-empty">No matches</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
