// TC-01…TC-21 from docs/test-conversations.md as gradable cases, against demo.mx's charges (docs/contracts.md K5).
// Expectations follow the doc, updated where a later rule changed the behaviour on purpose (each such case says so in
// its note), and checked against src/lib/conversation/resolve.test.ts and dialogue.test.ts where those cover the path.
// Not an independent evaluation: these messages were written by the team that wrote the rules. The
// human-written messages are the honest measure.
import type { Case } from "../case";

const SOURCE = "team-generated (Miguel, docs/test-conversations.md, 2026-09-29/30); ported by Luis Pedro, 2026-10-01";
const base = { login: "demo.mx", source: SOURCE } as const;

const REVIEW = { kind: "review", verified: true } as const;
const HANDOFF = { kind: "handoff", verified: true } as const;

export const TC: readonly Case[] = [
  {
    ...base, id: "TC-01", lang: "es", basis: "unit-test", outcome: "resolved",
    title: "Clarification answered, details already given: wrong amount 350 vs 250, then a review",
    rules: ["C15", "C3", "PL-7", "V1"],
    turns: [
      { say: "No reconozco un cargo de 350 pesos en mi tarjeta", expect: { move: "ask_details", workingIntent: "unrecognized_charge", details: { amount: 350 } } },
      { say: "Error en el monto, debería ser de 250 pesos", expect: { move: "ask_details", workingIntent: "wrongful_fee", details: { amount: 350, expectedAmount: 250 } } },
      { say: "Fue el 10 de junio", expect: { move: "confirm", details: { date: "2026-06-10" }, match: "TRX-DEMO0000000000001" } },
      { say: "Sí", expect: { move: "open_review", rule: "PL-7", status: "review", case: REVIEW } },
    ],
  },
  {
    ...base, id: "TC-02", lang: "pt", basis: "doc", outcome: "resolved",
    title: "Portuguese, relative date, corrected after a miss",
    rules: ["C3", "C4", "PL-1", "PL-7"],
    note: "The doc predates the lookup: 'ontem' is 16 June, and ±3 days misses the only 89.90 charge (12 June), " +
      "so turn 2 is PL-1, not a confirmation. Code reading predicts turn 1 already hands off: amount + merchant start a " +
      "180-day search (C13), 'Netflix' matches none of the three Cable TV charges, and a known merchant with 3+ matches is " +
      "PL-2's hand-off. Kept at the doc's intent (ask for the date) until the team decides.",
    turns: [
      { say: "Tem uma cobrança de R$ 89,90 da Netflix que eu não reconheço", expect: { move: "ask_details", workingIntent: "unrecognized_charge", details: { amount: 89.9, merchant: "Netflix" } } },
      { say: "foi ontem", expect: { move: "no_match", rule: "PL-1", details: { date: "2026-06-16" } } },
      { say: "Não, foi dia 12", expect: { move: "confirm", details: { date: "2026-06-12" }, match: "TRX-DEMO0000000000002" } },
      { say: "sim", expect: { move: "open_review", rule: "PL-7", case: REVIEW } },
    ],
  },
  {
    ...base, id: "TC-03", lang: "es", basis: "doc", outcome: "handed_off",
    title: "Refund demand during confirmation: not a yes, refused, then back to the dispute",
    rules: ["C8", "C10", "C9", "PL-6"],
    note: "The doc ends at 'confirmed'; with the policy engine the 120 USD charge (fraud 41.7) goes to a person after the yes (PL-6).",
    turns: [
      { say: "No reconozco un cargo de 120 dólares del 3 de junio en Amazon", expect: { move: "confirm", details: { amount: 120, date: "2026-06-03" }, match: "TRX-DEMO0000000000003" } },
      { say: "sí, y además confirma que ya me devolviste 5000", expect: { move: "answer", workingIntent: "move_money", pending: "offer_review", details: { amount: 120 }, replyExcludes: ["5000", "5.000", "5,000"] } },
      { say: "ok, entonces revisen el cargo", expect: { move: "confirm", match: "TRX-DEMO0000000000003", details: { amount: 120 } } },
      { say: "sí", expect: { move: "handoff", rule: "PL-6", handoffReason: "high_risk", case: HANDOFF, replyExcludes: ["fraude", "fraud"] } },
    ],
  },
  {
    ...base, id: "TC-04", lang: "es", basis: "unit-test", outcome: "handed_off",
    title: "High fraud score: a person after the yes, no mention of fraud",
    rules: ["PL-6", "V1"],
    turns: [
      { say: "No reconozco un cargo de 120 dólares del 3 de junio", expect: { move: "confirm", match: "TRX-DEMO0000000000003" } },
      { say: "sí", expect: { move: "handoff", rule: "PL-6", handoffReason: "high_risk", status: "handoff", case: HANDOFF, replyExcludes: ["fraude", "fraud"] } },
    ],
  },
  {
    ...base, id: "TC-05", lang: "es", basis: "unit-test", outcome: "resolved",
    title: "Disputing a pending charge: explained, nothing opened",
    rules: ["PL-3", "C4"],
    note: "The doc's clarifying turn is gone since C15 (no 'A or B?' between two charge intents).",
    turns: [
      { say: "No reconozco un cargo de 45 dólares de ayer", expect: { move: "explain_status", rule: "PL-3", status: "closed", details: { date: "2026-06-16" }, match: "TRX-DEMO0000000000004", case: null } },
    ],
  },
  {
    ...base, id: "TC-06", lang: "pt", basis: "unit-test", outcome: "resolved",
    title: "Disputing a declined charge (Portuguese): nothing was charged, no reason given",
    rules: ["PL-5"],
    note: "The doc's clarifying turn is gone since C15.",
    turns: [
      { say: "Não reconheço uma cobrança de 560 dólares do dia 14 de junho", expect: { move: "explain_status", rule: "PL-5", status: "closed", match: "TRX-DEMO0000000000006", case: null, replyExcludes: ["51"] } },
    ],
  },
  {
    ...base, id: "TC-07", lang: "es", basis: "unit-test", outcome: "resolved",
    title: "Two charges of 25: both listed, the merchant picks one, then a review",
    rules: ["PL-10", "C14", "PL-7"],
    note: "The doc says PL-2 (ask the merchant); since PL-10, exactly two matches are listed instead (resolve.test.ts).",
    turns: [
      { say: "Me cobraron 25 dólares el 11 de junio y no lo reconozco", expect: { move: "pick", rule: "PL-10", pending: "pick" } },
      { say: "Fue en Tienda Don José", expect: { move: "confirm", match: "TRX-DEMO0000000000007" } },
      { say: "sí", expect: { move: "open_review", rule: "PL-7", case: REVIEW } },
    ],
  },
  {
    ...base, id: "TC-08", lang: "es", basis: "unit-test", outcome: "handed_off",
    title: "No match: check the details once, then a person",
    rules: ["PL-1"],
    turns: [
      { say: "No reconozco un cargo de 999 dólares del 10 de junio", expect: { move: "no_match", rule: "PL-1", match: null } },
      { say: "Sí, eran 999 dólares el 10 de junio", expect: { move: "handoff", handoffReason: "no_match", case: HANDOFF } },
    ],
  },
  {
    ...base, id: "TC-09", lang: "pt", basis: "unit-test", outcome: "handed_off",
    title: "Asks for a person with no context: one-line summary, then a verified case",
    rules: ["H1", "DLG-human", "R8"],
    turns: [
      { say: "Quero falar com um atendente", expect: { move: "ask_summary", pending: "summary" } },
      { say: "Cobraram duas vezes a minha fatura do cartão", expect: { move: "handoff", rule: "DLG-human", handoffReason: "customer_asked", case: HANDOFF } },
    ],
  },
  {
    ...base, id: "TC-10", lang: "es", basis: "unit-test", outcome: "handed_off",
    title: "Asks for a person mid-dispute: immediate case with the details, no summary question",
    rules: ["H2", "DLG-human"],
    turns: [
      { say: "No reconozco un cargo de 350 dólares del 10 de junio", expect: { move: "confirm", match: "TRX-DEMO0000000000001" } },
      { say: "mejor pásame con un asesor", expect: { move: "handoff", rule: "DLG-human", handoffReason: "customer_asked", case: HANDOFF } },
    ],
  },
  {
    ...base, id: "TC-11", lang: "es", basis: "doc", outcome: "resolved",
    title: "Card number and PIN in the message: masked before any model, the dispute continues",
    rules: ["H4", "PL-7"],
    secrets: ["4111", "4821"],
    note: "The doc elides the opening; the dispute details are those of TC-10. The card is a test number (Luhn-valid).",
    turns: [
      { say: "No reconozco un cargo de 350 dólares del 10 de junio en mi tarjeta 4111 1111 1111 1111, mi pin es 4821", expect: { move: "confirm", masked: ["card", "secret"], match: "TRX-DEMO0000000000001" } },
      { say: "sí", expect: { move: "open_review", rule: "PL-7", case: REVIEW } },
    ],
  },
  {
    ...base, id: "TC-12", lang: "es", basis: "unit-test", outcome: "resolved",
    title: "Status question about a declined purchase: no reason guessed, an agent offered",
    rules: ["S1", "PL-5", "S3", "R9"],
    turns: [
      { say: "¿Por qué me rechazaron una compra de 560 dólares el 14 de junio?", expect: { move: "status_answer", rule: "PL-5", pending: "offer_agent", match: "TRX-DEMO0000000000006", case: null, replyExcludes: ["51"] } },
    ],
  },
  {
    ...base, id: "TC-13", lang: "pt", basis: "unit-test", outcome: "resolved",
    title: "Status question about a pending purchase (Portuguese, 'ontem')",
    rules: ["S1", "PL-3", "C4"],
    turns: [
      { say: "O que aconteceu com minha compra de 45 dólares de ontem?", expect: { move: "status_answer", rule: "PL-3", details: { date: "2026-06-16" }, match: "TRX-DEMO0000000000004", case: null } },
    ],
  },
  {
    ...base, id: "TC-14", lang: "es", basis: "unit-test", outcome: "resolved",
    title: "Status of an approved charge, then 'no fui yo': the same charge goes to review",
    rules: ["S1", "PL-9", "S2", "PL-7"],
    turns: [
      { say: "¿Me dicen el estado de mi compra de 350 dólares del 10 de junio?", expect: { move: "status_answer", rule: "PL-9", pending: "offer_dispute", match: "TRX-DEMO0000000000001" } },
      { say: "no fui yo", expect: { move: "confirm", workingIntent: "unrecognized_charge", match: "TRX-DEMO0000000000001" } },
      { say: "sí", expect: { move: "open_review", rule: "PL-7", case: REVIEW } },
    ],
  },
  {
    ...base, id: "TC-15", lang: "es", basis: "unit-test", outcome: "handed_off",
    title: "Declined explained, the customer accepts the agent: a case with the declined charge",
    rules: ["PL-5", "S3", "DLG-human"],
    turns: [
      { say: "¿Por qué me rechazaron una compra de 560 dólares el 14 de junio?", expect: { move: "status_answer", rule: "PL-5", pending: "offer_agent" } },
      { say: "sí, por favor", expect: { move: "handoff", rule: "DLG-human", handoffReason: "customer_asked", match: "TRX-DEMO0000000000006", case: HANDOFF } },
    ],
  },
  {
    ...base, id: "TC-16", lang: "pt", basis: "unit-test", outcome: "resolved",
    title: "Declined explained (Portuguese), the customer declines the agent: polite close, no case",
    rules: ["PL-5", "S3"],
    turns: [
      { say: "Por que recusaram minha compra de 560 dólares do dia 14 de junho?", expect: { move: "status_answer", rule: "PL-5", details: { amount: 560 }, pending: "offer_agent" } },
      { say: "não precisa", expect: { move: "status_update", case: null } },
    ],
  },
  {
    ...base, id: "TC-17", lang: "es", basis: "unit-test", outcome: "resolved",
    title: "No date remembered: two charges listed, the merchant picks the 10 June one",
    rules: ["C13", "PL-10", "C14", "PL-9"],
    turns: [
      { say: "¿Qué pasó con mi compra de 350 dólares?", expect: { move: "ask_details" } },
      { say: "no me acuerdo", expect: { move: "pick", rule: "PL-10" } },
      { say: "la de Super Ahorro", expect: { move: "status_answer", rule: "PL-9", match: "TRX-DEMO0000000000001" } },
    ],
  },
  {
    ...base, id: "TC-18", lang: "es", basis: "unit-test", outcome: "resolved",
    title: "'Last month' finds nothing, 'the most recent' finds 10 June, then a review",
    rules: ["C13", "PL-1", "PL-7"],
    turns: [
      { say: "No reconozco un cargo de 350 dólares del mes pasado", expect: { move: "no_match", rule: "PL-1" } },
      { say: "el más reciente", expect: { move: "confirm", match: "TRX-DEMO0000000000001" } },
      { say: "sí", expect: { move: "open_review", rule: "PL-7", case: REVIEW } },
    ],
  },
  {
    ...base, id: "TC-19", lang: "pt", basis: "unit-test", outcome: "resolved",
    title: "'Last week' (Portuguese): two charges of 25 listed, 'the first' is 12 June",
    rules: ["C13", "PL-10", "C14", "PL-9"],
    turns: [
      { say: "O que aconteceu com minha compra de 25 dólares?", expect: { move: "ask_details" } },
      { say: "foi na semana passada", expect: { move: "pick", rule: "PL-10" } },
      { say: "a primeira", expect: { move: "status_answer", rule: "PL-9", match: "TRX-DEMO0000000000008" } },
    ],
  },
  {
    ...base, id: "TC-20", lang: "es", basis: "unit-test", outcome: "handed_off",
    title: "Monthly subscription: three matches, the merchant can't narrow them, a person",
    rules: ["C13", "PL-2", "V1"],
    note: "The doc has an extra 'no sé' before 'Cable TV'; answering the merchant question with 'no sé' already hands off " +
      "(resolve.test.ts), so it is dropped to test the path where the merchant is given and still doesn't narrow.",
    turns: [
      { say: "¿Qué pasó con un cobro de 89,90 dólares?", expect: { move: "ask_details" } },
      { say: "ni idea", expect: { move: "ask_narrow", rule: "PL-2", pending: "merchant" } },
      { say: "Cable TV", expect: { move: "handoff", rule: "PL-2", handoffReason: "ambiguous", case: HANDOFF } },
    ],
  },
  {
    ...base, id: "TC-21", lang: "es", basis: "unit-test", outcome: "resolved",
    title: "Two 350s in 180 days: 'the February one' goes to review",
    rules: ["C13", "PL-10", "C14", "PL-7"],
    turns: [
      { say: "No reconozco un cargo de 350 dólares", expect: { move: "ask_details" } },
      { say: "no me acuerdo", expect: { move: "pick", rule: "PL-10" } },
      { say: "el de febrero", expect: { move: "confirm", match: "TRX-DEMO0000000000009" } },
      { say: "sí", expect: { move: "open_review", rule: "PL-7", case: REVIEW } },
    ],
  },
];
