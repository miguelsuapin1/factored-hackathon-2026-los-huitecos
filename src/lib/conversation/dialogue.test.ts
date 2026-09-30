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
  it("asking for a person while confirming hands off at once, keeping the dispute as context (H2)", () => {
    const [, t2] = run([complete, { text: "Quiero hablar con un asesor", intent: intent({ human_agent: 0.92 }) }]);
    assert.equal(t2.move, "handoff");
    assert.equal(t2.state.handoffReason, "customer_asked");
    assert.equal(t2.state.workingIntent, "unrecognized_charge");
    assert.equal(t2.state.details.amount, 120);
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
    assert.equal(t3.move, "handoff");
    assert.equal(t3.state.handoffReason, "customer_asked");
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
  it("C11: a bare 'sí' to 'A or B?' doesn't pick one, even if the scores lean one way (seen live)", () => {
    const [, t2] = run([
      { text: "No reconozco un cargo de 120 dólares", intent: intent({ unrecognized_charge: 0.5, transaction_status: 0.3 }) },
      { text: "sí", intent: intent({ transaction_status: 0.41, out_of_scope: 0.3, unrecognized_charge: 0.05 }) },
    ]);
    assert.equal(t2.move, "ask_clarify");
    assert.equal(t2.state.workingIntent, null);
  });
  it("C11: 'sí, no lo reconozco' still resolves (it's more than a bare yes)", () => {
    const [, t2] = run([
      { text: "Me cobraron algo raro", intent: intent({ unrecognized_charge: 0.45, wrongful_fee: 0.4 }) },
      { text: "sí, no lo reconozco para nada", intent: intent({ unrecognized_charge: 0.6, wrongful_fee: 0.1 }) },
    ]);
    assert.equal(t2.state.workingIntent, "unrecognized_charge");
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

describe("asking for a person (H1–H3)", () => {
  it("H1: with no context, ask for one line, then hand off with it", () => {
    const [t1, t2] = run([
      { text: "Quero falar com um atendente", intent: intent({ human_agent: 0.99 }) },
      { text: "Cobraram duas vezes a minha fatura", intent: intent({ wrongful_fee: 0.8 }) },
    ]);
    assert.equal(t1.move, "ask_summary");
    assert.equal(t2.move, "handoff");
    assert.equal(t2.state.summary, "Cobraram duas vezes a minha fatura");
    assert.equal(t2.state.handoffReason, "customer_asked");
  });
  it("H1: the summary is taken as-is even if it looks like another request (no re-routing)", () => {
    const [, t2] = run([
      { text: "un asesor por favor", intent: intent({ human_agent: 0.97 }) },
      { text: "devuélvanme la plata", intent: intent({ move_money: 0.9 }) },
    ]);
    assert.equal(t2.move, "handoff");
  });
  it("H3: 'no' right after asking for the summary cancels the hand-off", () => {
    const [, t2] = run([
      { text: "quiero un asesor", intent: intent({ human_agent: 0.97 }) },
      { text: "no, ya no", intent: intent({ out_of_scope: 0.6 }) },
    ]);
    assert.equal(t2.move, "answer");
    assert.equal(t2.state.pending, null);
    assert.notEqual(t2.state.status, "handoff");
  });
});

describe("C12: bare acknowledgements stay in the conversation (found by the robustness sweep)", () => {
  const okAct = intent({ out_of_scope: 0.71 }); // the live score of a lone "sí"
  it("'sí' after being asked for details keeps the dispute and asks again", () => {
    const [, t2] = run([
      { text: "Me cobraron algo raro", intent: intent({ wrongful_fee: 0.73 }) },
      { text: "sí", intent: okAct },
    ]);
    assert.equal(t2.state.workingIntent, "wrongful_fee");
    assert.equal(t2.move, "ask_details");
  });
  it("'ok gracias' after a finished dispute gives a status update, not the greeting", () => {
    const [, , t3] = run([
      { text: "No reconozco un cargo de 120 dólares del 3 de junio", intent: intent({ unrecognized_charge: 0.9 }), details: { amount: 120, date: "2026-06-03" } },
      { text: "sí", intent: okAct },
      { text: "ok gracias", intent: intent({ out_of_scope: 0.87 }) },
    ]);
    assert.equal(t3.move, "status_update");
  });
  it("a real new topic still switches ('¿a qué hora abre la sucursal?')", () => {
    const [, t2] = run([
      { text: "Me cobraron algo raro", intent: intent({ wrongful_fee: 0.73 }) },
      { text: "¿a qué hora abre la sucursal?", intent: intent({ out_of_scope: 0.9 }) },
    ]);
    assert.equal(t2.state.workingIntent, "out_of_scope");
  });
  it("'revisen el cargo' picks the dispute option of 'A or B?' even when scores lean the other way", () => {
    const [, t2] = run([
      { text: "Devuélvanme el dinero del cargo de 350", intent: intent({ move_money: 0.5, unrecognized_charge: 0.3 }), details: { amount: 350 } },
      { text: "ok, revisen el cargo", intent: intent({ out_of_scope: 0.32, move_money: 0.3, unrecognized_charge: 0.1 }) },
    ]);
    assert.equal(t2.state.workingIntent, "unrecognized_charge");
    assert.equal(t2.move, "ask_details");
  });
});

describe("C12b: short answers to our question stay in the conversation", () => {
  it("'Cable TV' in reply to a details question keeps the topic even at out_of_scope 74%", () => {
    const [, t2] = run([
      { text: "¿Qué pasó con un cobro de 89,90?", intent: intent({ transaction_status: 0.9 }), details: { amount: 89.9 } },
      { text: "Cable TV", intent: intent({ out_of_scope: 0.74 }), details: { merchant: "Cable TV" } },
    ]);
    assert.equal(t2.state.workingIntent, "transaction_status");
  });
  it("a longer real question still switches ('¿a qué hora abre la sucursal del centro?')", () => {
    const [, t2] = run([
      { text: "¿Qué pasó con un cobro de 89,90?", intent: intent({ transaction_status: 0.9 }), details: { amount: 89.9 } },
      { text: "¿a qué hora abre la sucursal del centro?", intent: intent({ out_of_scope: 0.92 }) },
    ]);
    assert.equal(t2.state.workingIntent, "out_of_scope");
  });
  it("C14: Portuguese feminine ordinals pick ('a primeira')", async () => {
    const { readPick } = await import("./dialogue");
    const opts = [{ transactionId: "a", date: "2026-06-12", amount: 25, currency: "USD", merchant: "Super Ahorro", status: "Approved" as const },
      { transactionId: "b", date: "2026-06-11", amount: 25, currency: "USD", merchant: "Tienda Don José", status: "Approved" as const }];
    assert.equal(readPick("a primeira", opts), 0);
    assert.equal(readPick("a segunda", opts), 1);
    assert.equal(readPick("la de don jose", opts), 1);
    assert.equal(readPick("el del 12", opts), 0);
    assert.equal(readPick("mmm", opts), null);
  });
});

describe("C12c: a reply that gives what we asked for is an answer", () => {
  it("'el más reciente' to the date question stays in the dispute even at balance_check 81%", () => {
    const [, t2] = run([
      { text: "No reconozco un cargo de 350 dólares", intent: intent({ unrecognized_charge: 0.9 }), details: { amount: 350 } },
      { text: "el más reciente", intent: intent({ balance_check: 0.81 }) },
    ]);
    assert.equal(t2.state.workingIntent, "unrecognized_charge");
    assert.equal(t2.state.when.latest, true);
  });
  it("asking for a person while answering is still honored", () => {
    const [, t2] = run([
      { text: "No reconozco un cargo de 350 dólares", intent: intent({ unrecognized_charge: 0.9 }), details: { amount: 350 } },
      { text: "no me acuerdo, pásame con un asesor", intent: intent({ human_agent: 0.9 }) },
    ]);
    assert.equal(t2.move, "handoff");
  });
});

