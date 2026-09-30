const TOKEN_KEY = 'jee_arena_token';

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---- "Waking up the server…" -------------------------------------------------------------
// On Render's free plan the server sleeps after 15 idle minutes and takes ~30–60 s to start.
// While that happens requests hang, fail (502/503/504) or get Render's HTML loading page.
// api() quietly retries through it and tells <WakeBanner> to show a message.
const wakeListeners = new Set();
let waking = null; // Date.now() when we noticed, or null
const setWaking = (on) => {
  const next = on ? waking || Date.now() : null;
  if (next === waking) return;
  waking = next;
  wakeListeners.forEach((fn) => fn(waking));
};
export const onWake = (fn) => {
  wakeListeners.add(fn);
  fn(waking);
  return () => wakeListeners.delete(fn);
};

const SLOW_MS = 3500; // a request slower than this is probably a cold start
const WAKE_GIVE_UP_MS = 120000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isJson = (res) => (res.headers.get('content-type') || '').includes('application/json');

async function fetchThroughWake(url, init) {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    const slow = setTimeout(() => setWaking(true), SLOW_MS);
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      res = null; // network error: server restarting / asleep
      if (Date.now() - started > WAKE_GIVE_UP_MS) {
        clearTimeout(slow);
        setWaking(false);
        throw e;
      }
    }
    clearTimeout(slow);
    // 204 No Content (e.g. /api/hit) is a normal answer, not the host's "starting up" HTML page.
    const asleep = !res || [502, 503, 504].includes(res.status) || (res.ok && res.status !== 204 && !isJson(res));
    if (!asleep || Date.now() - started > WAKE_GIVE_UP_MS) {
      setWaking(false);
      if (!res) throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
      return res;
    }
    setWaking(true);
    await sleep(Math.min(1500 * (attempt + 1), 6000));
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null));
    if ([...qs].length) url += `?${qs}`;
  }
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetchThroughWake(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data;
}
