// Policy engine (build step 12): plain code decides what happens to a dispute once its details are known.
// Every rule has an id (PL-n) that goes into the trace; reasons and evidence are in docs/policy.md.
// No rule moves money: the most any rule does is open a review case or send the case to a person.
// Type-only imports keep this module pure (tested by policy.test.ts).
import type { Details } from "@/lib/conversation/state";
import type { LookupQuery, TransactionMatch } from "@/lib/lookup/types";

/** PL-6: chosen by pipeline/fraud_threshold.py on 2023–2025, confirmed on held-out 2026 (reports/fraud_threshold.md). */
export const FRAUD_HANDOFF_SCORE = 30;
/** PL-1/PL-2: how many times we ask the customer to adjust the details before handing off. */
export const MAX_LOOKUP_RETRIES = 1;
/** The customer's date is approximate: search this many days either side. */
export const DATE_WINDOW_DAYS = 3;

export type RuleId = "PL-1" | "PL-2" | "PL-3" | "PL-4" | "PL-5" | "PL-6" | "PL-7" | "PL-8" | "PL-9";

export type LookupDecision =
  | { kind: "confirm_match"; rule: null; match: TransactionMatch }
  | { kind: "no_match"; rule: "PL-1"; handoff: boolean }
  | { kind: "ambiguous"; rule: "PL-2"; handoff: boolean; count: number }
  | { kind: "explain_status"; rule: "PL-3" | "PL-4" | "PL-5"; match: TransactionMatch };

export type ConfirmDecision =
  | { kind: "open_review"; rule: "PL-7" }
  | { kind: "handoff"; rule: "PL-6" | "PL-8"; reason: "high_risk" | "record_unavailable" };

function shiftDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** What we search for: the amount charged, around the date the customer gave, plus merchant/currency if known. */
export function queryFor(details: Details): LookupQuery {
  return {
    amount: details.amount ?? undefined,
    currency: details.currency,
    dateFrom: details.date ? shiftDays(details.date, -DATE_WINDOW_DAYS) : undefined,
    dateTo: details.date ? shiftDays(details.date, DATE_WINDOW_DAYS) : undefined,
    merchant: details.merchant ?? undefined,
  };
}

/** After the lookup, before asking the customer to confirm. `retries` = earlier no-match/ambiguous turns. */
export function decideOnLookup(matches: TransactionMatch[], retries: number): LookupDecision {
  const giveUp = retries >= MAX_LOOKUP_RETRIES;
  if (matches.length === 0) return { kind: "no_match", rule: "PL-1", handoff: giveUp };
  if (matches.length > 1) return { kind: "ambiguous", rule: "PL-2", handoff: giveUp, count: matches.length };
  const [match] = matches;
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
