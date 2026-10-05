# Decision log

## D-001: Hybrid AWS (source) + local DuckDB pipeline + Supabase (serving) (2026-09-25)
**Status:** accepted. This replaces the provisional "Supabase + Vercel only" decision.

**Context**
- The organizer dataset is in a read-only S3 bucket (`us-east-2`): 12,505 daily-partitioned CSVs. The current copy under `data/` is 5.3 GB, of which `digital_events` is 3.6 GB. `data_backup_20260831/` is an incomplete older copy and is ignored.
- The organizers list Snowflake/AWS/Databricks/Azure only as "(maybe) valuable resources". Nothing in the rules rewards using them.
- The judges want a trusted test session, per-customer access enforced outside the model, reproducible pipelines with contracts and lineage, and a deployed tool.

**Decision**
| Layer | Where | Why |
|---|---|---|
| Raw / source of truth | Organizer S3 bucket (read-only), mirrored to `data/raw/` with `scripts/download_data.sh` | Immutable input; the pipeline starts here |
| ETL + contracts + lineage | Python + DuckDB → Parquet (bronze → silver → gold) | Deterministic and free; runs the same on every laptop and in CI; handles ~19M rows easily |
| Operational/serving DB | Supabase Postgres (sa-east-1) | Auth covers the trusted test session; RLS gives per-customer isolation; audit log, handoff tickets, traces; already wired to Vercel |
| App / API | Next.js on Vercel | Deployed link for the submission |
| LLM | Claude via the Anthropic API (Bedrock is an alternative) | Simplest integration |

Only the workflow-relevant slice goes into Supabase (the free tier is 500 MB).

**Revisit if:** the slice exceeds the free tier (→ Supabase Pro, or Athena over S3), or we want the whole stack in AWS for the pitch.

## D-002: Use case
**Status:** accepted 2026-09-28 by the team. Chosen: **transaction-dispute intake** (unrecognized charges + wrongful fees; 40% of complaints; the complaint bucket has the worst first-contact resolution at 43.6% and 23% of agent hours). Alternative: account & payment inquiries (35% of contacts, but already 91.5% first-contact resolution). Evidence: [contact-reason-analysis.md](contact-reason-analysis.md).

## D-003: BigQuery as the shared warehouse for bronze → silver → gold (2026-09-29)
**Status:** proposed, bronze layer built; team to confirm (Carlos, 2026-09-29). Supersedes the "ETL" row of D-001 only; S3 stays the source of truth and Supabase stays the serving DB.

**Context**
- Everyone's laptop needed its own 1.7–5.3 GB copy plus a DuckDB file, and `digital_events` (3.6 GB CSV, 15.6M rows) was never loaded.
- Phase 2 needs silver/gold tables everyone can query, and a gold slice small enough for Supabase's 500 MB free tier.

**Decision**
| Layer | Where |
|---|---|
| Source | Organizer S3 `data/`, copied once by Google Storage Transfer Service to `gs://factored_gt_latam_bank_raw/raw/` (7,671 CSVs, 13 tables, 5.3 GB) |
| Raw, read in place | BigQuery dataset `raw_ext`: external tables, hive partitions `year/month/day` |
| Bronze | BigQuery dataset `bronze`: native, all STRING, `_source_file` + `_loaded_at`; built by `pipeline/bigquery/bronze_bq.py` |
| Silver / gold | BigQuery (next); gold slice exported to Supabase |

GCP project `project-d49391de-51c4-49bf-aae`, location `us-east1` (dataset and bucket must share a region).

**Evidence it is equivalent:** row counts of all 12 tables DuckDB loaded match exactly (e.g. transactions 4,425,008; interactions 686,296), and null counts match on the spot-checked columns (`complaints.subcategory` 6,698; `origin_interaction_id` 67,095; `transactions.amount_usd` 2,537,456; `response_code` 221,033). Every table's daily files share one header (no schema drift), so fixed STRING schemas are safe.

**Trade-offs:** reproducing from scratch now needs a GCP project (DuckDB remains the no-cloud path; keep `pipeline/bronze.py` working). A fourth platform to secure: the S3 keys live only in the Storage Transfer job, never in the repo. Cost: ~8.5 GB of BigQuery storage (6 GB is `digital_events`), about the 10 GB free tier; queries stay far below the 1 TB/month free tier.

**Revisit if:** the team prefers a single-laptop path for judges (then silver/gold are written as portable SQL that also runs on DuckDB).

## D-004: Banking77 may be used for training, never for evaluation (2026-09-30)
**Status:** permitted by the organizers (Diego Ralon, Slack direct message to Miguel, 2026-09-30), on two conditions: it is **not used for evaluation**, and we **document how and why** it is used. Recorded by Miguel.

**What it is:** Banking77 (PolyAI, Casanueva et al. 2020), ~13,000 English online-banking customer queries labelled with 77 intents, CC BY 4.0. Not part of the organizer dataset.

**How we may use it:**
- As **training data only** for the intent model (step 3's softmax on Cohere embeddings), mapped to our 7 intents by a written mapping table (team judgment, labelled as such per the label provenance rule).
- As **hard negatives** for `out_of_scope` (the ~60 banking intents we don't handle).
- As **design evidence** (which share of banking requests our 7 intents route, refuse or hand off), clearly not a metric of our model.

**How we may not use it:** no reported number is computed on Banking77: not the test set, not validation, not threshold selection, not cross-validation scores (CV folds are scored on our Spanish/Portuguese phrases only). It is never downloaded into `data/phrases/` and never touches `split_manifest.json`.

**Why:** our training set is 948 team-generated phrases by one author (Claude); Banking77 adds real phrasing variety and many out-of-scope banking questions. Risks we'll measure, not assume: it's English while our customers write Spanish and Portuguese, and 13K sentences could swamp our 948 (we'll rebalance). **Result (2026-09-30): tried and rejected; the live model doesn't use it** ([intent-model.md D17](intent-model.md), [reports/banking77_experiment.md](../reports/banking77_experiment.md)).

## D-005: dbt for silver and gold, same models on BigQuery and DuckDB (2026-09-30)
**Status:** proposed, silver + gold built on the full population; team to confirm (Carlos, 2026-09-30).

**Options considered:** (A) dbt, (B) numbered SQL files + a Python runner (like `bronze_bq.py`), (C) Python dataframes + Pandera/Great Expectations, (Dataform) Google's in-console dbt. Chosen A.

**Why:** the work is typing, mapping, deduplication and joins (what SQL does best); dbt gives contracts as tests (unique, not_null, accepted_values, relationships), unit tests for tricky rules, a lineage graph and docs, and the **same models run on DuckDB**, so a judge without a GCP account can run the pipeline on the fixture bronze (removes the reproducibility trade-off in D-003). Adapter differences live in dispatched macros (`macros/casts.sql`, `macros/silver_utils.sql`).

**Pinned:** dbt-core 1.11 (1.12 downloads a parser binary at install time, which failed behind the proxy; lessons-learned X2).

**How it ran first:** no dbt login was available in the assistant session, so `compile_offline.py` + `plan_sql.py` compiled the project and the statements were executed through the BigQuery connector (pipeline/dbt/README.md). The canonical path is `dbt build --target bq`.

**Rules of the layers:** silver never drops a row silently (bronze = silver + quarantine, tested); every change carries a rule id in `_rule_flags`; reports are generated from `ops.ops_silver_quality`. Serving gold is a sample (~2,000 stratified customers + demo scenarios) sized for Supabase, with representativeness measured.


## D-006: Per-customer test login + row-level security through a restricted database role (2026-10-01)
**Status:** built and checked; Miguel to review in the PR (Carlos, 2026-10-01).

**Problem:** the brief asks for a trusted test session ("a national ID or customer number alone is not proof of identity") and per-customer access enforced outside model prose. Until now every sign-in was one shared demo account, and the server read Supabase with the secret key, which skips row-level security (RLS), so RLS could not protect anything.

**Options considered:** (A) Supabase Auth users + `authenticated` policies, the server keeping each user's token; (B) our own test logins + a restricted Postgres role the lookup connects as. **Chose B** (Carlos, 2026-10-01): it extends Miguel's existing signed-cookie session instead of replacing it, needs no token refresh, and keeps Miguel's rule exactly: the browser keys (`anon`, `authenticated`) still get no policy and no privilege on any table.

**How it works** (migration `supabase/migrations/20261001010000_step8_login_rls.sql`):
- `public.app_users`: username → `customer_id`, password as PBKDF2-SHA256 (600k iterations, salted), server-only like `cases`. Test logins are team-generated (`pipeline/seed_test_users.py`); plaintext only in the git-ignored `test-users.local.md`.
- Login (`src/lib/auth/login.ts`) checks a password on every path; the session cookie now carries the customer id (`c`) and is refused without one. The shared demo account (env `DEMO_*`) still works and signs in as the synthetic demo customer only.
- Customer data is read only through `src/lib/db/scoped.ts`: it connects as `lookup_reader` (`SUPABASE_LOOKUP_DB_URL`, transaction pooler) and starts every transaction with `set_config('app.customer_id', <session customer>, true)`. Policies on `customers`, `products`, `transactions` show only that customer's rows; no setting → no rows. A query that forgets its `WHERE` still can't leak.
- `lookup_reader` can read those three tables and nothing else (no `cases`, no `app_users`, no writes).

**Evidence:** `supabase/tests/step8_rls_check.sql` (passed on Supabase 2026-10-01; checked to fail when run without the role), `src/lib/auth/auth.test.ts` (hashing, Python↔TS hash compatibility, wrong/unknown/disabled user, id-only login, forged and pre-step-8 cookies), and the seed script re-checks isolation through the pooler as `lookup_reader` after every run.

**Trade-offs:** one more secret (`SUPABASE_LOOKUP_DB_URL`) and a direct Postgres connection from Vercel; password hashing is ours, not a managed identity service. `app_users.customer_id` has no foreign key (the step-7 loader truncates `customers`); the loader refuses a reload that would orphan a login instead.

## D-007: Agent console with a live hand-off chat, by polling through server routes (2026-10-05)
**Status:** built and tested locally; Miguel to review in the PR (Carlos, 2026-10-05).

**Problem:** step 20. Every hand-off becomes a verified case (K3), but nobody could pick it up, and the customer was told "an agent will take over" with nothing behind it.

**Chosen (Carlos, 2026-10-05):**
- **One shared agent login** from env (`AGENT_USERNAME`, `AGENT_PASSWORD`), its own cookie that customer sessions can't impersonate (and the reverse).
- **Request inbox + accept + chat.** The case's existing `status` is the request state (open → in_progress → closed; accept is a conditional update so two agents can't take the same request). Messages live in a new server-only table `public.case_messages`; `cases` columns are unchanged.
- **Polling through server routes** (2–4 s), not Supabase Realtime: Realtime would need browser read policies on cases and messages, which breaks the rule that the browser key reads nothing. Polling works on Vercel as is and keeps every read behind a session check.
- **Briefing built by code** from the case facts (intent, what the customer said, the matched and confirmed transaction, why a person, open questions, checks done), not by a model and not from a transcript (the brief's "structured handoff").
- **Customer side:** after a verified hand-off the chat shows "connecting you to an agent", then the agent's messages; while the agent is on the case, the customer's messages go to the agent, masked first (H4).

**Evidence:** `src/lib/agent/service.test.ts` (accept once, no writing before accepting, scoping by customer, masking, polling order), `briefing.test.ts`, agent-session tests in `auth.test.ts`; a two-browser run (agent + customer) on a local server with the seeded memory store.

**Trade-offs and limits:** one shared login (no per-agent attribution or routing by `agent_pools`); polling adds a request every 2 s per open screen; no notification when the agent's tab is in the background beyond the count in the tab title; the 300+ open test cases from evaluation runs are hidden by default (environment filter), not deleted.
