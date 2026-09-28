import { type NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { getBrand } from "@/lib/brand";

export async function GET(req: NextRequest) {
  const size = Math.min(Math.max(Number(req.nextUrl.searchParams.get("size") || 192), 48), 512);
  const brand = await getBrand();

  // If the tenant has a logo, proxy it directly.
  // ImageResponse (Satori) cannot resolve relative URLs like /uploads/logo.png,
  // which is why Android Chrome was getting the fallback letter tile instead of the logo.
  // iPhone works because it reads apple-touch-icon from <head> directly in the browser.
  if (brand.logoUrl) {
    const abs = brand.logoUrl.startsWith("http")
      ? brand.logoUrl
      : `${req.nextUrl.origin}${brand.logoUrl}`;
    try {
      const res = await fetch(abs, { cache: "no-store" });
      if (res.ok) {
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("svg")) {
          const body = await res.arrayBuffer();
          return new Response(body, {
            headers: {
              "Content-Type": ct || "image/png",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      }
    } catch { /* fall through to letter tile */ }
  }

  // Fallback: branded letter-tile PNG via ImageResponse
  const color = brand.primaryColor || "#2563eb";
  const initial = (brand.name || "T").charAt(0).toUpperCase();
  const r = Math.round(size * 0.18);
  const fs = Math.round(size * 0.46);

  const content = (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: color, borderRadius: r }}>
      <span style={{ color: "#ffffff", fontSize: fs, fontWeight: 700, fontFamily: "system-ui" }}>{initial}</span>
    </div>
  );

  return new ImageResponse(content as any, {
    width: size,
    height: size,
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
  });
}
