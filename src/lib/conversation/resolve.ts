// Between the dialogue rules and the reply (build step 12): when a dispute's details are complete, look up the
// customer's transactions and let the policy engine decide; when the customer confirms, re-read the record and decide
// again. Tool failures never break the turn: a person takes over (docs/policy.md PL-8).
import { decideOnConfirm, decideOnLookup, queryFor, type RuleId } from "@/lib/policy/decide";
import type { CustomerSession, TransactionLookup, TransactionMatch } from "@/lib/lookup/types";
import type { Move, TurnOutcome } from "./dialogue";
import type { HandoffReason, MatchView } from "./state";

const LOOKUP_TIMEOUT_MS = 3000;

export type PolicyTrace = {
  lookup: { source: string; op: "find" | "get"; ms: number; count: number | null; error: string | null } | null;
  rule: RuleId | null;
  decision: string | null;
};

export type Resolved = { move: Move; trace: PolicyTrace };

const view = (m: TransactionMatch): MatchView => ({
  transactionId: m.transactionId, date: m.date.slice(0, 10), amount: m.amount, currency: m.currency,
  merchant: m.merchant, status: m.status,
});

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("lookup timed out")), LOOKUP_TIMEOUT_MS)),
  ]);
}

export async function resolveTurn(outcome: TurnOutcome, session: CustomerSession, lookup: TransactionLookup): Promise<Resolved> {
  const s = outcome.state;
  const trace: PolicyTrace = { lookup: null, rule: null, decision: null };
  const handoff = (reason: HandoffReason, rule: RuleId): Resolved => {
    s.status = "handoff";
    s.pending = null;
    s.handoffReason = reason;
    trace.rule = rule;
    trace.decision = `handoff:${reason}`;
    return { move: "handoff", trace };
  };
  const call = async <T>(op: "find" | "get", fn: () => Promise<T>, count: (r: T) => number) => {
    const t0 = performance.now();
    try {
      const result = await withTimeout(fn());
      trace.lookup = { source: lookup.source, op, ms: Math.round(performance.now() - t0), count: count(result), error: null };
      return { ok: true as const, result };
    } catch (err) {
      trace.lookup = { source: lookup.source, op, ms: Math.round(performance.now() - t0), count: null, error: String(err) };
      console.error(JSON.stringify({ event: "lookup_failed", op, error: String(err) }));
      return { ok: false as const };
    }
  };

  // The customer rejected or is correcting the details: the old match no longer applies.
  if (outcome.move === "ask_details" || outcome.move === "ask_correction") s.match = null;

  // Details complete: find the charge before asking the customer to confirm it.
  if (outcome.move === "confirm") {
    const found = await call("find", () => lookup.findTransactions(session, queryFor(s.details)), (r) => r.length);
    if (!found.ok) return handoff("tool_failure", "PL-8");
    const d = decideOnLookup(found.result, s.lookupRetries);
    trace.rule = d.rule;
    trace.decision = d.kind;
    switch (d.kind) {
      case "confirm_match":
        s.match = view(d.match);
        return { move: "confirm", trace };
      case "no_match":
      case "ambiguous":
        if (d.handoff) return handoff(d.kind, d.rule);
        s.lookupRetries += 1;
        s.match = null;
        s.pending = { kind: "details" };
        return { move: d.kind === "no_match" ? "no_match" : "ask_narrow", trace };
      case "explain_status":
        s.match = view(d.match);
        s.status = "closed";
        s.pending = null;
        return { move: "explain_status", trace };
    }
  }

  // The customer said yes: decide on a fresh read of the record, not on what the state remembers.
  if (outcome.move === "confirmed") {
    if (!s.match) return handoff("record_unavailable", "PL-8");
    const id = s.match.transactionId;
    const got = await call("get", () => lookup.getTransaction(session, id), (r) => (r ? 1 : 0));
    if (!got.ok) return handoff("tool_failure", "PL-8");
    const d = decideOnConfirm(got.result);
    if (d.kind === "handoff") return handoff(d.reason, d.rule);
    s.status = "review";
    trace.rule = d.rule;
    trace.decision = "open_review";
    return { move: "open_review", trace };
  }

  return { move: outcome.move, trace };
}
