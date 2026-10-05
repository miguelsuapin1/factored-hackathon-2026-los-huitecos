"use client";

import { useRouter } from "next/navigation";
import { GTBankLogo } from "@/components/brand";
import { FactoredLogo } from "@/components/FactoredLogo";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppHeader() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
  }

  return (
    <header className="topbar">
      <div className="topbar-row">
        <GTBankLogo subtitle="Dispute Desk · fictional bank, synthetic data" />
        <div className="topbar-actions">
          <a className="credit" href="https://www.factored.ai" target="_blank" rel="noreferrer">
            <span>Built for the AI &amp; Data Hackathon 2026 by</span>
            <FactoredLogo height={18} />
          </a>
          <ThemeToggle onDark />
          <button type="button" className="icon-btn on-dark text" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
