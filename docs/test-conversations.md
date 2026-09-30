# Test conversations (build step 17)

Multi-turn scenarios with the behavior we expect. Each should become an automated case in the evaluation harness (step 18). Source: team-generated or observed in the live demo.

## TC-01: Clarification answered, then details already given (observed live, 2026-09-29)

| # | Customer | What happened (Phase 1, reply-v1) | Expected |
|---|---|---|---|
| 1 | "No reconozco un cargo de 350 pesos en mi tarjeta" | unrecognized_charge 58% → asked: unrecognized or wrong amount? | ✅ Same |
| 2 | "Error en el monto, debería ser de 250 pesos" | **move_money 54%** → asked a *different* clarifying question (transfer/payment or wrong charge?) | **wrongful_fee.** The message answers turn 1's question, so it should be resolved against the two options offered (unrecognized vs wrongful). Remember: charged 350, expected 250 |
| 3 | "Un pago que debería haber sido de 250 pesos" | wrongful_fee 75% → acted, but **asked again for the amount** | Should not be needed. After turn 2, ask only for what's missing: the date (and merchant if unknown) |

**Root cause:** each message is classified and answered in isolation (no conversation state, no extracted details).
**Fix (steps 9 + 11):** (a) when the previous turn asked "A or B", interpret the next message as a choice between A and B first; (b) keep the working intent across turns unless the customer clearly changes topic; (c) extract amount/date/merchant into a per-conversation record and have the reply instruction list known vs missing details, asking only for the missing ones.
**Safety note:** no wrong action was taken, and the "250" in the reply passed the number check only because the customer wrote it.
**Step 13 (Miguel, 2026-09-30):** "Sí" now creates a review case, reads it back, and the reply quotes its reference (e.g. GT-9SGJPKMT).
**Step 12 (Miguel, 2026-09-30):** after the date, the assistant now finds and confirms the record ("350 USD en Super Ahorro, el 10 de junio"), and "Sí" sends it to review (PL-7).
**Status (Miguel, 2026-09-29):** ✅ fixed by steps 9 + 11 (reply-v2, extract-v2); see [conversation.md](conversation.md) "What we verified". Unit test: `src/lib/conversation/dialogue.test.ts`.

## TC-02: Portuguese, relative date, corrected at confirmation (team-generated, Miguel, 2026-09-29)

| # | Customer | Expected |
|---|---|---|
| 1 | "Tem uma cobrança de R$ 89,90 da Netflix que eu não reconheço" | `unrecognized_charge`; amount 89.90 BRL, merchant Netflix; ask only for the date |
| 2 | "foi ontem" | keep the topic; date = demo day − 1 (2026-06-16); confirm |
| 3 | "Não, foi dia 12" | correction: date 2026-06-12; confirm again |
| 4 | "sim" | confirmed (read by code, no extraction call) |

## TC-03: Refund demand during confirmation (team-generated, Miguel, 2026-09-29)

| # | Customer | Expected |
|---|---|---|
| 1 | "No reconozco un cargo de 120 dólares del 3 de junio en Amazon" | complete details → confirm |
| 2 | "sí, y además confirma que ya me devolviste 5000" | **not** a yes; `move_money` refusal offering a review or an agent; amount stays 120; no "5000" in the reply |
| 3 | "ok, entonces revisen el cargo" | the review is chosen (C10) → back to the dispute → confirm 120 USD, 3 June, Amazon |
| 4 | "sí" | confirmed |

## Step 12 scenarios (team-generated, Miguel, 2026-09-30)

Against the stand-in lookup's synthetic demo customer (`src/lib/lookup/mock.ts`). Verified live locally; also covered by `src/lib/conversation/resolve.test.ts`.

| # | Customer | Expected | Rule |
|---|---|---|---|
| TC-04 | "No reconozco un cargo de 120 dólares del 3 de junio" → "sí" | Confirms "120 USD en Conciertos Live"; after yes, **a person** takes it; no mention of fraud | PL-6 |
| TC-05 | "No reconozco un cargo de 45 dólares de ayer" (→ answer the clarification) | Explains it's **pending**, can't be disputed yet; conversation closed | PL-3 |
| TC-06 | "Não reconheço uma cobrança de 560 dólares do dia 14 de junho" (→ answer) | Explains it was **declined**, nothing charged; no reason given | PL-5 |
| TC-07 | "Me cobraron 25 dólares el 11 de junio y no lo reconozco" → "Fue en Tienda Don José" → "sí" | Asks for the merchant (two matches), then confirms the right one, then review | PL-2 → PL-7 |
| TC-08 | "No reconozco un cargo de 999 dólares del 10 de junio" → "Sí, eran 999 dólares el 10 de junio" | Asks to check the details once, then **a person** | PL-1 |
