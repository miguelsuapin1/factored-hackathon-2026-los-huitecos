// GT Bank is a fictional bank for this demo. The mark is an original design: a "G" whose tail sweeps out like a
// quetzal's tail feather, with the bird's crimson breast as a dot. The colors come from the quetzal (emerald and
// blue plumage, crimson breast), deliberately unlike real banks' logos. Change BANK_NAME to rebrand.
export const BANK_NAME = "GT Bank";

export function GTBankMark({ size = 32 }: { size?: number }) {
  // Gradient ids are per size so two marks of different sizes on one page don't share defs.
  const id = `gtq-${size}`;
  return (
    <svg className="gt-mark" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`${BANK_NAME} logo`}>
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4be3b2" />
          <stop offset=".55" stopColor="#17b29a" />
          <stop offset="1" stopColor="#1287a6" />
        </linearGradient>
        <linearGradient id={`${id}-tail`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}-tile)`} />
      <path d="M27.6 13.4A9.6 9.6 0 1 0 29.4 20.6H20.4" fill="none" stroke="#f4fbf8" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29.4 20.6C30.6 26.6 33.4 31.4 38.5 35" fill="none" stroke={`url(#${id}-tail)`} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="29.3" cy="11.6" r="2.6" fill="#ff5a52" />
    </svg>
  );
}

export function GTBankWordmark() {
  return (
    <span className="wordmark">
      GT <span>Bank</span>
    </span>
  );
}

export function GTBankLogo({ subtitle }: { subtitle?: string }) {
  return (
    <div className="bank">
      <GTBankMark />
      <div>
        <div className="bank-name"><GTBankWordmark /></div>
        {subtitle && <div className="bank-sub">{subtitle}</div>}
      </div>
    </div>
  );
}
