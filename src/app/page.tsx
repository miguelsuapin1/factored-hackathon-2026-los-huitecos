import { ChatDemo } from "@/components/ChatDemo";
import { FactoredLogo } from "@/components/FactoredLogo";

export default function Home() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-row">
          <div className="bank">
            <span className="bank-mark" aria-hidden="true">LB</span>
            <div>
              <div className="bank-name">LATAM Bank</div>
              <div className="bank-sub">Dispute assistant · fictional bank, synthetic data</div>
            </div>
          </div>
          <div className="credit">
            <a href="https://www.factored.ai" target="_blank" rel="noreferrer">
              <span>Built for the AI &amp; Data Hackathon 2026 by</span>
              <FactoredLogo height={18} />
            </a>
          </div>
        </div>
      </header>
      <ChatDemo />
    </>
  );
}
