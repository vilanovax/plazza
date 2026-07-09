/* Minimal service worker for the poker PWA.
 *
 * Strategy: network-first for navigations (the game is realtime, we never want
 * stale HTML), cache-first for static assets so the shell loads offline. The
 * live table itself needs the network — offline mode only serves the app shell
 * and an offline notice.
 */
const CACHE = "poker-shell-v1";
const SHELL = ["/", "/offline", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never intercept the realtime channel or API calls.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline").then((r) => r || caches.match("/")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((resp) => {
          const copy = resp.clone();
          if (resp.ok && url.origin === self.location.origin) {
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return resp;
        })
    )
  );
});
