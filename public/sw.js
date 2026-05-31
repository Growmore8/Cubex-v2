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