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
  | { kind: "details" }
  | { kind: "confirm" }
  | null;

export type ConversationState = {
  v: 1;
  id: string;
  user: string; // the signed-in user the token belongs to
  exp: number; // unix seconds; the session's expiry
  turn: number;
  lang: Lang | null;
  workingIntent: IntentLabel | null;
  details: Details;
  pending: Pending;
  status: "open" | "confirmed" | "handoff";
  customerTexts: string[]; // the last MAX_TEXTS customer messages (for the reply number check, C9)
};

export const MAX_TEXTS = 6;

export const EMPTY_DETAILS: Details = { amount: null, expectedAmount: null, currency: null, date: null, merchant: null };

export function newState(id: string, user: string, exp: number): ConversationState {
  return {
    v: 1, id, user, exp, turn: 0, lang: null, workingIntent: null,
    details: { ...EMPTY_DETAILS }, pending: null, status: "open", customerTexts: [],
  };
}
