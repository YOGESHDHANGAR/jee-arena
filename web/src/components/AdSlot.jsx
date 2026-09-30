import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

/**
 * Google AdSense, kept out of the way of studying:
 *   - Big screens (≥ 1280px wide and ≥ 720px tall): one sticky 160×600 ad in the empty space on each side.
 *   - Everything else (phones, short laptop screens): a single ad at the very bottom of the page, above the footer.
 * Nothing ever sits between questions, options, solutions or comments, and the exam screen has no ads.
 * Pro members see no ads.
 */

let configPromise;
const getConfig = () => (configPromise ||= api('/config').catch(() => ({ ads: null })));

let scriptPromise;
function loadAdSense(client) {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    s.onload = resolve;
    s.onerror = resolve; // ad blockers: fail quietly
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** { ads, on } — `on` is false when ads aren't configured or the viewer is Pro. */
export function useAds() {
  const { user } = useAuth();
  const [ads, setAds] = useState(null);
  useEffect(() => {
    let alive = true;
    getConfig().then((c) => alive && setAds(c.ads || null));
    return () => {
      alive = false;
    };
  }, []);
  const on = !!ads && user?.plan !== 'pro' && (ads.preview || !!ads.client);
  return { ads, on };
}

// Rails need room for the full 160×600 unit (Google's standard "Wide Skyscraper") plus the top bar:
// 1280px wide for two rails beside the content, and 720px tall so the ad is never cut off.
// Short or narrow screens get the single bottom ad instead.
const RAIL_QUERY = '(min-width: 1280px) and (min-height: 720px)';
function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(RAIL_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(RAIL_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** One ad unit. `size` = { width, height } for a fixed unit, or omit for responsive. */
function AdUnit({ ads, slot, size, label = true }) {
  const { pathname } = useLocation();
  const ref = useRef(null);

  // A new page in the app is a new page view, so ask for a fresh ad (the <ins> is re-created via key).
  useEffect(() => {
    if (ads.preview || !slot) return;
    let cancelled = false;
    loadAdSense(ads.client).then(() => {
      if (cancelled || !ref.current || ref.current.dataset.adsbygoogleStatus) return;
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        /* blocked, too small, or account not approved yet */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ads, slot, pathname]);

  if (!ads.preview && !slot) return null;
  const style = size ? { display: 'inline-block', width: size.width, height: size.height } : { display: 'block', minHeight: 90 };

  return (
    <div className="ad-unit">
      {label && <div className="ad-label">Advertisement</div>}
      {ads.preview ? (
        <div className="ad-preview" style={size ? { width: size.width, height: size.height } : { minHeight: 90 }}>
          Ad {size ? `${size.width}×${size.height}` : '· responsive'}
        </div>
      ) : (
        <ins
          key={pathname}
          ref={ref}
          className="adsbygoogle"
          style={style}
          data-ad-client={ads.client}
          data-ad-slot={slot}
          {...(size ? {} : { 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' })}
        />
      )}
    </div>
  );
}

/** Left and right sticky rails. Renders nothing on narrow screens. */
export function AdRails() {
  const { ads, on } = useAds();
  const wide = useWide();
  const railOn = on && wide && (ads.preview || ads.slots?.rail);

  // Tell the layout to leave room for the rails.
  useEffect(() => {
    document.documentElement.classList.toggle('has-rails', !!railOn);
    return () => document.documentElement.classList.remove('has-rails');
  }, [railOn]);

  if (!railOn) return null;
  const size = { width: 160, height: 600 };
  return (
    <>
      <aside className="ad-rail left" aria-label="Advertisement">
        <AdUnit ads={ads} slot={ads.slots.rail} size={size} />
      </aside>
      <aside className="ad-rail right" aria-label="Advertisement">
        <AdUnit ads={ads} slot={ads.slots.rail} size={size} />
      </aside>
    </>
  );
}

/** One ad at the bottom of the page, only where there's no room for rails. */
export function AdBottom() {
  const { ads, on } = useAds();
  const wide = useWide();
  if (!on || wide || !(ads.preview || ads.slots?.bottom)) return null;
  return (
    <div className="ad-bottom-bar">
      <AdUnit ads={ads} slot={ads.slots.bottom} />
    </div>
  );
}
