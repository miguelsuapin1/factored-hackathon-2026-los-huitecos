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
**Status:** proposed by Carlos, bronze layer built; team to confirm. Supersedes the "ETL" row of D-001 only; S3 stays the source of truth and Supabase stays the serving DB.

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
