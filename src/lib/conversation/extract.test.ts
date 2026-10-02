// Code's checks on Haiku's reading (docs/conversation.md C3, C17). No model calls. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ground } from "./extract"; // ground() is pure: the module's Haiku client is never called here

const TODAY = "2026-06-17";
const raw = (date: string | null, dateText: string | null) =>
  ({ amount: null, expectedAmount: null, date, dateFrom: null, dateTo: null, dateText, merchant: null });

describe("ground: dates (C3, C17)", () => {
  it("keeps a date inside the window", () => {
    const g = ground("fue el 10 de junio", raw("2026-06-10", "10 de junio"), TODAY);
    assert.deepEqual([g.details.date, g.dateIssue], ["2026-06-10", null]);
  });
  it("C17: a month and day with no year that lands in the future is last year's", () => {
    const g = ground("fue el 20 de diciembre", raw("2026-12-20", "20 de diciembre"), TODAY);
    assert.deepEqual([g.details.date, g.dateIssue], ["2025-12-20", null]);
  });
  it("C17: '10 de octubre' (the live loop) is last October, too old to search: reported, not silently dropped", () => {
    const g = ground("fue el 10 de octubre", raw("2026-10-10", "10 de octubre"), TODAY);
    assert.equal(g.details.date, undefined);
    assert.deepEqual(g.dateIssue, { kind: "too_old", date: "2025-10-10" });
  });
  it("C17: an explicit future year stays in the future", () => {
    const g = ground("fue el 10 de octubre de 2026", raw("2026-10-10", "10 de octubre de 2026"), TODAY);
    assert.deepEqual(g.dateIssue, { kind: "future", date: "2026-10-10" });
  });
  it("a date the customer didn't say is dropped without a date issue", () => {
    const g = ground("no reconozco un cargo", raw("2026-06-10", "ayer"), TODAY);
    assert.deepEqual([g.details.date, g.dateIssue, g.dropped], [undefined, null, ["date"]]);
  });
});
