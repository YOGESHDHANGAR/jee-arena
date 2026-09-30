import { getToken } from './api.js';

/**
 * Sends uncaught errors from the browser to the server (Admin → Errors).
 * At most 10 reports per page load, each distinct message once.
 */
const sent = new Set();
let budget = 10;

export function reportError(error, extra = {}) {
  try {
    const message = String(error?.message || error || 'Unknown error').slice(0, 500);
    if (error?.name === 'ApiError' || error?.status !== undefined) return; // API errors are shown to the student and logged server-side
    if (sent.has(message) || budget <= 0) return;
    sent.add(message);
    budget--;
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch('/api/errors', {
      method: 'POST',
      keepalive: true,
      headers,
      body: JSON.stringify({ message, stack: String(error?.stack || '').slice(0, 4000), url: window.location.href, ...extra }),
    }).catch(() => {});
  } catch {
    /* never throw from the error reporter */
  }
}

/**
 * After a new deploy, a tab that was open before it may ask for a code chunk that no longer exists
 * ("Failed to fetch dynamically imported module"). Reload once to pick up the new version.
 */
export function isStaleChunk(error) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \S+ failed/i.test(String(error?.message || error));
}
export function reloadOnceForNewVersion() {
  try {
    if (sessionStorage.getItem('ja_reloaded_for_update')) return false;
    sessionStorage.setItem('ja_reloaded_for_update', '1');
  } catch {
    /* storage blocked: still try once */
  }
  window.location.reload();
  return true;
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => {
    if (e.error && isStaleChunk(e.error) && reloadOnceForNewVersion()) return;
    reportError(e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isStaleChunk(e.reason) && reloadOnceForNewVersion()) return;
    reportError(e.reason);
  });
}
