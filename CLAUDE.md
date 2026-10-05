@AGENTS.md

# Project context
Factored AI & Data Hackathon 2026 (10-day sprint from 2026-09-25, deadline ~2026-10-05, to confirm). Team: Miguel (miguelsuapin1), lpcuellar, Carloscuellark.
We build **transaction-dispute intake** (unrecognized charges + wrongful fees) for a **fictional bank, "GT Bank"**, in Spanish and Portuguese.
Read first: [docs/phase-1-walkthrough.md](docs/phase-1-walkthrough.md) (what exists and why). Brief: docs/challenge.md. Decisions: docs/decisions.md, docs/intent-model.md (D1–D16), docs/reply-generation.md (R1–R7), docs/conversation.md (C1–, steps 9 + 11), docs/policy.md (PL-1–PL-8, step 12), docs/verification.md (V1–V5, step 13), docs/handoff.md (H1–H4, R8, step 14), docs/evaluation.md (EV-1–EV-6, steps 16–19; findings docs/evaluation-findings.md, team requests docs/team/evaluation-requests.md). Team interfaces: docs/contracts.md. Data findings: docs/contact-reason-analysis.md, docs/data-issues.md. What failed and was replaced: docs/lessons-learned.md (add new entries as they happen).

## Current state (end of Phase 1, 2026-09-29)
- Live: https://latam-bank-service-sigma.vercel.app — `/` sign-in, `/app` chat. Every push to `main` deploys.
- One turn = `POST /api/chat`: intent (`src/lib/intent/`) → reply (`src/lib/reply/`). `POST /api/classify` = intent only (for evaluation).
- **Intent:** Cohere Embed Multilingual v3 on Bedrock → softmax regression (`src/lib/intent-model-cohere-mv3.json`, threshold 0.70). Fallback: multilingual-e5-small bundled in the function (`src/lib/intent-model-e5small.json`, threshold 0.61). Test: 91.7% accuracy, 0 wrong actions.
- **Reply:** Claude Haiku 4.5 (`claude-haiku-4-5`) phrases a code-chosen instruction; code rejects replies with numbers not in the customer message; ES/PT templates as fallback. `PROMPT_VERSION` in compose.ts.
- **Auth (step 8, D-006):** test logins in Supabase `public.app_users` (PBKDF2 hashes, `pipeline/seed_test_users.py`) + the shared demo account (env `DEMO_*` → demo customer). The session cookie carries the customer id; customer data is read only via `src/lib/db/scoped.ts` as role `lookup_reader` (env `SUPABASE_LOOKUP_DB_URL`) under RLS. Check: `supabase/tests/step8_rls_check.sql`.
- Tracing: one JSON log line per turn (`event: "turn"`) in Vercel runtime logs. Not persisted yet.
- **Steps 9 + 11 (branch `miguel/step-9-11-memory`, 2026-09-29):** conversation memory, extraction and confirmation in `src/lib/conversation/` (docs/conversation.md C1–C10). The state is a signed token the client sends back; dialogue rules are pure code with unit tests (`npm test`). TC-01 fixed.
- **Step 12 (branch `miguel/step-12-policy`, 2026-09-30):** policy rules PL-1..PL-8 in `src/lib/policy/` (docs/policy.md); fraud-score cutoff 30 from `pipeline/fraud_threshold.py` (held-out 2026 check). Lookup: Supabase since step 10 (stand-in `src/lib/lookup/mock.ts` when no database URL); swap point `src/lib/lookup/index.ts`.
- **Step 13 (branch `miguel/step-13-verification`, 2026-09-30):** every review/hand-off is a row in Supabase `public.cases` (server-only, RLS on, no policies; env `SUPABASE_SECRET_KEY`), written then read back before the reply quotes its reference (docs/verification.md V1–V5).
- **Step 14 (branch `miguel/step-14-handoff`, 2026-09-30):** asking for a person creates a case (one-line summary if no context), sensitive data masked at the door (`src/lib/privacy/mask.ts`), code check against timing promises (docs/handoff.md H1–H4, R8).
- **Status answers (branch `miguel/status-answers`, 2026-09-30):** status questions use the lookup and are answered from the record (PL-9, S1–S2 in docs/policy.md); explain-only replies can't offer actions (R9).
- **Vague dates + picking (branch `miguel/vague-dates-pick`, 2026-09-30):** Miguel's ladder (docs/policy.md "When the customer can't give an exact date", PL-10, C12b/c–C14).
- **C15 (branch `miguel/skip-charge-clarify`, 2026-09-30):** no "A or B?" between two charge intents; words decide the kind, else status first (docs/conversation.md C15).
- **Step 7 (branch `Phase2_Cuellar`, Carlos, 2026-10-01):** bronze/silver/gold in BigQuery (dbt, `pipeline/dbt`), gold serving slice loaded into Supabase (`customers`, `products`, `transactions`, `fx_rates`, `agent_pools`, `data_version`; server-only). Log: docs/phase-2-data-log.md.
- **Step 8 (branch `Phase2_Cuellar`, Carlos, 2026-10-01):** per-customer login + RLS (see Auth above).
- **Step 10 (branch `carlos/step-10-lookup`, Carlos, 2026-10-01):** Supabase lookup `src/lib/lookup/sql.ts` (K2), used when `SUPABASE_LOOKUP_DB_URL` is set, stand-in otherwise; same matching rules as the stand-in (`match.ts`), parity test `src/lib/lookup/sql.test.ts` (`LOOKUP_TEST_DB_URL=... npm test`).
- **Evidence track (Luis Pedro, PRs #16–#20, 2026-10-01):** K5 demo/test customers in docs/contracts.md. Harness `evals/` (`npm run eval`): replays conversations against a running app and grades code-decided fields (EV-1); suites `tc` (TC-01…21), `step17` (personas), `break` (24 probes + 14 protocol attacks). `npm run eval:report` → `reports/eval_<name>.md` vs. a human-only baseline (EV-3); inputs kept in `evals/results/`. Step 16 scorer `pipeline/score_human.py` + `evals/human/` (messages not written yet). Step 18 on Cohere (2026-10-04, deployed app, `--repeat 3`): tc 63/63, step17 33/33, break 66/72 (PI-4, EF-6), 0 wrong actions, 0 leaks (`reports/eval_production-cohere.md`). Step 16: 31 human messages (one author), 83.3% accuracy, 0 wrong actions (`reports/intent_eval_human.md`).
- **EF-1, EF-4, C17 (branch `miguel/fix-ef1-ef4-date-loop`, 2026-10-02):** PL-2 asks the date before the merchant (EF-1); PINs/CVVs masked before their label too (EF-4); unusable dates are said, not re-asked: year-less future → last year, stated dates up to 365 days (the slice's 12 months; older → a person, PL-11), searches without a date still 180 days, re-asks capped at two (C17, docs/conversation.md). State token v7.
- **Jev experiment (branch `miguel/jev-validation`, 2026-10-02, D18):** `pipeline/jev_validation.py` compares Jev (TypeSafe) with Cohere on validation and exports question + threshold (0.99) to `src/lib/intent-model-jev.json`; a "Use Jev" toggle in the chat (`src/lib/intent/jev.ts`) only where `JEV_TOGGLE=1` + `TYPESAFE_API_KEY` (local/Preview, never Production). Masked text only, masked again at the Jev boundary.
- Not built yet: agent console.

## Phase 2 plan (build steps 7–21, see the published build plan)
Data & access: 7 pipeline + Supabase load + labeled fixtures · 8 test login + row-level security · 9 extract amount/date/merchant · 10 transaction lookup tool.
Control: 11 memory + confirmation · 12 policy engine (code thresholds) · 13 verification · 14 structured handoff · 15 second opinion (optional; idea: keyword rules vs model disagreement → ask).
Evidence: 16 human-written tests · 17 test conversations · 18 eval report (start early) · 19 break-it cases · 20 agent console · 21 repo rename `factored-hackathon-2026-[team]`, one-command setup, slides, video.

## Rules we follow (keep them)
- **Banking77 (D-004):** allowed for training only, never evaluation; document every use.
- **Sealed test set.** `data/phrases/split_manifest.json` stores a SHA-256 of test phrases; scripts refuse to run if it changes. New training data: `uv run python pipeline/split.py --add-to-train`. Never tune on test.
- **Test runs:** `pipeline/train_intent.py` evaluates test only with `--test`; every run is appended to `reports/test_runs.jsonl`. Commit the decision/code BEFORE running `--test`, and document it in docs/intent-model.md.
- **Policy lives in code, not prompts.** The LLM phrases; code decides what may be said or done. No money movement, ever.
- **Label provenance:** team-generated/synthetic data is labeled as such (see data/phrases/LABELING_GUIDE.md).
- Never commit customer data (data/raw is git-ignored) or secrets (.env* ignored except .env.example). The repo is public.
- Reproducible numbers: reports are generated by scripts; don't hand-edit files in `reports/`.

## Git workflow
- `main` is protected: everyone (Miguel included, see docs/conversation.md C1) works on a branch (`miguel/step-9-11-memory`, `step-7-pipeline`, ...) and opens a pull request; Miguel merges with **"Create a merge commit"** (Vercel Hobby deploys production from the merge). Force pushes and deleting `main` are blocked; the repo admin can still push directly.
- Every push to `main` deploys to production, so keep `main` working. Push branches after every commit so the team sees progress (Vercel builds a preview per branch).
- **Say who did what:** commit subjects start with the author tag (`[Miguel] Step 9: ...`); decision entries carry `(Name, YYYY-MM-DD)`.
- **Interfaces between people live in docs/contracts.md** (K1 chat API, K2 lookup, K3 handoff, K4 trace). Change one only in a PR that edits that file.

## Commands
```bash
npm run dev                                   # app (predev fetches the fallback model into ./models)
./scripts/download_data.sh                    # organizer S3 data -> data/raw (AWS profile "factored")
uv run python pipeline/bronze.py              # raw CSVs -> data/processed/bronze.duckdb
uv run python pipeline/phrases.py             # validate phrase families -> phrases.csv + phrase_texts.json
node scripts/embed_phrases.mjs                # e5-small embeddings (same settings the app serves)
uv run python pipeline/embed_bedrock.py cohere-mv3   # Cohere embeddings (AWS profile "bedrock"; quota 20 req/min)
uv run python pipeline/split.py               # verify the sealed split
(cd pipeline/dbt && uv run dbt build --profiles-dir . --target bq)   # silver + gold in BigQuery (gcloud login)
(cd pipeline/dbt && uv run python fixtures/build_fixture_bronze.py && DBT_DUCKDB_PATH=../../data/processed/fixture.duckdb uv run dbt build --profiles-dir . --target duckdb --vars '{fixtures: true}')  # offline
(cd pipeline && uv run python compare_embeddings.py) # model selection by grouped CV (test untouched)
(cd pipeline && uv run python train_intent.py --embedding cohere-mv3)  # validation only; --test is logged
(cd pipeline && uv run python jev_validation.py)    # Jev (TypeSafe) vs Cohere on validation (D18); needs TYPESAFE_API_KEY
npm run eval -- --suite tc|step17|break       # evaluation harness against a running app (paced 15 turns/min)
npm run eval:report -- --name <name>          # reports/eval_<name>.md from the newest runs
uv run python pipeline/score_human.py         # step 16: intent model vs keyword rules on human-written messages
```

## Accounts & infrastructure
Account ids, project ids and IAM details are kept out of the public repo: see your git-ignored `CLAUDE.local.md` (ask Miguel for his copy).

## Gotchas we already hit
- **Next.js 16:** middleware is `src/proxy.ts`; read `node_modules/next/dist/docs/` before using an API (see AGENTS.md).
- **Vercel bundle:** onnxruntime-node and sharp load native binaries dynamically; `next.config.ts` includes them explicitly (Linux x64 only) and excludes other platforms to stay under 250 MB (~204 MB now). If the fallback breaks in production, check the traced files first.
- **Fallback isolation:** `embed-local` is imported lazily and warmed with `after()`; importing it at module top-level once took down the whole route, and warming it at boot starved the first Bedrock call.
- **Embedding parity:** `scripts/embed_phrases.mjs` currently embeds in one batch; q8 activations calibrate per batch, so serving (one message at a time) differs by ≤0.03 in confidence. Switch to one-at-a-time before the next e5 retrain.
- **iCloud Desktop:** the repo lives on an iCloud-synced Desktop, which creates `"name 2.ext"` duplicates (tsconfig ignores `* 2.ts`). Moving the repo off the Desktop is recommended.
- Portuguese regexes: JS `\b` doesn't treat accented letters as word characters.
- **Evaluation runs:** without `SUPABASE_LOOKUP_DB_URL` the app silently uses the stand-in lookup (only demo.mx and otro.mx have data; the runner marks other logins invalid). Without the `bedrock` AWS profile every turn waits ~2 s for Cohere to fail, then uses e5-small. Harness runs write real rows to `public.cases` (environment `local`).
