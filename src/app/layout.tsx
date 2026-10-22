import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { AppHeader } from "@/components/app/app-header";
import { AppProvider } from "@/components/app/app-provider";

export const metadata: Metadata = {
  title: {
    default: "WayShare — share the ride you're already taking",
    template: "%s · WayShare",
  },
  description:
    "Peer-to-peer carpooling: drivers offer empty seats on routes they already drive, choose how far they'll detour for a pickup, and passengers book and pay per seat.",
  applicationName: "WayShare",
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink">
        <AppProvider>
          <AppHeader />
          <main className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-20 sm:px-6 sm:pt-8 lg:px-8">{children}</main>
        </AppProvider>
      </body>
    </html>
  );
}
