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
