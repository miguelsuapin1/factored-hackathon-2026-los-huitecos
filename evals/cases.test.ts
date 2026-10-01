// Checks on the test conversations themselves, so a mistake in a case is caught here and not mistaken for a system
// failure in a live run. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_CUSTOMER_ID, FIXTURES } from "@/lib/lookup/mock";
import type { Case } from "./case";
import { STEP17 } from "./cases/step17";
import { TC } from "./cases/tc";

/** docs/contracts.md K5. */
const K5_LOGINS = ["demo.mx", "otro.mx", "pendiente.ar", "rechazado-sin-codigo.co", "ambiguo.mx"];
const SUITES: Record<string, readonly Case[]> = { tc: TC };

for (const [name, cases] of Object.entries(SUITES)) {
  describe(`suite ${name}`, () => {
    it("has unique case ids", () => {
      const ids = cases.map((c) => c.id);
      assert.deepEqual(ids, [...new Set(ids)]);
    });
    it("uses only the agreed demo and test customers (K5)", () => {
      for (const c of cases) assert.ok(K5_LOGINS.includes(c.login), `${c.id}: ${c.login}`);
    });
    it("expects a move on every turn, so every turn is graded", () => {
      for (const c of cases) c.turns.forEach((t, i) => assert.ok(t.expect?.move, `${c.id} turn ${i + 1}`));
    });
    it("states its provenance and the rules it exercises", () => {
      for (const c of cases) {
        assert.ok(c.source.trim(), `${c.id}: source`);
        assert.ok(c.rules.length, `${c.id}: rules`);
      }
    });
    it("demo.mx cases only expect demo.mx's own charges", () => {
      const own = new Set(FIXTURES.filter((f) => f.customerId === DEMO_CUSTOMER_ID).map((f) => f.transactionId));
      for (const c of cases.filter((x) => x.login === "demo.mx")) {
        for (const t of c.turns) if (t.expect?.match) assert.ok(own.has(t.expect.match), `${c.id}: ${t.expect.match}`);
      }
    });
    it("messages fit the API's 500-character limit", () => {
      for (const c of cases) for (const t of c.turns) assert.ok(t.say.length <= 500, `${c.id}: ${t.say.length} chars`);
    });
  });
}

/** The charges K5 lets each non-demo login's tests quote (docs/contracts.md K5). */
const K5_CHARGES: Record<string, string[]> = {
  "otro.mx": ["TRX-OTHER000000000001"],
  "pendiente.ar": ["TRX-2T5FBDU4MTH3GM4JDAJT", "TRX-E5OTG7YNKVLRYJPHC7U4", "TRX-SXIOLJ5ZKWC1BEENJPHX"],
  "rechazado-sin-codigo.co": ["TRX-9SINWMOKM1OQBAFUPXBT", "TRX-3TV223QNN106GCJN466L", "TRX-4SAR69NU78Q4GUDQ926N"],
  "ambiguo.mx": ["TRX-KB3BCKQKAA2OT00Q57VL", "TRX-N4OFZ3SVM86XNWB6F7OG", "TRX-70B1SMWBEZWIH577GVBX"],
};

describe("suite step17 (personas)", () => {
  const demo = new Set(FIXTURES.filter((f) => f.customerId === DEMO_CUSTOMER_ID).map((f) => f.transactionId));
  it("has unique ids and uses only K5 logins", () => {
    const ids = STEP17.map((c) => c.id);
    assert.deepEqual(ids, [...new Set(ids)]);
    for (const c of STEP17) assert.ok(K5_LOGINS.includes(c.login), `${c.id}: ${c.login}`);
  });
  it("expects only charges that belong to the case's own login", () => {
    for (const c of STEP17) {
      if (!c.final.match) continue;
      const own = c.login === "demo.mx" ? demo : new Set(K5_CHARGES[c.login] ?? []);
      assert.ok(own.has(c.final.match), `${c.id}: ${c.final.match} is not ${c.login}'s`);
    }
  });
  it("records provenance and every edit to the source text", () => {
    for (const c of STEP17) {
      assert.ok(c.source.trim() && c.persona.trim(), `${c.id}: source/persona`);
      assert.ok(c.edits?.trim(), `${c.id}: edits`);
    }
  });
  it("messages fit the API's 500-character limit", () => {
    for (const c of STEP17) for (const t of [c.opening, ...Object.values(c.replies)]) assert.ok((t ?? "").length <= 500, c.id);
  });
});
