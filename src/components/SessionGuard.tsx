"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// Polls session validity. Logs out on deactivation / other-device / expiry,
// and shows a global red READ-ONLY banner when the account is locked.
export default function SessionGuard() {
  const done = useRef(false);
  const [readOnly, setReadOnly] = useState(false);
  const path = usePathname() || "";
  // The client terminal + admin/manager desk render their OWN read-only banner,
  // so suppress this global one there (it was showing twice). Polling still runs.
  const ownBanner = path.startsWith("/client") || path.startsWith("/admin") || path.startsWith("/manager");

  useEffect(() => {
    let alive = true;
    async function check() {
      if (done.current) return;
      try {
        const d = await fetch("/api/auth/ping", { cache: "no-store" }).then((r) => r.json());
        if (!alive) return;
        if (d && d.ok === false) {
          done.current = true;
          try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
          const reason = d.reason === "other-device" ? "other-device" : d.reason === "deactivated" ? "deactivated" : d.reason === "suspended" ? "suspended" : "expired";
          window.location.href = "/login?reason=" + reason;
          return;
        }
        setReadOnly(!!(d && d.readOnly));
      } catch {}
    }
    check();
    const t = setInterval(check, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!readOnly || ownBanner) return null;
  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
        background: "#dc2626", color: "#fff", textAlign: "center",
        fontSize: 12, fontWeight: 700, padding: "5px 8px", letterSpacing: "0.02em",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      <i className="fa-solid fa-lock mr-2" />READ-ONLY ACCESS — your account has been locked. You can view everything, but no actions are allowed. Contact support.
    </div>
  );
}
