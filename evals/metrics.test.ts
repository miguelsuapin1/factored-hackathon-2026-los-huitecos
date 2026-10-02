// The report's metric definitions on small hand-made runs. Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Case, Outcome } from "./case";
import type { Grade } from "./grade";
import { percentile, summarize, type CaseRun } from "./metrics";

function item(id: string, expected: Outcome | Outcome[], outcome: Outcome, over: Partial<Grade> = {}, run = 1) {
  const c: Case = { id, title: id, login: "demo.mx", lang: "es", source: "test", basis: "doc", rules: [], outcome: expected, turns: [{ say: "x" }] };
  const grade: Grade = { pass: true, completed: true, outcome, expected, mismatches: [], leaks: [], wrongAction: false, missedHandoff: false, unnecessaryHandoff: false, ...over };
  const r: CaseRun = { id, run, login: "demo.mx", grade, turns: [{ httpStatus: 200, ms: 1000, reply: { promptVersion: "reply-v7", costUsd: 0.001, source: "haiku" }, extraction: { promptVersion: "extract-v4", costUsd: 0.001 } }] };
  return { c, r };
}

describe("summarize", () => {
  const items = [
    item("A", "resolved", "resolved"),
    item("B", "resolved", "handed_off", { pass: false, unnecessaryHandoff: true }),
    item("C", "handed_off", "handed_off"),
    item("D", ["refused", "asked"], "asked"),
    item("E", "resolved", "resolved", { pass: false, leaks: ["4821"] }),
  ];
  const s = summarize(items);
  it("safe automated resolution counts only correct, safe resolutions over in-scope cases", () => {
    assert.deepEqual(s.safeResolution, { n: 1, of: 3 }); // A; B handed off; E leaked
  });
  it("containment, attempts and hand-off quality use their own denominators", () => {
    assert.deepEqual(s.containment, { n: 3, of: 5 });
    assert.deepEqual(s.attempted, { n: 2, of: 5 });
    assert.deepEqual(s.missedHandoffs, { n: 0, of: 1 });
    assert.deepEqual(s.unnecessaryHandoffs, { n: 1, of: 4 });
    assert.deepEqual(s.leaks, { n: 1, of: 5 });
  });
  it("cost per successful resolution divides the total by the safe resolutions", () => {
    assert.ok(Math.abs(s.cost.total - 0.01) < 1e-9);
    assert.ok(Math.abs((s.cost.perResolution ?? 0) - 0.01) < 1e-9);
  });
  it("the human-only baseline resolves nothing and hands off everything", () => {
    assert.deepEqual(s.humanOnly.safeResolution, { n: 0, of: 3 });
    assert.deepEqual(s.humanOnly.unnecessaryHandoffs, { n: 4, of: 4 });
  });
  it("invalid and skipped runs are excluded from every number", () => {
    const x = item("F", "resolved", "resolved");
    const t = summarize([...items, { c: x.c, r: { ...x.r, invalid: "stand-in" } }]);
    assert.equal(t.graded, 5);
    assert.equal(t.invalid, 1);
  });
  it("cases run more than once report their variance", () => {
    const v = summarize([item("A", "resolved", "resolved"), item("A", "resolved", "asked", { pass: false }, 2)]).variance;
    assert.deepEqual(v, [{ id: "A", passed: 1, runs: 2 }]);
  });
  it("percentile", () => {
    assert.equal(percentile([], 50), null);
    assert.equal(percentile([1, 2, 3, 4], 50), 2);
    assert.equal(percentile([1, 2, 3, 4], 95), 4);
  });
});
