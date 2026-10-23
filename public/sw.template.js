// Offline shell: the page, its assets and the packages are cached as they are fetched; the API is always network.
// The cache name changes with every deploy (the build stamps it), so a new version replaces the old on next load.
const CACHE = "kotoba-__BUILD__";
const SHELL = ["/", "/packages/index.json", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // navigations and the deck: network first, so a deploy shows up; fall back to the cache offline
  if (event.request.mode === "navigate" || url.pathname.endsWith(".json")) {
    event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match("/"))));
    return;
  }
  // hashed assets: cache first
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; })));
});
