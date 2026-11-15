/* Furniche: a durable, local cache for Matterport model files.
 *
 * Matterport's tour streams a model's panorama tiles, textures and mesh from cdn-*.matterport.com
 * with signed URLs (?t=...&k=...) that change every session, so the browser's HTTP cache often
 * cannot reuse them. This worker keeps each file in Cache Storage under a key without the
 * signature, so a home you have opened before (or one the page warmed) loads from local storage
 * instead of the network, including when you fly in from the 3D city.
 *
 * Only GET requests for /models/ files on *.matterport.com are cached; everything else passes
 * straight through. Entries expire after 14 days and the cache is capped by entry count.
 * Debug: navigator.serviceWorker.controller.postMessage({ type: 'mp-stats' }) answers on a port.
 */
const CACHE = 'furniche-mp-v2'; // v2: drops v1, which may hold files stored while the disk was full
const MAX_ENTRIES = 8000;
const TTL_MS = 14 * 24 * 3600 * 1000;
const STAMP = 'x-furniche-cached-at';
const SIGNED_PARAMS = ['t', 'k'];

const isMatterport = (url) => /(^|\.)matterport\.com$/.test(url.hostname);
const isModelFile = (url) => /^\/models\//.test(url.pathname);

const stats = { hits: 0, misses: 0, stored: 0, expired: 0, passed: 0, errors: 0, bytesFromCache: 0, bytesStored: 0, msHit: 0, msMiss: 0 };
const errs = []; // last few failure messages (debugging aid)
const seen = {}; // request kinds seen: "host path-pattern" -> count (debugging aid)

const keyFor = (url) => {
  const u = new URL(url.href);
  for (const p of SIGNED_PARAMS) u.searchParams.delete(p);
  return u.href;
};
const kindOf = (url, how) =>
  `${how} ${url.hostname} ${url.pathname.replace(/[0-9a-f]{32}/g, '<id>').replace(/\d+/g, 'N').slice(0, 90)}`;
const note = (url, how) => {
  const k = kindOf(url, how);
  seen[k] = (seen[k] || 0) + 1;
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('furniche-mp-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!isMatterport(url)) return;
  if (!isModelFile(url) || req.headers.has('range')) {
    stats.passed += 1;
    note(url, 'pass');
    return;
  }
  event.respondWith(cacheFirst(event, req, url));
});

async function cacheFirst(event, req, url) {
  const key = keyFor(url);
  const t0 = performance.now();
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key, { ignoreVary: true });
    if (hit) {
      const age = Date.now() - Number(hit.headers.get(STAMP) || 0);
      if (age < TTL_MS) {
        stats.hits += 1;
        stats.msHit += performance.now() - t0;
        stats.bytesFromCache += Number(hit.headers.get('content-length') || 0);
        note(url, 'hit');
        return hit;
      }
      stats.expired += 1;
      event.waitUntil(cache.delete(key));
    }
    stats.misses += 1;
    note(url, 'miss');
    const res = await fetch(req);
    stats.msMiss += performance.now() - t0; // time to the response headers; the body streams on
    if (res.status === 200 && (res.type === 'cors' || res.type === 'basic')) event.waitUntil(store(cache, key, res.clone()));
    return res;
  } catch (e) {
    stats.errors += 1;
    errs.push(`fetch ${url.pathname.slice(-40)} ${e && e.name}: ${e && e.message}`.slice(0, 160));
    return fetch(req); // never let the cache break the tour
  }
}

async function store(cache, key, res) {
  try {
    const body = await res.blob();
    // A body shorter than the server announced (an aborted download) must not be kept.
    const announced = Number(res.headers.get('content-length') || 0);
    if (!body.size || (!res.headers.get('content-encoding') && announced && body.size !== announced)) return;
    const headers = new Headers(res.headers);
    // The body is already decoded, so drop the headers that describe the wire encoding.
    headers.delete('content-encoding');
    headers.set('content-length', String(body.size));
    headers.set(STAMP, String(Date.now()));
    await cache.put(key, new Response(body, { status: 200, statusText: res.statusText, headers }));
    stats.stored += 1;
    stats.bytesStored += body.size;
    if (stats.stored % 100 === 0) await trim(cache);
  } catch (e) {
    stats.errors += 1; // Vary: *, quota exceeded, or the body could not be read
    errs.push(`store ${e && e.name}: ${e && e.message}`.slice(0, 160));
  }
}

// Oldest entries go first (Cache Storage lists keys in insertion order).
async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(k);
}

self.addEventListener('message', (event) => {
  const port = event.ports && event.ports[0];
  if (!port) return;
  if (event.data && event.data.type === 'mp-stats') port.postMessage({ stats, seen, errs: errs.slice(-8) });
  if (event.data && event.data.type === 'mp-clear') {
    caches.delete(CACHE).then(() => {
      for (const k of Object.keys(stats)) stats[k] = 0;
      for (const k of Object.keys(seen)) delete seen[k];
      port.postMessage({ cleared: true });
    });
  }
});
