"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "";
  if (path.startsWith("/admin/desk")) return <>{children}</>;
  const items: [string, string][] = [
    ["/admin/desk", "Desk"], ["/admin", "Clients"], ["/admin/managers", "Managers"], ["/admin/kyc", "KYC"],
    ["/admin/payments", "Payments"], ["/admin/trades", "Trades"], ["/admin/groups", "Groups"],
    ["/admin/symbols", "Symbols"], ["/admin/audit", "Audit"],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 border-b pb-2">
        {items.map(([href, label]) => {
          const active = path === href;
          return (
            <Link key={href} href={href} className={"text-sm " + (active ? "font-medium" : "text-gray-500")}
              style={active ? { color: "var(--brand-primary)" } : undefined}>{label}</Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
