// GT Bank is a fictional bank for this demo. The mark is an original design (a "G" whose crossbar forms a
// "T"), deliberately unlike real banks' logos. Change BANK_NAME to rebrand.
export const BANK_NAME = "GT Bank";

export function GTBankMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={`${BANK_NAME} logo`}>
      <rect width="32" height="32" rx="9" fill="var(--blue)" />
      {/* G: an open ring */}
      <path d="M22.6 11.2A8.4 8.4 0 1 0 24.4 17" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      {/* T: the G's crossbar with a stem */}
      <path d="M15.2 17H24.4" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M19.8 17V22.6" fill="none" stroke="var(--amber)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function GTBankLogo({ subtitle }: { subtitle?: string }) {
  return (
    <div className="bank">
      <GTBankMark />
      <div>
        <div className="bank-name">{BANK_NAME}</div>
        {subtitle && <div className="bank-sub">{subtitle}</div>}
      </div>
    </div>
  );
}
