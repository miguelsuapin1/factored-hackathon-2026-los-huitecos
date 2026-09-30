// End-to-end rules without models: dialogue (step 11) → lookup (K2 stand-in) → policy (step 12). Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IntentLabel } from "@/lib/intent/model";
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

async function run(turns: { text: string; intent: TurnInput["intent"]; details?: Partial<Details> }[], lookup: TransactionLookup = mockLookup) {
  let state: ConversationState = newState("c1", "demo", 0);
  const moves = [];
  for (const t of turns) {
    const out = advance(state, { text: t.text, intent: t.intent, details: t.details ?? {} });
    const r = await resolveTurn(out, me, lookup);
    state = out.state;
    moves.push({ move: r.move, rule: r.trace.rule, state: structuredClone(state) });
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
