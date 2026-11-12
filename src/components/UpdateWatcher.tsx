"use client";
import { useEffect, useRef, useState } from "react";

export default function UpdateWatcher() {
  const current = useRef<string | null>(null);
  const [stale, setStale] = useState(false);
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const d = await fetch("/api/version", { cache: "no-store" }).then((r) => r.json());
        if (!alive || !d?.v) return;
        if (current.current == null) current.current = d.v;
        else if (d.v !== current.current) setStale(true);
      } catch {}
    }
    check();
    const t = setInterval(check, 60000);
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // Auto-reload after 8 s so stale JS (which causes server-action error loops
  // that spike CPU to 120%+) is replaced without requiring the user to tap.
  useEffect(() => {
    if (!stale) return;
    setCountdown(8);
    const tick = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) { clearInterval(tick); location.reload(); return 0; }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [stale]);

  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 z-[2000] flex justify-center px-3" style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}>
      <button
        onClick={() => location.reload()}
        className="flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white shadow-2xl"
        style={{ background: "linear-gradient(135deg, var(--brand-primary, #6d28d9), var(--brand-accent, #2563eb))", animation: "ui-pop .3s cubic-bezier(.16,1,.3,1) both" }}
      >
        <i className="fa-solid fa-arrows-rotate" /> New version — refreshing in {countdown}s (tap to refresh now)
      </button>
    </div>
  );
}
