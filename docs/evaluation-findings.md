# Evaluation findings (steps 17–18)

Owner: Luis Pedro. Findings from the evaluation harness (`evals/`), each with evidence, root cause, a reproduction and a proposed fix. Evidence levels as in [lessons-learned.md](lessons-learned.md): 📊 measured.

**How this was produced (2026-10-01):** harness commit `9adc07c`, `npm run eval` against a local `npm run dev`, demo.mx ([contracts.md](contracts.md) K5). **Offline, team-written messages, one run per case (TC-02: four).** Intent ran on the **e5-small fallback** for every turn (`fallbackReason: "bedrock auth"`: the `bedrock` AWS profile isn't on this machine), and the lookup was the stand-in (no `SUPABASE_LOOKUP_DB_URL`; identical to Supabase for demo.mx, K5). Replies and extraction used Haiku (`reply-v7`, `extract-v4`).

| | Result |
|---|---|
| Cases | **17 / 21 pass** (TC-01…TC-21, `evals/cases/tc.ts`) |
| Wrong actions (review opened when not expected) | **0** |
| Leaks (card/PIN in reply or state token, TC-11) | **0** |
| Missed / unnecessary hand-offs | 1 (TC-20) / 1 (TC-02) |
| Latency per turn, 52 turns | p50 3.2 s, p95 4.6 s |
| Cost | $0.094 total, about $0.0018 per turn (Haiku only; embeddings not priced) |

| ID | Finding | Severity | Owner | Status |
|---|---|---|---|---|
| EF-1 | PL-2 hands off without ever asking for the date when a merchant stands in for it, even a merchant that matched nothing | **High** | Miguel | open |
| EF-2 | On the fallback model, status questions get "A or B?" depending on the runner-up label; "ni idea" during that question drops the topic | Medium | Miguel (dialogue), Luis Pedro (re-run on Cohere) | needs Cohere re-run |
| EF-3 | Stale docs and comments that describe pre-step-12 behaviour | Low | Miguel (file owner) | open |

## EF-1. A merchant that can't narrow the charges causes an immediate hand-off 📊

**What happens.** TC-02 turn 1, "Tem uma cobrança de R$ 89,90 da Netflix que eu não reconheço": the customer is handed to a person on the first message, with `rule: "PL-2"`, `handoffReason: "ambiguous"`. demo.mx has no Netflix charge; it has three 89.90 USD Cable TV charges (12 June, 12 May, 12 April). Every later turn is only `status_update`, so the conversation is lost.

**Evidence: 4 / 4 live runs**, same result, intent read correctly (`unrecognized_charge` 0.68, `act`). Each run created a verified hand-off case promising an agent will look into "essa cobrança de Netflix":

| Run | Turn 1 | Case |
|---|---|---|
| suite run | handoff, PL-2, ambiguous | verified |
| repeat 1–3 | handoff, PL-2, ambiguous | `GT-YJ3BYWD4`, `GT-CZT8FDQC`, `GT-5BZQXWKB` (environment `local`) |

**Root cause.**
1. `dialogue.ts` `missingFor` (C13): amount + merchant counts as enough to search, so no date is asked; the lookup searches the last 180 days.
2. `lookup/match.ts:22` `narrowAndScore`: a merchant that matches nothing is ignored on purpose (customers misname stores). All three Cable TV charges stay.
3. `conversation/resolve.ts:113` passes `merchantKnown: s.details.merchant !== null`: true because the customer *named* one, although it was discarded.
4. `policy/decide.ts` `decideOnLookup`: 3+ matches with `merchantKnown` → `ambiguous`, hand off.

**It isn't only a misnamed merchant.** Naming the right merchant ("Cable TV") ends the same way: the merchant can't separate a monthly subscription, and the date, the one detail that would (89.90 on 12 June), is never asked.

**Model-free reproduction** (fails today; paste into `src/lib/conversation/resolve.test.ts`, which already defines `run` and `intent`):

```ts
it("TC-02: a merchant that can't narrow three matches asks for the date before a person", async () => {
  for (const merchant of ["Netflix", "Cable TV"]) {
    const [t1] = await run([{ text: `Tem uma cobrança de R$ 89,90 da ${merchant}`, intent: intent("unrecognized_charge", 0.9),
      details: { amount: 89.9, currency: "BRL", merchant } }]);
    assert.notEqual(t1.move, "handoff", merchant); // today: handoff, PL-2, decision handoff:ambiguous, lookup count 3
  }
});
```

**Proposed fix (recommended).** In the PL-2 ladder, when 3+ charges match and the customer gave **no date, no period, and didn't say they don't remember** (`when.unknown`), ask for the date before handing off: merchant → date → person. Netflix then becomes "¿qué día fue?" → "dia 12" → one match → confirm (showing it's Cable TV). TC-20 is unaffected: there the customer said "ni idea", so the hand-off stays.

**Smaller alternative.** Count the merchant as known only when it actually narrowed (`narrowAndScore` already computes `merchantHit`; expose it to `resolve.ts:113`). Fixes Netflix but not the Cable TV variant, and would ask for the merchant the customer already gave.

**Done when:** the reproduction passes, `npm run eval -- --case TC-02` passes, and the rest of `npm test` and the TC suite still pass.

## EF-2. Fallback mode: "A or B?" depends on the runner-up label 📊

**What happens.** TC-14, TC-19 and TC-20 open with a status question and get `ask_clarify` instead of a search. C15 skips the clarification only when the **top two** labels are both charge intents (`dialogue.ts`, step 5). Scores from `/api/classify`, e5-small, threshold 0.61:

| Turn | Top two | Second a charge intent? | Move |
|---|---|---|---|
| TC-17 t1 (passed) | transaction_status 0.48, unrecognized_charge 0.14 | yes | search |
| TC-14 t1 | transaction_status 0.47, balance_check 0.24 | no | ask_clarify |
| TC-19 t1 | transaction_status 0.55, out_of_scope 0.15 | no | ask_clarify |
| TC-20 t1 | wrongful_fee 0.43, balance_check 0.18 | no | ask_clarify |

Then in TC-20 the answer "ni idea" scores `out_of_scope` 0.73 (`act`), is taken as a new topic, and the charge is dropped ("Cable TV" next: 0.59, asks again). The customer ends without an answer or a person (a missed hand-off).

**Status.** Measured on the fallback only. Production uses Cohere (threshold 0.70); these may pass there. **Next step (Luis Pedro):** re-run on Cohere, via the `bedrock` AWS profile or a preview deployment. Only if it reproduces there, options for Miguel: let status words ("estado", "qué pasó", "o que aconteceu") decide the kind as dispute words do in C15; and, while a clarification is pending, read a short "no sé / ni idea" as an unresolved answer (C5), not a new topic.

## EF-3. Stale docs and comments

- [test-conversations.md](test-conversations.md) TC-07 and the comment above `TRX-DEMO…0007` in `src/lib/lookup/mock.ts` say two 25 USD matches ask for the merchant (PL-2); since PL-10 they are listed (verified live).
- TC-02 and TC-03 predate the lookup: TC-02 "ontem" can't match 12 June (±3 days, PL-1), TC-03 ends in PL-6 (fraud 41.7), not "confirmed". TC-05/06 still have a clarification turn removed by C15. Updated expectations are in `evals/cases/tc.ts` notes.
- [contracts.md](contracts.md) K1: `resolvedBy` lacks `words`; the `move` and `pending` lists predate steps 12–14 (`pick`, `status_answer`, `record_failed`, `ask_summary`, `offer_dispute`, `offer_agent`).
- [policy.md](policy.md) "Proposal (not built)" about skipping the dispute-kind question was built as C15.

## What held 📊

No review was opened on a turn that didn't expect one (0 wrong actions); every review and hand-off was written and read back before its reference was quoted (V1); TC-11's card and PIN were masked and appear in neither the reply nor the state token; the refund demand in TC-03 was refused and "5000" never appeared; PL-6 never mentioned fraud.

## Reproduce

```bash
npm run dev                                 # needs .env.local (Miguel's)
npm run eval                                # the TC suite; results in evals/runs/ (git-ignored)
npm run eval -- --case TC-02 --repeat 3     # EF-1
```

Not yet covered: the other four K5 customers (passwords pending from Carlos), Cohere, the Supabase lookup, and human-written messages (steps 16–17), which are the evaluation the judges' numbers should come from.
