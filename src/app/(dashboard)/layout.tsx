import { getSession } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Chrome from "@/components/layout/Chrome";
import SessionGuard from "@/components/SessionGuard";
import { IMP_RETURN_COOKIE } from "@/app/api/auth/impersonate/route";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = await getBrand();
  const isImpersonating = !!(await cookies()).get(IMP_RETURN_COOKIE)?.value;
  return (
    <Chrome brandName={brand.name} primary={brand.primaryColor} accent={brand.accentColor} name={session.name} role={session.role}>
      <SessionGuard />
      {isImpersonating && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          background: "#7c3aed", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
          padding: "6px 16px", fontSize: 13, fontWeight: 500,
        }}>
          <span>👁 Viewing as <strong>{session.name}</strong> ({session.email}) — superadmin impersonation</span>
          <a href="/api/auth/impersonate-exit" style={{
            background: "rgba(255,255,255,0.2)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)",
            borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600, textDecoration: "none",
          }}>Exit &amp; return to superadmin</a>
        </div>
      )}
      <div style={isImpersonating ? { paddingTop: 36 } : undefined}>
        {children}
      </div>
    </Chrome>
  );
}
