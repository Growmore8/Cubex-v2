import { type NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { getBrand } from "@/lib/brand";

// Resolve the public origin of this request, respecting reverse-proxy headers.
// req.nextUrl.origin can be wrong behind nginx because the container sees http://
// while the public URL is https://. x-forwarded-proto + host gives the real origin.
function publicOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const size = Math.min(Math.max(Number(req.nextUrl.searchParams.get("size") || 192), 48), 512);
  const brand = await getBrand();

  // If the tenant has a raster logo, proxy it directly as the icon.
  //
  // Why not use ImageResponse(<img src={logoUrl}>) like before?
  // Satori (which powers ImageResponse) cannot resolve relative paths like
  // /uploads/logo.png — it needs an absolute URL to fetch images. The result
  // was a silent fallback to the letter tile on every tenant that stores logos
  // as relative upload paths. iPhone worked because it reads apple-touch-icon
  // from <head> in the browser (no Satori involved).
  //
  // The fix: fetch the image server-side using the public absolute URL, then
  // stream the raw bytes back. Chrome on Android gets the real logo PNG/JPG.
  // SVGs are skipped because Android Chrome ignores SVG manifest icons.
  if (brand.logoUrl) {
    const abs = brand.logoUrl.startsWith("http")
      ? brand.logoUrl
      : `${publicOrigin(req)}${brand.logoUrl}`;
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

  // Fallback: generate a branded letter-tile PNG via ImageResponse.
  // Used when there is no logo, the logo is SVG, or the logo fetch failed.
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
