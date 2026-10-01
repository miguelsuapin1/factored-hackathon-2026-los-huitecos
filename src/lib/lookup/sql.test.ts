// Step 10 parity + scoping test for the Supabase lookup (docs/contracts.md K2). Needs a database, so it only runs when
// LOOKUP_TEST_DB_URL is set: a connection AS lookup_reader to a database with the migrations and Miguel's demo charges
// (Supabase itself — use the SUPABASE_LOOKUP_DB_URL value — or a local Postgres). Otherwise every test is skipped.
//   LOOKUP_TEST_DB_URL=postgresql://... npm test
// The same questions go to the stand-in (mock.ts) and to the SQL lookup; the answers must be identical, so the
// policy and dialogue tests written against the stand-in hold for the real data.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import postgres from "postgres";
import { makeAsCustomer } from "@/lib/db/as-customer";
import { DEMO_CUSTOMER_ID, mockLookup } from "./mock";
import { sqlLookup } from "./sql";
import type { LookupQuery, TransactionMatch } from "./types";

const url = process.env.LOOKUP_TEST_DB_URL;
const local = !!url && /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = url ? postgres(url, { prepare: false, max: 1, ssl: local ? false : "require", onnotice: () => {} }) : null;
const lookup = sql ? sqlLookup(makeAsCustomer(() => sql)) : null;
const skip = url ? false : "set LOOKUP_TEST_DB_URL to run the database tests";
after(async () => { await sql?.end(); });

const demo = { customerId: DEMO_CUSTOMER_ID };
const other = { customerId: "CLI-OTHER0000000001" };
const byId = (list: TransactionMatch[]) => [...list].sort((a, b) => a.transactionId.localeCompare(b.transactionId));

// The questions the dialogue actually asks (queryFor shapes), one per policy path of the demo fixtures.
const QUESTIONS: [string, LookupQuery][] = [
  ["TC-01 amount + ±3-day window", { amount: 350, dateFrom: "2026-06-06", dateTo: "2026-06-12", limit: 10 }],
  ["misnamed currency is a preference", { amount: 89.9, currency: "BRL", dateFrom: "2026-06-09", dateTo: "2026-06-15", limit: 10 }],
  ["named currency that matches", { amount: 89.9, currency: "USD", dateFrom: "2026-06-09", dateTo: "2026-06-15", limit: 10 }],
  ["two same-amount charges", { amount: 25, dateFrom: "2026-06-08", dateTo: "2026-06-14", limit: 10 }],
  ["merchant narrows them to one", { amount: 25, dateFrom: "2026-06-08", dateTo: "2026-06-14", merchant: "don jose", limit: 10 }],
  ["merchant that matches nothing doesn't empty the result", { amount: 25, dateFrom: "2026-06-08", dateTo: "2026-06-14", merchant: "zara", limit: 10 }],
  ["no date: last 180 days, two 350s", { amount: 350, dateFrom: "2025-12-19", dateTo: "2026-06-17", limit: 10 }],
  ["subscription: three 89.90 Cable TV", { amount: 89.9, merchant: "cable tv", dateFrom: "2025-12-19", dateTo: "2026-06-17", limit: 10 }],
  ["merchant only", { merchant: "Super Ahorro", dateFrom: "2025-12-19", dateTo: "2026-06-17", limit: 10 }],
  ["high fraud score", { amount: 120, dateFrom: "2026-05-31", dateTo: "2026-06-06", limit: 10 }],
  ["pending", { amount: 45, dateFrom: "2026-06-13", dateTo: "2026-06-17", limit: 10 }],
  ["reversed", { amount: 230, dateFrom: "2026-06-02", dateTo: "2026-06-08", limit: 10 }],
  ["declined", { amount: 560, dateFrom: "2026-06-11", dateTo: "2026-06-17", limit: 10 }],
  ["±1% tolerance (349 finds 350, 340 doesn't)", { amount: 349, dateFrom: "2026-06-06", dateTo: "2026-06-12", limit: 10 }],
  ["outside tolerance", { amount: 340, dateFrom: "2026-06-06", dateTo: "2026-06-12", limit: 10 }],
  ["nothing that day", { amount: 350, dateFrom: "2026-01-01", dateTo: "2026-01-05", limit: 10 }],
];

describe("Supabase lookup = stand-in on the demo charges (parity)", { skip }, () => {
  for (const [name, q] of QUESTIONS) {
    it(name, async () => {
      const [want, got] = await Promise.all([mockLookup.findTransactions(demo, q), lookup!.findTransactions(demo, q)]);
      assert.deepEqual(byId(got), byId(want));
    });
  }
  it("getTransaction returns the same record", async () => {
    for (const id of ["TRX-DEMO0000000000001", "TRX-DEMO0000000000003", "TRX-DEMO0000000000006"]) {
      assert.deepEqual(await lookup!.getTransaction(demo, id), await mockLookup.getTransaction(demo, id));
    }
  });
  it("returns the customer's local time, not UTC (TC-01 was at 13:42 in Mexico City)", async () => {
    assert.equal((await lookup!.getTransaction(demo, "TRX-DEMO0000000000001"))?.date, "2026-06-10T13:42:10");
  });
});

describe("Supabase lookup scoping (step 8 RLS through step 10 code)", { skip }, () => {
  it("never returns another customer's charge, by search or by id", async () => {
    const found = await lookup!.findTransactions(demo, { amount: 350, dateFrom: "2026-06-06", dateTo: "2026-06-12" });
    assert.ok(found.every((m) => m.transactionId.startsWith("TRX-DEMO")));
    assert.equal(await lookup!.getTransaction(demo, "TRX-OTHER000000000001"), null);
    assert.equal(await lookup!.getTransaction(other, "TRX-DEMO0000000000001"), null);
  });
  it("the other customer sees only their own charge", async () => {
    const found = await lookup!.findTransactions(other, { amount: 350, dateFrom: "2026-06-01", dateTo: "2026-06-17" });
    assert.deepEqual(found.map((m) => m.transactionId), ["TRX-OTHER000000000001"]);
  });
  it("refuses a session without a customer before touching the database", async () => {
    await assert.rejects(lookup!.findTransactions({ customerId: "" }, { amount: 350 }), /no customer/);
  });
  it("row-level security holds even for a query with no customer filter at all", async () => {
    const asCustomer = makeAsCustomer(() => sql!);
    const ids = await asCustomer(demo, (tx) => tx<{ customer_id: string }[]>`select distinct customer_id from public.transactions`);
    assert.deepEqual(ids.map((r) => r.customer_id), [DEMO_CUSTOMER_ID]);
  });
});
