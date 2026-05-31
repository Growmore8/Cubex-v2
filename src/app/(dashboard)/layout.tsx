import { getSession } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
import { redirect } from "next/navigation";
import Chrome from "@/components/layout/Chrome";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = await getBrand();
  return (
    <Chrome brandName={brand.name} primary={brand.primaryColor} accent={brand.accentColor} name={session.name} role={session.role}>
      {children}
    </Chrome>
  );
}
