# Contracts between our parts

The interfaces where one person's work plugs into another's. Agree here first, then build against it in parallel: until the real piece exists, the consumer uses a mock with the same shape. **Changing a contract? Edit this file in your pull request and tell the owner of the other side.**

| # | Contract | Producer → consumer | Status |
|---|---|---|---|
| K1 | `POST /api/chat` v2 (multi-turn) | Miguel → Person 3 (eval harness, steps 17–18) | implemented on `miguel/step-9-11-memory` (Miguel, 2026-09-29) |
| K2 | Transaction lookup | Person 2 (step 10) → Miguel (steps 12–13) | types in `src/lib/lookup/types.ts`; stand-in used by step 12 (Miguel, 2026-09-30); Person 2 to confirm |
| K3 | Case file (reviews and hand-offs) | Miguel (steps 13–14) → Person 2 (agent console, step 20) | table `public.cases` live (Miguel, 2026-09-30); see docs/verification.md |
| K4 | Trace line | everyone → Person 3 (eval report) | Phase 1 shape + conversation fields |

## K1. `POST /api/chat` v2

Backward compatible: a request without `state` starts a new conversation, exactly like Phase 1.

```jsonc
// request
{ "text": "Error en el monto, debería ser de 250 pesos", "state": "<opaque token from the previous response>" }

// response (Phase 1 fields unchanged, plus `conversation`)
{
  "intent": { "intent": "move_money", "confidence": 0.54, "decision": "ask", "...": "same as Phase 1" },
  "reply": { "text": "...", "language": "es", "source": "haiku", "...": "same as Phase 1" },
  "conversation": {
    "state": "<opaque token: send it back with the next message>",
    "conversationId": "uuid",
    "turn": 2,
    "workingIntent": "wrongful_fee",            // what the conversation is about now (may differ from intent.intent)
    "resolvedBy": "clarification",              // model | clarification | offer | kept_topic | confirmation | new_topic
    "move": "ask_details",                      // ask_clarify | ask_details | confirm | ask_correction | no_match | ask_narrow
                                                // | explain_status | open_review | handoff | status_update | answer
    "details": { "amount": 350, "expectedAmount": 250, "currency": null, "date": null, "merchant": null },
    "missing": ["date"],
    "pending": { "kind": "details" },           // or { kind: "clarify", options: [a, b], attempts } | { kind: "offer_review", dispute } | { kind: "confirm" } | null
    "match": null,                              // the matched charge: { transactionId, date, amount, currency, merchant, status }
    "policy": { "rule": null, "decision": null, "lookup": null }, // e.g. { rule: "PL-7", decision: "open_review", lookup: { source: "mock", count: 1 } }
    "handoffReason": null,                      // repeated_clarification | no_match | ambiguous | high_risk | record_unavailable | tool_failure
    "status": "open",                           // open | confirmed | review | handoff | closed
    "restartReason": null,                      // set when a sent state was rejected (invalid signature, expired, other user)
    "extraction": { "source": "haiku", "dropped": [], "error": null, "ms": 950, "promptVersion": "extract-v2", "costUsd": 0.0005 }
  }
}
```

**For the harness:** replay a conversation by sending each customer message with the `state` from the previous response. Grade on `conversation.move`, `conversation.status`, `conversation.policy.rule`, `conversation.workingIntent` and `conversation.details`, not on the reply wording. The expected outcome per test conversation ("resolve, ask, refuse or hand off") maps to: `open_review` / `explain_status` = resolved, `ask_*`/`no_match`/`confirm` = asked, `answer` for move_money = refused, `handoff` = handed off. A tampered or expired `state` silently starts a new conversation (`turn: 1`).

## K2. Transaction lookup (Person 2, step 10)

Server-only, always scoped to the signed-in customer (row-level security enforces it in the database, step 8). The caller never passes someone else's id: the customer id comes from the session, not from the conversation.

```ts
type LookupQuery = {
  amount?: number;          // matched with tolerance (e.g. ±1%), in the transaction's own currency
  currency?: string | null; // ISO code if the customer named one; null = any
  dateFrom?: string;        // ISO date, inclusive
  dateTo?: string;          // ISO date, inclusive
  merchant?: string;        // fuzzy, accent/case-insensitive
  limit?: number;           // default 5
};

type TransactionMatch = {
  transactionId: string;
  date: string;                   // ISO timestamp (transaction_date)
  amount: number;
  currency: string;               // the record's own currency, never converted for display
  merchant: string | null;
  status: "Approved" | "Declined" | "Pending" | "Reversed";
  responseCode: string | null;    // null → "reason unavailable" (data issue E4)
  channel: string | null;
  country: string | null;         // ISO: MX, CO, AR
  fraudScore: number | null;      // for the policy engine (step 12), never shown to the customer
  score: number;                  // how well it matches the query, 0..1
};

async function findTransactions(session: CustomerSession, query: LookupQuery): Promise<TransactionMatch[]>;
async function getTransaction(session: CustomerSession, transactionId: string): Promise<TransactionMatch | null>; // re-read before deciding (step 12)
```

**Now in code (Miguel, 2026-09-30):** the types are [src/lib/lookup/types.ts](../src/lib/lookup/types.ts); the stand-in with synthetic fixtures is `src/lib/lookup/mock.ts`. **Person 2:** implement `TransactionLookup` against Supabase and export it from `src/lib/lookup/index.ts`; the unit tests in `src/lib/policy/policy.test.ts` show the expected behaviour (scoping, ±1% amount, date window, merchant and currency narrow only when something still matches). There is deliberately **no `is_fraud` field** (docs/policy.md PL-6).

**Data for K2 (Carlos, 2026-09-30):** BigQuery `gold_serving.serving_transactions` (+ `serving_customers`, `serving_products`) is the slice to load into Supabase: one row per transaction with exactly the K2 fields (`transaction_ts` UTC, `transaction_date_local` = the customer's calendar day, `amount`, `currency`, `merchant_name`, `transaction_status`, `response_code`, `channel`, `transaction_country` ISO, `fraud_score`), no `is_fraud`, and `data_source` (`organizer` | `team_synthetic`). Miguel's mock charges (`CLI-DEMO00000001`, `CLI-OTHER0000000001`) are included unchanged, so the test conversations keep working when the mock is replaced. **Filter dates on `transaction_date_local`.** In Supabase it is `public.transactions` (+ `customers`, `products`), created by migration `20260930220000_serving_slice.sql`, filled by `pipeline/load_supabase.py`; server-only until step 8. **Loaded 2026-10-01:** 2,040 customers, 23,052 transactions, about 10 MB (`public.data_version` records each load). Contents and size: [reports/serving_slice.md](../reports/serving_slice.md).

Relative dates are resolved against the demo clock (`DEMO_TODAY`, default 2026-06-17; see [conversation.md](conversation.md) C4), so the gold slice must cover the weeks before it. Until K2 is live, Miguel uses a mock returning fixed fixtures with this shape.

## K3. Handoff case file (step 14 → agent console, step 20)

Stored in the Supabase table `public.cases` ([migration](../supabase/migrations/20260930050000_cases.sql), owned by Miguel, reviewed by Person 2). No raw transcript: verified facts and open questions only (the brief's "structured handoff"). **Now live (2026-09-30):** columns are the snake_case of the fields below plus `reference` (shown to the customer), `kind` (`review` | `handoff`), `rule`, `status`, `idempotency_key`, `prompt_versions` (includes `environment`). Server-only: the console must read it through a server route with the secret key, never from the browser. The draft below is kept for reference; the table is authoritative.

```jsonc
{
  "caseId": "uuid", "conversationId": "uuid", "customerId": "CLI-...", "createdAt": "ISO",
  "reason": "customer_asked | low_confidence | high_risk | repeated_clarification | tool_failure",
  "request": { "intent": "unrecognized_charge", "summary": "Customer does not recognize a charge of 350 on 2026-06-10" },
  "verifiedFacts": [ { "fact": "Transaction TRX-... of 350.00 USD at X on 2026-06-10, status Approved", "source": "lookup" } ],
  "customerStatements": { "amount": 350, "date": "2026-06-10", "merchant": null },
  "checksDone": [ "lookup: 1 match", "confirmation: yes" ],
  "actionsTaken": [],                       // verified actions only (step 13)
  "openQuestions": [ "Merchant unknown to the customer" ],
  "language": "es"
}
```

## K4. Trace line

One JSON line per turn, `event: "turn"`, in Vercel runtime logs (Phase 1 fields in [reply-generation.md](reply-generation.md)). Steps 9 + 11 add `conversation: { conversationId, turn, resolvedBy, move, pendingBefore, detailsKnown, extractDropped, extractMs }`. Message texts and detail values are **not** logged, only which fields are known.

## Open questions for the team

- **Supabase region (Person 2):** the build plan says `us-east-1`; the existing, empty project `paguvqqelfwadcolocaq` is in `sa-east-1`. Vercel functions and Bedrock run in `us-east-1`, so a `us-east-1` project avoids a cross-continent hop on every lookup. Decide before the first load.
- **Demo customers (Person 2 + 3):** which 3–5 customers the demo and test conversations use, so fixtures, K2 and the test conversations line up.
