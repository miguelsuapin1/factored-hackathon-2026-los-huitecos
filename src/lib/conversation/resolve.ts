// Between the dialogue rules and the reply (steps 12–13): when a dispute's details are complete, look up the
// customer's transactions and let the policy engine decide; when the customer confirms, re-read the record and decide
// again. Every review or hand-off is then written as a case and read back before the customer is told it exists
// (docs/verification.md V1–V3). Tool failures never break the turn (docs/policy.md PL-8).
import { buildCase, verifyCase } from "@/lib/cases/build";
import type { CaseStore } from "@/lib/cases/types";
import { decideOnConfirm, decideOnLookup, FRAUD_HANDOFF_SCORE, queryFor, type RuleId } from "@/lib/policy/decide";
import type { CustomerSession, TransactionLookup, TransactionMatch } from "@/lib/lookup/types";
import type { Move, TurnOutcome } from "./dialogue";
import { MAX_CHECKS, type HandoffReason, type MatchView } from "./state";

const LOOKUP_TIMEOUT_MS = 3000;

export type PolicyTrace = {
  lookup: { source: string; op: "find" | "get"; ms: number; count: number | null; error: string | null } | null;
  rule: RuleId | "DLG-clarify" | "DLG-human" | null;
  decision: string | null;
  case: { source: string; ms: number; kind: string; verified: boolean; reference: string | null; error: string | null } | null;
};

export type ResolveContext = {
  session: CustomerSession;
  lookup: TransactionLookup;
  store: CaseStore;
  language: "es" | "pt";
  promptVersions: Record<string, string>;
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

export async function resolveTurn(outcome: TurnOutcome, ctx: ResolveContext): Promise<Resolved> {
  const { lookup } = ctx;
  const s = outcome.state;
  const trace: PolicyTrace = { lookup: null, rule: null, decision: null, case: null };
  let record: TransactionMatch | null = null; // the fresh record a decision was made on
  // Checks accumulate across turns in the state (the case file needs the whole story, not just this turn).
  const turnChecks: string[] = [];
  const note = (c: string) => turnChecks.push(`turn ${s.turn}: ${c}`);
  if (["model", "clarification", "offer", "new_topic"].includes(outcome.resolvedBy) && s.workingIntent) {
    note(`topic ${s.workingIntent} (by ${outcome.resolvedBy})`);
  }
  const checks = () => [...s.checks, ...turnChecks].slice(-MAX_CHECKS);

  const handoff = (reason: HandoffReason, rule: RuleId) => {
    s.status = "handoff";
    s.pending = null;
    s.handoffReason = reason;
    trace.rule = rule;
    trace.decision = `handoff:${reason}`;
    return "handoff" as const;
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

  let move: Move = outcome.move;

  // The customer rejected or is correcting the details: the old match no longer applies.
  if (move === "ask_details" || move === "ask_correction") s.match = null;

  // The dialogue itself gave up (two unresolved clarifications): that's a hand-off too, and gets a case.
  if (move === "handoff" && s.handoffReason === "repeated_clarification") trace.rule = "DLG-clarify";
  // The customer asked for a person (H1/H2): also a hand-off with a case.
  if (move === "handoff" && s.handoffReason === "customer_asked") trace.rule = "DLG-human";

  // Details complete: find the charge before asking the customer to confirm it.
  if (move === "confirm") {
    const found = await call("find", () => lookup.findTransactions(ctx.session, queryFor(s.details)), (r) => r.length);
    if (!found.ok) {
      note("lookup failed");
      move = handoff("tool_failure", "PL-8");
    } else {
      note(`lookup (${lookup.source}): ${found.result.length} match(es)`);
      const d = decideOnLookup(found.result, s.lookupRetries);
      trace.rule = d.rule;
      trace.decision = d.kind;
      switch (d.kind) {
        case "confirm_match":
          s.match = view(d.match);
          s.checks = checks();
          return { move: "confirm", trace };
        case "no_match":
        case "ambiguous":
          if (d.handoff) {
            move = handoff(d.kind, d.rule);
            break;
          }
          s.lookupRetries += 1;
          s.match = null;
          s.pending = { kind: "details" };
          s.checks = checks();
          return { move: d.kind === "no_match" ? "no_match" : "ask_narrow", trace };
        case "explain_status":
          s.match = view(d.match);
          s.status = "closed";
          s.pending = null;
          s.checks = checks();
          return { move: "explain_status", trace };
      }
    }
  }

  // The customer said yes: decide on a fresh read of the record, not on what the state remembers.
  if (move === "confirmed") {
    note("customer confirmed the matched charge");
    if (!s.match) {
      move = handoff("record_unavailable", "PL-8");
    } else {
      const id = s.match.transactionId;
      const got = await call("get", () => lookup.getTransaction(ctx.session, id), (r) => (r ? 1 : 0));
      if (!got.ok) {
        move = handoff("tool_failure", "PL-8");
      } else {
        record = got.result;
        note(`re-read ${id}: ${record ? record.status : "not found"}`);
        const d = decideOnConfirm(record);
        if (d.kind === "handoff") {
          move = handoff(d.reason, d.rule);
        } else {
          s.status = "review";
          trace.rule = d.rule;
          trace.decision = "open_review";
          move = "open_review";
        }
      }
    }
  }

  // Step 13: a review or hand-off exists only once it's written AND read back identical (V1).
  if (move === "open_review" || (move === "handoff" && trace.rule !== null)) {
    const kind = move === "open_review" ? "review" : "handoff";
    note(`policy ${trace.rule}`);
    const input = buildCase({
      state: s, kind, rule: trace.rule ?? "unknown", reason: kind === "handoff" ? s.handoffReason : null,
      customerId: ctx.session.customerId, language: ctx.language, record, lookupSource: lookup.source,
      fraudCutoff: FRAUD_HANDOFF_SCORE, checks: checks(), promptVersions: ctx.promptVersions,
    });
    const t0 = performance.now();
    let problem: string | null = null;
    try {
      const written = await ctx.store.create(input);
      const mismatches = verifyCase(input, await ctx.store.get(written.id));
      if (mismatches.length) problem = `read-back mismatch: ${mismatches.join(", ")}`;
      else {
        s.caseRef = written.reference;
        s.caseId = written.id;
      }
      trace.case = { source: ctx.store.source, ms: Math.round(performance.now() - t0), kind, verified: !problem, reference: problem ? null : written.reference, error: problem };
    } catch (err) {
      problem = String(err);
      trace.case = { source: ctx.store.source, ms: Math.round(performance.now() - t0), kind, verified: false, reference: null, error: problem };
    }
    if (problem) {
      // V2: never claim a case that isn't verified. Keep what we know; a later "sí" retries (idempotent, V3).
      console.error(JSON.stringify({ event: "case_not_verified", kind, error: problem }));
      s.status = "open";
      s.caseRef = null;
      s.caseId = null;
      s.pending = kind === "review" && s.match ? { kind: "confirm" } : null;
      s.checks = checks();
      return { move: "record_failed", trace };
    }
  }

  s.checks = checks();
  return { move, trace };
}
