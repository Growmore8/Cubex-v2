import Redis from "ioredis";

let pub: any = null;
function getPub() {
  if (!pub) { try { pub = new Redis(process.env.REDIS_URL || "redis://localhost:6379"); } catch (e) { pub = null; } }
  return pub;
}
export function emitRefresh(payload?: any) {
  try { const p = getPub(); if (p) p.publish("cubex:refresh", JSON.stringify(payload || {})); } catch (e) {}
}

// Tell the price engine (server.js) to reload feed keys/primary and reconnect.
export function reloadFeeds() {
  try { const p = getPub(); if (p) p.publish("cubex:feeds", "1"); } catch (e) {}
}