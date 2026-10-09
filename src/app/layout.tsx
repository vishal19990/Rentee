import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Rounded geometric face for the "Rentee" wordmark.
const outfit = Outfit({ subsets: ["latin"], weight: ["800"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Rentee", template: "%s · Rentee" },
  description: "Rental property management for landlords",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
