"use client";
import { useEffect, useRef, useState } from "react";

// Polls /api/version and, when the deployed build changes, shows a one-tap
// "Update" banner. Installed PWAs have no browser refresh button, so this is how
// a long-open app picks up a new deploy without the user hunting for a refresh.
export default function UpdateWatcher() {
  const current = useRef<string | null>(null);
  const [stale, setStale] = useState(false);

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
    // Also re-check when the user returns to the app (common in PWAs).
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 z-[2000] flex justify-center px-3" style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}>
      <button
        onClick={() => location.reload()}
        className="flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white shadow-2xl"
        style={{ background: "linear-gradient(135deg, var(--brand-primary, #6d28d9), var(--brand-accent, #2563eb))", animation: "ui-pop .3s cubic-bezier(.16,1,.3,1) both" }}
      >
        <i className="fa-solid fa-arrows-rotate" /> Update available — tap to refresh
      </button>
    </div>
  );
}
