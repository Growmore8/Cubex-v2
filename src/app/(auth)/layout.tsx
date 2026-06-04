import { getBrand } from "@/lib/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{
        background: "var(--background)",
        ["--brand-primary" as any]: brand.primaryColor,
        ["--brand-accent" as any]: brand.accentColor,
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border p-6 sm:p-8 shadow-sm"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="mb-6 text-center text-lg font-bold" style={{ color: "var(--brand-primary)" }}>
          {brand.name}
        </div>
        {children}
      </div>
    </div>
  );
}
