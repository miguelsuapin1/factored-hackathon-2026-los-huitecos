# Phase 2 data log (step 7): Carlos

What the data track (Person 2) did, in order, with the numbers each step produced. Everything runs in Google
Cloud (project `project-d49391de-51c4-49bf-aae`, region `us-east1`); the code and every generated report are in
this repo. Decisions: [decisions.md](decisions.md) D-003, D-005. Rules: [data-issues.md](data-issues.md).
Failures and fixes: [lessons-learned.md](lessons-learned.md) X1–X5.

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
- Staging types every column: **0 cast failures** across 25.6M rows.
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
  wrong-owner complaint link) and the fixture expectations. With `--drift` the schema contract fails loudly.

### 2026-09-30: gold
- Analytics (full population): `gold_contact_reason_metrics` reproduces the briefing from cleaned data
  (complaints: 17.1% of contacts, 43.6% first-contact resolution, 16.6 agent-min per resolution, 45.3% of
  unresolved time); `gold_dispute_kpis`, `gold_baseline_human` (for the eval report, step 18),
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

## Next (step 7 finish, then 8 and 10)
1. Run the canonical `dbt build --target bq` once with a Google login (the first build ran through
   `compile_offline.py` + a BigQuery connector; X1).
2. Run `pipeline/load_supabase.py` once from a laptop with both logins (tables already exist), then verify counts and size.
3. Step 8: per-customer test login + row-level security on the loaded tables.
4. Step 10: the Supabase `TransactionLookup` (K2) replacing `src/lib/lookup/mock.ts`, filtering dates on
   `transaction_date_local`.
