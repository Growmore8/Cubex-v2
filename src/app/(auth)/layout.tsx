import { getBrand } from "@/lib/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  return (
    <>
      {/* Keep the document background dark so PWA overscroll never flashes white. */}
      <style>{`html,body{background:#0a0f1c !important;}`}</style>
      <div
        className="fixed inset-0 overflow-y-auto"
        style={{
          // Flat, corporate backdrop: solid navy with a single faint brand wash up top.
          background:
            "radial-gradient(1100px 520px at 50% -8%, color-mix(in srgb, var(--brand-primary) 13%, #0b1322), #0a0f1c 60%)",
          ["--brand-primary" as any]: brand.primaryColor,
          ["--brand-accent" as any]: brand.accentColor,
        }}
      >
        <div
          className="relative flex min-h-full items-center justify-center px-4 py-8"
          style={{ paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
        >
          <div
            className="auth-card w-full max-w-[380px] rounded-2xl border p-7"
            style={{
              background: "var(--card)",
              borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
              boxShadow: "0 24px 60px -24px rgba(0,0,0,0.55), 0 2px 8px -4px rgba(0,0,0,0.3)",
            }}
          >
            {/* Brand — left aligned at the top of the card */}
            <div className="mb-6 flex items-center gap-2.5">
              {brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logoUrl} alt={brand.name} className="h-9 w-auto max-w-[170px] object-contain" />
              ) : (
                <>
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-extrabold text-white"
                    style={{ background: `linear-gradient(135deg, ${brand.primaryColor}, ${brand.accentColor})` }}
                  >
                    {(brand.name || "?").trim().charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[17px] font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
                    {brand.name}
                  </span>
                </>
              )}
            </div>

            {children}

            {brand.companyInfo && (
              <div
                className="mt-6 border-t pt-3 text-[10px] leading-snug"
                style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
              >
                {brand.companyInfo}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
