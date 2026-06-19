import { getBrand } from "@/lib/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const primary = brand.primaryColor;
  const accent = brand.accentColor;

  const logoMark = brand.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brand.logoUrl} alt={brand.name} className="h-9 w-auto max-w-[180px] object-contain" />
  ) : (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
        {(brand.name || "?").trim().charAt(0).toUpperCase()}
      </div>
      <span className="text-[17px] font-bold tracking-tight" style={{ color: "var(--foreground)" }}>{brand.name}</span>
    </div>
  );

  return (
    <>
      <style>{`html,body{background:#0a0f1c !important;}`}</style>
      <div className="fixed inset-0 overflow-y-auto" style={{ background: "#0a0f1c", ["--brand-primary" as any]: primary, ["--brand-accent" as any]: accent }}>
        <div className="min-h-full lg:grid lg:grid-cols-2">

          {/* ── FORM SIDE ── */}
          <div className="relative flex min-h-full items-center justify-center px-4 py-6" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))", background: "radial-gradient(900px 480px at 50% -10%, color-mix(in srgb, var(--brand-primary) 12%, #0b1322), #0a0f1c 62%)" }}>
            <div className="w-full max-w-[340px] lg:max-w-[400px]">
              {/* logo — shown here on mobile (brand panel carries it on desktop) */}
              <div className="mb-5 flex justify-center lg:hidden">{logoMark}</div>
              <div className="auth-card rounded-2xl border p-5 lg:p-7" style={{ background: "var(--card)", borderColor: "color-mix(in srgb, var(--border) 70%, transparent)", boxShadow: "0 24px 60px -24px rgba(0,0,0,0.55), 0 2px 8px -4px rgba(0,0,0,0.3)" }}>
                {children}
                {brand.companyInfo && (
                  <div className="mt-6 border-t pt-3 text-[10px] leading-snug" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>{brand.companyInfo}</div>
                )}
              </div>
            </div>
          </div>

          {/* ── BRAND / TRADING PANEL (desktop only) ── */}
          <div className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex" style={{ background: `linear-gradient(150deg, ${primary}, ${accent})` }}>
            {/* depth + trading motif */}
            <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(700px 500px at 80% 10%, rgba(255,255,255,0.16), transparent 60%), radial-gradient(600px 500px at 0% 100%, rgba(0,0,0,0.35), transparent 55%)" }} />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 400 600" aria-hidden>
              <defs>
                <linearGradient id="auth-line" x1="0" y1="1" x2="1" y2="0">
                  <stop offset="0" stopColor="#ffffff" stopOpacity="0.0" />
                  <stop offset="1" stopColor="#ffffff" stopOpacity="0.85" />
                </linearGradient>
              </defs>
              {/* faint grid */}
              {Array.from({ length: 7 }).map((_, i) => (<line key={"h" + i} x1="0" y1={i * 90} x2="400" y2={i * 90} stroke="#fff" strokeOpacity="0.06" />))}
              {Array.from({ length: 5 }).map((_, i) => (<line key={"v" + i} x1={i * 100} y1="0" x2={i * 100} y2="600" stroke="#fff" strokeOpacity="0.06" />))}
              {/* candlesticks */}
              {[[60, 360, 300, 230, 270], [110, 320, 250, 200, 230], [160, 300, 210, 160, 195], [210, 250, 170, 120, 150], [260, 210, 130, 90, 120], [310, 160, 95, 55, 80]].map((c, i) => {
                const [x, lo, oTop, hi, oBot] = c as number[];
                const up = i % 2 === 0;
                return (<g key={i} stroke="#fff" strokeOpacity={0.5}>
                  <line x1={x} y1={hi} x2={x} y2={lo} strokeWidth="2" />
                  <rect x={x - 9} y={oTop} width="18" height={Math.max(8, oBot - oTop)} rx="2" fill={up ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)"} stroke="none" />
                </g>);
              })}
              {/* uptrend line */}
              <polyline points="40,400 100,360 160,300 220,250 280,180 360,90" fill="none" stroke="url(#auth-line)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>

            <div className="relative">{logoMark}</div>
            <div className="relative">
              <h2 className="text-3xl font-extrabold leading-tight text-white drop-shadow">{brand.slogan || "Trade smarter, anywhere."}</h2>
              <p className="mt-3 max-w-[340px] text-sm text-white/80">{brand.companyInfo || `Your ${brand.name || ""} trading account — markets, charts and funds in one place.`}</p>
            </div>
            <div className="relative flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/70">
              <i className="fa-solid fa-shield-halved" /> Secure · Encrypted · 24/7
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
