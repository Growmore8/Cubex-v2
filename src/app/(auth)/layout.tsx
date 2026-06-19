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
          <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-6 lg:min-h-full" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))", background: "radial-gradient(900px 480px at 50% -10%, color-mix(in srgb, var(--brand-primary) 12%, #0b1322), #0a0f1c 62%)" }}>
            <div className="w-full max-w-[400px]">
              {/* logo — shown here on mobile (brand panel carries it on desktop) */}
              <div className="mb-5 flex justify-center lg:hidden">{logoMark}</div>
              <div className="auth-card rounded-2xl border p-6 lg:p-7" style={{ background: "var(--card)", borderColor: "color-mix(in srgb, var(--border) 70%, transparent)", boxShadow: "0 24px 60px -24px rgba(0,0,0,0.55), 0 2px 8px -4px rgba(0,0,0,0.3)" }}>
                {children}
                {brand.companyInfo && (
                  <div className="mt-6 border-t pt-3 text-[10px] leading-snug" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>{brand.companyInfo}</div>
                )}
              </div>
            </div>
          </div>

          {/* ── BRAND / TRADING PANEL (desktop only) — dark, animated chart in brand colours ── */}
          {(() => {
            // One period (W) of candles, repeated 3× so the scroll loops seamlessly.
            const W = 460, n = 11, sx = W / n;
            const seed = [0.42, 0.34, 0.5, 0.4, 0.56, 0.46, 0.62, 0.52, 0.7, 0.6, 0.78];
            const yOf = (h: number) => 500 - h * 360; // chart band: y 140..500
            const cells = Array.from({ length: n * 3 }, (_, i) => ({ i, cx: i * sx + sx / 2, y: yOf(seed[i % n]), up: seed[i % n] >= seed[(i - 1 + n) % n] }));
            const linePts = cells.map((c) => `${c.cx.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
            return (
            <div className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex" style={{ background: `radial-gradient(820px 620px at 78% 22%, color-mix(in srgb, ${primary} 34%, transparent), transparent 60%), radial-gradient(720px 620px at 18% 102%, color-mix(in srgb, ${accent} 28%, transparent), transparent 60%), linear-gradient(165deg, #0b1020, #070a12)` }}>
              {/* animated scrolling chart */}
              <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 460 600" aria-hidden>
                <defs>
                  <linearGradient id="auth-line" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor={accent} stopOpacity="0.2" />
                    <stop offset="1" stopColor={accent} stopOpacity="1" />
                  </linearGradient>
                </defs>
                {/* faint grid (static) */}
                {Array.from({ length: 7 }).map((_, i) => (<line key={"h" + i} x1="0" y1={i * 100} x2="460" y2={i * 100} stroke="#fff" strokeOpacity="0.05" />))}
                <g style={{ filter: `drop-shadow(0 0 6px ${accent})` }}>
                  <animateTransform attributeName="transform" type="translate" from="0 0" to={`-${W} 0`} dur="22s" repeatCount="indefinite" />
                  {cells.map((c) => (
                    <g key={c.i}>
                      <line x1={c.cx} y1={c.y - 24} x2={c.cx} y2={c.y + 24} stroke={c.up ? accent : primary} strokeOpacity="0.5" strokeWidth="2" />
                      <rect x={c.cx - 6} y={c.y - 12} width="12" height="24" rx="2" fill={c.up ? accent : primary} fillOpacity={c.up ? 0.85 : 0.4} />
                    </g>
                  ))}
                  <polyline points={linePts} fill="none" stroke="url(#auth-line)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </svg>

              {/* TOP: logo + brand name + slogan */}
              <div className="relative z-10">
                <div className="flex items-center gap-2.5">
                  {brand.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={brand.logoUrl} alt={brand.name} className="h-10 w-auto max-w-[190px] object-contain" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg text-base font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>{(brand.name || "?").trim().charAt(0).toUpperCase()}</div>
                  )}
                  <span className="text-lg font-bold text-white">{brand.name}</span>
                </div>
                {brand.slogan && <div className="mt-2 text-sm text-white/70">{brand.slogan}</div>}
              </div>

              {/* CENTER: big centered statement */}
              <div className="relative z-10 flex flex-1 items-center justify-center">
                <h2 className="max-w-[440px] text-center text-[40px] font-extrabold leading-tight text-white drop-shadow">Trade the markets — anytime, anywhere.</h2>
              </div>

              {/* BOTTOM */}
              <div className="relative z-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/65">
                <i className="fa-solid fa-shield-halved" /> Secure · Encrypted · 24/7
              </div>
            </div>
            );
          })()}

        </div>
      </div>
    </>
  );
}
