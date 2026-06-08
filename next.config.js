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
};
module.exports = nextConfig;