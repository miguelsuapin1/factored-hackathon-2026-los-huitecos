# Structured hand-off and sensitive data (build step 14)

**Owner:** Miguel. The brief's human-required case: "a structured handoff that transfers verified facts and open questions, not the raw transcript". Every hand-off is a verified case in Supabase `public.cases` ([verification.md](verification.md)); this step adds the one path that didn't create a case (the customer asking for a person), masks sensitive data at the door, and adds a code check against timing promises. Code: [src/lib/conversation/dialogue.ts](../src/lib/conversation/dialogue.ts), [src/lib/cases/build.ts](../src/lib/cases/build.ts), [src/lib/privacy/mask.ts](../src/lib/privacy/mask.ts), [src/lib/reply/checks.ts](../src/lib/reply/checks.ts).

## Every way a conversation reaches a person

| Trigger | Rule | Case `reason` | What the agent gets besides the facts |
|---|---|---|---|
| Customer asks for a person, nothing known yet | **DLG-human** (H1) | `customer_asked` | The customer's one-line summary, in their words |
| Customer asks for a person mid-dispute | **DLG-human** (H2) | `customer_asked` | The dispute details and matched charge collected so far |
| Two unresolved clarifying questions | DLG-clarify (C5) | `repeated_clarification` | "Request still unclear" |
| No matching charge, after one retry | PL-1 | `no_match` | What the customer said; suggestion to check other cards/dates |
| Several matches, after one retry | PL-2 | `ambiguous` | Same |
| Fraud score ≥ 30 after confirmation | PL-6 | `high_risk` | The transaction, its score, "confirm the card is in their possession" |
| Lookup failure / record changed | PL-8 | `tool_failure`, `record_unavailable` | "Nothing was verified automatically" |

Every row is written and read back before the customer hears the case number (V1), is idempotent (V3), and is assembled by code (V5). Example (live, local, 2026-09-30): `human_agent: a charge (details not collected). handed off: customer_asked (DLG-human). Customer's summary: "Cobraram duas vezes a minha fatura do cartão".`

## Decisions

### H1. Asking for a person with no context: one line first, then the case (Miguel, 2026-09-30)
- **Chose:** the assistant asks for a one-line summary; the next message is taken as that summary **whatever its intent** (no re-routing) and the case is created. Capped at 300 characters.
- **Why:** an agent receiving "customer wants a person" with nothing else starts from zero. One line is cheap and it's the customer's own framing. Re-routing the summary ("me cobraron dos veces" looks like a dispute) would ignore what they asked for.

### H2. Asking for a person mid-dispute: hand off at once (Miguel, 2026-09-30)
- **Chose:** if the conversation already has any dispute details or a matched charge, no summary is asked: the case carries those details and keeps the dispute intent.
- **Why:** asking "what's it about?" after the customer already explained would repeat TC-01's mistake (asking twice).

### H3. "No" right after being asked for a summary cancels (Miguel, 2026-09-30)
- **Chose:** a short "no" (≤ 3 words, read by code as in C8) cancels the hand-off; anything else is the summary.

### H4. Sensitive data is masked before anything sees it (Miguel, 2026-09-30)
- **Chose:** the route masks each message first, before the intent model (Cohere on AWS), Haiku (Anthropic), the conversation state, the logs and the cases table:
  - card numbers: 13–19 digits (spaces/dashes allowed) that pass the **Luhn checksum**, and 18-digit CLABE accounts → `****1234`;
  - a value after PIN / NIP / CVV / CVC / clave / contraseña / senha / código de seguridad / token / OTP → `[oculto]`;
  - emails → `[email]`.
- If a PIN, CVV or password was typed, the reply **starts with a safety reminder** ("nunca compartas tu PIN… el banco nunca te los pedirá"), decided by code.
- **Why:** third-party models and logs should never receive card data; the brief asks for customer-record isolation. Luhn keeps amounts, dates and references intact (tested: "1.250,00", "10/06/2026", "referencia 123456" and a non-Luhn 13-digit folio are untouched).
- **Both endpoints that reach a model mask:** `/api/chat` and, since 2026-09-30, `/api/classify` (the evaluation endpoint also sends text to Cohere; it was missed in the first version).
- **Bug found and fixed before merge (P14):** a card number followed by a comma wasn't masked; the preview's trace showed it.
- **Limit:** pattern-based. It won't catch a PIN written in words ("cuatro ocho dos uno") or a card number split across messages. The trace records which kinds were masked, never the values.

### R8. Replies may not promise timing: checked by code (Miguel, 2026-09-30)
- **Chose:** a reply containing an explicit speed promise ("ahora mismo", "enseguida", "en breve", "de inmediato", "em breve", "agora mesmo", "imediatamente", …) is rejected and the fixed template is used, like the number check (R4). `reply-v4`.
- **Why:** the prompt forbade it since reply-v3 (P11), and Haiku still wrote "em breve" and "ahora mismo" in step 14's live tests. We don't control how fast agents or reviewers respond. Verified live: "ahora mismo" → template.
- **Guard for the guard:** a unit test runs every fixed template (every move × hand-off reason × language) through the check, since templates are what the customer gets when a reply is rejected. It caught our own "responde en unos minutos" in the record-failed template, reworded to "más tarde".
- **Limit:** plain "ahora"/"agora" passes (our own template says "Ahora revisaremos ese cargo").

## Verified

- `npm test`: 59 tests, including H1–H3, the case contents for both hand-off paths, masking (cards, CLABE, PIN/CVV/senha, emails, and what must not be masked), R8, and every template.
- Live, local (2026-09-30): Portuguese "Quero falar com um atendente" → one-line summary → case GT-PLEB3X2U; mid-dispute "mejor pásame con un asesor" → immediate case; a message with a card number and PIN → masked, safety reminder, dispute continued normally.
