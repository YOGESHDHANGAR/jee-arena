/* JEE Arena service worker.
 * - Makes the site installable ("Add to Home screen").
 * - Opens instantly for returning students: the app shell comes from cache if the server is slow
 *   (e.g. Render's free plan waking up); the app then shows "Waking up the server…" while API calls wait.
 * - Never caches /api — answers, scores and ranks always come from the server.
 * Bump VERSION to force every phone to drop its old caches.
 */
const VERSION = 'v1';
const SHELL = `ja-shell-${VERSION}`;
const STATIC = `ja-static-${VERSION}`;
const SHELL_URL = '/__app-shell';
const NETWORK_WAIT_MS = 3500;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (![SHELL, STATIC].includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// The page HTML carries a pre-rendered copy of whichever page it was; strip that so the cached
// shell is neutral for every URL (React renders the real page straight away).
async function storeShell(response) {
  const html = (await response.text()).replace(/<div id="root">[\s\S]*<\/div>(\s*<\/body>)/, '<div id="root"></div>$1');
  const cache = await caches.open(SHELL);
  await cache.put(SHELL_URL, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}

async function navigate(event) {
  const network = fetch(event.request).then((res) => {
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) event.waitUntil(storeShell(res.clone()));
    return res;
  });
  const cached = await caches.match(SHELL_URL);
  if (!cached) return network;
  // Network first, but don't keep a returning student staring at a blank screen.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_WAIT_MS));
  try {
    return (await Promise.race([network, timeout])) || cached;
  } catch {
    return cached; // offline
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    cache.put(request, res.clone());
    // Keep the static cache from growing forever across deploys.
    cache.keys().then((keys) => keys.length > 400 && Promise.all(keys.slice(0, keys.length - 300).map((k) => cache.delete(k))));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(api|admin)\b|^\/(sitemap[^/]*\.xml|robots\.txt|ads\.txt|sw\.js)$/.test(url.pathname)) return;
  if (req.mode === 'navigate') return event.respondWith(navigate(event));
  // Build files have content hashes in their names and question pictures never change: cache forever.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(req));
  }
});
