"use client";
import { useEffect } from "react";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    function onPageHide() {
      if (!localStorage.getItem("cubex-remember")) {
        navigator.sendBeacon("/api/auth/logout");
      }
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  return <>{children}</>;
}
