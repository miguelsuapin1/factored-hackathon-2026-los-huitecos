// Checks on the test conversations themselves, so a mistake in a case is caught here and not mistaken for a system
// failure in a live run. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_CUSTOMER_ID, FIXTURES } from "@/lib/lookup/mock";
import type { Case } from "./case";
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
