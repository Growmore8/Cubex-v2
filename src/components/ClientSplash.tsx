"use client";

// Branded loading/splash screen for the client app. Premium dark gradient
// background (brand-tinted glow) with either the tenant logo OR brand name,
// the slogan, and a sweeping progress bar. Cross-fades out (`hiding`) once the
// app's first data is ready.
export default function ClientSplash({
  brand, hiding,
}: {
  brand: { name?: string; logoUrl?: string | null; slogan?: string | null; primaryColor?: string | null; accentColor?: string | null };
  theme?: "dark" | "light";
  hiding: boolean;
}) {
  const primary = brand?.primaryColor || "#7c3aed";
  const accent = brand?.accentColor || "#2563eb";
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "0 32px",
        opacity: hiding ? 0 : 1,
        transition: "opacity .45s ease",
        pointerEvents: hiding ? "none" : "auto",
        // Dark, brand-tinted gradient so logo, name and slogan are always crisp.
        background: `radial-gradient(720px 480px at 50% 28%, color-mix(in srgb, ${primary} 40%, transparent), transparent 60%), radial-gradient(640px 480px at 50% 110%, color-mix(in srgb, ${accent} 32%, transparent), transparent 58%), linear-gradient(160deg, #0c1222, #070a12)`,
      }}
    >
      <div style={{ animation: "splash-in .55s cubic-bezier(.16,1,.3,1) both", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {brand?.logoUrl ? (
          <img src={brand.logoUrl} alt={brand?.name || ""} style={{ height: 84, width: "auto", maxWidth: 240, objectFit: "contain", filter: "drop-shadow(0 10px 30px rgba(0,0,0,0.45))" }} />
        ) : (
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.01em", color: "#fff", textShadow: "0 8px 28px rgba(0,0,0,0.5)" }}>{brand?.name || ""}</div>
        )}
        {brand?.slogan && (
          <div style={{ marginTop: 14, fontSize: 13.5, fontWeight: 500, color: "rgba(255,255,255,0.72)", maxWidth: 320, lineHeight: 1.5 }}>{brand.slogan}</div>
        )}
      </div>

      {/* sweeping progress bar */}
      <div style={{ marginTop: 34, width: 180, height: 5, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.14)" }}>
        <div style={{ height: "100%", width: 60, borderRadius: 999, background: `linear-gradient(90deg, ${primary}, ${accent})`, boxShadow: `0 0 14px ${primary}aa`, animation: "splash-sweep 1.15s cubic-bezier(.45,0,.55,1) infinite" }} />
      </div>
    </div>
  );
}
