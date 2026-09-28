import { NextResponse } from "next/server";
import { getBrand } from "@/lib/brand";

// Per-tenant PWA manifest — "Add to Home Screen" uses the broker's brand name + logo.
// Icons are served as PNG via /api/icon (Android Chrome rejects SVG for home-screen icons).
// A version hash derived from the logo URL is embedded in the icon query so that when
// the admin changes the logo, Chrome sees a new URL and re-fetches the icon.
export async function GET() {
  const brand = await getBrand();
  const name = brand.name || "Trading Platform";
  const logo = brand.logoUrl || null;
  const color = brand.primaryColor || "#2563eb";

  // Version hash: last 8 chars of base64-encoded logo URL (or "0" for no logo).
  // Changing the logo changes the hash → Chrome treats icons as new → re-fetches them.
  const v = logo ? Buffer.from(logo).toString("base64url").slice(-8) : "0";

  const icons = [
    { src: `/api/icon?size=192&v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `/api/icon?size=512&v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];

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
    {
      headers: {
        "Content-Type": "application/manifest+json",
        // Short cache so logo changes propagate within an hour
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
