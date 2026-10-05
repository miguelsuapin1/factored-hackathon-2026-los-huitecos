// Test-conversation format for the evaluation harness. A case is a scripted conversation plus what
// the system must do on each turn, graded on the machine-readable fields of POST /api/chat (docs/contracts.md K1),
// never on the reply wording. Types come from the app itself, so a case can't expect a value the code can't produce.
import type { IntentLabel } from "@/lib/intent/model";
import type { Move, ResolvedBy } from "@/lib/conversation/dialogue";
import type { PolicyTrace } from "@/lib/conversation/resolve";
import type { Details, HandoffReason, Pending, Status } from "@/lib/conversation/state";
import type { MaskKind } from "@/lib/privacy/mask";

/** resolve.ts always rewrites these, so they never reach a response and no case may expect them. */
type InternalMove = "confirmed" | "lookup_status" | "picked";
export type ObservableMove = Exclude<Move, InternalMove>;
export type Rule = NonNullable<PolicyTrace["rule"]>;
export type PendingKind = NonNullable<Pending>["kind"];

/** Only the fields a turn lists are graded. A move may allow alternatives, but keep it to one where the docs say one. */
export type TurnExpect = {
  move?: ObservableMove | readonly ObservableMove[];
  rule?: Rule | null;
  status?: Status;
  workingIntent?: IntentLabel;
  resolvedBy?: ResolvedBy;
  handoffReason?: HandoffReason | null;
  pending?: PendingKind | null;
  details?: Partial<Details>; // only the listed keys are compared
  match?: string | null; // transactionId of the charge the customer is asked about
  case?: { kind: "review" | "handoff"; verified: boolean } | null;
  masked?: readonly MaskKind[]; // kinds that must have been masked in this message (H4)
  replyExcludes?: readonly string[]; // safety strings the reply must not contain (an injected number, "fraude")
};

export type Turn = { say: string; expect?: TurnExpect };

/** Where the expectations come from, so a failure can be triaged: a code-reading expectation may itself be wrong. */
export type Basis = "unit-test" | "doc" | "code-reading";

/** Outcome classes from docs/contracts.md K1, plus the two it leaves out: "informed" (an answer to a non-dispute
 * question, or a polite close) and "failed" (V2: the case couldn't be written and verified). */
export type Outcome = "resolved" | "asked" | "refused" | "handed_off" | "informed" | "failed";

/** What a persona answers with, chosen by what the assistant just asked (evals/grade.ts nextSlot). */
export type Slot = "details" | "merchant" | "confirm" | "clarify" | "offer";

/** A responsive customer: an opening message plus one reply per kind of question. The path isn't scripted, so it
 * is graded on where the conversation ends (outcome, rule, charge, case) and on the safety checks, not per turn. */
export type PersonaCase = {
  id: string;
  title: string;
  login: string; // a K5 login (docs/contracts.md)
  lang: "es" | "pt" | "en";
  source: string;
  basis: Basis;
  rules: readonly string[];
  persona: string;
  opening: string;
  replies: Partial<Record<Slot, string>>; // no reply for what was asked: the customer stops there
  outcome: Outcome;
  final: { rule?: Rule | null; match?: string | null; case?: { kind: "review" | "handoff"; verified: boolean } | null };
  secrets?: readonly string[];
  edits?: string; // what was changed from the source text, and why
  note?: string;
};

/** The failure classes the brief requires an evaluation to cover (docs/challenge.md "What gets assessed" 5), plus
 * privacy (H4 masking). Break-it cases carry one. */
export type AttackClass =
  | "prompt_injection" | "unauthorized_access" | "expired_session" | "bad_data" | "tool_failure" | "multilingual" | "privacy";

export type Case = {
  id: string;
  title: string;
  login: string; // a K5 login (docs/contracts.md)
  lang: "es" | "pt" | "en";
  source: string; // label provenance: who wrote the messages and how (data/phrases/LABELING_GUIDE.md)
  basis: Basis;
  rules: readonly string[]; // what the case exercises (docs/policy.md, conversation.md, handoff.md, verification.md)
  outcome: Outcome | readonly Outcome[]; // expected outcome of the whole conversation (several: any is safe)
  secrets?: readonly string[]; // must never come back, in the reply or in the state token
  forbiddenMatches?: readonly string[]; // other customers' charges: matching one is a leak (unauthorized access)
  attack?: AttackClass;
  knownGap?: string; // a documented limit this case probes: a failure confirms it rather than finding something new
  forceFallback?: boolean; // run on the fallback intent model (D16), as if Bedrock were down
  note?: string;
  turns: readonly Turn[];
};
