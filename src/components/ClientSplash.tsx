"use client";

// Branded loading/splash screen for the client app: centred tenant logo (or
// brand name), slogan, then a sweeping progress bar in the brand colours.
// Cross-fades out (`hiding`) once the app's first data is ready.
export default function ClientSplash({
  brand, theme, hiding,
}: {
  brand: { name?: string; logoUrl?: string | null; slogan?: string | null; primaryColor?: string | null; accentColor?: string | null };
  theme: "dark" | "light";
  hiding: boolean;
}) {
  const primary = brand?.primaryColor || "#7c3aed";
  const accent = brand?.accentColor || "#2563eb";
  const dark = theme === "dark";
  const fg = dark ? "#f8fafc" : "#0f172a";
  const muted = dark ? "rgba(248,250,252,0.6)" : "rgba(15,23,42,0.55)";
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        opacity: hiding ? 0 : 1,
        transition: "opacity .45s ease",
        pointerEvents: hiding ? "none" : "auto",
        background: `radial-gradient(680px 420px at 50% 28%, color-mix(in srgb, ${primary} 30%, transparent), transparent 62%), radial-gradient(560px 380px at 50% 110%, color-mix(in srgb, ${accent} 26%, transparent), transparent 60%), var(--bg)`,
      }}
    >
      <div style={{ animation: "splash-in .5s cubic-bezier(.16,1,.3,1) both", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        {brand?.logoUrl && (
          <img src={brand.logoUrl} alt={brand?.name || ""} style={{ height: 72, width: "auto", maxWidth: 220, objectFit: "contain", filter: "drop-shadow(0 8px 22px rgba(0,0,0,0.22))" }} />
        )}
        {brand?.name && (
          <div style={{ marginTop: brand?.logoUrl ? 14 : 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em", color: fg, textShadow: "0 6px 22px rgba(0,0,0,0.18)" }}>{brand.name}</div>
        )}
        {brand?.slogan && <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: muted, maxWidth: 300 }}>{brand.slogan}</div>}
      </div>

      {/* sweeping progress bar */}
      <div style={{ marginTop: 28, width: 180, height: 5, borderRadius: 999, overflow: "hidden", background: dark ? "rgba(255,255,255,0.16)" : "rgba(15,23,42,0.14)" }}>
        <div style={{ height: "100%", width: 60, borderRadius: 999, background: `linear-gradient(90deg, ${primary}, ${accent})`, animation: "splash-sweep 1.15s cubic-bezier(.45,0,.55,1) infinite" }} />
      </div>
    </div>
  );
}
