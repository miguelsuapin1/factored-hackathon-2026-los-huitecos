// Builds the case file (docs/contracts.md K3) and checks a written case against its read-back (step 13).
// Pure code: every line an agent reads is assembled from verified data and the customer's own grounded statements,
// never written by a model. Type-only imports keep this testable with node --test.
import type { ConversationState, HandoffReason } from "@/lib/conversation/state";
import type { TransactionMatch } from "@/lib/lookup/types";
import type { CaseInput, CaseKind, CaseRecord } from "./types";

export type CaseContext = {
  state: ConversationState;
  kind: CaseKind;
  rule: string;
  reason: HandoffReason | null;
  customerId: string;
  language: "es" | "pt";
  record: TransactionMatch | null; // the fresh record the decision was made on, if any
  lookupSource: string;
  fraudCutoff: number;
  checks: string[]; // what this conversation checked, in order
  promptVersions: Record<string, string>;
};

const OPEN_QUESTIONS: Record<HandoffReason, string> = {
  customer_asked: "The customer asked to speak with a person. Start from their summary and any details below.",
  repeated_clarification: "The request is still unclear after two clarifying questions: ask the customer what happened.",
  no_match: "No transaction matched the customer's details, after one correction. Check other accounts/cards or a different date.",
  ambiguous: "Several transactions match the customer's details; the customer couldn't tell which one.",
  high_risk: "Possible fraud: confirm the customer has the card and whether others could use it; consider blocking.",
  record_unavailable: "The matched transaction could not be re-read or changed status before the decision. Recheck it.",
  tool_failure: "Transactions could not be checked (lookup failure). Nothing was verified automatically.",
};

const money = (v: number, c: string | null) => `${v}${c ? ` ${c}` : ""}`;

export function buildCase(ctx: CaseContext): CaseInput {
  const { state: s } = ctx;
  // The fresh record the decision used or, for a hand-off that didn't re-read it (S3, H2), the matched charge we showed.
  const r: Pick<TransactionMatch, "transactionId" | "amount" | "currency" | "merchant" | "date" | "status"> & Partial<TransactionMatch> | null =
    ctx.record ?? (s.match ? { ...s.match } : null);
  const d = s.details;
  const stated: Record<string, unknown> = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null));
  if (s.summary) stated.summary = s.summary; // the customer's own words, already masked (H4)
  const what = r
    ? `${money(r.amount, r.currency)} at ${r.merchant ?? "unknown merchant"} on ${r.date.slice(0, 10)}`
    : [d.amount !== null ? money(d.amount, d.currency) : null, d.merchant ? `at ${d.merchant}` : null, d.date ? `on ${d.date}` : null]
        .filter(Boolean).join(" ") || "a charge (details not collected)";
  const expected = d.expectedAmount !== null ? ` (customer says it should be ${money(d.expectedAmount, d.currency ?? r?.currency ?? null)})` : "";
  const outcome = ctx.kind === "review" ? "sent to review" : `handed off: ${ctx.reason}`;
  const theirWords = s.summary ? ` Customer's summary: "${s.summary}".` : "";

  const verifiedFacts: CaseInput["verifiedFacts"] = [];
  if (r) {
    verifiedFacts.push({
      fact: `Transaction ${r.transactionId}: ${money(r.amount, r.currency)} at ${r.merchant ?? "unknown merchant"}, ${r.date}, status ${r.status}, channel ${r.channel ?? "unknown"}`,
      source: `lookup:${ctx.lookupSource}`,
    });
    if (r.fraudScore !== undefined && r.fraudScore !== null) {
      verifiedFacts.push({
        fact: `Fraud score ${r.fraudScore} (hand-off cutoff ${ctx.fraudCutoff}; not shown to the customer)`,
        source: `lookup:${ctx.lookupSource}`,
      });
    }
    if (ctx.record) verifiedFacts.push({ fact: "Customer confirmed this is the charge they mean", source: "conversation" });
  }

  const openQuestions: string[] = [];
  if (ctx.reason) openQuestions.push(OPEN_QUESTIONS[ctx.reason]);
  if (r?.status === "Declined") openQuestions.push("Customer wants to know why this charge was declined; our response codes can't explain it (data issue E7): check the authorization log.");
  if (d.expectedAmount !== null) openQuestions.push(`Customer says the amount should have been ${money(d.expectedAmount, d.currency ?? r?.currency ?? null)}: check the merchant's price or applicable fees.`);

  return {
    idempotencyKey: `${s.id}:${r?.transactionId ?? "none"}:${ctx.kind}`,
    kind: ctx.kind,
    rule: ctx.rule,
    reason: ctx.reason,
    conversationId: s.id,
    customerId: ctx.customerId,
    intent: s.workingIntent ?? "unknown",
    language: ctx.language,
    transactionId: r?.transactionId ?? null,
    summary: `${s.workingIntent ?? "unknown"}: ${what}${expected}. ${outcome} (${ctx.rule}).${theirWords}`,
    verifiedFacts,
    customerStatements: stated,
    checksDone: ctx.checks,
    openQuestions,
    promptVersions: ctx.promptVersions,
  };
}

/** V1: the read-back must be the case we wrote, field by field, before the customer hears it exists. */
export function verifyCase(written: CaseInput, readBack: CaseRecord | null): string[] {
  if (!readBack) return ["case not found on read-back"];
  const keys: (keyof CaseInput)[] = ["idempotencyKey", "kind", "rule", "conversationId", "customerId", "transactionId"];
  return keys.filter((k) => readBack[k] !== written[k]).map((k) => `${k} differs`);
}
