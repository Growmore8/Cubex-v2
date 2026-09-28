import { type NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { getBrand } from "@/lib/brand";

// Dynamic PWA icon — returns a PNG so Android Chrome accepts it as a home-screen icon.
// SVG icons are ignored by Chrome for Android; ImageResponse produces a proper raster PNG.
// If the tenant has a logo URL, it is composited into the PNG at the requested size.
// Falls back to a branded letter-initial tile when no logo is set.
export async function GET(req: NextRequest) {
  const size = Math.min(Math.max(Number(req.nextUrl.searchParams.get("size") || 192), 48), 512);
  const brand = await getBrand();
  const color = brand.primaryColor || "#2563eb";
  const initial = (brand.name || "T").charAt(0).toUpperCase();
  const r = Math.round(size * 0.18);
  const fs = Math.round(size * 0.46);

  let content;
  if (brand.logoUrl) {
    content = (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#131722",
        }}
      >
        {/* @ts-expect-error — JSX inside ImageResponse uses React 18 types */}
        <img src={brand.logoUrl} width={size} height={size} style={{ objectFit: "contain" }} />
      </div>
    );
  } else {
    content = (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: color,
          borderRadius: r,
        }}
      >
        <span style={{ color: "#ffffff", fontSize: fs, fontWeight: 700, fontFamily: "system-ui" }}>
          {initial}
        </span>
      </div>
    );
  }

  return new ImageResponse(content as any, {
    width: size,
    height: size,
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
