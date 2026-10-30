/*
 * PackAM service worker.
 *
 * Deliberately small. It caches only files that can never be out of date or private:
 *   - /_next/static/*  build files whose names contain a content hash (a new build means new names),
 *   - /icons/*, the logo and the offline page.
 * Everything else goes straight to the network and is never stored: pages (they carry the signed-in user,
 * cart and prices), /api/* (cart, checkout, payments, orders, printing, auth), webhooks, images, and anything
 * that isn't a GET. When a page can't load because the device is offline, the offline page is shown instead,
 * and it reloads by itself when the connection is back.
 *
 * Updates: the browser re-checks this file on every visit (it is served with no-cache). A new version takes
 * over straight away and removes the old caches; because no page is ever cached, that is always safe.
 */
const VERSION = "packam-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/packam-logo.png", "/icons/icon-192.png"];
const MAX_STATIC_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("packam-") && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isCacheableStatic(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/packam-logo.png";
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_STATIC_ENTRIES;
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Only complete, same-origin, successful responses; never partial (206) or opaque ones.
  if (response.ok && response.status === 200 && response.type === "basic") {
    await cache.put(request, response.clone());
    void trimCache(cache);
  }
  return response;
}

async function networkWithOfflinePage(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never touch the API (auth, cart, checkout, payments, orders, printing, webhooks) or Next's data requests.
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.has("RSC") || request.headers.has("Next-Router-Prefetch") || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    // Always the live page; the offline page only when the network can't be reached at all.
    event.respondWith(networkWithOfflinePage(request));
    return;
  }
  if (isCacheableStatic(url)) event.respondWith(cacheFirst(request));
});
