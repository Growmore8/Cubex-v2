"use client";

export function isOnline(lastSeenAt?: string | Date | null): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  return isFinite(t) && Date.now() - t < 2 * 60 * 1000;
}

export function ago(d?: string | Date | null): string {
  if (!d) return "never";
  const ms = Date.now() - new Date(d).getTime();
  if (!isFinite(ms)) return "never";
  if (ms < 60000) return "just now";
  const m = Math.floor(ms / 60000); if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
  const days = Math.floor(h / 24); if (days < 30) return days + "d ago";
  return new Date(d).toLocaleDateString();
}

export function PresenceDot({ online, size = 9 }: { online?: boolean; size?: number }) {
  return (
    <span
      title={online ? "Online" : "Offline"}
      style={{ display: "inline-block", width: size, height: size, borderRadius: 9999, background: online ? "#16a34a" : "#94a3b8", boxShadow: online ? "0 0 0 2px rgba(22,163,74,0.25)" : "none", flexShrink: 0 }}
    />
  );
}

export function DeviceIcon({ device, className = "" }: { device?: string | null; className?: string }) {
  const d = String(device || "").toLowerCase();
  const icon = d === "mobile" ? "fa-mobile-screen-button" : d === "tablet" ? "fa-tablet-screen-button" : "fa-laptop";
  return <i className={"fa-solid " + icon + " " + className} title={device || "Desktop"} />;
}

// Compact "● Online" / "● last seen 5m ago" line.
export function Presence({ online, lastSeenAt, device }: { online?: boolean; lastSeenAt?: string | Date | null; device?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <PresenceDot online={online} />
      <span style={{ color: online ? "#16a34a" : "var(--muted-foreground, #94a3b8)" }}>
        {online ? "Online" : "last seen " + ago(lastSeenAt)}
      </span>
      {device && <DeviceIcon device={device} className="opacity-70" />}
    </span>
  );
}
