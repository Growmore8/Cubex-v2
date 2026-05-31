"use client";
import { usePathname } from "next/navigation";
import LogoutButton from "@/components/auth/LogoutButton";
import NotificationBell from "@/components/shared/NotificationBell";

export default function Chrome({ brandName, primary, accent, name, role, children }: any) {
  const path = usePathname() || "";
  const bare = path.startsWith("/client") || path.startsWith("/admin/desk");
  const vars: any = { ["--brand-primary"]: primary, ["--brand-accent"]: accent };
  if (bare) return <div className="min-h-screen" style={vars}>{children}</div>;
  return (
    <div className="min-h-screen bg-gray-50" style={vars}>
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div className="font-semibold" style={{ color: "var(--brand-primary)" }}>{brandName}</div>
        <div className="flex items-center gap-4 text-sm">
          <NotificationBell />
          <span className="text-gray-600">{name} - {role}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
