import { getBrand } from "@/lib/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  return (
    <>
      {/* Force the document background dark on auth pages so the home-screen (PWA
          standalone) overscroll / safe-area below the card never shows white.
          Scoped to while this layout is mounted; removed on navigating away. */}
      <style>{`html,body{background:#0a0f1c !important;}`}</style>
    <div
      className="fixed inset-0 overflow-y-auto"
      style={{
        background: "linear-gradient(135deg, #0a0f1c 0%, #0f1a2e 55%, #0a0f1c 100%)",
        ["--brand-primary" as any]: brand.primaryColor,
        ["--brand-accent" as any]: brand.accentColor,
      }}
    >
      {/* Ambient brand glows + animated market lines */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="auth-glow absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full opacity-[0.18] blur-3xl"
          style={{ background: brand.primaryColor }}
        />
        <div
          className="auth-glow absolute -bottom-40 -right-24 h-[26rem] w-[26rem] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: brand.accentColor, animationDelay: "1.5s" }}
        />
        {/* slow-scrolling market chart lines */}
        <svg className="auth-pan absolute inset-x-0 bottom-0 h-[40%] w-[200%] opacity-[0.10]" viewBox="0 0 1200 200" preserveAspectRatio="none">
          <polyline fill="none" stroke={brand.primaryColor} strokeWidth="2"
            points="0,160 60,120 120,140 180,80 240,110 300,60 360,90 420,40 480,80 540,30 600,70 660,50 720,100 780,60 840,120 900,70 960,110 1020,60 1080,100 1140,50 1200,90" />
        </svg>
        <svg className="auth-pan2 absolute inset-x-0 bottom-0 h-[55%] w-[200%] opacity-[0.07]" viewBox="0 0 1200 200" preserveAspectRatio="none">
          <polyline fill="none" stroke={brand.accentColor} strokeWidth="2"
            points="0,90 60,110 120,70 180,120 240,80 300,130 360,90 420,140 480,100 540,150 600,110 660,90 720,130 780,100 840,80 900,120 960,90 1020,130 1080,100 1140,140 1200,110" />
        </svg>
      </div>

      {/* min-h-full centers the card when it fits, but lets it scroll from the
          TOP when taller than the viewport (items-center alone clips the top). */}
      <div
        className="relative flex min-h-full items-center justify-center px-4 py-6"
        style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
      <div className="auth-card relative w-full max-w-[340px]">
        {/* Thin brand gradient accent on top of the card */}
        <div
          className="mx-auto h-1 w-20 rounded-full"
          style={{ background: `linear-gradient(90deg, ${brand.primaryColor}, ${brand.accentColor})` }}
        />
        <div
          className="mt-2.5 rounded-2xl border p-5 backdrop-blur-xl"
          style={{
            background: "color-mix(in srgb, var(--card) 92%, transparent)",
            borderColor: "color-mix(in srgb, var(--border) 80%, transparent)",
            boxShadow: "0 30px 70px -28px rgba(0,0,0,0.55), 0 4px 14px -6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div className="mb-4 text-center">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt={brand.name}
                className="mx-auto mb-2 h-10 w-auto object-contain"
              />
            ) : (
              <div
                className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold text-white"
                style={{ background: `linear-gradient(135deg, ${brand.primaryColor}, ${brand.accentColor})` }}
              >
                {(brand.name || "?").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div
              className="text-lg font-bold tracking-tight"
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

          {brand.companyInfo && (
            <div
              className="mt-5 border-t pt-3 text-center text-[10px] leading-snug"
              style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
            >
              <div>{brand.companyInfo}</div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
    </>
  );
}
