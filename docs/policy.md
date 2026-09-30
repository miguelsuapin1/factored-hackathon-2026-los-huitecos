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
| **PL-2** | Several transactions match | Ask for the merchant or the exact date, once. Still several → a person | We never pick one for the customer. The reply doesn't list the charges |
| **PL-3** | The match is **Pending** | Explain it isn't final and can still change; no dispute. Conversation closed | A pending charge can still be cancelled or adjusted; disputes apply to completed charges (common card practice; a policy choice, not from the data) |
| **PL-4** | The match is **Reversed** | Explain the amount was returned; no dispute | Nothing left to dispute |
| **PL-5** | The match is **Declined** | Explain nothing was charged; no dispute. No reason given | The response codes can't be trusted to explain a decline ([data issue E7](data-issues.md)) |
| **PL-6** | Confirmed, approved, **fraud score ≥ 30** | A person takes the case | Data-backed cutoff, below. The customer is never told the score or the reason |
| **PL-7** | Confirmed, approved, fraud score < 30 | The dispute goes to review | The normal path. Step 13 will create the review record and verify it; until then the reply says it *will* go to review |
| **PL-8** | The record can't be read (lookup failed or timed out, or the record changed) | A person takes the case | A tool failure must never break the turn or leave the customer without an answer |

Wrongful fee and unrecognized charge follow the same rules; the intent only changes the wording.

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
- **"Review" isn't a record yet:** step 13 creates it and verifies it before saying so. Step 14 turns a hand-off into the K3 case file.
- **Wording can still overstate.** Haiku once wrote "has been sent" for a review that didn't exist yet, and once promised an agent "right away". The instructions now forbid both (reply-v3), but code can't check tense the way it checks numbers. The trace has the reply source and prompt version for review.
- **Proposal (not built):** when the intent model hesitates between the two dispute intents, the clarifying question changes nothing: both lead to the same lookup and rules. Skipping it would save a turn. Needs Person 3's conversations to confirm it doesn't hurt.
