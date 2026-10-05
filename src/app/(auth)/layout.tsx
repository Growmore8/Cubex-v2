import { getBrand } from "@/lib/brand";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

// ── Animation 0: Particle Network ──────────────────────────────────────────
function AnimParticles({ p, a }: { p: string; a: string }) {
  const pts = [
    [100, 80], [290, 55], [460, 105], [55, 210], [215, 175], [395, 195],
    [135, 310], [315, 285], [490, 255], [75, 405], [255, 395], [430, 370],
    [170, 490], [355, 465], [520, 440], [45, 525], [240, 515], [455, 500],
    [310, 145], [155, 435],
  ];
  const lines: [number, number, number, number][] = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < 175) lines.push([pts[i][0], pts[i][1], pts[j][0], pts[j][1]]);
    }
  return (
    <svg className="absolute inset-0 h-full w-full opacity-55" viewBox="0 0 560 580" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {lines.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={a} strokeOpacity="0.22" strokeWidth="1" />
      ))}
      {pts.map(([cx, cy], i) => {
        const r = i % 4 === 0 ? 3.5 : i % 4 === 1 ? 2.5 : i % 4 === 2 ? 2 : 1.5;
        const col = i % 2 === 0 ? a : p;
        const dur = `${2.2 + i * 0.27}s`;
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill={col} fillOpacity="0.8">
            <animate attributeName="opacity" values={i % 2 === 0 ? "0.35;0.95;0.35" : "0.25;0.75;0.25"} dur={dur} repeatCount="indefinite" />
            <animate attributeName="r" values={`${r};${r + 1.5};${r}`} dur={dur} repeatCount="indefinite" />
          </circle>
        );
      })}
    </svg>
  );
}

// ── Animation 1: Wave Layers ────────────────────────────────────────────────
function AnimWaves({ p, a }: { p: string; a: string }) {
  const TW = 1100;
  function sine(amp: number, period: number, phase: number, yBase: number) {
    return Array.from({ length: Math.ceil(TW / 6) + 1 }, (_, i) => {
      const x = i * 6;
      const y = yBase + amp * Math.sin((x / period) * Math.PI * 2 + phase);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }
  const ws = [
    { amp: 72, period: 340, phase: 0, y: 155, dur: "10s", col: a, op: 0.45 },
    { amp: 52, period: 250, phase: 1.2, y: 270, dur: "14s", col: p, op: 0.38 },
    { amp: 88, period: 470, phase: 2.4, y: 380, dur: "12s", col: a, op: 0.27 },
    { amp: 38, period: 185, phase: 0.8, y: 475, dur: "8s", col: p, op: 0.32 },
  ];
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${TW} 580`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      {ws.map((w, i) => (
        <path key={i} d={sine(w.amp, w.period, w.phase, w.y)} fill="none" stroke={w.col} strokeOpacity={w.op} strokeWidth="2" strokeLinecap="round">
          <animateTransform attributeName="transform" type="translate" from="0 0" to={`-${TW / 2} 0`} dur={w.dur} repeatCount="indefinite" />
        </path>
      ))}
    </svg>
  );
}

// ── Animation 2: Orbital Rings ──────────────────────────────────────────────
function AnimOrbits({ p, a }: { p: string; a: string }) {
  const cx = 280, cy = 290;
  return (
    <svg className="absolute inset-0 h-full w-full opacity-60" viewBox="0 0 560 580" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <circle cx={cx} cy={cy} r="155" fill="none" stroke={a} strokeOpacity="0.18" strokeWidth="1.5" strokeDasharray="4 8" />
      <circle cx={cx} cy={cy} r="220" fill="none" stroke={p} strokeOpacity="0.13" strokeWidth="1" strokeDasharray="6 12" />
      <circle cx={cx} cy={cy} r="95" fill="none" stroke={a} strokeOpacity="0.22" strokeWidth="1" strokeDasharray="3 5" />
      <circle cx={cx + 155} cy={cy} r="5.5" fill={a} fillOpacity="0.9">
        <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="9s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy - 155} r="3.5" fill={a} fillOpacity="0.55">
        <animateTransform attributeName="transform" type="rotate" from={`90 ${cx} ${cy}`} to={`450 ${cx} ${cy}`} dur="9s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx + 220} cy={cy} r="4" fill={p} fillOpacity="0.75">
        <animateTransform attributeName="transform" type="rotate" from={`360 ${cx} ${cy}`} to={`0 ${cx} ${cy}`} dur="15s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy + 220} r="3" fill={p} fillOpacity="0.5">
        <animateTransform attributeName="transform" type="rotate" from={`-90 ${cx} ${cy}`} to={`270 ${cx} ${cy}`} dur="15s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx + 95} cy={cy} r="3.5" fill={a} fillOpacity="0.7">
        <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="6s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r="9" fill={a} fillOpacity="0.35">
        <animate attributeName="r" values="7;14;7" dur="3.5s" repeatCount="indefinite" />
        <animate attributeName="fill-opacity" values="0.35;0.08;0.35" dur="3.5s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r="4" fill={a} fillOpacity="0.9" />
    </svg>
  );
}

// ── Animation 3: Pulse Ripples ──────────────────────────────────────────────
function AnimRipples({ p, a }: { p: string; a: string }) {
  const centers = [[190, 190], [390, 360], [110, 430], [440, 140], [280, 290]] as const;
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 560 580" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {centers.map(([x, y], ci) =>
        [0, 1, 2].map((j) => (
          <circle key={`${ci}-${j}`} cx={x} cy={y} r="10" fill="none" stroke={ci % 2 === 0 ? a : p} strokeWidth="1.5">
            <animate attributeName="r" values="10;150;10" begin={`${j * 1.9 + ci * 0.65}s`} dur={`${5.6 + ci * 0.35}s`} repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.55;0;0.55" begin={`${j * 1.9 + ci * 0.65}s`} dur={`${5.6 + ci * 0.35}s`} repeatCount="indefinite" />
          </circle>
        ))
      )}
    </svg>
  );
}

// ── Animation 4: Chart Flow (gradient area + line) ──────────────────────────
function AnimChart({ p, a }: { p: string; a: string }) {
  const W = 560;
  const data = [0.42, 0.38, 0.5, 0.44, 0.58, 0.52, 0.65, 0.58, 0.72, 0.65, 0.78, 0.72, 0.82, 0.76, 0.9, 0.82, 0.87, 0.82, 0.9, 0.84, 0.78, 0.72, 0.85, 0.78, 0.92, 0.86, 0.8, 0.74];
  const sx = (W * 2) / (data.length - 1);
  const yOf = (v: number) => 490 - v * 350;
  const linePts = data.map((v, i) => `${(i * sx).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const area = `M0,490 ${data.map((v, i) => `L${(i * sx).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ")} L${((data.length - 1) * sx).toFixed(1)},490 Z`;
  const line2Pts = data.map((v, i) => `${(i * sx + W * 2).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const area2 = `M${W * 2},490 ${data.map((v, i) => `L${(i * sx + W * 2).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ")} L${((data.length - 1) * sx + W * 2).toFixed(1)},490 Z`;
  return (
    <svg className="absolute inset-0 h-full w-full opacity-50" viewBox={`0 0 ${W * 2} 580`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="cf-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={a} stopOpacity="0.38" />
          <stop offset="1" stopColor={a} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cf-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={a} stopOpacity="0.1" />
          <stop offset="0.5" stopColor={a} stopOpacity="0.95" />
          <stop offset="1" stopColor={a} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {Array.from({ length: 7 }, (_, i) => (
        <line key={i} x1="0" y1={80 + i * 60} x2={W * 2} y2={80 + i * 60} stroke="#fff" strokeOpacity="0.04" />
      ))}
      <g>
        <animateTransform attributeName="transform" type="translate" from="0 0" to={`-${W * 2} 0`} dur="20s" repeatCount="indefinite" />
        <path d={area} fill="url(#cf-area)" />
        <path d={area2} fill="url(#cf-area)" />
        <polyline points={linePts} fill="none" stroke="url(#cf-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={line2Pts} fill="none" stroke="url(#cf-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

// ── Animation 5: Hex Grid ───────────────────────────────────────────────────
function AnimHex({ p, a }: { p: string; a: string }) {
  const R = 38, H = R * Math.sqrt(3) / 2;
  const hexes: [number, number, number][] = [];
  for (let row = -1; row <= 9; row++)
    for (let col = -1; col <= 9; col++) {
      const hx = col * R * 2 + (row % 2 === 0 ? 0 : R);
      const hy = row * H * 1.12;
      hexes.push([hx, hy, row * 11 + col]);
    }
  function hex(cx: number, cy: number) {
    return Array.from({ length: 6 }, (_, i) => {
      const ang = (Math.PI / 3) * i - Math.PI / 6;
      return `${(cx + R * 0.88 * Math.cos(ang)).toFixed(1)},${(cy + R * 0.88 * Math.sin(ang)).toFixed(1)}`;
    }).join(" ");
  }
  return (
    <svg className="absolute inset-0 h-full w-full opacity-45" viewBox="0 0 560 580" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {hexes.map(([hx, hy, idx]) => {
        const col = idx % 3 === 0 ? a : p;
        const baseOp = idx % 3 === 0 ? "0.12;0.45;0.12" : "0.06;0.22;0.06";
        const dur = `${2.8 + (idx * 7 % 8) * 0.45}s`;
        const begin = `${(idx * 3 % 5) * 0.6}s`;
        return (
          <polygon key={idx} points={hex(hx, hy)} fill="none" stroke={col} strokeWidth="1">
            <animate attributeName="stroke-opacity" values={baseOp} dur={dur} begin={begin} repeatCount="indefinite" />
          </polygon>
        );
      })}
    </svg>
  );
}

// ───────────────────────────────────────────────────────────────────────────

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const host = ((await headers()).get("host") || "").split(":")[0].toLowerCase();
  const pub = (process.env.PLATFORM_BASE_DOMAIN || "").toLowerCase();
  if (!brand.tenantId && pub && host !== pub && host.endsWith("." + pub)) {
    redirect(`https://${pub}`);
  }
  const primary = brand.primaryColor;
  const accent = brand.accentColor;
  const animIdx = brand.tenantId ? djb2(brand.tenantId) % 6 : 0;

  const animations = [
    <AnimParticles key="a" p={primary} a={accent} />,
    <AnimWaves key="a" p={primary} a={accent} />,
    <AnimOrbits key="a" p={primary} a={accent} />,
    <AnimRipples key="a" p={primary} a={accent} />,
    <AnimChart key="a" p={primary} a={accent} />,
    <AnimHex key="a" p={primary} a={accent} />,
  ];

  const logoMark = brand.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brand.logoUrl} alt={brand.name} className="h-9 w-auto max-w-[180px] object-contain" />
  ) : (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
        {(brand.name || "?").trim().charAt(0).toUpperCase()}
      </div>
      <span className="text-[17px] font-bold tracking-tight text-white">{brand.name}</span>
    </div>
  );

  return (
    <>
      <style>{`html,body{background:#0a0f1c !important;}`}</style>
      <div
        className="fixed inset-0 overflow-y-auto"
        style={{ background: "#0a0f1c", ["--brand-primary" as any]: primary, ["--brand-accent" as any]: accent }}
      >
        <div className="min-h-full lg:grid lg:grid-cols-2">

          {/* ── FORM SIDE ── */}
          <div
            className="relative flex min-h-[100dvh] items-center justify-center px-4 py-8 lg:min-h-full"
            style={{
              paddingTop: "max(2rem, env(safe-area-inset-top))",
              paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
              background: "radial-gradient(900px 480px at 50% -10%, color-mix(in srgb, var(--brand-primary) 12%, #0b1322), #0a0f1c 62%)",
            }}
          >
            <div className="w-full" style={{ maxWidth: 420 }}>
              {/* logo — mobile only */}
              <div className="mb-6 flex justify-center lg:hidden">{logoMark}</div>
              <div
                className="auth-card rounded-2xl border p-6 lg:p-8"
                style={{
                  background: "var(--card)",
                  borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
                  boxShadow: "0 24px 60px -24px rgba(0,0,0,0.55), 0 2px 8px -4px rgba(0,0,0,0.3)",
                  minHeight: 500,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ flex: 1 }}>{children}</div>
                {brand.companyInfo && (
                  <div className="mt-6 border-t pt-3 text-[10px] leading-snug" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
                    {brand.companyInfo}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── BRAND / ANIMATION PANEL (desktop only) ── */}
          <div
            className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
            style={{
              background: `radial-gradient(760px 600px at 80% 16%, color-mix(in srgb, ${primary} 18%, transparent), transparent 62%), radial-gradient(680px 600px at 16% 104%, color-mix(in srgb, ${accent} 15%, transparent), transparent 62%), linear-gradient(165deg, #0a0d18, #05070d)`,
            }}
          >
            {/* Unique animation layer */}
            {animations[animIdx]}

            {/* Subtle centre vignette so text stays readable */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(600px 400px at 55% 50%, rgba(0,0,0,0.42), transparent 70%), linear-gradient(180deg, rgba(5,7,13,0.28), rgba(5,7,13,0.45))" }}
            />

            {/* TOP: logo */}
            <div className="relative z-10">
              <div className="flex items-center gap-2.5">
                {brand.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logoUrl} alt={brand.name} className="h-10 w-auto max-w-[190px] object-contain" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg text-base font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
                    {(brand.name || "?").trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-lg font-bold text-white">{brand.name}</span>
              </div>
            </div>

            {/* CENTER: headline */}
            <div className="relative z-10 flex flex-1 items-center justify-center">
              <h2
                className="text-center text-white"
                style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.15, letterSpacing: "0.01em", textShadow: "0 6px 30px rgba(0,0,0,0.7)" }}
              >
                Trade the markets<br />anytime, anywhere
              </h2>
            </div>

            {/* BOTTOM: trust line */}
            <div className="relative z-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/60">
              <i className="fa-solid fa-shield-halved" /> Secure · Encrypted · 24/7
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
