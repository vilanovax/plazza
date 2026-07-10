/* Minimal service worker for Plazza.
 *
 * - Navigations: network-first (realtime app)
 * - /_next/static: network-first (avoid stale JS after deploy)
 * - Other static shell assets: cache-first for offline boot
 */
const CACHE = "plazza-shell-v2";
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

function isNextStatic(url: URL): boolean {
  return url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate" || isNextStatic(url)) {
    event.respondWith(
      fetch(request).catch(() => {
        if (request.mode === "navigate") {
          return caches.match("/offline").then((r) => r || caches.match("/"));
        }
        return caches.match(request);
      })
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
