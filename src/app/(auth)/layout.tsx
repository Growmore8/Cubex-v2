import { getBrand } from "@/lib/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-gray-50 px-4"
      style={{ ["--brand-primary" as any]: brand.primaryColor, ["--brand-accent" as any]: brand.accentColor }}
    >
      <div className="w-full max-w-sm rounded-xl border bg-white p-8 shadow-sm">
        <div className="mb-6 text-center text-lg font-bold" style={{ color: "var(--brand-primary)" }}>
          {brand.name}
        </div>
        {children}
      </div>
    </div>
  );
}
