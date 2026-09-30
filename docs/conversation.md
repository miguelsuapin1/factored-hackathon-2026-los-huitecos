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
  - **date:** it's a valid date, not after the demo date (C4) and not more than 180 days before it;
  - **currency:** only if the customer named it. Never assumed ([data issue A5](data-issues.md): Mexican customers transact in USD).
- **Why:** the same principle as the reply number check (R4). The model reads; code decides what's believed. A dropped value only means we ask for it; it never breaks the turn. Every drop is recorded in the trace.

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
- **Chose:** a reply may contain a number only if the customer wrote it in any turn of this conversation (not just the current message).
- **Why:** confirmation restates the amount from an earlier turn. The rule still blocks invented numbers.
