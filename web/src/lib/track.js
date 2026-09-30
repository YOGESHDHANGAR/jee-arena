import { api } from './api.js';

/**
 * Where visitors come from, for Admin → Growth. No cookies, no personal data: one count per visit
 * (day + source) and, for new visitors, their first source is remembered in this browser so it can be
 * attached to their sign-up.
 */
const FIRST = 'ja_first_touch';
const SESSION = 'ja_visit_counted';

const HOSTS = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'],
  [/(^|\.)google\./, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'facebook'],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, 'x'],
  [/(^|\.)telegram\.(org|me)$|^t\.me$/, 'telegram'],
  [/(^|\.)whatsapp\.com$|^wa\.me$/, 'whatsapp'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'],
];

/** Source of this visit from the URL and the page that linked here. */
export function visitSource(url = new URL(window.location.href), referrer = document.referrer) {
  const p = url.searchParams;
  if (p.get('ref')) return 'share'; // result share card / invite link
  if (p.get('utm_source')) return p.get('utm_source').toLowerCase().slice(0, 40);
  if ((p.get('source') || '').startsWith('app')) return 'app';
  if (referrer) {
    try {
      const host = new URL(referrer).hostname.replace(/^www\./, '');
      if (host && host !== url.hostname.replace(/^www\./, '')) return (HOSTS.find(([re]) => re.test(host)) || [null, host])[1];
    } catch {
      /* bad referrer */
    }
  }
  return 'direct';
}

export function firstTouch() {
  try {
    return JSON.parse(localStorage.getItem(FIRST) || 'null');
  } catch {
    return null;
  }
}

/** Once per browser session. */
export function trackVisit() {
  try {
    if (sessionStorage.getItem(SESSION)) return;
    sessionStorage.setItem(SESSION, '1');
  } catch {
    /* storage blocked: count anyway */
  }
  const url = new URL(window.location.href);
  const source = visitSource(url);
  const isNew = !firstTouch();
  if (isNew) {
    try {
      localStorage.setItem(FIRST, JSON.stringify({ source, ref: url.searchParams.get('ref') || null, landing: url.pathname.slice(0, 120), at: new Date().toISOString() }));
    } catch {
      /* ignore */
    }
  }
  api('/hit', { method: 'POST', body: { source, new: isNew } }).catch(() => {});
}
