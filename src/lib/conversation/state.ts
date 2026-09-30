// Conversation state (docs/conversation.md C2): what the assistant remembers between turns. It travels to the client
// as a signed token and comes back with the next message; a tampered, foreign or expired token starts a new one.
// Type-only imports keep this module loadable by node --test.
import type { IntentLabel } from "@/lib/intent/model";

export type Lang = "es" | "pt";

/** What the customer told us about the disputed charge. Every value passed the grounding checks in extract.ts. */
export type Details = {
  amount: number | null; // the amount that was charged (identifies the transaction)
  expectedAmount: number | null; // what the customer says it should have been (wrong-amount disputes)
  currency: string | null; // only if the customer named it (never assumed, data issue A5)
  date: string | null; // YYYY-MM-DD, resolved against the demo clock
  merchant: string | null;
};

export type Pending =
  | { kind: "clarify"; options: [IntentLabel, IntentLabel]; attempts: number }
  | { kind: "offer_review"; dispute: IntentLabel } // after refusing to move money we offered a review or an agent
  | { kind: "details" }
  | { kind: "confirm" }
  | null;

/** The matched transaction as the customer may see it. No fraud score: the state is readable by the client. */
export type MatchView = {
  transactionId: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  merchant: string | null;
  status: "Approved" | "Declined" | "Pending" | "Reversed";
};

export type Status = "open" | "confirmed" | "review" | "handoff" | "closed";
/** Statuses where the current dispute is finished: a new dispute starts a new case. */
export const FINISHED: Status[] = ["confirmed", "review", "handoff", "closed"];

export type HandoffReason = "repeated_clarification" | "no_match" | "ambiguous" | "high_risk" | "record_unavailable" | "tool_failure";

export type ConversationState = {
  v: 2; // bumped when the shape changes: older tokens restart the conversation
  id: string;
  user: string; // the signed-in user the token belongs to
  exp: number; // unix seconds; the session's expiry
  turn: number;
  lang: Lang | null;
  workingIntent: IntentLabel | null;
  details: Details;
  pending: Pending;
  status: Status;
  match: MatchView | null; // the transaction the customer is being asked to confirm (step 12)
  lookupRetries: number; // no-match / ambiguous turns so far (PL-1, PL-2)
  handoffReason: HandoffReason | null;
  customerTexts: string[]; // the last MAX_TEXTS customer messages (for the reply number check, C9)
};

export const MAX_TEXTS = 6;

export const EMPTY_DETAILS: Details = { amount: null, expectedAmount: null, currency: null, date: null, merchant: null };

export function newState(id: string, user: string, exp: number): ConversationState {
  return {
    v: 2, id, user, exp, turn: 0, lang: null, workingIntent: null,
    details: { ...EMPTY_DETAILS }, pending: null, status: "open", customerTexts: [],
    match: null, lookupRetries: 0, handoffReason: null,
  };
}
