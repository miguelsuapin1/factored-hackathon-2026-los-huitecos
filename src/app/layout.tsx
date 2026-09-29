import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { themeInitScript } from "@/components/ThemeToggle";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GT Bank · Dispute Assistant",
  description:
    "Bilingual (Spanish/Portuguese) transaction-dispute assistant for a fictional bank, built for the Factored AI & Data Hackathon 2026.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Apply a saved light/dark choice before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
