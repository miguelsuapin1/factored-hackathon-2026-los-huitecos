import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { QuetzalBackdrop } from "@/components/QuetzalBackdrop";
import { themeInitScript } from "@/components/ThemeToggle";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "GT Bank · Dispute Desk",
  description:
    "Bilingual (Spanish/Portuguese) transaction-dispute assistant for a fictional bank, built for the Factored AI & Data Hackathon 2026.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geist.variable} ${geistMono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply a saved light/dark choice before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <QuetzalBackdrop />
        <div className="page">{children}</div>
      </body>
    </html>
  );
}
