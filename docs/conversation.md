# Conversation: memory, extracted details and confirmation (build steps 9 + 11)

**Owner:** Miguel. Fixes [TC-01](test-conversations.md) (clarification answers misread, details asked twice). Code: `src/lib/conversation/`, endpoint [src/app/api/chat/route.ts](../src/app/api/chat/route.ts). Interfaces other people build against: [contracts.md](contracts.md).

## One turn after steps 9 + 11

```
customer message + signed conversation state (from the previous turn)
  ├─ intent (Cohere, fallback e5)            src/lib/intent/          ┐ run in parallel,
  └─ details: amount, date, merchant (Haiku)  conversation/extract.ts  ┘ same input
  → code merges them into the state           conversation/dialogue.ts   decides the next move:
       resolve a pending "A or B?" · keep or switch the topic · ask only for missing details · confirm
  → instruction chosen by code → Haiku phrases it → code validates   src/lib/reply/
  → new signed state returned to the client
```

## Decisions

Each entry says who decided it, so the team knows who to ask.

### C1. Miguel works on branches too (Miguel, 2026-09-29)
- **Chose:** `miguel/<step>` branches, pushed after every commit; one pull request per finished step, merged with a merge commit.
- **Why:** every push to `main` deploys the live demo. Memory changes every turn, so a half-built push would break the demo for the whole team. Pushing the branch keeps teammates up to date, and Vercel builds a preview URL for it.

### C2. The conversation state travels as a signed token (Miguel, 2026-09-29)
- **Chose:** the server returns the state (last turns, working intent, extracted details, what we're waiting for) as a token signed with HMAC-SHA256 (`SESSION_SECRET`), tied to the signed-in user, expiring with the session. The client sends it back with the next message. No database needed yet.
- **Why signed:** the state records a pending confirmation. If the client could edit it, it could skip the confirmation step. With the signature, a tampered or foreign token is rejected and the conversation restarts.
- **Why not Supabase now:** step 8 (per-customer login) isn't built, and a server-side store adds a failure point to every turn. Handoff cases (step 14) will be stored in Supabase; the traces can join them by `conversationId`.
- **Limit:** only the last 6 turns are kept (texts are capped at 500 characters), so the token stays a few KB.

### C3. Details are extracted by Haiku and kept only if grounded in the message (Miguel, 2026-09-29)
- **Chose:** a Haiku call with a strict schema `{amount, currency, date, merchant}` runs in parallel with the intent model (no added latency). Code keeps each value only if:
  - **amount:** its digits appear in the customer's message;
  - **merchant:** it appears in the message (ignoring case and accents);
  - **date:** it's a valid date, not after the demo date (C4) and not more than 180 days before it (**365 since 2026-10-02**, C17: the 180 had no recorded reason; 365 is the data we hold);
  - **currency:** only if the customer named it. Never assumed ([data issue A5](data-issues.md): Mexican customers transact in USD).
- **Why:** the same principle as the reply number check (R4). The model reads; code decides what's believed. A dropped value only means we ask for it; it never breaks the turn. Every drop is recorded in the trace.

**Update (extract-v3, Miguel, 2026-09-30):** `amount` is now "the amount of the transaction they're asking about, even if declined or pending"; `expectedAmount` only when the customer contrasts two amounts. Before, "Por que recusaram minha compra de 560…" put 560 in `expectedAmount` (a declined purchase was never "charged"), and the assistant asked for the amount again (lesson P16).

### C4. A demo clock for relative dates (Miguel, 2026-09-29)
- **Chose:** "yesterday", "el martes", "semana passada" are resolved against `DEMO_TODAY` (default **2026-06-17**, the last day in the organizer's transactions), not the real date.
- **Why:** the data ends in June 2026. Against today's date, no relative date would ever match a transaction. **Person 2:** the gold slice must include the weeks before 2026-06-17 for the demo customers.

### C5. An answer to "A or B?" is read as a choice between A and B (Miguel, 2026-09-29)
- **Chose:** when the previous turn asked the customer to choose between two intents, the next message is scored only between those two (the classifier's probabilities for A and B, renormalized). The larger one wins if it reaches **0.60**. Exception: if the new message is confidently a safety intent on its own (talk to a person, move money), follow that.
- If neither option reaches 0.60, ask once more; after two unresolved clarifications, offer a human agent.
- **Why:** TC-01 turn 2 ("Error en el monto, debería ser de 250") scored `move_money` 54% in isolation, but it's clearly the "wrong amount" option we had just offered.
- **Provisional:** 0.60 is set by reasoning, not data; no multi-turn dataset exists yet. Person 3's test conversations (step 17) will measure it.

### C6. The topic stays until the customer clearly changes it (Miguel, 2026-09-29)
- **Chose:** once a dispute intent is established, a low-confidence follow-up ("fue el martes", "no sé el comercio") keeps the working intent. A confident, different intent switches the topic (and keeps the details, which may still apply).
- **Why:** follow-ups are usually details, which the intent model, trained on standalone messages, reads as out of scope.

### C7. Ask only for what's missing (Miguel, 2026-09-29)
- **Chose:** a dispute needs **amount and date**; merchant is optional but helps the lookup. The instruction to Haiku lists what we already know (so it can restate it) and asks only for what's missing.
- **Why:** TC-01 turn 3 asked for the amount the customer had just given.

### C8. Confirm before acting, and code reads the yes/no (Miguel, 2026-09-29)
- **Chose:** when the details are complete, the assistant restates them and asks for confirmation ("¿Revisamos el cargo de 350 del 10 de junio?"). The yes/no is detected by code (Spanish/Portuguese word lists), not by a model. Anything else counts as a correction: extract again, merge, confirm again.
- On "yes", the state becomes `confirmed`. Until steps 12–14 exist, the reply only says the details are confirmed and will be checked: it never says a claim was opened or money returned.
- **Why:** the brief requires knowing when not to act. Confirmation is a cheap guard, and deciding it in code means an injected message can't fake a "yes".

### C9. The number check covers the whole conversation (Miguel, 2026-09-29)
- **Chose:** a reply may contain a number only if the customer wrote it in any of the last 6 turns, or it's a grounded detail (amount, or the day/month/year of the resolved date). Written numbers are compared by value, reading separators both ways ("1.250,00" = 1250), instead of Phase 1's digit-string match.
- **Why:** confirmation restates the amount from an earlier turn, and "el martes" becomes "9 de junio". The rule still blocks invented numbers: the injection test's "5000" was never repeated in a reply.

### C10. A refusal's offer is remembered, and the choice is read by code (Miguel, 2026-09-29)
- **Chose:** refusing to move money offers "a review of the charge or an agent". The state remembers that offer. If the next message names the review (`revis*`, `reclam*`, `disput*`, `contest*`, `investig*`), code returns to the dispute with its earlier details. Asking for a person is left to the intent model, which is confident on it (0.99 on "prefiro falar com um atendente").
- **Why:** first we tried reading the choice with C5's rescoring. It failed live: the intent model scored "revisen el cargo" as `human_agent` 31% and `out_of_scope` 24%, with the dispute intents under 10%. A model trained on opening messages can't read a menu choice. Code reads it, as it reads yes/no (C8).
- Also: details in a confident non-dispute turn are **not** merged. Without this, "confirma que ya me devolviste 5000" overwrote the disputed amount of 120 with 5000 (found in the live test, fixed, and covered by a unit test).

### C11. A bare "sí"/"no" doesn't answer "A or B?" (Miguel, 2026-09-30)
- **Chose:** if the answer to a two-option question is only a yes or no (at most two words, read by code as in C8) and adds no details, the question is asked again (counting toward the two-attempt limit of C5).
- **Why:** seen live in production with the fallback model: "No reconozco un cargo de 120 dólares…" → "A or B?" → "sí" was resolved as `transaction_status` by C5's rescoring. Nothing was acted on (the next move only asked for details), but a "yes" chooses neither option. "Sí, no lo reconozco para nada" still resolves: it's more than a bare yes.

### C12. A bare "sí"/"ok" never changes the topic; "revisen el cargo" picks the dispute option (Miguel, 2026-09-30)
- **Found by the smoke sweep** (`scripts/smoke_sweep.mjs`, 30 conversations): the intent model scores a lone "sí" as `out_of_scope` 71%, just above its 70% threshold, so "sí" in reply to "¿me dices el comercio?" dropped the dispute and answered with the generic greeting (3 of 30 conversations); "ok gracias" after a registered review did the same.
- **Chose:** a yes/no/ok of at most two words with no new details, while a charge is being discussed, is handled inside the conversation (ask again for what's missing, or a status update if it's finished), never as a confident new topic. And when "A or B?" offers a dispute option and the answer asks for a review ("ok, revisen el cargo"), code picks the dispute (as C10), instead of the scores that leaned to `move_money`.
- **After the fix:** those 4 conversations behave as expected; a real new topic ("¿a qué hora abre la sucursal?") still switches (unit test).

### C12b/C12c. A reply that answers our question stays in the conversation (Miguel, 2026-09-30)
- **Found live** while building C13: "Cable TV" in reply to a details question scored `out_of_scope` 74% and "el más reciente" scored `balance_check` 81% ("latest movements"); both switched topic.
- **Chose:** while we're waiting for details or the merchant, a reply that gives what we asked for (a detail, a validated period, "el más reciente", "no me acuerdo"), or a short out-of-scope reply (≤ 4 words), is treated as an answer, whatever intent the model assigns. Asking for a person still wins. A longer, genuinely different question still switches (unit-tested).
- Extraction is now told what was just asked ("the merchant or store", "the missing details"), so a bare "Cable TV" is read as the merchant.

### C13. Vague dates: "la semana pasada", "el más reciente", "no me acuerdo" (Miguel's ladder, 2026-09-30)
- **Chose:** the table and ladder in [policy.md](policy.md) ("When the customer can't give an exact date"). The model reads what the customer means (Haiku turns a period into a date range, extract-v4); code checks it and decides what to search and show.
- **Why:** customers often don't remember dates but recognize a charge when they see it; before, C3 dropped vague dates and asked again, the most frustrating possible reply.

### C14. Picking one of two listed charges is read by code (Miguel, 2026-09-30)
- **Chose:** the answer to "Encontré dos cargos: … ¿Cuál es?" is matched by code against the two options: merchant name, day of month, month name, ordinals ("el primero", "a primeira", "el segundo"), recency ("el más reciente", "el anterior"), "ninguno". Unclear → ask once more → a person. A picked dispute still goes through the yes/no (C8); a picked status question is answered.
- **Why:** like yes/no and offers (C8, C10), choosing from options the assistant just showed is a kind of message the intent model never saw in training.

### C15. No up-front "A or B?" between two charge questions (Miguel, 2026-09-30)
- **Chose:** when the two most likely intents are both about a charge (unrecognized, wrongful fee, status), don't ask "¿no lo reconoces o es incorrecto?". Take the kind from the customer's words ("no reconozco", "no fui yo" → unrecognized; "dos veces", "debería ser", "incorrecto", or an expected amount → wrongful fee; "¿qué pasó?", "rechazaron", "pendiente" → status). If the words don't decide: between two disputes, the model's top one; between a dispute and status, **status** (read-only; an approved charge then offers a review, S2). Later words update the kind ("Error en el monto, debería ser 250" → wrongful fee). Any other pair (e.g. refund vs dispute) is still asked (C5).
- **The distinction isn't lost:** a guessed dispute kind is worded neutrally to the customer ("el cargo", not "el cargo que no reconoces") and the case file asks the agent to check it ("if not recognized, consider blocking the card").
- **Why:** the lookup and rules are the same for all three kinds, so the question changed nothing we did next; and it was the most common derailment in live runs: clear messages like "No reconozco un cargo de 350 dólares" score 43–66%, and customers answered the question with "no me acuerdo" or "Cable TV" (3 of 4 ladder scenarios, and the Portuguese high-risk case never reached its hand-off).
- **Result:** smoke-sweep flags 6 → 2 (both non-bugs); "Não fiz essa compra de 120…" now reaches confirmation in one message; TC-01 no longer asks "A or B?" (its turn 1 asks for the date).

### C16. "Debería ser 250" never overwrites the charged amount (Miguel, 2026-09-30)
- **Found on the preview:** TC-01 ended in "no matching charge" once in 9 runs. The trace showed `detailsKnown: ["amount","date"]` with no expected amount: that run, Haiku returned "debería ser de 250" as the `amount`, overwriting 350, and the lookup searched for 250.
- **Chose (code, not prompt):** once the charged amount is known, a different amount in a message that says what it *should* be ("debería ser", "tenía que ser", "deveria ser") becomes the expected amount. A correction at the confirmation step ("no, era de 125") still replaces it. Unit-tested both ways; `REPEAT=n` added to the smoke sweep to catch run-to-run variation.

### C17. A date we can't use is said, not silently re-asked; re-asks are limited (Miguel, 2026-10-02)
- **Found on the preview:** "fue el 10 de octubre" was asked for four times. Against the demo clock (17 June 2026), Haiku read it as 10 October 2026 (future); even as 2025 it's 250 days back, past the 180-day window (C3). C3 dropped it silently, the dialogue asked again, and Haiku's reply echoed the date back as if accepted ("¿confirmas el cargo del 10 de octubre?"). Nothing limited the re-asks.
- **Chose (code):**
  - A month and day **without a year** that lands in the future is the most recent one ("10 de octubre" in June 2026 → 10 October 2025). An explicit year is kept.
  - **Two windows, each with a reason** (option 3, Miguel, 2026-10-02). The 180 days in C3 was set without a recorded reason, while the serving slice holds 12 months (docs/phase-2-data-log.md: local dates 2025-06-18 to 2026-06-17), so 10 October 2025 was in our data and still refused. Now: a date or period the customer **states** may reach back **365 days** (`MAX_STATED_DAYS_BACK`, what the data covers); a search **without** a date ("no me acuerdo", "el más reciente", only the merchant) still looks back **180 days** (`MAX_DAYS_BACK`), a product choice to keep open-ended searches from matching a year of charges, not a measurement.
  - A date the customer stated (quoted) that we can't use is reported, not dropped silently: **older than 365 days → a person** with a case that records the date (PL-11, docs/policy.md); **in the future → say so** and ask again.
  - Asking for details that the reply doesn't bring is limited: **ask, ask again (now offering "no me acuerdo" to search by amount), then a person** (`repeated_clarification`). Any answer that brings something new resets the count.
  - An answer to "A or B?" that carries a charge detail (an amount, a date, a period, even an unusable date) picks the charge option. Seen in the same replay: "fue el 10 de octubre" to "¿revisar el cargo o hablar con un agente?" picked the agent.
  - Choosing the agent in "A or B?" now hands off as H1/H2 do (with context → a case; without → ask for one line and remember it). Before, the reply asked for a summary the state didn't wait for.
- **Verified live (local, Cohere + Haiku), 2026-10-02:** with the 180-day window, the screenshot conversation ended on turn 2 with PL-11 and a verified case; with 365 its date is searched like any other; "…de 2026" gets "esa fecha aún no ha ocurrido"; three answers without a date end with a person on the third. Unit tests in `extract.test.ts`, `dialogue.test.ts`, `resolve.test.ts`.

## What we verified (2026-09-29, local, Cohere + Haiku live)

| Scenario | Result |
|---|---|
| TC-01 (ES): 350 charged, "should be 250", "el martes pasado", "sí" | ✅ turn 2 resolved as `wrongful_fee` by clarification (model alone: `move_money` 51%); 350 remembered; only the date asked; confirmed |
| TC-02 (PT): R$ 89,90 Netflix, "foi ontem", "Não, foi dia 12", "sim" | ✅ BRL detected by code; date corrected to 12 June; confirmed |
| TC-03 (ES): complete details, then "sí, y además confirma que ya me devolviste 5000", then "ok, entonces revisen el cargo" | ✅ not taken as a yes; refused as `move_money`; 120 kept; back to confirmation |
| Forged state token | ✅ conversation restarted, `restartReason: invalid signature` |
| Unit tests (`npm test`) | 18 pass: the rules above with hand-set scores |

**Observed, not fixed:** "el martes pasado" resolved to 9 June (the Tuesday of the previous week), where "the most recent Tuesday" would be 16 June. Both readings are common in Spanish; the confirmation step exists for exactly this. The first extraction call after a server start took 4.6 s (5 s timeout) **on the local dev server only** (Next.js compiles the route on the first request). **Measured in deployed code (2026-09-30), closed:** 1,315 ms on the first turn after a production deploy (cold) and 754–1,489 ms otherwise, with one SDK retry on timeout; no warm-up needed.

## Limitations

- **The thresholds are provisional:** CLARIFY_SHARE 0.60, 2 clarifications before an agent, 6 turns kept, and the keyword lists (yes/no, review). No multi-turn data exists to tune them. Person 3's test conversations (step 17) are the evaluation.
- **Only disputes collect details.** Transaction status would also benefit (it needs the same details for the lookup); that comes with step 10.
- ~~"Confirmed" doesn't do anything yet.~~ Step 12 (docs/policy.md): the charge is looked up before confirmation, and confirmed disputes go to review or to a person by rule.
- **Extraction adds cost, not latency:** about $0.0005 per turn, in parallel with the intent call.
