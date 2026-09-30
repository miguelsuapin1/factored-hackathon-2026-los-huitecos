// Masking tests (docs/handoff.md H4). Run: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskSensitive } from "./mask";

describe("maskSensitive", () => {
  it("masks a card number (Luhn-valid), with or without spaces, keeping the last 4", () => {
    assert.deepEqual(maskSensitive("mi tarjeta 4111 1111 1111 1111 tiene un cargo"), { text: "mi tarjeta ****1111 tiene un cargo", masked: ["card"] });
    assert.equal(maskSensitive("5500-0000-0000-0004").text, "****0004");
  });
  it("masks a card number followed or preceded by punctuation (found live on the preview: '…1111, mi pin')", () => {
    assert.equal(maskSensitive("en mi tarjeta 4111 1111 1111 1111, mi pin es 4821").text, "en mi tarjeta ****1111, mi pin es [oculto]");
    assert.equal(maskSensitive("tarjeta: 4111111111111111.").text, "tarjeta: ****1111.");
    assert.equal(maskSensitive("(4111-1111-1111-1111)").text, "(****1111)");
    assert.deepEqual(maskSensitive("4111 1111 1111 1111, pin 4821").masked.sort(), ["card", "secret"]);
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
  it("H5: masks national IDs in unmistakable formats", () => {
    assert.equal(maskSensitive("mi CURP es GODE561231HDFRRN09").text, "mi CURP es [documento]");
    assert.equal(maskSensitive("RFC GODE561231AB3 para la factura").text, "RFC [documento] para la factura");
    assert.equal(maskSensitive("meu CPF é 529.982.247-25").text, "meu CPF é [documento]");
    assert.equal(maskSensitive("CUIL 20-30123456-7").text, "CUIL [documento]");
    assert.equal(maskSensitive("no reconozco un cargo, mi DNI es 30123456").text, "no reconozco un cargo, mi DNI es [documento]");
    assert.equal(maskSensitive("cédula 1020304050").text, "cédula [documento]");
  });
  it("H5: masks phones with a country code or after their label", () => {
    assert.equal(maskSensitive("llámame al +52 55 1234 5678").text, "llámame al [teléfono]");
    assert.equal(maskSensitive("meu celular: 11 98765-4321").text, "meu celular: [teléfono]");
    assert.deepEqual(maskSensitive("whatsapp 3001234567").masked, ["phone"]);
  });
  it("H5: leaves amounts, dates, references and bare numbers alone", () => {
    for (const t of [
      "Me cobraron 1.250,00 pesos el 10/06/2026",
      "referencia 123456789, folio 30123456",
      "cobraram R$ 1.234.567,89 na fatura",
      "el cargo TRX-7I07NJ7LT0TPC5YC33UL",
      "un número 529.982.247-24 que no es un CPF válido",
    ]) assert.deepEqual(maskSensitive(t), { text: t, masked: [] }, t);
  });
});
