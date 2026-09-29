import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LATAM Bank · Dispute Assistant",
  description:
    "Bilingual (Spanish/Portuguese) transaction-dispute assistant built for the Factored AI & Data Hackathon 2026.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
