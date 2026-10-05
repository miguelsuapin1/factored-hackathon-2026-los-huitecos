# LATAM Bank Service

A bilingual (🇪🇸 Spanish / 🇧🇷 Portuguese) **banking customer-service system** — not a chatbot. It understands the customer, uses the right tools, verifies that actions happened, knows when *not* to act, and hands off to a human with a structured summary.

> Status: **Phase 2, build steps 7–21.** What exists and why: [docs/phase-1-walkthrough.md](docs/phase-1-walkthrough.md). Brief: [docs/challenge.md](docs/challenge.md). Decisions: [docs/decisions.md](docs/decisions.md). How it's evaluated: [docs/evaluation.md](docs/evaluation.md).

**Live:** https://latam-bank-service-sigma.vercel.app (auto-deploys from `main`)

## Demo access
The app opens on a sign-in page. Each test login is one customer of the synthetic bank and can only see that
customer's data: the session cookie (signed, HttpOnly, 8 hours) carries the customer id, and the database enforces it
with row-level security (decision D-006). Test logins live in Supabase `public.app_users` as password hashes; the
shared demo account (`DEMO_USERNAME`, `DEMO_PASSWORD`) signs in as the synthetic demo customer. Credentials are shared
with the judges in the submission and never committed.

**Agent console** (`/agent`, decision D-007): when the assistant hands a customer to a person, the request appears
there with the case facts and a code-built summary; an agent accepts it and chats with the customer in the same chat
window. One shared agent login (`AGENT_USERNAME`, `AGENT_PASSWORD`). Without `SUPABASE_SECRET_KEY` (local only) it
runs on three seeded synthetic requests.

## Stack
| Layer | Choice |
|---|---|
| App / API | Next.js (App Router, TypeScript) on Vercel |
| Data | BigQuery (bronze/silver/gold, dbt) → serving slice in Supabase Postgres, `sa-east-1` (São Paulo), row-level security |
| Intent | Cohere Embed Multilingual v3 on AWS Bedrock + softmax regression; multilingual-e5-small in the function as fallback |
| LLM | Claude Haiku 4.5: extracts details and phrases code-chosen replies; code decides every action |

Recommended platforms (Snowflake / AWS / Azure / Databricks) to be evaluated later — see D-001.

## Repo layout
```
src/            Next.js app + API routes
src/lib/        shared clients (supabase, ...)
supabase/       SQL migrations (source of truth for schema + RLS)
data/raw/       raw inputs — git-ignored, never commit customer data
data/processed/ reproducible outputs of the prep pipeline
evals/          evaluation harness, test conversations, break-it suite, report generator (docs/evaluation.md)
docs/           meeting notes, decisions, honest "what's missing"
```

## Getting started
```bash
npm install
./scripts/download_data.sh    # needs `aws configure --profile factored` (keys: Data Dictionary p.2, never commit them)
cp .env.example .env.local   # fill in server-only secrets
npm run dev
```

### Data pipeline & analysis
```bash
uv sync                                   # Python deps (DuckDB, pandas)
uv run python pipeline/bronze.py          # data/raw CSVs -> data/processed/bronze.duckdb (verbatim + lineage)
(cd pipeline && uv run python dq_checks.py)   # -> reports/data_quality.md
uv run python analysis/contact_reasons.py # -> reports/contact_reasons.md
```

#### BigQuery bronze (D-003, shared copy of all 13 tables incl. digital_events)
Raw CSVs are copied S3 → `gs://factored_gt_latam_bank_raw/raw/` by a one-off Storage Transfer job, then:
```bash
gcloud auth application-default login                    # once, with an account on the GCP project
uv run python pipeline/bigquery/bronze_bq.py --print     # show the SQL (no GCP access needed)
uv run python pipeline/bigquery/bronze_bq.py             # raw_ext (external) + bronze (native) datasets, us-east1
uv run python pipeline/bigquery/bronze_bq.py --verify    # row counts vs the DuckDB bronze numbers
```

### Intent phrase set (classifier data)
```bash
uv run python pipeline/phrases.py   # validate data/phrases/families.jsonl -> phrases.csv
node scripts/embed_phrases.mjs      # embed with the same model the app serves (src/lib/embedding-config.json)
uv run python pipeline/split.py     # verify the sealed train/validation/test split -> reports/split_leakage.md
(cd pipeline && uv run python train_intent.py --embedding cohere-mv3)   # validation only; --test for the logged test run
uv run python pipeline/embed_bedrock.py cohere-mv3   # Bedrock embeddings (AWS profile "bedrock")
```
Labels and rules: [data/phrases/LABELING_GUIDE.md](data/phrases/LABELING_GUIDE.md)

### Evaluation (steps 16–19, [docs/evaluation.md](docs/evaluation.md))
```bash
npm test                                    # unit tests: the app's rules and the harness itself
npm run dev                                 # then, in another terminal:
npm run eval                                # TC-01…TC-21 against the running app
npm run eval -- --suite step17              # persona conversations
npm run eval -- --suite break               # break-it cases and protocol attacks
npm run eval:report -- --name <name>        # reports/eval_<name>.md from the newest runs
uv run python pipeline/score_human.py       # intent model vs. keyword rules on human-written messages
```
Findings and fixes: [docs/evaluation-findings.md](docs/evaluation-findings.md) · what the evaluation needs from the team: [docs/evaluation-requests.md](docs/evaluation-requests.md)
Findings: [docs/contact-reason-analysis.md](docs/contact-reason-analysis.md) · issue register: [docs/data-issues.md](docs/data-issues.md)

## What's missing (keep this honest)
- [x] Dataset + final instructions (S3; architecture in docs/decisions.md D-001)
- [x] Use case: transaction-dispute intake (D-002)
- [x] Intent phrase set (ES/PT, team-generated) + sealed train/validation/test split
- [ ] Native Portuguese review of the phrase set
- [x] Intent classifier vs keyword baseline: [docs/intent-model.md](docs/intent-model.md) (offline, synthetic data)
- [x] Phase 1 chat page: intent API with Cohere (Bedrock, keyless via Vercel OIDC) and in-app fallback
- [x] Phase 1 replies: Claude Haiku phrases code-chosen content in ES/PT, validated, with template fallback ([docs/reply-generation.md](docs/reply-generation.md))
- [x] Per-customer login + row-level security (D-006), structured human hand-off ([docs/handoff.md](docs/handoff.md)), verified cases ([docs/verification.md](docs/verification.md))
- [x] End-to-end evaluation harness, break-it suite and report generator ([docs/evaluation.md](docs/evaluation.md)); first report on the fallback model: [reports/eval_local-fallback.md](reports/eval_local-fallback.md)
- [ ] Evaluation on the production model (Cohere), with repeats for run-to-run variance
- [ ] Human-written test messages (step 16): scorer ready, messages not yet written ([evals/human/README.md](evals/human/README.md))
- [ ] Fixes for evaluation findings EF-1 (premature hand-off) and EF-4 (PIN before its label not masked)
- [ ] Observability: one trace line per turn in Vercel logs, not persisted
