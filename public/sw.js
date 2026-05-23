// NoWorry Home — minimal service worker
//
// Just enough to satisfy PWA install criteria (a registered, fetch-
// listening worker). No caching strategy yet — offline support is a
// separate concern (which routes to cache, stale-data invalidation,
// etc.) and gets its own task.
//
// skipWaiting + clients.claim mean an updated worker takes over on
// the next page load without forcing the user to close all tabs.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // Pass-through. Letting the browser handle each request directly
  // is correct for v1 — the worker exists so the app is installable,
  // not because we have a caching strategy ready.
})
