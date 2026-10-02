# Contracts between our parts

The interfaces where one person's work plugs into another's. Agree here first, then build against it in parallel: until the real piece exists, the consumer uses a mock with the same shape. **Changing a contract? Edit this file in your pull request and tell the owner of the other side.**

| # | Contract | Producer → consumer | Status |
|---|---|---|---|
| K1 | `POST /api/chat` v2 (multi-turn) | Miguel → Person 3 (eval harness, steps 17–18) | implemented on `miguel/step-9-11-memory` (Miguel, 2026-09-29) |
| K2 | Transaction lookup | Person 2 (step 10) → Miguel (steps 12–13) | types in `src/lib/lookup/types.ts`; stand-in used by step 12 (Miguel, 2026-09-30); Person 2 to confirm |
| K3 | Case file (reviews and hand-offs) | Miguel (steps 13–14) → Person 2 (agent console, step 20) | table `public.cases` live (Miguel, 2026-09-30); see docs/verification.md |
| K4 | Trace line | everyone → Person 3 (eval report) | Phase 1 shape + conversation fields |
| K5 | Demo and test customers | Person 2 (slice + logins) → Person 3 (test conversations, steps 16–19) | agreed (Luis Pedro + Carlos, 2026-10-01) |

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
    "handoffReason": null,                      // customer_asked | repeated_clarification | no_match | ambiguous | high_risk | record_unavailable | tool_failure | too_old (PL-11, 2026-10-02)
    "status": "open",                           // open | confirmed | review | handoff | closed
    "restartReason": null,                      // set when a sent state was rejected (invalid signature, expired, other user)
    "extraction": { "source": "haiku", "dropped": [], "error": null, "ms": 950, "promptVersion": "extract-v2", "costUsd": 0.0005 }
  }
}
```

**For the harness:** replay a conversation by sending each customer message with the `state` from the previous response. Grade on `conversation.move`, `conversation.status`, `conversation.policy.rule`, `conversation.workingIntent` and `conversation.details`, not on the reply wording. The expected outcome per test conversation ("resolve, ask, refuse or hand off") maps to: `open_review` / `explain_status` = resolved, `ask_*`/`no_match`/`confirm` = asked, `answer` for move_money = refused, `handoff` = handed off. A tampered or expired `state` silently starts a new conversation (`turn: 1`).

## K2. Transaction lookup (Person 2, step 10)

Server-only, always scoped to the signed-in customer (row-level security enforces it in the database, step 8). The caller never passes someone else's id: the customer id comes from the session, not from the conversation.

**Step 8 (Carlos, 2026-10-01, D-006):** `customerFor(session)` returns the customer id from the signed session cookie (`c`). The Supabase implementation must read through `asCustomer(session, tx => ...)` in `src/lib/db/scoped.ts` (role `lookup_reader`, env `SUPABASE_LOOKUP_DB_URL`), never with `SUPABASE_SECRET_KEY`: the policies then hide every other customer's rows even if a query has no `WHERE customer_id`.

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

**Live (Carlos, 2026-10-01, step 10):** `src/lib/lookup/sql.ts` implements `TransactionLookup` against Supabase (`source: "supabase"`), wired in `src/lib/lookup/index.ts` whenever `SUPABASE_LOOKUP_DB_URL` is set (the stand-in otherwise, e.g. a laptop without database credentials). Amount (±1%, min 0.01) and date window are SQL filters on `transaction_date_local`; merchant/currency narrowing and `score` are shared with the stand-in (`src/lib/lookup/match.ts`). `date` is the customer's **local** timestamp without zone (same shape as the stand-in), never UTC. Results are newest first. Every query runs through `asCustomer` (RLS, D-006). Parity with the stand-in on all demo charges + scoping: `src/lib/lookup/sql.test.ts` (runs with `LOOKUP_TEST_DB_URL`).

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

## K5. Demo and test customers (Person 2 → Person 3)

**Agreed (Luis Pedro + Carlos, 2026-10-01): the slice stays as loaded in Supabase.** Test conversations (steps 17–19) quote only the charges below, so every expected outcome follows from data both sides agree on. Checked the same day against Supabase (`data_version` 1, commit `1112091`) and BigQuery `gold_serving`: same rows, counts and amount sums for all five customers, and `demo.mx` matches the stand-in in `src/lib/lookup/mock.ts`. Dates are the customer's local day (`transaction_date_local`) against the demo clock, 2026-06-17. Passwords stay in the git-ignored `test-users.local.md`, never in a test file.

| Login | Customer | Profile | Why this one |
|---|---|---|---|
| `demo.mx` | `CLI-DEMO00000001` | MX, Basic, USD, team_synthetic, 11 charges | The only customer whose charges reach every rule PL-1…PL-10 with named merchants, and the only one identical in the stand-in and Supabase, so its conversations run with or without a database. TC-01…TC-21 and the smoke sweep already use it. |
| `otro.mx` | `CLI-OTHER0000000001` | MX, Basic, USD, team_synthetic, 1 charge | Isolation: the same 350 USD Super Ahorro charge on the same day as `demo.mx`. Each must only ever see their own. |
| `pendiente.ar` | `CLI-ET8RX4AC7A0W` | AR, Premium, USD + ARS, organizer | A Pending charge carrying a decline code (E7), the fraud cutoff from just below, and a null fraud score (F). |
| `rechazado-sin-codigo.co` | `CLI-VAQ11UMRIQJJ` | CO, Plus, USD + COP, organizer | Declined with no response code (E4); COP amounts in the millions test the thousands separator. |
| `ambiguo.mx` | `CLI-GMZJYO4I75ST` | MX, Plus, USD, organizer | Three near-identical withdrawals with no merchant: which rule fires depends on whether the customer gives a date. |

Together they cover MX/CO/AR, USD/COP/ARS, Basic/Plus/Premium and both data sources. The other seven logins (`revertido.ar`, `rechazado.mx`, `fraude.co`, `extranjero.co`, `usd.mx`, `suspendido.co`, `sin-movimientos.mx`) stay available for break-it cases (step 19).

**Charges to quote.** "Expected" is what `src/lib/policy/decide.ts` decides. Matching is the amount ±1% inside a window: ±3 days around an exact date, or the last 180 days when the customer says they don't remember. A test with no date at all has no window, so write "no me acuerdo" / "não lembro" when the 180-day search is intended.

| Login | Transaction | Local day | Amount | Merchant / type | Record | Expected |
|---|---|---|---|---|---|---|
| demo.mx | `TRX-DEMO0000000000001` | 2026-06-10 | 350.00 USD | Super Ahorro | Approved, fraud 12.4 | confirm → "sí" → PL-7 review |
| demo.mx | `TRX-DEMO0000000000003` | 2026-06-03 | 120.00 USD | Conciertos Live | Approved, fraud 41.7 | confirm → "sí" → PL-6, a person. The only clean PL-6 case: the slice's other scores ≥30 belong to customers without a login, or to `fraude.co`'s merchant-less deposit |
| demo.mx | `TRX-DEMO0000000000004` | 2026-06-16 ("ayer") | 45.00 USD | Gasolinera Express | Pending | PL-3 |
| demo.mx | `TRX-DEMO0000000000005` | 2026-06-05 | 230.00 USD | Restaurante El Buen Sabor | Reversed | PL-4 (the only Reversed charge among the five) |
| demo.mx | `TRX-DEMO0000000000006` | 2026-06-14 | 560.00 USD | Empresa Telefónica | Declined, code 51 | PL-5 |
| demo.mx | `…0007`, `…0008` | 2026-06-11, 2026-06-12 | 25.00 USD each | Tienda Don José, Super Ahorro | Approved | "25 dólares el 11 de junio" → 2 matches → PL-10, list both |
| demo.mx | `…0001`, `…0009` | 2026-06-10, 2026-02-27 | 350.00 USD each | Super Ahorro, Tienda Don José | Approved | "350 dólares" + "no me acuerdo" → 2 matches → PL-10 |
| demo.mx | `…0002`, `…0010`, `…0011` | 06-12, 05-12, 04-12 | 89.90 USD each | Cable TV | Approved | "no me acuerdo" → 3 matches → PL-2 asks the merchant; "Cable TV" can't narrow it → a person |
| otro.mx | `TRX-OTHER000000000001` | 2026-06-10 | 350.00 USD | Super Ahorro | Approved | Must never appear in a `demo.mx` conversation, and the reverse |
| pendiente.ar | `TRX-2T5FBDU4MTH3GM4JDAJT` | 2026-06-14 | 550.66 USD | none / Deposit | Pending, code 51 | PL-3. Ask it as a status question ("¿qué pasó con mi depósito?"); the reply must not give code 51's reason (E7) |
| pendiente.ar | `TRX-E5OTG7YNKVLRYJPHC7U4` | 2026-05-23 | 385.41 USD | none / Withdrawal | Approved, fraud 29.60 | confirm → "sí" → PL-7 review: just below the cutoff of 30 |
| pendiente.ar | `TRX-SXIOLJ5ZKWC1BEENJPHX` | 2026-06-02 | 4,093.50 ARS | Estación de Servicio | Approved, fraud null | confirm → "sí" → PL-7 review: a null score is not high risk (F) |
| rechazado-sin-codigo.co | `TRX-9SINWMOKM1OQBAFUPXBT` | 2026-05-26 | 7,323,195.33 COP | none / Payment | Declined, code null | PL-5 with "reason unavailable", never a guessed reason (E4) |
| rechazado-sin-codigo.co | `TRX-3TV223QNN106GCJN466L` | 2026-06-06 | 485.58 USD | none / Withdrawal | Approved, fraud 25.85 | confirm → "sí" → PL-7 review |
| ambiguo.mx | `TRX-KB3BCKQKAA2OT00Q57VL`, `TRX-N4OFZ3SVM86XNWB6F7OG`, `TRX-70B1SMWBEZWIH577GVBX` | 06-16, 06-15, 06-10 | 427.59, 427.26, 426.40 USD | none / Withdrawal | Approved | "no me acuerdo" → 3 matches → PL-2, no merchant to give → a person. "el 16 de junio" → 2 matches (06-15, 06-16) → PL-10 |

PL-1 needs no fixture: any amount the customer doesn't have (e.g. 999 USD on 10 June, TC-08). PL-8 is a forced tool failure, not data. Changing any of these rows in the slice, or a login's customer, is a change to this contract.

## Open questions for the team

- **Supabase region (Person 2):** the build plan says `us-east-1`; the existing, empty project `paguvqqelfwadcolocaq` is in `sa-east-1`. Vercel functions and Bedrock run in `us-east-1`, so a `us-east-1` project avoids a cross-continent hop on every lookup. Decide before the first load.
- ~~**Demo customers (Person 2 + 3)**~~ closed: see [K5](#k5-demo-and-test-customers-person-2--person-3) (Luis Pedro + Carlos, 2026-10-01).
