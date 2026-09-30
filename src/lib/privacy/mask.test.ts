// Masking tests (docs/handoff.md H4). Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskSensitive } from "./mask";

describe("maskSensitive", () => {
  it("masks a card number (Luhn-valid), with or without spaces, keeping the last 4", () => {
    assert.deepEqual(maskSensitive("mi tarjeta 4111 1111 1111 1111 tiene un cargo"), { text: "mi tarjeta ****1111 tiene un cargo", masked: ["card"] });
    assert.equal(maskSensitive("5500-0000-0000-0004").text, "****0004");
  });
  it("masks an 18-digit CLABE account number", () => {
    assert.equal(maskSensitive("mi CLABE 012180001234567891").text, "mi CLABE ****7891");
  });
  it("leaves amounts, dates and short numbers alone", () => {
    const t = "Me cobraron 1.250,00 pesos el 10/06/2026, referencia 123456";
    assert.deepEqual(maskSensitive(t), { text: t, masked: [] });
  });
  it("leaves a long number that isn't a valid card alone", () => {
    assert.equal(maskSensitive("folio 1234567890123").text, "folio 1234567890123");
  });
  it("masks PINs, CVVs and passwords in Spanish and Portuguese", () => {
    assert.equal(maskSensitive("mi pin es 4821").text, "mi pin es [oculto]");
    assert.equal(maskSensitive("el CVV: 123").text, "el CVV: [oculto]");
    assert.equal(maskSensitive("minha senha é abc987").text, "minha senha é [oculto]");
    assert.deepEqual(maskSensitive("mi pin es 4821").masked, ["secret"]);
  });
  it("masks emails", () => {
    assert.equal(maskSensitive("escríbanme a ana.perez+1@correo.com.mx").text, "escríbanme a [email]");
  });
});
