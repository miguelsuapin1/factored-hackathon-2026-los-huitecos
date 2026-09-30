// End-to-end rules without models: dialogue (step 11) → lookup (K2 stand-in) → policy (step 12). Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IntentLabel } from "@/lib/intent/model";
import { memoryStore } from "@/lib/cases/memory-store";
import type { CaseStore } from "@/lib/cases/types";
import { DEMO_CUSTOMER_ID, mockLookup } from "@/lib/lookup/mock";
import type { TransactionLookup } from "@/lib/lookup/types";
import { advance, type TurnInput } from "./dialogue";
import { resolveTurn } from "./resolve";
import { newState, type ConversationState, type Details } from "./state";

const LABELS: IntentLabel[] = ["unrecognized_charge", "wrongful_fee", "transaction_status", "balance_check", "move_money", "human_agent", "out_of_scope"];
function intent(top: IntentLabel, p: number): TurnInput["intent"] {
  const scores = LABELS.map((label) => ({ label, probability: label === top ? p : (1 - p) / 6 })).sort((a, b) => b.probability - a.probability);
  return { intent: top, decision: p >= 0.7 ? "act" : "ask", scores };
}
const me = { customerId: DEMO_CUSTOMER_ID };

async function run(
  turns: { text: string; intent: TurnInput["intent"]; details?: Partial<Details> }[],
  lookup: TransactionLookup = mockLookup,
  store: CaseStore = memoryStore(),
) {
  let state: ConversationState = newState("c1", "demo", 0);
  const moves = [];
  for (const t of turns) {
    const out = advance(state, { text: t.text, intent: t.intent, details: t.details ?? {} });
    const r = await resolveTurn(out, { session: me, lookup, store, language: "es", promptVersions: { reply: "test" } });
    state = out.state;
    moves.push({ move: r.move, rule: r.trace.rule, case: r.trace.case, state: structuredClone(state) });
  }
  return moves;
}

const yes = { text: "sí", intent: intent("out_of_scope", 0.75) };
const dispute = (amount: number, date: string, extra: Partial<Details> = {}) => ({
  text: `No reconozco un cargo de ${amount}`, intent: intent("unrecognized_charge", 0.9), details: { amount, date, ...extra },
});

describe("dispute outcomes (docs/policy.md)", () => {
  it("TC-01 path: one approved low-risk match → confirm the record → review (PL-7)", async () => {
    const [t1, t2] = await run([dispute(350, "2026-06-09"), yes]);
    assert.equal(t1.move, "confirm");
    assert.equal(t1.state.match?.merchant, "Super Ahorro");
    assert.equal(t2.move, "open_review");
    assert.equal(t2.rule, "PL-7");
    assert.equal(t2.state.status, "review");
  });
  it("high fraud score → a person, after confirmation (PL-6)", async () => {
    const [, t2] = await run([dispute(120, "2026-06-03"), yes]);
    assert.equal(t2.move, "handoff");
    assert.equal(t2.rule, "PL-6");
    assert.equal(t2.state.handoffReason, "high_risk");
  });
  it("the state never holds the fraud score (the client can read the token)", async () => {
    const [t1] = await run([dispute(120, "2026-06-03")]);
    assert.ok(!JSON.stringify(t1.state).includes("fraud"));
  });
  it("pending → explained and closed, no dispute (PL-3)", async () => {
    const [t1] = await run([dispute(45, "2026-06-16")]);
    assert.equal(t1.move, "explain_status");
    assert.equal(t1.rule, "PL-3");
    assert.equal(t1.state.status, "closed");
  });
  it("two matches → ask for the merchant → one match → confirm (PL-2)", async () => {
    const [t1, t2] = await run([
      dispute(25, "2026-06-11"),
      { text: "fue en Tienda Don José", intent: intent("out_of_scope", 0.4), details: { merchant: "Tienda Don José" } },
    ]);
    assert.equal(t1.move, "ask_narrow");
    assert.equal(t2.move, "confirm");
    assert.equal(t2.state.match?.merchant, "Tienda Don José");
  });
  it("no match twice → a person (PL-1)", async () => {
    const [t1, t2] = await run([
      dispute(999, "2026-06-10"),
      { text: "sí, eran 999 el 10 de junio", intent: intent("out_of_scope", 0.4), details: { amount: 999, date: "2026-06-10" } },
    ]);
    assert.equal(t1.move, "no_match");
    assert.equal(t2.move, "handoff");
    assert.equal(t2.state.handoffReason, "no_match");
  });
  it("'no, that's not the charge' drops the match and asks what's wrong", async () => {
    const [, t2] = await run([dispute(350, "2026-06-09"), { text: "no", intent: intent("out_of_scope", 0.5) }]);
    assert.equal(t2.move, "ask_correction");
    assert.equal(t2.state.match, null);
  });
  it("a lookup failure hands off instead of breaking the turn (PL-8)", async () => {
    const broken: TransactionLookup = { ...mockLookup, findTransactions: async () => { throw new Error("db down"); } };
    const [t1] = await run([dispute(350, "2026-06-09")], broken);
    assert.equal(t1.move, "handoff");
    assert.equal(t1.state.handoffReason, "tool_failure");
  });
  it("after a review is opened, a follow-up gets a status update, not a second review", async () => {
    const [, , t3] = await run([dispute(350, "2026-06-09"), yes, { text: "ok gracias", intent: intent("out_of_scope", 0.5) }]);
    assert.equal(t3.move, "status_update");
  });
});

describe("verification (step 13, docs/verification.md)", () => {
  it("V1: a review exists only after write + identical read-back; the reference is kept in the state", async () => {
    const store = memoryStore();
    const [, t2] = await run([dispute(350, "2026-06-09"), yes], mockLookup, store);
    assert.equal(t2.move, "open_review");
    assert.equal(t2.case?.verified, true);
    assert.match(t2.state.caseRef ?? "", /^GT-[2-9A-Z]{8}$/);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].rule, "PL-7");
    assert.equal(store.rows[0].transactionId, "TRX-DEMO0000000000001");
    // The case file tells the whole story, across turns (not only the final "yes").
    assert.deepEqual(store.rows[0].checksDone, [
      "turn 1: topic unrecognized_charge (by model)",
      "turn 1: lookup (mock): 1 match(es)",
      "turn 2: customer confirmed the matched charge",
      "turn 2: re-read TRX-DEMO0000000000001: Approved",
      "turn 2: policy PL-7",
    ]);
  });
  it("hand-offs get a case too, with the reason and an open question for the agent", async () => {
    const store = memoryStore();
    await run([dispute(120, "2026-06-03"), yes], mockLookup, store);
    assert.equal(store.rows[0].kind, "handoff");
    assert.equal(store.rows[0].reason, "high_risk");
    assert.ok(store.rows[0].openQuestions[0].startsWith("Possible fraud"));
    assert.ok(store.rows[0].verifiedFacts.some((f) => f.fact.startsWith("Fraud score 41.7")));
  });
  it("V2: if the store fails, nothing is claimed and a later 'sí' can retry", async () => {
    const [, t2] = await run([dispute(350, "2026-06-09"), yes], mockLookup, memoryStore({ failCreate: true }));
    assert.equal(t2.move, "record_failed");
    assert.equal(t2.state.caseRef, null);
    assert.equal(t2.state.status, "open");
    assert.equal(t2.state.pending?.kind, "confirm");
  });
  it("V2: a write that silently doesn't persist is caught by the read-back", async () => {
    const [, t2] = await run([dispute(350, "2026-06-09"), yes], mockLookup, memoryStore({ loseWrites: true }));
    assert.equal(t2.move, "record_failed");
    assert.equal(t2.case?.error, "read-back mismatch: case not found on read-back");
  });
  it("V2: a read-back that differs from what was written is not trusted", async () => {
    const store = memoryStore({ corrupt: (r) => ({ ...r, customerId: "CLI-SOMEONE-ELSE" }) });
    const [, t2] = await run([dispute(350, "2026-06-09"), yes], mockLookup, store);
    assert.equal(t2.move, "record_failed");
    assert.match(t2.case?.error ?? "", /customerId differs/);
  });
  it("V3: retrying the confirmation after a failure never creates a second case", async () => {
    const store = memoryStore();
    // Same conversation, same charge, same kind → same idempotency key.
    const [, t2] = await run([dispute(350, "2026-06-09"), yes], mockLookup, store);
    const again = await store.create({ ...store.rows[0] });
    assert.equal(again.id, store.rows[0].id);
    assert.equal(store.rows.length, 1);
    assert.equal(t2.state.caseId, store.rows[0].id);
  });
});

