// Unit tests for the policy rules (docs/policy.md) and the stand-in lookup's scoping. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_DETAILS } from "@/lib/conversation/state";
import { DEMO_CUSTOMER_ID, mockLookup } from "@/lib/lookup/mock";
import { decideOnConfirm, decideOnLookup, FRAUD_HANDOFF_SCORE, queryFor } from "./decide";

const me = { customerId: DEMO_CUSTOMER_ID };
const find = (d: Partial<typeof EMPTY_DETAILS>) => mockLookup.findTransactions(me, queryFor({ ...EMPTY_DETAILS, ...d }));

describe("lookup (stand-in for K2)", () => {
  it("finds TC-01's charge within the date window, and never another customer's", async () => {
    const m = await find({ amount: 350, date: "2026-06-09" });
    assert.equal(m.length, 1);
    assert.equal(m[0].transactionId, "TRX-DEMO0000000000001");
  });
  it("treats a misnamed currency as a preference (customer said R$, record is USD)", async () => {
    const m = await find({ amount: 89.9, currency: "BRL", date: "2026-06-12" });
    assert.equal(m.length, 1);
    assert.equal(m[0].currency, "USD");
  });
  it("the merchant narrows two same-amount charges to one", async () => {
    assert.equal((await find({ amount: 25, date: "2026-06-11" })).length, 2);
    assert.equal((await find({ amount: 25, date: "2026-06-11", merchant: "don jose" })).length, 1);
  });
  it("getTransaction refuses another customer's id", async () => {
    assert.equal(await mockLookup.getTransaction(me, "TRX-OTHER000000000001"), null);
  });
});

describe("decideOnLookup", () => {
  it("PL-1: no match asks once, then hands off", async () => {
    const none = await find({ amount: 999, date: "2026-06-10" });
    assert.deepEqual(decideOnLookup(none, 0), { kind: "no_match", rule: "PL-1", handoff: false });
    assert.deepEqual(decideOnLookup(none, 1), { kind: "no_match", rule: "PL-1", handoff: true });
  });
  it("PL-10: exactly two matches are listed for the customer to pick, newest first", async () => {
    const two = await find({ amount: 25, date: "2026-06-11" });
    const d = decideOnLookup(two, 0);
    assert.equal(d.kind, "pick");
    assert.deepEqual(d.kind === "pick" && d.options.map((o) => o.date.slice(0, 10)), ["2026-06-12", "2026-06-11"]);
  });
  it("PL-2: three or more → ask the merchant once; still three or more (or merchant known) → a person", () => {
    const tx = (d: string) => ({ transactionId: d, date: d, amount: 89.9, currency: "USD", merchant: "Cable TV", status: "Approved" as const, responseCode: "00", channel: null, country: null, fraudScore: 5, score: 1 });
    const three = [tx("2026-04-12"), tx("2026-05-12"), tx("2026-06-12")];
    assert.equal(decideOnLookup(three, { retries: 0 }).kind, "ask_merchant");
    assert.equal(decideOnLookup(three, { retries: 0, merchantAsked: true }).kind, "ambiguous");
    assert.equal(decideOnLookup(three, { retries: 0, merchantKnown: true }).kind, "ambiguous");
    const latest = decideOnLookup(three, { retries: 0, latest: true });
    assert.equal(latest.kind === "confirm_match" && latest.match.date, "2026-06-12");
  });
  it("PL-3/4/5: pending, reversed and declined are explained, never disputed", async () => {
    assert.equal(decideOnLookup(await find({ amount: 45, date: "2026-06-16" }), 0).rule, "PL-3");
    assert.equal(decideOnLookup(await find({ amount: 230, date: "2026-06-05" }), 0).rule, "PL-4");
    assert.equal(decideOnLookup(await find({ amount: 560, date: "2026-06-14" }), 0).rule, "PL-5");
  });
  it("an approved single match goes to confirmation", async () => {
    assert.equal(decideOnLookup(await find({ amount: 350, date: "2026-06-10" }), 0).kind, "confirm_match");
  });
});

describe("decideOnConfirm", () => {
  it("PL-7: low risk opens a review", async () => {
    const tx = await mockLookup.getTransaction(me, "TRX-DEMO0000000000001");
    assert.deepEqual(decideOnConfirm(tx), { kind: "open_review", rule: "PL-7" });
  });
  it(`PL-6: fraud score ≥ ${FRAUD_HANDOFF_SCORE} goes to a person`, async () => {
    const tx = await mockLookup.getTransaction(me, "TRX-DEMO0000000000003");
    assert.deepEqual(decideOnConfirm(tx), { kind: "handoff", rule: "PL-6", reason: "high_risk" });
  });
  it("PL-6 boundary: exactly the cutoff hands off, just below doesn't", () => {
    const base = { transactionId: "x", date: "2026-06-10", amount: 1, currency: "USD", merchant: null, status: "Approved" as const, responseCode: "00", channel: null, country: null, score: 1 };
    assert.equal(decideOnConfirm({ ...base, fraudScore: FRAUD_HANDOFF_SCORE }).kind, "handoff");
    assert.equal(decideOnConfirm({ ...base, fraudScore: FRAUD_HANDOFF_SCORE - 0.01 }).kind, "open_review");
  });
  it("PL-8: if the record can't be re-read, or changed status, a person takes it", () => {
    assert.deepEqual(decideOnConfirm(null), { kind: "handoff", rule: "PL-8", reason: "record_unavailable" });
  });
});
