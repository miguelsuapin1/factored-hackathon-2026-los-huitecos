// Between the dialogue rules and the reply (steps 12–13): when a dispute's details are complete, look up the
// customer's transactions and let the policy engine decide; when the customer confirms, re-read the record and decide
// again. Every review or hand-off is then written as a case and read back before the customer is told it exists
// (docs/verification.md V1–V3). Tool failures never break the turn (docs/policy.md PL-8).
import { buildCase, verifyCase } from "@/lib/cases/build";
import type { CaseStore } from "@/lib/cases/types";
import { decideOnConfirm, decideOnLookup, FRAUD_HANDOFF_SCORE, queryFor, single, type LookupDecision, type RuleId } from "@/lib/policy/decide";
import type { CustomerSession, TransactionLookup, TransactionMatch } from "@/lib/lookup/types";
import { dateGiven, type Move, type TurnOutcome } from "./dialogue";
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
  if (["model", "clarification", "offer", "new_topic", "words"].includes(outcome.resolvedBy) && s.workingIntent) {
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
  // C17: the customer's date is older than the window we can search: a person can look further back (PL-11).
  if (move === "handoff" && s.handoffReason === "too_old") trace.rule = "PL-11";
  if (outcome.dateIssue) note(`customer gave a date that can't be searched (${outcome.dateIssue.kind}): ${outcome.dateIssue.date}`);
  // The merchant step or the pick ended unresolved (C13, C14): PL-2's hand-off.
  if (move === "handoff" && s.handoffReason === "ambiguous" && trace.rule === null) trace.rule = "PL-2";

  // Details complete (a dispute to confirm, or a status question, S1), or the customer picked one of two listed
  // charges (C14): find the charge and walk the ladder (docs/policy.md PL-1, PL-2, PL-10).
  if (move === "confirm" || move === "lookup_status" || move === "picked") {
    const status = s.workingIntent === "transaction_status";
    let decision: LookupDecision | null = null;
    if (move === "picked" && s.match) {
      const id = s.match.transactionId;
      const got = await call("get", () => lookup.getTransaction(ctx.session, id), (r) => (r ? 1 : 0));
      if (got.ok && got.result) {
        note(`customer picked ${id}`);
        decision = single(got.result);
      } else {
        note("lookup failed");
        move = handoff(got.ok ? "record_unavailable" : "tool_failure", "PL-8");
      }
    } else {
      const found = await call("find", () => lookup.findTransactions(ctx.session, queryFor(s.details, s.when)), (r) => r.length);
      if (!found.ok) {
        note("lookup failed");
        move = handoff("tool_failure", "PL-8");
      } else {
        const where = s.details.date ? "around the date" : s.when.from ? "in the period described" : s.when.latest ? "most recent" : s.when.unknown ? "last 180 days" : "";
        note(`lookup (${lookup.source}, ${where}${s.details.merchant ? ", with merchant" : ""}): ${found.result.length} match(es)`);
        decision = decideOnLookup(found.result, {
          retries: s.lookupRetries, latest: s.when.latest, merchantKnown: s.details.merchant !== null, merchantAsked: s.merchantAsked,
          dateKnown: dateGiven(s), dateAsked: s.dateAsked,
        });
      }
    }
    if (decision) {
      trace.rule = decision.rule;
      trace.decision = decision.kind;
      const done = (m: Move): Resolved => {
        s.checks = checks();
        return { move: m, trace };
      };
      switch (decision.kind) {
        case "no_match":
          if (decision.handoff) {
            move = handoff("no_match", "PL-1");
            break;
          }
          s.lookupRetries += 1;
          s.match = null;
          s.pending = { kind: "details" };
          return done("no_match");
        case "ask_date":
          // EF-1: the merchant couldn't separate the charges; the date will (merchant → date → a person).
          s.dateAsked = true;
          s.match = null;
          s.pending = { kind: "details" };
          return done("ask_details");
        case "ask_merchant":
          s.merchantAsked = true;
          s.match = null;
          s.pending = { kind: "merchant" };
          return done("ask_narrow");
        case "ambiguous":
          move = handoff("ambiguous", "PL-2");
          break;
        case "pick":
          s.match = null;
          s.pending = { kind: "pick", options: decision.options.map(view), attempts: 0 };
          return done("pick");
        case "explain_status":
        case "confirm_match":
          s.match = view(decision.match);
          if (status) {
            // S1: explain; PL-9 (approved) offers a review (S2), PL-5 (declined) offers a person (S3).
            s.status = "closed";
            trace.rule = decision.kind === "confirm_match" ? "PL-9" : decision.rule;
            trace.decision = "status_answer";
            s.pending = decision.kind === "confirm_match" ? { kind: "offer_dispute" } : decision.rule === "PL-5" ? { kind: "offer_agent" } : null;
            return done("status_answer");
          }
          if (decision.kind === "explain_status") {
            s.status = "closed";
            s.pending = null;
            return done("explain_status");
          }
          s.status = "open";
          s.pending = { kind: "confirm" };
          return done("confirm");
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
