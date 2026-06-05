import { NextResponse } from "next/server";
import { getBrand } from "@/lib/brand";

// Per-tenant PWA manifest — "Add to Home Screen" uses the broker's brand name + logo,
// resolved from the request host. Traders never see "Cubex".
export async function GET() {
  const brand = await getBrand();
  const name = brand.name || "Trading Platform";
  const icon = brand.logoUrl || undefined;
  const type = icon?.endsWith(".svg")
    ? "image/svg+xml"
    : /\.jpe?g$/i.test(icon || "")
    ? "image/jpeg"
    : "image/png";

  return NextResponse.json(
    {
      name,
      short_name: name.length > 12 ? name.slice(0, 12) : name,
      description: `${name} trading platform`,
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: brand.primaryColor || "#131722",
      theme_color: brand.primaryColor || "#131722",
      icons: icon
        ? [
            { src: icon, sizes: "192x192", type, purpose: "any" },
            { src: icon, sizes: "512x512", type, purpose: "any maskable" },
          ]
        : [],
    },
    { headers: { "Content-Type": "application/manifest+json" } }
  );
}
