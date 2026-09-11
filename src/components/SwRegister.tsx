"use client";
import { useEffect } from "react";

// Registers /sw.js early so the PWA install prompt can appear and offline
// caching starts before the user explicitly enables push notifications.
export default function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
