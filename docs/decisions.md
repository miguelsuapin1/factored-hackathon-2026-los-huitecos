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
