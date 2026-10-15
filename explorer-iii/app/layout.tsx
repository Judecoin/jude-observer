import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Judecoin Blockchain Explorer",
  description: "Explore live Judecoin blocks, transactions, Service Nodes, staking, and quorum activity.",
  icons: {
    icon: [
      { url: "/favicon.ico?v=37", sizes: "any" },
      { url: "/judecoin-logo-minimal-ring-transparent.png?v=37", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/favicon.ico?v=37",
    apple: "/apple-touch-icon.png?v=37",
  },
  openGraph: {
    title: "Judecoin Blockchain Explorer",
    description: "Explore Judecoin blocks, transactions, Service Nodes, and network statistics.",
    images: [{ url: "/judecoin-logo-official.png", width: 512, height: 512, alt: "Judecoin" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Judecoin Blockchain Explorer",
    description: "Explore Judecoin blocks, transactions, Service Nodes, and network statistics.",
    images: ["/judecoin-logo-official.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head><link rel="preload" href="/fonts/InterVariable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /></head>
      <body>{children}</body>
    </html>
  );
}
