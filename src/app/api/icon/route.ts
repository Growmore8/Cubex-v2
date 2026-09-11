import { type NextRequest, NextResponse } from "next/server";
import { getBrand } from "@/lib/brand";

// Dynamic PWA icon — returns an SVG with the tenant's primary color and brand initial.
// Used as fallback when the tenant has no logoUrl set.
export async function GET(req: NextRequest) {
  const size = Math.min(Math.max(Number(req.nextUrl.searchParams.get("size") || 192), 48), 512);
  const brand = await getBrand();
  const color = brand.primaryColor || "#2563eb";
  const initial = (brand.name || "T").charAt(0).toUpperCase();
  const r = Math.round(size * 0.18);
  const fs = Math.round(size * 0.46);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${color}"/>
  <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="white"
    font-size="${fs}" font-weight="700" font-family="system-ui,-apple-system,sans-serif">${initial}</text>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
