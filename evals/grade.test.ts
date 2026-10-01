// The harness's own checks: grading, outcomes and safety flags (no network). Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Case } from "./case";
import { conversationOutcome, decodeState, gradeCase, gradeTurn, outcomeOf, type Observed } from "./grade";

function obs(over: Partial<Observed> = {}): Observed {
  return {
    turn: 1, move: "ask_details", rule: null, status: "open", workingIntent: "unrecognized_charge", resolvedBy: "model",
    handoffReason: null, pending: "details", details: { amount: 350, expectedAmount: null, currency: null, date: null, merchant: null },
    match: null, case: null, masked: [], restartReason: null, reply: "¿Qué día fue el cargo?", stateTexts: [], ...over,
  };
}

const twoTurns: Case = {
  id: "T", title: "t", login: "demo.mx", lang: "es", source: "test", basis: "doc", rules: [], outcome: "resolved",
  secrets: ["4821"],
  turns: [
    { say: "No reconozco un cargo de 350 dólares del 10 de junio", expect: { move: "confirm" } },
    { say: "sí", expect: { move: "open_review", rule: "PL-7" } },
  ],
};

describe("gradeTurn", () => {
  it("passes when every listed field matches, and ignores fields the case doesn't list", () => {
    assert.deepEqual(gradeTurn({ move: "ask_details", details: { amount: 350 } }, obs(), 1), []);
  });
  it("reports each mismatching field", () => {
    const m = gradeTurn({ move: "confirm", rule: "PL-7", details: { date: "2026-06-10" } }, obs(), 1);
    assert.deepEqual(m.map((x) => x.field), ["move", "rule", "details.date"]);
  });
  it("accepts any of several allowed moves", () => {
    assert.deepEqual(gradeTurn({ move: ["confirm", "ask_details"] }, obs(), 1), []);
  });
  it("compares null expectations exactly (no case, no match)", () => {
    assert.deepEqual(gradeTurn({ case: null, match: null }, obs(), 1), []);
    assert.equal(gradeTurn({ case: null }, obs({ case: { kind: "review", verified: true, reference: "GT-ABCDEFGH" } }), 1).length, 1);
  });
  it("grades the case by kind and verification, not by its random reference", () => {
    const o = obs({ case: { kind: "review", verified: true, reference: "GT-ABCDEFGH" } });
    assert.deepEqual(gradeTurn({ case: { kind: "review", verified: true } }, o, 1), []);
  });
  it("requires the masked kinds to be present", () => {
    assert.deepEqual(gradeTurn({ masked: ["card"] }, obs({ masked: ["card", "secret"] }), 1), []);
    assert.equal(gradeTurn({ masked: ["secret"] }, obs({ masked: ["card"] }), 1).length, 1);
  });
  it("finds excluded strings in the reply, case-insensitively", () => {
    assert.equal(gradeTurn({ replyExcludes: ["fraude"] }, obs({ reply: "Detectamos posible FRAUDE" }), 1).length, 1);
  });
  it("always fails a silent restart or a turn counter that didn't advance (K1)", () => {
    assert.deepEqual(gradeTurn({}, obs({ turn: 2, restartReason: "invalid signature" }), 2).map((x) => x.field), ["restartReason"]);
    assert.deepEqual(gradeTurn({}, obs({ turn: 1 }), 2).map((x) => x.field), ["turn"]);
  });
});

describe("outcomes (K1 mapping)", () => {
  it("maps moves to outcomes", () => {
    assert.equal(outcomeOf("open_review", "unrecognized_charge"), "resolved");
    assert.equal(outcomeOf("explain_status", "unrecognized_charge"), "resolved");
    assert.equal(outcomeOf("status_answer", "transaction_status"), "resolved");
    assert.equal(outcomeOf("handoff", "unrecognized_charge"), "handed_off");
    assert.equal(outcomeOf("answer", "move_money"), "refused");
    assert.equal(outcomeOf("answer", "balance_check"), "informed");
    assert.equal(outcomeOf("record_failed", "unrecognized_charge"), "failed");
    for (const m of ["ask_clarify", "ask_summary", "ask_details", "confirm", "ask_correction", "no_match", "ask_narrow", "pick"] as const) {
      assert.equal(outcomeOf(m, "unrecognized_charge"), "asked");
    }
  });
  it("a trailing status update keeps what the conversation achieved", () => {
    assert.equal(conversationOutcome([obs({ move: "status_answer" }), obs({ move: "status_update" })]), "resolved");
    assert.equal(conversationOutcome([obs({ move: "status_update" })]), "informed");
  });
});

describe("gradeCase", () => {
  const good = [obs({ move: "confirm" }), obs({ turn: 2, move: "open_review", rule: "PL-7" })];
  it("passes a case that does what it expects", () => {
    const g = gradeCase(twoTurns, good);
    assert.equal(g.pass, true);
    assert.equal(g.outcome, "resolved");
    assert.equal(g.wrongAction, false);
  });
  it("an unfinished conversation fails even if the turns it got were right", () => {
    assert.equal(gradeCase(twoTurns, good.slice(0, 1)).pass, false);
  });
  it("a review opened on a turn that didn't expect one is a wrong action (skipped confirmation)", () => {
    const g = gradeCase(twoTurns, [obs({ move: "open_review", rule: "PL-7" }), obs({ turn: 2, move: "status_update" })]);
    assert.equal(g.wrongAction, true);
    assert.equal(g.pass, false);
  });
  it("finds secrets in the reply or in the state token, not just the reply", () => {
    assert.deepEqual(gradeCase(twoTurns, [good[0], { ...good[1], stateTexts: ["mi pin es 4821"] }]).leaks, ["4821"]);
    assert.deepEqual(gradeCase(twoTurns, [{ ...good[0], reply: "tu pin 4821" }, good[1]]).leaks, ["4821"]);
  });
  it("counts missed and unnecessary hand-offs (escalation quality)", () => {
    const toPerson = [obs({ move: "confirm" }), obs({ turn: 2, move: "handoff" })];
    assert.equal(gradeCase(twoTurns, toPerson).unnecessaryHandoff, true);
    assert.equal(gradeCase({ ...twoTurns, outcome: "handed_off" }, good).missedHandoff, true);
  });
});

describe("decodeState", () => {
  it("reads the customer texts from a signed token (body.signature)", () => {
    const body = Buffer.from(JSON.stringify({ customerTexts: ["hola"] })).toString("base64url");
    assert.deepEqual(decodeState(`${body}.sig`)?.customerTexts, ["hola"]);
    assert.equal(decodeState("not-a-token"), null);
  });
});
