# Policy engine (build step 12)

**Owner:** Miguel. What happens to a dispute once its details are known: plain code, one rule per situation, and each decision's rule id is logged. Code: [src/lib/policy/decide.ts](../src/lib/policy/decide.ts) (rules), [src/lib/conversation/resolve.ts](../src/lib/conversation/resolve.ts) (runs them in a turn), [src/lib/lookup/](../src/lib/lookup/) (the K2 lookup, a stand-in until step 10).

**No rule moves money.** The most any rule does is send a confirmed dispute to review, or pass the case to a person. "Resolve" in this project always means *routing*, never a refund or reversal.

## Where it sits in a turn

```
dialogue rules (step 11) say the details are complete → move "confirm"
  → lookup: the customer's own transactions, amount ±1%, date ±3 days, merchant/currency if known
  → decideOnLookup:  0 matches → PL-1 · 2+ → PL-2 · Pending → PL-3 · Reversed → PL-4 · Declined → PL-5 · 1 approved → confirm it
customer says yes → move "confirmed"
  → re-read the record by id (fresh, not from the state)
  → decideOnConfirm: fraud score ≥ 30 → PL-6 (person) · can't re-read → PL-8 (person) · otherwise → PL-7 (review)
```

## Rules

| Rule | Situation | Decision | Why |
|---|---|---|---|
| **PL-1** | No transaction matches | Ask the customer to check the amount and date (and give the merchant), once. Still none → a person | Customers misremember; one retry is cheap. After that, guessing is worse than an agent |
| **PL-2** | **Three or more** transactions match | Ask for what's still missing, each once: the **date** if the customer gave none (EF-1), then the **merchant**. Still three or more, or "no sé" → a person, with a verified case | We never pick one for the customer, and never list more than two (updated 2026-09-30 with PL-10; Miguel's ladder). The date step (2026-10-02, EF-1): a merchant can't separate a monthly subscription, and a misnamed one ("Netflix") matches nothing, yet both sent the customer to a person on the first message (TC-02, 4/4 runs) |
| **PL-10** | **Exactly two** transactions match (also after the merchant) | List both, as the records show them (amount, merchant, date), and let the customer pick; the pick is read by code (C14). Unclear → ask once more → a person; "ninguno" → ask the merchant | Showing two of the customer's own charges is faster than another question, and still safe: a dispute is confirmed with yes/no before anything opens |
| **PL-3** | The match is **Pending** | Explain it isn't final and can still change; no dispute. Conversation closed | A pending charge can still be cancelled or adjusted; disputes apply to completed charges (common card practice; a policy choice, not from the data) |
| **PL-4** | The match is **Reversed** | Explain the amount was returned; no dispute | Nothing left to dispute |
| **PL-5** | The match is **Declined** | Explain nothing was charged; no dispute. No reason given | The response codes can't be trusted to explain a decline ([data issue E7](data-issues.md)) |
| **PL-6** | Confirmed, approved, **fraud score ≥ 30** | A person takes the case | Data-backed cutoff, below. The customer is never told the score or the reason |
| **PL-7** | Confirmed, approved, fraud score < 30 | The dispute goes to review | The normal path. Since step 13 a review case is written and read back before the reply gives its reference ([verification.md](verification.md)) |
| **PL-9** | A **status question** ("¿qué pasó con mi compra?") matches one **approved** charge | Explain it was charged normally and offer a review; if the customer says it isn't theirs or isn't right, the dispute continues with the same charge (S2) | Approved is the one status where a dispute may still make sense; the offer is the only one a status answer may make (R9) |
| **PL-11** | The customer dates the charge **more than 365 days back** (older than the 12 months of transactions we hold) | A person takes the case; the stated date goes into the case's checks | The assistant can't see it, so asking again only loops (C17); an agent can look at the full history. 365 = the serving slice's coverage (docs/phase-2-data-log.md) |
| **PL-8** | The record can't be read (lookup failed or timed out, or the record changed) | A person takes the case | A tool failure must never break the turn or leave the customer without an answer |

Wrongful fee and unrecognized charge follow the same rules; the intent only changes the wording.

## When the customer can't give an exact date (C13–C14, Miguel, 2026-09-30)

The date is still asked for. What the answer can be, and where the search then looks:

| The customer says | Search window |
|---|---|
| An exact day ("el 10 de junio", "10/06", "ayer") | ± 3 days |
| A period ("la semana pasada", "a principios de mes", "el mes pasado") | That range: read by Haiku, then checked by code (quoted from the message, ends by the demo date, starts within 365 days, spans ≤ 35 days) |
| "El más reciente" / "o mais recente" | The last 180 days, keeping only the latest charge of that amount |
| "No me acuerdo" / "não sei" | The last 180 days |
| The merchant instead of a date | The last 180 days, with the merchant |

Then the ladder: **0** → check the details once (PL-1) · **1** → that charge (confirm, or explain its status) · **2** → list both (PL-10) · **3+** → ask the date once if none was given (EF-1), then the merchant once (PL-2) → still 3+ or "no sé" → a person. A stated date or period may reach back 365 days (the data we hold); older → a person (PL-11). Searches without a date stay at 180 days (a product choice, C17); a month and day without a year means the most recent one (C17). "El más reciente" and "no me acuerdo" replace any earlier date (after "el mes pasado" found nothing, "el más reciente" searches the whole window). Status questions (S1) use the same ladder. The stand-in customer has a second 350 charge (27 February, Tienda Don José) and a monthly Cable TV charge to exercise every step.

## Status questions (S1–S2, Miguel, 2026-09-30)

- **S1:** `transaction_status` collects the same details as a dispute (amount and date), then looks the charge up **without asking for confirmation**: reading a record changes nothing, so there's nothing to confirm. PL-1 and PL-2 apply unchanged (ask once, then a person). Pending, reversed and declined are explained by PL-3/4/5 (for a decline, "no tengo el detalle del motivo", data issue E7); approved by PL-9. Nothing is written to `cases`.
- **S2:** after PL-9's offer, "no lo reconozco", "no fui yo", "está mal", "sí" or "revísenlo" (read by code, like yes/no) continue as a dispute with the same details and matched charge → confirmation → verified review. A "no" closes politely.
- **S3 (Miguel, 2026-09-30):** a **declined** charge's answer offers a person to check the reason ("¿quieres que un asesor lo revise?"), since our response codes can't explain declines (E7). "Sí" / "un asesor" → a verified hand-off case carrying the declined transaction and the open question "why was it declined"; "no" closes. This replaced an explanation that ended in silence, which Haiku kept filling with an invented offer (R9, P15). Verified live: "sí, por favor" → case GT-Y7LVMA9Z.
- **Why:** it completes the brief's "normal resolution" without a hand-off: most "what happened?" questions end with a factual answer from the record.
- **Verified live (local, 2026-09-30):** declined (ES) and pending (PT) explained; "¿Me dicen el estado de mi compra de 350…?" → approved + offer → "no fui yo" (model alone: human_agent 54%) → confirm → review GT-B7RCDNPP; "não, obrigado" → polite close, no case.

## PL-6: the fraud-score cutoff (Miguel, 2026-09-30)

- **What the score is:** a column in the organizer's transactions, 0–100. In a real bank it comes from the fraud engine when the card payment is authorized, so it exists when a customer disputes. The customer never provides it; we read it from the matched record.
- **What we don't use:** `is_fraud`. In reality that label only exists after disputes and chargebacks are resolved, so the running system never reads it. The lookup contract (K2) has no such field. It's used offline only, as the answer key for choosing the cutoff.
- **How 30 was chosen:** [pipeline/fraud_threshold.py](../pipeline/fraud_threshold.py). The selection rule was committed before the first run (commit `5c802e8`): the lowest whole-number cutoff at which at least half of the flagged debits are fraud, chosen on 2023–2025, then reported on held-out 2026. Result in [reports/fraud_threshold.md](../reports/fraud_threshold.md):

  | At fraud score ≥ 30 | Flagged per day (whole bank) | Fraud caught | Flagged that are fraud |
  |---|---|---|---|
  | Chosen on 2023–2025 | 2.37 | 69.1% | 79.5% |
  | **Held out, 2026** | **2.19** | **71.4%** | **78.9%** |

  One point lower (≥ 29) flags 96 per day with 1.8% fraud: that's where the normal transactions end.
- **Agent load:** the rule only applies to charges a customer disputes, so it adds at most ~2 cases per day across the whole bank, against ~25 dispute complaints per day that all go to agents today.
- **Honest limits:** the edge at 30 is unusually sharp because the data is synthetic. With real data the trade-off is gradual; the cutoff would be set by agent capacity and rechecked against confirmed disputes. About 29% of fraud scores under 30 and isn't caught by this rule; other signals still route to a person (no match, the customer asking).

## Rules we considered and didn't adopt

- **An amount limit** ("hand off disputes above USD 500"). First proposed without evidence and **rejected on measurement** (Miguel, 2026-09-30): transaction amounts are uniform (purchases 0–500 USD), so the limit would have flagged almost nothing; complaint `claimed_amount` is uniform 0–5,000 in every currency, unrelated to `priority` or to `compensation_granted` (correlation 0.03). The data gives no basis for any amount. If the team wants one for the story, it must be written down as a business choice. See [data issue E8](data-issues.md).
- **Foreign merchant, repeat complainer** (listed in [contact-reason-analysis.md](contact-reason-analysis.md)): not adopted until measured.

## Tests

- `npm test`: `src/lib/policy/policy.test.ts` (each rule, the PL-6 boundary, lookup scoping) and `src/lib/conversation/resolve.test.ts` (dialogue → lookup → policy end to end, including a lookup failure and "the state never holds the fraud score").
- Live, local, 2026-09-30 (Cohere + Haiku, stand-in lookup): TC-01 → review (PL-7); high risk → person (PL-6); pending (PL-3); declined in Portuguese (PL-5); ambiguous → merchant → review (PL-2); no match twice → person (PL-1). See [test-conversations.md](test-conversations.md).

## Known limits and next steps

- **The lookup is a stand-in** (one synthetic demo customer, labelled in `src/lib/lookup/mock.ts`). Person 2 swaps in the Supabase version in `src/lib/lookup/index.ts`.
- ~~"Review" isn't a record yet.~~ Step 13: reviews and hand-offs are verified cases ([verification.md](verification.md)).
- **Wording can still overstate.** Haiku once wrote "has been sent" for a review that didn't exist yet, and once promised an agent "right away". The instructions now forbid both (reply-v3), but code can't check tense the way it checks numbers. The trace has the reply source and prompt version for review.
- **Built as C15 (2026-09-30):** when the intent model hesitates between two charge intents, the "A or B?" question is skipped and the customer's words decide the kind (docs/conversation.md C15).
