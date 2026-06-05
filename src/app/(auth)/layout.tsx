import { getBrand } from "@/lib/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"
      style={{
        background: "var(--background)",
        ["--brand-primary" as any]: brand.primaryColor,
        ["--brand-accent" as any]: brand.accentColor,
      }}
    >
      {/* Ambient brand glows */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="auth-glow absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full opacity-[0.18] blur-3xl"
          style={{ background: brand.primaryColor }}
        />
        <div
          className="auth-glow absolute -bottom-40 -right-24 h-[26rem] w-[26rem] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: brand.accentColor, animationDelay: "1.5s" }}
        />
      </div>

      <div className="auth-card relative w-full max-w-sm">
        {/* Thin brand gradient accent on top of the card */}
        <div
          className="mx-auto h-1 w-24 rounded-full"
          style={{ background: `linear-gradient(90deg, ${brand.primaryColor}, ${brand.accentColor})` }}
        />
        <div
          className="mt-3 rounded-2xl border p-7 sm:p-8 backdrop-blur-sm"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            boxShadow: "0 24px 60px -24px rgba(0,0,0,0.35), 0 2px 8px -4px rgba(0,0,0,0.2)",
          }}
        >
          <div className="mb-7 text-center">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt={brand.name}
                className="mx-auto mb-3 h-12 w-auto object-contain"
              />
            ) : (
              <div
                className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white"
                style={{ background: `linear-gradient(135deg, ${brand.primaryColor}, ${brand.accentColor})` }}
              >
                {(brand.name || "?").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div
              className="text-xl font-bold tracking-tight"
              style={{
                background: `linear-gradient(90deg, ${brand.primaryColor}, ${brand.accentColor})`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {brand.name}
            </div>
            {brand.slogan && (
              <div className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
                {brand.slogan}
              </div>
            )}
          </div>

          {children}

          {(brand.companyInfo || brand.supportEmail) && (
            <div
              className="mt-7 border-t pt-3 text-center text-[10px] leading-snug"
              style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
            >
              {brand.companyInfo && <div>{brand.companyInfo}</div>}
              {brand.supportEmail && <div className="mt-0.5">{brand.supportEmail}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
