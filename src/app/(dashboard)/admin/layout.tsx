"use client";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "";
  const router = useRouter();

  // Everything is managed inside the Platform — redirect other admin pages there
  useEffect(() => {
    if (!path.startsWith("/admin/platform")) {
      router.replace("/admin/platform");
    }
  }, [path, router]);

  if (!path.startsWith("/admin/platform")) return null;
  return <>{children}</>;
}
