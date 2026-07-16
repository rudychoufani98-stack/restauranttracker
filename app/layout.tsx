import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Self-hosted by next/font — no external CDN, so the CSP stays locked down.
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Restaurant Intelligence",
  description: "Plateforme de coûts et marges pour restaurateurs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={hanken.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
