import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const instrumentSans = Instrument_Sans({
  variable: "--font-primary",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vectra – Intent-Based Group Treasury",
  description: "Programmable USDC settlement infrastructure for group obligations on Arc. Create settlement intents, authorize with EIP-712, and execute on-chain.",
  keywords: ["DeFi", "USDC", "Arc", "Treasury", "Settlement", "Web3", "Group Finance", "EIP-712"],
  authors: [{ name: "Vectra" }],
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#114C5A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${instrumentSans.variable} ${instrumentSerif.variable} ${plusJakarta.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
