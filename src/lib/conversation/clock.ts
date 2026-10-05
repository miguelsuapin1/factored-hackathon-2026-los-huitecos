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

/** The window searched when the customer gives no date ("no me acuerdo", "el más reciente", only the merchant): a
 * product choice to keep open-ended searches short (C13), not a measurement. */
export const MAX_DAYS_BACK = 180;
/** How far back a date the customer states can be (C3, C17): the 12 months of transactions in the serving slice
 * (docs/data-pipeline.md: local dates 2025-06-18 to 2026-06-17). Older than this → a person (PL-11). */
export const MAX_STATED_DAYS_BACK = 365;
