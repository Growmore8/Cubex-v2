import { NextResponse } from "next/server";
import { getBrand } from "@/lib/brand";

// Per-tenant PWA manifest — "Add to Home Screen" uses the broker's brand name + logo,
// resolved from the request host. Traders never see "Cubex".
export async function GET() {
  const brand = await getBrand();
  const name = brand.name || "Trading Platform";
  const logo = brand.logoUrl || null;
  const color = brand.primaryColor || "#2563eb";

  // Always include generated SVG fallback icons so the browser install prompt
  // never gets blocked by a missing icon (required by Chrome/Safari).
  const icons: { src: string; sizes: string; type: string; purpose: string }[] = [];
  if (logo) {
    const type = logo.endsWith(".svg") ? "image/svg+xml" : /\.jpe?g$/i.test(logo) ? "image/jpeg" : "image/png";
    icons.push({ src: logo, sizes: "any", type, purpose: "any" });
  }
  icons.push(
    { src: "/api/icon?size=192", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
    { src: "/api/icon?size=512", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
  );

  return NextResponse.json(
    {
      name,
      short_name: name.length > 12 ? name.slice(0, 12) : name,
      description: `${name} — trade global markets`,
      start_url: "/client",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#131722",
      theme_color: color,
      icons,
      categories: ["finance"],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } }
  );
}
