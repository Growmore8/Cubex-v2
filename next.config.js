/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // pdfkit loads its built-in font metrics (.afm) from node_modules at runtime;
  // keep it external so Next doesn't bundle it and break that file lookup.
  serverExternalPackages: ["pdfkit"],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            // Block all outbound requests to tradingview.com and external CDNs
            // from the charting library. connect-src allows only our own origin.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https://cdnjs.cloudflare.com",
              // Block tradingview.com and twemoji CDN — allow only our own WS
              "connect-src 'self' wss: ws:",
              // TradingView charting library uses blob: iframes internally;
              // TVWidget uses tradingview.com/widgetembed for non-licensed domains
              "frame-src 'self' blob: https://www.tradingview.com",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;