"use client";

import { useRouter } from "next/navigation";
import { GTBankLogo } from "@/components/brand";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AgentHeader() {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/agent/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/agent/login");
  }
  return (
    <header className="topbar">
      <div className="topbar-row">
        <GTBankLogo subtitle="Agent console · hand-offs from the assistant" />
        <div className="topbar-actions">
          <ThemeToggle onDark />
          <button type="button" className="icon-btn on-dark text" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
