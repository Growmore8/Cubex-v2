"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const IDLE_MS = 15 * 60 * 1000;   // 15 minutes
const WARN_MS = 13 * 60 * 1000;   // warn at 13 minutes

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "";
  const router = useRouter();
  const [warn, setWarn] = useState(false);
  const [secs, setSecs] = useState(120);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Admin pages live inside the Platform; also allow the standalone manager-
  // management page. Anything else redirects to the desk.
  const allowed = path.startsWith("/admin/platform") || path.startsWith("/admin/managers");
  useEffect(() => {
    if (!allowed) router.replace("/admin/platform");
  }, [allowed, router]);

  // Tab/browser close = logout (if not remembered)
  useEffect(() => {
    function onPageHide() {
      if (!localStorage.getItem("cubex-remember")) {
        navigator.sendBeacon("/api/auth/logout");
      }
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // 15-minute idle auto-logout
  useEffect(() => {
    function reset() {
      if (warnRef.current) clearTimeout(warnRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countRef.current) clearInterval(countRef.current);
      setWarn(false);

      warnRef.current = setTimeout(() => {
        setWarn(true);
        setSecs(120);
        countRef.current = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
      }, WARN_MS);

      timerRef.current = setTimeout(doLogout, IDLE_MS);
    }

    async function doLogout() {
      if (countRef.current) clearInterval(countRef.current);
      localStorage.removeItem("cubex-remember");
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login?reason=expired";
    }

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (warnRef.current) clearTimeout(warnRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countRef.current) clearInterval(countRef.current);
    };
  }, []);

  if (!allowed) return null;

  return (
    <>
      {children}
      {warn && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", maxWidth: 360, width: "90%", textAlign: "center", boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⏱</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6, color: "#1a2332" }}>Session expiring soon</div>
            <div style={{ fontSize: 13, color: "#5a6a82", marginBottom: 18 }}>
              You will be logged out in <strong style={{ color: "#ef4444" }}>{secs}s</strong> due to inactivity.
            </div>
            <button
              onClick={() => { setWarn(false); }}
              style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "9px 28px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              Stay signed in
            </button>
          </div>
        </div>
      )}
    </>
  );
}
