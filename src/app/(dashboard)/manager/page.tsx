"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Managers now use the same full platform terminal as admins (scoped to their
// own clients + limited by permissions on the server).
export default function ManagerRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/platform"); }, [router]);
  return null;
}
