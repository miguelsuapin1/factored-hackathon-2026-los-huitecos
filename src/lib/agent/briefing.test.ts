// Agent console tests: the agent's briefing is built only from the case's stored facts. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBriefing, statedCharge, waited, type AgentCase } from "./briefing";

const base: AgentCase = {
  id: "00000000-0000-0000-0000-000000000001", reference: "GT-CMGMDZFE", createdAt: "2026-10-04T10:00:00Z", status: "open",
  rule: "PL-6", reason: "high_risk", customerId: "CLI-DEMO00000001", intent: "unrecognized_charge", language: "es",
  transactionId: "TRX-DEMO0000000000003",
  summary: "unrecognized_charge: 120 USD at Conciertos Live on 2026-06-03. handed off: high_risk (PL-6).",
  verifiedFacts: [{ fact: "Customer confirmed this is the charge they mean", source: "conversation" }],
  customerStatements: { date: "2026-06-03", amount: 120, currency: "USD" },
  checksDone: ["turn 1: topic unrecognized_charge (by words)", "turn 1: lookup (supabase, around the date): 1 match(es)",
    "turn 2: customer confirmed the matched charge", "turn 2: policy PL-6"],
  openQuestions: ["Possible fraud: confirm the customer has the card and whether others could use it; consider blocking."],
  environment: "production",
};
const customer = { firstName: "Demo", country: "MX", segment: "Basic", status: "Active", dataSource: "team_synthetic" };
const tx = { transactionId: "TRX-DEMO0000000000003", dateLocal: "2026-06-03", amount: 120, currency: "USD", merchant: "Conciertos Live",
  status: "Approved", responseCode: "00", channel: "Web", country: "MX", fraudScore: 41.7 };

describe("buildBriefing", () => {
  it("tells the agent who, what, what was checked and why, from the case facts only", () => {
    const b = buildBriefing(base, customer, tx);
    assert.match(b.paragraph, /^Demo \(CLI-DEMO00000001\), Mexico, Basic wrote in Spanish about a charge they don't recognize\./);
    assert.match(b.paragraph, /They reported 120\.00 USD on 2026-06-03\./);
    assert.match(b.paragraph, /matched transaction TRX-DEMO0000000000003 \(120\.00 USD at Conciertos Live on 2026-06-03, Approved\) and the customer confirmed it/);
    assert.match(b.paragraph, /handed to a person because the matched charge has a high fraud score \(PL-6\)\./);
    assert.match(b.paragraph, /Next: Possible fraud/);
    assert.equal(b.headline, "Unrecognized charge · fraud score at or above the cutoff");
  });
  it("shows the fraud score to the agent, marked as never shown to the customer", () => {
    const row = buildBriefing(base, customer, tx).rows.find(([k]) => k === "Fraud score");
    assert.equal(row?.[1], "41.7 (hand-off cutoff 30; never shown to the customer)");
  });
  it("handles a hand-off with nothing collected (customer asked for a person straight away)", () => {
    const b = buildBriefing({ ...base, rule: "DLG-human", reason: "customer_asked", transactionId: null, intent: "human_agent",
      customerStatements: { summary: "me cobraron dos veces" }, checksDone: [], verifiedFacts: [], openQuestions: [] }, null, null);
    assert.match(b.paragraph, /^Customer CLI-DEMO00000001 wrote in Spanish about talking to a person\./);
    assert.match(b.paragraph, /didn't give the charge's details\. In their words: "me cobraron dos veces"\./);
    assert.match(b.paragraph, /because the customer asked to talk to a person \(DLG-human\)\.$/);
    assert.ok(!b.rows.some(([k]) => k === "Transaction"));
  });
  it("says when the assistant searched but couldn't settle on a charge, and flags test traffic", () => {
    const b = buildBriefing({ ...base, rule: "PL-2", reason: "ambiguous", transactionId: null, environment: "local",
      checksDone: ["turn 1: lookup (supabase, last 180 days): 3 match(es)", "turn 2: lookup (supabase, last 180 days, with merchant): 3 match(es)"] }, customer, null);
    assert.match(b.paragraph, /searched their transactions 2 times without settling on one charge/);
    assert.deepEqual(b.rows.find(([k]) => k === "Environment"), ["Environment", "local (test traffic)"]);
  });
  it("includes the amount the customer expected for a wrongful fee", () => {
    const b = buildBriefing({ ...base, intent: "wrongful_fee", customerStatements: { amount: 250, expectedAmount: 200, currency: "MXN" } }, customer, null);
    assert.match(b.paragraph, /They reported 250\.00 MXN, and say it should have been 200\.00 MXN\./);
  });
});

describe("helpers", () => {
  it("statedCharge ignores empty or malformed values", () => {
    assert.equal(statedCharge({}), null);
    assert.equal(statedCharge({ amount: "350", merchant: " ", date: 5 }), null);
    assert.equal(statedCharge({ amount: 1250.5, currency: "COP", merchant: "Tienda" }), "1,250.50 COP at Tienda");
  });
  it("waited reads naturally", () => {
    const t0 = Date.parse("2026-10-05T10:00:00Z");
    assert.equal(waited("2026-10-05T10:00:20Z", t0 + 20_000), "just now");
    assert.equal(waited("2026-10-05T10:00:00Z", t0 + 12 * 60_000), "12 min");
    assert.equal(waited("2026-10-05T10:00:00Z", t0 + 3 * 3600_000), "3 h");
    assert.equal(waited("2026-10-05T10:00:00Z", t0 + 3 * 86400_000), "3 d");
  });
});
