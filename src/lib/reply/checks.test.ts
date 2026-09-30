// Reply checks (docs/handoff.md R8). Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timingPromise, unbackedOffer } from "./checks";

describe("timingPromise (R8)", () => {
  it("catches the promises Haiku actually made", () => {
    assert.equal(timingPromise("te paso con un asesor ahora mismo."), "ahora mismo");
    assert.equal(timingPromise("vou conectá-lo com um agente em breve!"), "em breve");
    assert.equal(timingPromise("¡Enseguida te atenderá!"), "Enseguida");
  });
  it("lets the fixed templates through (including Portuguese 'Pronto' = 'Done')", () => {
    assert.equal(timingPromise("Pronto, um atendente vai continuar com o seu caso."), null);
    assert.equal(timingPromise("Listo, un asesor continuará con tu caso con lo que ya me contaste."), null);
  });
});

describe("every fixed template passes the reply checks", () => {
  it("no template promises timing, in any move or language", async () => {
    const { planReply } = await import("./templates");
    const moves = ["ask_clarify", "ask_details", "confirm", "ask_correction", "confirmed", "status_update", "answer", "handoff",
      "no_match", "ask_narrow", "explain_status", "open_review", "record_failed", "ask_summary", "lookup_status", "status_answer"] as const;
    const reasons = ["customer_asked", "repeated_clarification", "no_match", "ambiguous", "high_risk", "record_unavailable", "tool_failure"] as const;
    const match = { date: "2026-06-10", amount: 350, currency: "USD", merchant: "Super Ahorro" };
    for (const move of moves) for (const handoffReason of reasons) for (const warnSensitive of [false, true]) {
      const plan = planReply({
        move, intent: "unrecognized_charge", clarifyOptions: ["unrecognized_charge", "wrongful_fee"], clarifyAttempts: 0,
        details: { amount: 350, expectedAmount: null, currency: "USD", date: "2026-06-10", merchant: null }, missing: ["date"],
        match, explainRule: move === "status_answer" ? "PL-9" : "PL-3", handoffReason, status: "review", caseRef: "GT-ABCDEFGH", warnSensitive,
      }, "es");
      for (const lang of ["es", "pt"] as const) {
        assert.equal(timingPromise(plan.templates[lang]), null, `${move}/${handoffReason}/${lang}`);
        if (plan.explainOnly) assert.equal(unbackedOffer(plan.templates[lang]), null, `offer in ${move}/${lang}`);
      }
    }
  });
});

describe("unbackedOffer (R9)", () => {
  it("catches the offer Haiku actually added to a decline explanation", () => {
    assert.equal(unbackedOffer("no tengo los detalles, pero podemos investigarlo juntos si lo necesitas."), "investigarlo");
    assert.equal(unbackedOffer("Posso analisar isso para você."), "analisar");
  });
  it("lets a plain explanation through", () => {
    assert.equal(unbackedOffer("Encontré un cargo de 560 USD: fue rechazado, así que no se cobró."), null);
  });
});


describe("explain-only templates pass R9", () => {
  it("pending / reversed / declined status answers offer nothing", async () => {
    const { planReply } = await import("./templates");
    for (const explainRule of ["PL-3", "PL-4", "PL-5"] as const) {
      const plan = planReply({
        move: "status_answer", intent: "transaction_status", clarifyOptions: null, clarifyAttempts: 0,
        details: { amount: 560, expectedAmount: null, currency: "USD", date: "2026-06-14", merchant: null }, missing: [],
        match: { date: "2026-06-14", amount: 560, currency: "USD", merchant: "Empresa Telefónica" }, explainRule,
        handoffReason: null, status: "closed", caseRef: null, warnSensitive: false,
      }, "es");
      assert.equal(plan.explainOnly, true);
      for (const lang of ["es", "pt"] as const) assert.equal(unbackedOffer(plan.templates[lang]), null, `${explainRule}/${lang}`);
    }
  });
});
