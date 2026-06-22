import { getBrand } from "@/lib/brand";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  // Security: on the PUBLIC base domain, only real tenant subdomains may show a
  // login. Non-tenant public subdomains (e.g. trade./db./random.<public>) bounce
  // to the marketing site, so the platform/SuperAdmin login is never exposed there.
  // (Internal domains like cubexenterprises.com are unaffected.)
  const host = ((await headers()).get("host") || "").split(":")[0].toLowerCase();
  const pub = (process.env.PLATFORM_BASE_DOMAIN || "").toLowerCase();
  if (!brand.tenantId && pub && host !== pub && host.endsWith("." + pub)) {
    redirect(`https://${pub}`);
  }
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
            // Live-market ticker chips (forex/crypto/metal) — float gently for a "live" feel.
            const quotes = [
              { sym: "BTCUSD", sell: "64,178.20", buy: "64,182.50", up: true, style: { top: "14%", left: "7%" }, delay: "0s" },
              { sym: "XAUUSD", sell: "2,412.10", buy: "2,412.65", up: false, style: { top: "30%", right: "8%" }, delay: "1.1s" },
              { sym: "EURUSD", sell: "1.08402", buy: "1.08418", up: true, style: { bottom: "16%", left: "9%" }, delay: "0.6s" },
            ];
            return (
            <div className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex" style={{ background: `radial-gradient(760px 600px at 80% 16%, color-mix(in srgb, ${primary} 18%, transparent), transparent 62%), radial-gradient(680px 600px at 16% 104%, color-mix(in srgb, ${accent} 15%, transparent), transparent 62%), linear-gradient(165deg, #0a0d18, #05070d)` }}>
              {/* animated scrolling chart (dim, behind everything) */}
              <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-45" preserveAspectRatio="xMidYMid slice" viewBox="0 0 460 600" aria-hidden>
                <defs>
                  <linearGradient id="auth-line" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor={accent} stopOpacity="0.15" />
                    <stop offset="1" stopColor={accent} stopOpacity="0.9" />
                  </linearGradient>
                </defs>
                {Array.from({ length: 7 }).map((_, i) => (<line key={"h" + i} x1="0" y1={i * 100} x2="460" y2={i * 100} stroke="#fff" strokeOpacity="0.04" />))}
                <g>
                  <animateTransform attributeName="transform" type="translate" from="0 0" to={`-${W} 0`} dur="26s" repeatCount="indefinite" />
                  {cells.map((c) => (
                    <g key={c.i}>
                      <line x1={c.cx} y1={c.y - 22} x2={c.cx} y2={c.y + 22} stroke={c.up ? accent : primary} strokeOpacity="0.4" strokeWidth="2" />
                      <rect x={c.cx - 6} y={c.y - 11} width="12" height="22" rx="2" fill={c.up ? accent : primary} fillOpacity={c.up ? 0.6 : 0.3} />
                    </g>
                  ))}
                  <polyline points={linePts} fill="none" stroke="url(#auth-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </svg>
              {/* dark cover so the centred text stays readable */}
              <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(520px 360px at 60% 50%, rgba(0,0,0,0.55), transparent 70%), linear-gradient(180deg, rgba(5,7,13,0.35), rgba(5,7,13,0.55))" }} />

              {/* floating live-market quote chips */}
              {quotes.map((q) => (
                <div key={q.sym} className="absolute z-[5] rounded-xl border px-3 py-2 shadow-lg" style={{ ...q.style, background: "rgba(10,14,24,0.6)", borderColor: "rgba(255,255,255,0.1)", backdropFilter: "blur(6px)", animation: `auth-float 5.5s ease-in-out ${q.delay} infinite` }}>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-white">{q.sym}<i className={"fa-solid text-[8px] " + (q.up ? "fa-arrow-trend-up" : "fa-arrow-trend-down")} style={{ color: q.up ? "#22c55e" : "#ff6b6b" }} /></div>
                  <div className="mt-1 flex gap-3 text-[10px] tabular-nums">
                    <span className="text-white/55">Sell <b style={{ color: "#ff6b6b" }}>{q.sell}</b></span>
                    <span className="text-white/55">Buy <b style={{ color: "#22c55e" }}>{q.buy}</b></span>
                  </div>
                </div>
              ))}

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
              </div>

              {/* CENTER: big centered statement (2 lines) */}
              <div className="relative z-10 flex flex-1 items-center justify-center">
                <h2 className="text-center text-white" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.15, letterSpacing: "0.01em", textShadow: "0 6px 30px rgba(0,0,0,0.7)" }}>
                  Trade the markets<br />anytime, anywhere
                </h2>
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
