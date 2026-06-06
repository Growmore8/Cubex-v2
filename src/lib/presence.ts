// Online/offline presence + device helpers (shared by APIs).
export const ONLINE_WINDOW_MS = 2 * 60 * 1000; // "online" if seen within 2 minutes

export function isOnline(lastSeenAt?: Date | string | null): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  return isFinite(t) && Date.now() - t < ONLINE_WINDOW_MS;
}

// Coarse device class from a User-Agent string.
export function deviceFromUA(ua?: string | null): "Mobile" | "Tablet" | "Desktop" {
  const s = String(ua || "");
  if (/\b(iPad|Tablet)\b/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) return "Tablet";
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(s)) return "Mobile";
  return "Desktop";
}
