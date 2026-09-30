// The demo clock (docs/conversation.md C4): relative dates resolve against the last day in the organizer's data.
// Pure module (no SDK imports) so the policy engine and tests can use it.
export function demoToday(): string {
  const env = typeof process !== "undefined" ? process.env.DEMO_TODAY : undefined;
  return env && /^\d{4}-\d{2}-\d{2}$/.test(env) ? env : "2026-06-17";
}

export function shiftDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** How far back a dispute can reach (C3); also the window searched when the customer doesn't remember the date. */
export const MAX_DAYS_BACK = 180;
