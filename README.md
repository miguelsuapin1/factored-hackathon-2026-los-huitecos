# LATAM Bank Service

A bilingual (🇪🇸 Spanish / 🇧🇷 Portuguese) **banking customer-service system** — not a chatbot. It understands the customer, uses the right tools, verifies that actions happened, knows when *not* to act, and hands off to a human with a structured summary.

> Status: **scaffolding.** Official brief summarized in [docs/challenge.md](docs/challenge.md); dataset location pending. See [docs/meeting-notes.md](docs/meeting-notes.md) for kickoff notes and [docs/decisions.md](docs/decisions.md) for open decisions.

**Live:** https://latam-bank-service-sigma.vercel.app (auto-deploys from `main`)

## Stack (provisional)
| Layer | Choice |
|---|---|
| App / API | Next.js (App Router, TypeScript) on Vercel |
| Data | Supabase Postgres — region `sa-east-1` (São Paulo) |
| LLM | TBD |

Recommended platforms (Snowflake / AWS / Azure / Databricks) to be evaluated later — see D-001.

## Repo layout
```
src/            Next.js app + API routes
src/lib/        shared clients (supabase, ...)
supabase/       SQL migrations (source of truth for schema + RLS)
data/raw/       raw inputs — git-ignored, never commit customer data
data/processed/ reproducible outputs of the prep pipeline
evals/          baseline vs. system evaluation (strict train/eval isolation)
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

### Intent phrase set (classifier data)
```bash
uv run python pipeline/phrases.py   # validate data/phrases/families.jsonl -> phrases.csv
node scripts/embed_phrases.mjs      # embed with the same model the app serves (src/lib/embedding-config.json)
uv run python pipeline/split.py     # verify the sealed train/validation/test split -> reports/split_leakage.md
(cd pipeline && uv run python train_intent.py --embedding cohere-mv3)   # validation only; --test for the logged test run
uv run python pipeline/embed_bedrock.py cohere-mv3   # Bedrock embeddings (AWS profile "bedrock")
```
Labels and rules: [data/phrases/LABELING_GUIDE.md](data/phrases/LABELING_GUIDE.md)
Findings: [docs/contact-reason-analysis.md](docs/contact-reason-analysis.md) · issue register: [docs/data-issues.md](docs/data-issues.md)

## What's missing (keep this honest)
- [x] Dataset + final instructions (S3; architecture in docs/decisions.md D-001)
- [x] Use case: transaction-dispute intake (D-002)
- [x] Intent phrase set (ES/PT, team-generated) + sealed train/validation/test split
- [ ] Native Portuguese review of the phrase set
- [x] Intent classifier vs keyword baseline: [docs/intent-model.md](docs/intent-model.md) (offline, synthetic data)
- [ ] Full system, end-to-end evaluation harness
- [ ] Observability, security (prompt-injection defenses, RLS), structured human handoff
