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

describe("hand-off when the customer asks (step 14)", () => {
  it("creates a verified case with the customer's summary and rule DLG-human", async () => {
    const store = memoryStore();
    const [t1, t2] = await run([
      { text: "quiero hablar con alguien", intent: intent("human_agent", 0.98) },
      { text: "me cobraron una comisión que no autoricé", intent: intent("wrongful_fee", 0.8) },
    ], mockLookup, store);
    assert.equal(t1.move, "ask_summary");
    assert.equal(t2.move, "handoff");
    assert.equal(t2.rule, "DLG-human");
    assert.equal(t2.case?.verified, true);
    assert.equal(store.rows[0].reason, "customer_asked");
    assert.equal(store.rows[0].customerStatements.summary, "me cobraron una comisión que no autoricé");
    assert.match(store.rows[0].summary, /Customer's summary: "me cobraron una comisión que no autoricé"/);
  });
  it("mid-dispute: the case carries the dispute details and the matched charge", async () => {
    const store = memoryStore();
    await run([dispute(350, "2026-06-09"), { text: "mejor pásame con un asesor", intent: intent("human_agent", 0.95) }], mockLookup, store);
    assert.equal(store.rows[0].reason, "customer_asked");
    assert.equal(store.rows[0].customerStatements.amount, 350);
    assert.equal(store.rows[0].intent, "unrecognized_charge");
  });
});

describe("status questions answered from the record (S1, S2, PL-9)", () => {
  const status = (amount: number, date: string) => ({
    text: `¿Qué pasó con mi cargo de ${amount}?`, intent: intent("transaction_status", 0.9), details: { amount, date },
  });
  it("S1: no confirmation needed; pending / reversed / declined are explained and nothing is opened", async () => {
    const store = memoryStore();
    const [p] = await run([status(45, "2026-06-16")], mockLookup, store);
    const [r] = await run([status(230, "2026-06-05")], mockLookup, store);
    const [d] = await run([status(560, "2026-06-14")], mockLookup, store);
    assert.deepEqual([p.move, p.rule], ["status_answer", "PL-3"]);
    assert.deepEqual([r.move, r.rule], ["status_answer", "PL-4"]);
    assert.deepEqual([d.move, d.rule], ["status_answer", "PL-5"]);
    assert.equal(store.rows.length, 0);
  });
  it("S1: missing details are asked for first, then the answer comes without a yes/no", async () => {
    const [t1, t2] = await run([
      { text: "¿Por qué me rechazaron una compra?", intent: intent("transaction_status", 0.92) },
      { text: "fue de 560 dólares el 14 de junio", intent: intent("out_of_scope", 0.4), details: { amount: 560, date: "2026-06-14" } },
    ]);
    assert.equal(t1.move, "ask_details");
    assert.deepEqual([t2.move, t2.rule, t2.state.match?.status], ["status_answer", "PL-5", "Declined"]);
  });
  it("PL-9 + S2: approved → review offered → 'no lo reconozco' → confirm the same charge → verified review", async () => {
    const store = memoryStore();
    const [t1, t2, t3] = await run([
      status(350, "2026-06-10"),
      { text: "no lo reconozco", intent: intent("unrecognized_charge", 0.6) },
      yes,
    ], mockLookup, store);
    assert.deepEqual([t1.move, t1.rule, t1.state.pending?.kind], ["status_answer", "PL-9", "offer_dispute"]);
    assert.deepEqual([t2.move, t2.state.workingIntent, t2.state.match?.merchant], ["confirm", "unrecognized_charge", "Super Ahorro"]);
    assert.equal(t3.move, "open_review");
    assert.equal(store.rows.length, 1);
  });
  it("S2: 'no, gracias' after the offer closes politely, no case", async () => {
    const store = memoryStore();
    const [, t2] = await run([status(350, "2026-06-10"), { text: "no, gracias", intent: intent("out_of_scope", 0.7) }], mockLookup, store);
    assert.equal(t2.move, "status_update");
    assert.equal(store.rows.length, 0);
  });
});
