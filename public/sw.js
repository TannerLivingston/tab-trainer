// Offline support for Woodshed.
// - Pages: network first, falling back to the cached copy (so updates arrive when online).
// - Build assets (including the demo songs), fonts, sound banks and icons: cache first (they are
//   versioned or static).
// - Google Fonts: cache first.
// Paths are relative to where the app is served from (the site root, or /<repo>/ on GitHub Pages).
const VERSION = 'woodshed-v3';
const BASE = new URL(self.registration.scope).pathname;
const SHELL = ['', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'].map((p) => BASE + p);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CACHE_FIRST = /^(assets|font|soundfont|sounds|icons)\//;

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) ?? (await cache.match(BASE + 'index.html')) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname;
    if (req.mode === 'navigate') event.respondWith(networkFirst(req));
    else if (CACHE_FIRST.test(path)) event.respondWith(cacheFirst(req));
    else event.respondWith(networkFirst(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req));
  }
});
