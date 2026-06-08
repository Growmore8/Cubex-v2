import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "next-themes";
import { getBrand } from "@/lib/brand";
import UpdateWatcher from "@/components/UpdateWatcher";

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// Title / favicon / home-screen name follow the tenant's brand (set in Super Admin),
// so a broker's traders never see "Cubex" anywhere.
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const name = brand.name || "Trading Platform";
  const icon = brand.faviconUrl || brand.logoUrl || undefined;
  return {
    title: name,
    description: `${name} — trade global markets, fast and secure.`,
    icons: icon ? { icon, shortcut: icon, apple: icon } : undefined,
    manifest: "/api/manifest",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: name },
    formatDetection: { telephone: false },
  };
}

// App-like viewport: fill the screen, respect notches (safe areas), lock zoom so
// the trading UI behaves like a native app rather than a scrollable web page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#131722" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="light" storageKey="sa_theme">
          {children}
          <UpdateWatcher />
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                fontSize: "13px",
                padding: "8px 12px",
                borderRadius: "8px",
              },
              success: {
                style: {
                  background: "#f0fdf4",
                  color: "#15803d",
                  border: "1px solid #bbf7d0",
                },
                iconTheme: {
                  primary: "#15803d",
                  secondary: "#f0fdf4",
                },
                duration: 3000,
              },
              error: {
                style: {
                  background: "#fef2f2",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                },
                iconTheme: {
                  primary: "#b91c1c",
                  secondary: "#fef2f2",
                },
                duration: 3000,
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}