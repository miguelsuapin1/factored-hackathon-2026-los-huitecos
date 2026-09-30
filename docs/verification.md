# Verification (build step 13)

**Owner:** Miguel. The brief asks the system to "verify that actions actually happened". Here the only actions are creating a **case**: a dispute sent to review (PL-7) or passed to a person (PL-1, PL-2, PL-6, PL-8, repeated clarification). Nothing moves money. Code: [src/lib/cases/](../src/lib/cases/), the last step of [src/lib/conversation/resolve.ts](../src/lib/conversation/resolve.ts). Table: [supabase/migrations/20260930050000_cases.sql](../supabase/migrations/20260930050000_cases.sql).

## One confirmed dispute, end to end

```
customer: "sí"
  → re-read the transaction (not the state's copy) → policy decides review or person        (step 12)
  → build the case file in code: facts, what the customer said, checks, open questions       cases/build.ts
  → write it to Supabase `cases`                                                              cases/supabase-store.ts
  → read it back by id and compare field by field                                            V1
  → only then: "Registramos tu reclamo… Tu número de caso es GT-9SGJPKMT"
     otherwise: "No pude registrar tu caso… todavía no quedó registrado"                     V2
```

## Decisions

### V1. A case exists only after it's written and read back identical (Miguel, 2026-09-30)
- **Chose:** after the insert, read the row back by id and compare `idempotencyKey`, `kind`, `rule`, `conversationId`, `customerId`, `transactionId` with what was written. Only a matching read-back sets the case reference that the reply may quote.
- **Why:** a successful insert call isn't proof. The read-back catches a write that didn't persist and a row that isn't ours (both tested with a fake store that loses or alters writes). It costs one extra query (~0.1–0.2 s to `sa-east-1`).
- **Wording follows the evidence:** before step 13 the reply had to say the dispute *will go* to review (P11). With a verified case it may say it *was registered*, and give the reference. The reference's characters are allowed through the reply number check (C9) because code created them.

### V2. If it isn't verified, the customer is told nothing was registered (Miguel, 2026-09-30)
- **Chose:** on any failure (database down, timeout of 4 s, read-back missing or different) the move becomes `record_failed`: the reply says plainly that nothing was registered yet. For a review, the details and matched charge are kept and the confirmation is pending again, so replying "sí" later retries. The trace logs `case_not_verified` with the error.
- **Why:** claiming a case that doesn't exist is worse than admitting a failure: the customer would wait for a review that never comes.

### V3. Retrying never creates a second case (Miguel, 2026-09-30)
- **Chose:** each case has an idempotency key `conversation : transaction : kind`, unique in the database. A repeated "sí" (double click, retry after V2) returns the existing case.

### V4. Cases are server-only (Miguel, 2026-09-30)
- **Chose:** row-level security on with no policies, and every privilege revoked from the browser roles (`anon`, `authenticated`). Only the server's `SUPABASE_SECRET_KEY` reads or writes, from a module marked `server-only` (the build fails if browser code imports it).
- **Tested:** with the public key the browser uses, both reading and inserting return `permission denied for table cases` (2026-09-30). The Supabase advisor's only note is the intended "RLS enabled, no policy".

### V5. The case file is written by code, never by a model (Miguel, 2026-09-30)
- **Chose:** summary, verified facts, customer statements, checks done and open questions are assembled from the lookup record and the grounded details. The fraud score goes into the case's verified facts (agents may see it; customers never do). `checks_done` accumulates across the conversation's turns (last 12). No raw transcript is stored.
- **Example (live, 2026-09-30):**
  - `summary`: `unrecognized_charge: 120 USD at Conciertos Live on 2026-06-03. handed off: high_risk (PL-6).`
  - `open_questions`: `Possible fraud: confirm the customer has the card and whether others could use it; consider blocking.`
- Each case also records the model/prompt versions and the environment (`local`, `preview`, `production`), since all three write to the same table.

## Verified

- `npm test`: 45 unit tests, including V1 (write + read-back, reference format, rule and transaction stored), V2 three ways (store down, write lost, read-back altered), V3 (same key, one row), hand-off cases with reason and open question, and the checks across turns.
- **Live, local → real Supabase (2026-09-30):** a review (GT-9SGJPKMT, PL-7) and a Portuguese high-risk hand-off (GT-6XXJK7ZE, PL-6) created, read back and quoted to the customer; both rows checked in the table.

## Limits

- **One shared table** for local, preview and production (filter on `prompt_versions->>environment`). The region question (sa-east-1 vs us-east-1) is still Person 2's; the migration recreates the table anywhere.
- ~~Asking for a person directly doesn't create a case yet.~~ Step 14 ([handoff.md](handoff.md)) creates it.
- **Nobody works the cases yet:** the agent console is step 20 (Person 2). Case `status` starts at `open`.
