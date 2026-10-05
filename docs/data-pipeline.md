# Data pipeline log

By Carlos. What the data pipeline does, in the order it was built, with the numbers each stage produced. Everything runs in Google
Cloud (project `project-d49391de-51c4-49bf-aae`, region `us-east1`); the code and every generated report are in
this repo. Decisions: [decisions.md](decisions.md) D-003, D-005. Rules: [data-issues.md](data-issues.md).
Failures and fixes: [lessons-learned.md](lessons-learned.md) X1–X6.

## Where things are

| Layer | Where | Built by |
|---|---|---|
| Source | Organizer S3 `data/` (read-only) | organizers |
| Raw copy | `gs://factored_gt_latam_bank_raw/raw/` (7,671 CSVs, 13 tables, 5.3 GB) | Storage Transfer job, run once |
| Raw, read in place | BigQuery `raw_ext` (external tables, hive partitions) | `pipeline/bigquery/bronze_bq.py` |
| Bronze | BigQuery `bronze` (all STRING + `_source_file`, `_loaded_at`) | `pipeline/bigquery/bronze_bq.py` |
| Staging | BigQuery `staging` (views: typed, `_cast_errors`, `_reject_reasons`) | `pipeline/dbt` |
| Silver | BigQuery `silver` (13 tables) + `silver_quarantine.rejected_rows` | `pipeline/dbt` |
| Gold | BigQuery `gold` (analytics) and `gold_serving` (the Supabase slice) | `pipeline/dbt` |
| Quality | BigQuery `ops.ops_silver_quality` → `reports/silver_quality.md`; slice → `reports/serving_slice.md` | `pipeline/dbt/*_report.py` |

## Log

### 2026-09-29: bronze in BigQuery (D-003)
- Copied the organizer bucket to Cloud Storage (Storage Transfer, cloud to cloud). 7,671 files, 13 tables.
- Loaded every table verbatim into `bronze`. The 12 tables DuckDB already had match **row for row** (e.g.
  transactions 4,425,008) and on four spot-checked null counts. `digital_events` loaded for the first time:
  **15,620,994 rows** (dictionary: 10M).
- Every daily file of a table has the same header (no schema drift in the real data).

### 2026-09-30: silver, full population (D-005)
- Tooling decision: dbt (options A–C and Dataform compared in D-005). Same models run on BigQuery and DuckDB.
- Staging types every column: **0 cast failures** across 23.5M rows (23,495,188 in the 13 bronze tables).
- Silver applies the data-issue rules and flags each row it touches (`_rule_flags`). Counts per rule are in
  `reports/silver_quality.md`, e.g. C1 44,570 wrong-owner product links removed, A5 99,477 USD amounts derived,
  6,698 complaint subcategories derived from their category, E1 772, E2 62, E3 1,065, E5 3,274.
- **Reconciliation: bronze = silver + quarantine for all 13 tables; 0 rows quarantined** (the real data has no
  duplicate keys or missing required fields).
- **84/84 silver tests pass** on BigQuery: keys, allowed values, foreign keys, ranges, USD derivation, the
  privacy test (no complaint links to another customer's product) and reconciliation.
- New findings: **A6** the delivered `amount_usd` uses fixed rates, not the daily table; **A7** 24% of digital
  events are anonymous (first wrongly quarantined, fixed: X3); **E6** transcript durations can't be filled.

### 2026-09-30: fixtures and offline run
- `pipeline/dbt/fixtures/build_fixture_bronze.py` builds a tiny **team-generated synthetic** bronze in DuckDB
  with the problems the organizer data lacks: a duplicate delivery, a late file (Pending → Reversed), a row
  without an amount, and (with `--drift`) an extra column.
- `dbt build --target duckdb`: **178/178 steps pass**, including 3 unit tests (USD derivation, local date,
  wrong-owner complaint link). The fixture expectations were **not** among them: dbt skipped them until
  2026-10-05 (see that entry). With `--drift` the schema contract fails loudly.

### 2026-09-30: gold
- Analytics (full population): `gold_contact_reason_metrics` reproduces the briefing from cleaned data
  (complaints: 17.1% of contacts, 43.6% first-contact resolution, 16.6 agent-min per resolution, 45.3% of
  unresolved time); `gold_dispute_kpis`, `gold_baseline_human` (for the eval report),
  `gold_digital_events_profile`.
- Serving slice (`gold_serving.*`, docs/contracts.md K2): **2,040 customers** (2,002 stratified by
  country × segment with a fixed seed, 5 per demo scenario, 2 synthetic demo customers), **23,052
  transactions** over 12 months, **≈20 MB estimated** (budget 100 MB). Sample vs population within 0.05 pp on
  country and segment, within 1.5 pp on transaction mix. Minimised: first name, hashed document number,
  product last-4, no `is_fraud`.
- The organizer data has no repeated charges, so the duplicate/ambiguous demo paths use Miguel's synthetic
  charges, carried in unchanged as `data_source = 'team_synthetic'`.

### 2026-09-30: Supabase tables
- Kept the existing Supabase project (São Paulo) so Miguel's live `public.cases` is not moved; the region question in contracts.md stays open for the team.
- Migration `supabase/migrations/20260930220000_serving_slice.sql` applied: `customers`, `products`, `transactions`, `fx_rates`, `agent_pools`, `data_version`; indexes for per-customer lookups; RLS on with no policies and browser roles revoked (anon can read nothing, checked). `cases` untouched.
- Loader `pipeline/load_supabase.py`: reads BigQuery `gold_serving.*`, replaces the tables in one transaction, checks every count, records the load in `data_version`. Tested end to end on a local Postgres 16 with the fixture slice (two runs, identical counts).

### 2026-10-01: gold slice loaded into Supabase (Carlos)
- `pipeline/load_supabase.py` run from Carlos's laptop, BigQuery → Supabase, one transaction. `data_version` id 1:
  source `bigquery:project-d49391de-51c4-49bf-aae.gold_serving`, demo_today 2026-06-17.
- Checked afterwards in Supabase:
  - Row counts equal BigQuery: customers 2,040 (2 team_synthetic), products 6,110, transactions 23,052
    (12 team_synthetic), fx_rates 1,095, agent_pools 12. No transaction without its customer.
  - Statuses: Approved 21,176, Declined 1,174, Pending 465, Reversed 237. Foreign 1,035. Fraud score ≥ 30: 26
    (25 approved). Local dates 2025-06-18 to 2026-06-17 (12 months up to the demo clock).
  - Size about 10 MB for the six tables (transactions 7.6 MB), half the 20 MB estimate and 2% of the 500 MB free tier.
  - Access: RLS on, no policies, and anon/authenticated can't select any table (including `cases`). The advisor lists
    only "RLS enabled, no policy" (INFO), which is intended: reads go through the restricted role of D-006.
  - `public.cases` untouched: 144 rows, same structure.
- Loader fix: a `.env.local` saved by Windows editors (BOM / UTF-16) wasn't read; fixed in f2e6ac2.

### 2026-10-01: official dbt build in BigQuery (Carlos)
- `uv run dbt build --profiles-dir . --target bq` from Carlos's laptop, with his own Google login: 5 seeds, 26 views,
  27 tables, 118 data tests and 3 unit tests; PASS=179, WARN=0, ERROR=0, in 104 s. Every check now runs as dbt's own
  test, not the condensed SQL used for the first build (X1 closed).
- The rebuilt `gold_serving` matches what's loaded in Supabase: same counts, and the same IDs for customers,
  transactions and products (MD5 of the sorted IDs is identical in BigQuery and Supabase). The fixed seed keeps the
  slice reproducible.

### 2026-10-01: per-customer login + row-level security (D-006)
- Migration `20261001010000_step8_login_rls.sql` applied: `public.app_users` (server-only), role `lookup_reader`
  (read `customers`/`products`/`transactions` only), policies "own rows via `app.customer_id`". Browser roles still get
  nothing; `cases` untouched.
- `supabase/tests/step8_rls_check.sql` passed on Supabase: no customer → 0 rows; demo customer with no `WHERE` → only
  own rows; another customer's id or transaction id → 0; empty or injection-shaped ids → 0; no access to `cases` or
  `app_users`; no writes. Run without the role it fails (23,052 rows visible), so the check has teeth.
- App: login checks `app_users` (PBKDF2) or the shared demo account; the session carries the customer id; customer
  data goes through `src/lib/db/scoped.ts` as `lookup_reader`. 13 new unit tests; full suite 111/111.
- 12 test logins chosen from the slice: Miguel's 2 synthetic customers, one per scenario (pending, reversed, declined
  with/without code, fraud ≥ 30, foreign, MX in USD, ambiguous), a suspended customer and one with no recent charges.
  Created by `pipeline/seed_test_users.py` (tested end to end on a local Postgres 16, including the role login with
  a SCRAM verifier and the Python↔TypeScript hash check). Loader now refuses a reload that drops a test customer.

### 2026-10-01: the transaction lookup on Supabase (K2)
- Pipeline and login merged to main (PR #14) and live; test logins work on production; `SUPABASE_LOOKUP_DB_URL` added in
  Vercel by Miguel.
- `src/lib/lookup/sql.ts`: amount (±1%) and local-date window in SQL, merchant/currency narrowing and score shared with
  the stand-in (`match.ts`, the stand-in now uses it too), local timestamps, newest first, always through `asCustomer`.
- Parity test (`src/lib/lookup/sql.test.ts`): 16 dialogue-shaped questions on Miguel's demo charges give identical
  answers from the stand-in and the SQL lookup; scoping checks (other customer's id, other session, no customer, a query
  with no customer filter). 22/22 on a local Postgres 16 with both migrations and the demo seeds.
- Checked on Supabase as `lookup_reader`: `pendiente.ar`'s question (550.66 around 14 June) returns exactly its
  pending ATM charge, local time 20:19.

### 2026-10-05: the fixture expectations now run (Luis Pedro)
- `tests/fixtures/fixture_expectations.sql` (FIX-DUP/LATE/MISS, A5, C1, E1, E3, E5, A7, C3) had never run: dbt 1.11
  keeps `tests/fixtures/` for unit-test fixtures and skips singular tests there without a warning
  (`dbt/parser/read_files.py`). The manifest had no node for it, enabled or disabled (lessons-learned X6).
- Moved to `pipeline/dbt/tests/fixture_expectations.sql`, same `enabled=var('fixtures', false)` switch. Offline
  build: 118 data tests, **179/179 pass**, `fixture_expectations` included (fixture transactions: bronze 6 =
  silver 3 + quarantine 3). On a tampered copy of the fixture DB (FIX-LATE back to Pending, FIX-DUP twice in
  silver) it fails with exactly those 2 expectations.
- BigQuery unchanged: the test is disabled there (checked with `compile_offline.py`), and `serving_has_every_scenario`
  (the opposite switch) runs instead, so both targets build 179 steps.
- Bronze total corrected here and in pipeline/dbt/README.md: 23,495,188 rows, not 25.6M (the reconciliation table in
  `reports/silver_quality.md`; BigQuery `bronze.__TABLES__` gives the same sum).
