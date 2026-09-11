// ── Offline shell caching ──
const CACHE = "cubex-shell-v1";
const SHELL = ["/login", "/client"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  // Skip non-GET, API routes, WebSocket, cross-origin
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) return;
  // Navigation: network-first, fall back to /login shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match("/login") || caches.match(event.request);
      })
    );
    return;
  }
  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(event.request, clone); });
        }
        return res;
      });
    })
  );
});

// ── Push notifications ──
self.addEventListener("push", function (event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "CubeX", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "CubeX";
  const options = { body: data.body || "", data: { url: data.url || "/client" } };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/client";
  event.waitUntil(self.clients.matchAll({ type: "window" }).then(function (wins) {
    for (const w of wins) { if (w.url.indexOf(url) !== -1 && "focus" in w) return w.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});