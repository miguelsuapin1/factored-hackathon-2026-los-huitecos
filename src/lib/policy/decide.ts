// Policy engine (build step 12): plain code decides what happens to a dispute once its details are known.
// Every rule has an id (PL-n) that goes into the trace; reasons and evidence are in docs/policy.md.
// No rule moves money: the most any rule does is open a review case or send the case to a person.
// Type-only imports keep this module pure (tested by policy.test.ts).
import type { Details } from "@/lib/conversation/state";
import type { LookupQuery, TransactionMatch } from "@/lib/lookup/types";
import { demoToday, MAX_DAYS_BACK, shiftDays } from "@/lib/conversation/clock";

/** PL-6: chosen by pipeline/fraud_threshold.py on 2023–2025, confirmed on held-out 2026 (reports/fraud_threshold.md). */
export const FRAUD_HANDOFF_SCORE = 30;
/** PL-1/PL-2: how many times we ask the customer to adjust the details before handing off. */
export const MAX_LOOKUP_RETRIES = 1;
/** The customer's date is approximate: search this many days either side. */
export const DATE_WINDOW_DAYS = 3;

export type RuleId = "PL-1" | "PL-2" | "PL-3" | "PL-4" | "PL-5" | "PL-6" | "PL-7" | "PL-8" | "PL-9" | "PL-10";
/** PL-10: at most this many candidates are shown for the customer to pick from. */
export const MAX_LISTED = 2;

export type LookupDecision =
  | { kind: "confirm_match"; rule: null; match: TransactionMatch }
  | { kind: "no_match"; rule: "PL-1"; handoff: boolean }
  | { kind: "ask_merchant"; rule: "PL-2"; count: number }
  | { kind: "ambiguous"; rule: "PL-2"; handoff: true; count: number }
  | { kind: "pick"; rule: "PL-10"; options: TransactionMatch[] }
  | { kind: "explain_status"; rule: "PL-3" | "PL-4" | "PL-5"; match: TransactionMatch };

export type ConfirmDecision =
  | { kind: "open_review"; rule: "PL-7" }
  | { kind: "handoff"; rule: "PL-6" | "PL-8"; reason: "high_risk" | "record_unavailable" };

/** C13: what the customer said about the date when they didn't give an exact one. */
export type WhenHint = { from: string | null; to: string | null; latest: boolean; unknown: boolean };

/** What we search for: the amount, in the window the customer's date implies (C13), plus merchant/currency if known. */
export function queryFor(details: Details, when: WhenHint = { from: null, to: null, latest: false, unknown: false }, today = demoToday()): LookupQuery {
  const window = details.date
    ? { dateFrom: shiftDays(details.date, -DATE_WINDOW_DAYS), dateTo: shiftDays(details.date, DATE_WINDOW_DAYS) }
    : when.from && when.to
      ? { dateFrom: when.from, dateTo: when.to }
      : when.latest || when.unknown || details.merchant
        ? { dateFrom: shiftDays(today, -MAX_DAYS_BACK), dateTo: today }
        : {};
  return {
    amount: details.amount ?? undefined,
    currency: details.currency,
    ...window,
    merchant: details.merchant ?? undefined,
    limit: 10, // enough to tell "2" from "more than 2"
  };
}

/** The ladder after a lookup (docs/policy.md): 0 → check once, then a person; 1 → that one; 2 → list them (PL-10);
 * 3+ → ask the merchant once, then a person (PL-2). "El más reciente" keeps only the latest. */
export function decideOnLookup(
  found: TransactionMatch[],
  ctx: { retries: number; latest?: boolean; merchantKnown?: boolean; merchantAsked?: boolean } | number,
): LookupDecision {
  const c = typeof ctx === "number" ? { retries: ctx } : ctx;
  const byDate = [...found].sort((a, b) => b.date.localeCompare(a.date));
  const matches = c.latest ? byDate.slice(0, 1) : byDate;
  if (matches.length === 0) return { kind: "no_match", rule: "PL-1", handoff: c.retries >= MAX_LOOKUP_RETRIES };
  if (matches.length > MAX_LISTED) {
    return c.merchantKnown || c.merchantAsked
      ? { kind: "ambiguous", rule: "PL-2", handoff: true, count: matches.length }
      : { kind: "ask_merchant", rule: "PL-2", count: matches.length };
  }
  if (matches.length === 2) return { kind: "pick", rule: "PL-10", options: matches };
  return single(matches[0]);
}

/** One identified charge: explain it if it can't be disputed (PL-3/4/5), otherwise it's the one to confirm. */
export function single(match: TransactionMatch): LookupDecision {
  if (match.status === "Pending") return { kind: "explain_status", rule: "PL-3", match };
  if (match.status === "Reversed") return { kind: "explain_status", rule: "PL-4", match };
  if (match.status === "Declined") return { kind: "explain_status", rule: "PL-5", match };
  return { kind: "confirm_match", rule: null, match };
}

/** After the customer confirmed the matched charge. `fresh` is the record re-read from the lookup, not the state. */
export function decideOnConfirm(fresh: TransactionMatch | null): ConfirmDecision {
  if (!fresh || fresh.status !== "Approved") return { kind: "handoff", rule: "PL-8", reason: "record_unavailable" };
  if (fresh.fraudScore !== null && fresh.fraudScore >= FRAUD_HANDOFF_SCORE) {
    return { kind: "handoff", rule: "PL-6", reason: "high_risk" };
  }
  return { kind: "open_review", rule: "PL-7" };
}
