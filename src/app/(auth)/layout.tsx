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
        <div className="mb-6 text-center">
          {brand.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className="mx-auto mb-2 h-12 w-auto object-contain" />
          )}
          <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{brand.name}</div>
          {brand.slogan && <div className="mt-0.5 text-xs" style={{ color: "var(--muted-foreground)" }}>{brand.slogan}</div>}
        </div>
        {children}
        {(brand.companyInfo || brand.supportEmail) && (
          <div className="mt-6 border-t pt-3 text-center text-[10px] leading-snug" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
            {brand.companyInfo && <div>{brand.companyInfo}</div>}
            {brand.supportEmail && <div className="mt-0.5">{brand.supportEmail}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
