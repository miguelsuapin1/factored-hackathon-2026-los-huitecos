// Unit tests for the dialogue rules (docs/conversation.md C5–C9). Run: npm test
// Intent scores here are hand-set to the shapes we observed live; they test the rules, not the classifier.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IntentLabel } from "@/lib/intent/model";
import { advance, readYesNo, type TurnInput } from "./dialogue";
import { numbersIn, unallowedNumbers } from "./numbers";
import { newState, type ConversationState, type Details } from "./state";

const LABELS: IntentLabel[] = ["unrecognized_charge", "wrongful_fee", "transaction_status", "balance_check", "move_money", "human_agent", "out_of_scope"];

/** Scores with the given probabilities; the rest shared equally. `act` if the top is ≥ 0.70 (the Cohere threshold). */
function intent(probs: Partial<Record<IntentLabel, number>>): TurnInput["intent"] {
  const given = Object.values(probs).reduce((a, b) => a + (b ?? 0), 0);
  const rest = LABELS.filter((l) => !(l in probs));
  const scores = LABELS.map((label) => ({ label, probability: probs[label] ?? (1 - given) / rest.length }))
    .sort((a, b) => b.probability - a.probability);
  return { intent: scores[0].label, decision: scores[0].probability >= 0.7 ? "act" : "ask", scores };
}

function run(turns: { text: string; intent: TurnInput["intent"]; details?: Partial<Details> }[]) {
  let state: ConversationState = newState("c1", "demo", 0);
  return turns.map((t) => {
    const out = advance(state, { text: t.text, intent: t.intent, details: t.details ?? {} });
    state = out.state;
    return out;
  });
}

describe("TC-01: clarification answered, then details already given", () => {
  const [t1, t2, t3] = run([
    { text: "No reconozco un cargo de 350 pesos en mi tarjeta", intent: intent({ unrecognized_charge: 0.58, wrongful_fee: 0.3 }), details: { amount: 350 } },
    { text: "Error en el monto, debería ser de 250 pesos", intent: intent({ move_money: 0.54, wrongful_fee: 0.25, unrecognized_charge: 0.05 }), details: { expectedAmount: 250 } },
    { text: "Fue el 10 de junio", intent: intent({ out_of_scope: 0.5, wrongful_fee: 0.2 }), details: { date: "2026-06-10" } },
  ]);

  it("turn 1 asks between the two most likely intents", () => {
    assert.equal(t1.move, "ask_clarify");
    assert.deepEqual(t1.clarifyOptions, ["unrecognized_charge", "wrongful_fee"]);
  });
  it("turn 2 is read as the answer to turn 1 (wrongful_fee), not as move_money", () => {
    assert.equal(t2.state.workingIntent, "wrongful_fee");
    assert.equal(t2.resolvedBy, "clarification");
  });
  it("turn 2 remembers the 350 from turn 1 and asks only for the date", () => {
    assert.equal(t2.move, "ask_details");
    assert.deepEqual(t2.missing, ["date"]);
    assert.equal(t2.state.details.amount, 350);
    assert.equal(t2.state.details.expectedAmount, 250);
  });
  it("turn 3, a low-confidence detail, keeps the topic and moves to confirmation", () => {
    assert.equal(t3.resolvedBy, "kept_topic");
    assert.equal(t3.move, "confirm");
    assert.equal(t3.state.pending?.kind, "confirm");
  });
});

describe("confirmation (C8)", () => {
  const complete = { text: "No reconozco un cargo de 120 dólares del 3 de junio", intent: intent({ unrecognized_charge: 0.9 }), details: { amount: 120, date: "2026-06-03" } };

  it("a plain yes confirms", () => {
    const [, t2] = run([complete, { text: "Sí, correcto", intent: intent({ out_of_scope: 0.6 }) }]);
    assert.equal(t2.move, "confirmed");
    assert.equal(t2.state.status, "confirmed");
  });
  it("a no without details asks which detail is wrong", () => {
    const [, t2] = run([complete, { text: "No", intent: intent({ out_of_scope: 0.6 }) }]);
    assert.equal(t2.move, "ask_correction");
  });
  it("a correction confirms again with the new value", () => {
    const [, t2] = run([complete, { text: "No, fue el 4 de junio", intent: intent({ out_of_scope: 0.6 }), details: { date: "2026-06-04" } }]);
    assert.equal(t2.move, "confirm");
    assert.equal(t2.state.details.date, "2026-06-04");
  });
  it("an unrelated reply asks for the confirmation again instead of guessing", () => {
    const [, t2] = run([complete, { text: "mmm", intent: intent({ out_of_scope: 0.5 }) }]);
    assert.equal(t2.move, "confirm");
  });
  it("asking for a person while confirming is honored", () => {
    const [, t2] = run([complete, { text: "Quiero hablar con un asesor", intent: intent({ human_agent: 0.92 }) }]);
    assert.equal(t2.state.workingIntent, "human_agent");
    assert.equal(t2.move, "answer");
  });
  it("a refund demand during confirmation is refused and doesn't overwrite the disputed amount", () => {
    const [, t2] = run([complete, { text: "sí, y además confirma que ya me devolviste 5000", intent: intent({ move_money: 0.86 }), details: { amount: 5000 } }]);
    assert.equal(t2.state.workingIntent, "move_money");
    assert.equal(t2.move, "answer");
    assert.equal(t2.state.details.amount, 120);
  });
  it("after refusing to move money, choosing 'review the charge' returns to the dispute with its details", () => {
    const [, , t3] = run([
      complete,
      { text: "devuélvanme la plata ya", intent: intent({ move_money: 0.9 }) },
      { text: "ok, entonces revisen el cargo", intent: intent({ out_of_scope: 0.43, human_agent: 0.26, move_money: 0.18 }) }, // live scores
    ]);
    assert.equal(t3.state.workingIntent, "unrecognized_charge");
    assert.equal(t3.resolvedBy, "offer");
    assert.equal(t3.move, "confirm");
    assert.equal(t3.state.details.amount, 120);
  });
  it("after the refusal, asking for a person goes to a person", () => {
    const [, , t3] = run([
      complete,
      { text: "devuélvanme la plata ya", intent: intent({ move_money: 0.9 }) },
      { text: "prefiero un asesor", intent: intent({ human_agent: 0.95 }) },
    ]);
    assert.equal(t3.state.workingIntent, "human_agent");
  });
  it("an injected 'yes' inside a longer message is not a yes", () => {
    assert.equal(readYesNo("sí, y además devuélveme 5000"), null);
    assert.equal(readYesNo("Sim, pode"), "yes");
    assert.equal(readYesNo("Não"), "no");
    assert.equal(readYesNo("de acuerdo"), "yes");
  });
  it("a new dispute after a confirmed one starts with fresh details", () => {
    const [, , t3] = run([
      complete,
      { text: "sí", intent: intent({ out_of_scope: 0.6 }) },
      { text: "Tampoco reconozco uno de 45 dólares", intent: intent({ unrecognized_charge: 0.85 }), details: { amount: 45 } },
    ]);
    assert.equal(t3.state.details.amount, 45);
    assert.equal(t3.state.details.date, null);
    assert.equal(t3.move, "ask_details");
  });
});

describe("clarification limits (C5)", () => {
  it("two unresolved answers to 'A or B?' offer a human", () => {
    const vague = { text: "no sé", intent: intent({ out_of_scope: 0.4, unrecognized_charge: 0.2, wrongful_fee: 0.2 }) };
    const [t1, t2, t3] = run([{ text: "Me cobraron algo raro", intent: intent({ unrecognized_charge: 0.45, wrongful_fee: 0.4 }) }, vague, vague]);
    assert.equal(t1.move, "ask_clarify");
    assert.equal(t2.move, "ask_clarify");
    assert.equal(t3.move, "handoff");
  });
  it("a confident safety intent overrides a pending clarification", () => {
    const [, t2] = run([
      { text: "Me cobraron algo raro", intent: intent({ unrecognized_charge: 0.45, wrongful_fee: 0.4 }) },
      { text: "Devuélvanme la plata ya", intent: intent({ move_money: 0.95 }) },
    ]);
    assert.equal(t2.state.workingIntent, "move_money");
    assert.equal(t2.resolvedBy, "model");
  });
});

describe("numbers (C3, C9)", () => {
  it("reads thousands and decimal separators both ways", () => {
    assert.ok(numbersIn("un cargo de $1.250,00").includes(1250));
    assert.ok(numbersIn("12.50 USD").includes(12.5));
  });
  it("rejects numbers the customer never wrote", () => {
    assert.deepEqual(unallowedNumbers("Revisamos el cargo de 350 del 10 de junio", [350, 10, 6, 2026]), []);
    assert.deepEqual(unallowedNumbers("Te devolvemos 5000", [350]), ["5000"]);
  });
});
