@AGENTS.md

# Project context
Factored AI & Data Hackathon 2026 (10-day sprint from 2026-09-25, deadline ~2026-10-05, to confirm). Team: Miguel (miguelsuapin1), lpcuellar, Carloscuellark.
We build **transaction-dispute intake** (unrecognized charges + wrongful fees) for a **fictional bank, "GT Bank"**, in Spanish and Portuguese.
Read first: [docs/phase-1-walkthrough.md](docs/phase-1-walkthrough.md) (what exists and why). Brief: docs/challenge.md. Decisions: docs/decisions.md, docs/intent-model.md (D1–D16), docs/reply-generation.md (R1–R7), docs/conversation.md (C1–, steps 9 + 11), docs/policy.md (PL-1–PL-8, step 12), docs/verification.md (V1–V5, step 13), docs/handoff.md (H1–H4, R8, step 14). Team interfaces: docs/contracts.md. Data findings: docs/contact-reason-analysis.md, docs/data-issues.md. What failed and was replaced: docs/lessons-learned.md (add new entries as they happen).

## Current state (end of Phase 1, 2026-09-29)
- Live: https://latam-bank-service-sigma.vercel.app — `/` sign-in, `/app` chat. Every push to `main` deploys.
- One turn = `POST /api/chat`: intent (`src/lib/intent/`) → reply (`src/lib/reply/`). `POST /api/classify` = intent only (for evaluation).
- **Intent:** Cohere Embed Multilingual v3 on Bedrock → softmax regression (`src/lib/intent-model-cohere-mv3.json`, threshold 0.70). Fallback: multilingual-e5-small bundled in the function (`src/lib/intent-model-e5small.json`, threshold 0.61). Test: 91.7% accuracy, 0 wrong actions.
- **Reply:** Claude Haiku 4.5 (`claude-haiku-4-5`) phrases a code-chosen instruction; code rejects replies with numbers not in the customer message; ES/PT templates as fallback. `PROMPT_VERSION` in compose.ts.
- **Auth:** demo gate only (`src/proxy.ts`, `src/lib/auth/session.ts`), env `DEMO_USERNAME`, `DEMO_PASSWORD`, `SESSION_SECRET`. Per-customer test login is Phase 2.
- Tracing: one JSON log line per turn (`event: "turn"`) in Vercel runtime logs. Not persisted yet.
- **Steps 9 + 11 (branch `miguel/step-9-11-memory`, 2026-09-29):** conversation memory, extraction and confirmation in `src/lib/conversation/` (docs/conversation.md C1–C10). The state is a signed token the client sends back; dialogue rules are pure code with unit tests (`npm test`). TC-01 fixed.
- **Step 12 (branch `miguel/step-12-policy`, 2026-09-30):** policy rules PL-1..PL-8 in `src/lib/policy/` (docs/policy.md); fraud-score cutoff 30 from `pipeline/fraud_threshold.py` (held-out 2026 check). Lookup is a stand-in (`src/lib/lookup/mock.ts`, synthetic) until Person 2's step 10; swap point `src/lib/lookup/index.ts`.
- **Step 13 (branch `miguel/step-13-verification`, 2026-09-30):** every review/hand-off is a row in Supabase `public.cases` (server-only, RLS on, no policies; env `SUPABASE_SECRET_KEY`), written then read back before the reply quotes its reference (docs/verification.md V1–V5).
- **Step 14 (branch `miguel/step-14-handoff`, 2026-09-30):** asking for a person creates a case (one-line summary if no context), sensitive data masked at the door (`src/lib/privacy/mask.ts`), code check against timing promises (docs/handoff.md H1–H4, R8).
- **Status answers (branch `miguel/status-answers`, 2026-09-30):** status questions use the lookup and are answered from the record (PL-9, S1–S2 in docs/policy.md); explain-only replies can't offer actions (R9).
- **Vague dates + picking (branch `miguel/vague-dates-pick`, 2026-09-30):** Miguel's ladder (docs/policy.md "When the customer can't give an exact date", PL-10, C12b/c–C14).
- **C15 (branch `miguel/skip-charge-clarify`, 2026-09-30):** no "A or B?" between two charge intents; words decide the kind, else status first (docs/conversation.md C15).
- Not built yet: data cleaning layer (silver/gold), Supabase load of the gold slice, real lookup tool, eval harness, agent console.

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
(cd pipeline && uv run python compare_embeddings.py) # model selection by grouped CV (test untouched)
(cd pipeline && uv run python train_intent.py --embedding cohere-mv3)  # validation only; --test is logged
```

## Accounts & infrastructure
- GitHub `miguelsuapin1/latam-bank-service` (public). No `gh` CLI; git uses the keychain credential.
- Vercel team `miguelsuapin-1909s-projects` (team_WtIAxy18QvOOQWBoFrcnidFW), project `latam-bank-service` (prj_gGZ6kb85SYj3GESHcr2pj3wqenvT). **The local `vercel` CLI is logged into a different account (publink): use the Vercel connector, not the CLI.**
- Vercel env: `AWS_ROLE_ARN` (OIDC role `latam-bank-vercel`, keyless, can only invoke Cohere embed), `BEDROCK_REGION`, `DEMO_*`, `SESSION_SECRET`, `ANTHROPIC_API_KEY` (sensitive).
- AWS account 082229155656 (Free plan, credits). Local profiles: `factored` (organizer's read-only S3 keys), `bedrock` (IAM user latam-bank-bedrock, embeddings only). IAM user `miguel` is read-only; IAM changes need root (Miguel does them).
- Supabase project `paguvqqelfwadcolocaq` (org "hackathon", sa-east-1), empty so far. Schema changes go in supabase/migrations/.

## Gotchas we already hit
- **Next.js 16:** middleware is `src/proxy.ts`; read `node_modules/next/dist/docs/` before using an API (see AGENTS.md).
- **Vercel bundle:** onnxruntime-node and sharp load native binaries dynamically; `next.config.ts` includes them explicitly (Linux x64 only) and excludes other platforms to stay under 250 MB (~204 MB now). If the fallback breaks in production, check the traced files first.
- **Fallback isolation:** `embed-local` is imported lazily and warmed with `after()`; importing it at module top-level once took down the whole route, and warming it at boot starved the first Bedrock call.
- **Embedding parity:** `scripts/embed_phrases.mjs` currently embeds in one batch; q8 activations calibrate per batch, so serving (one message at a time) differs by ≤0.03 in confidence. Switch to one-at-a-time before the next e5 retrain.
- **iCloud Desktop:** the repo lives on an iCloud-synced Desktop, which creates `"name 2.ext"` duplicates (tsconfig ignores `* 2.ts`). Moving the repo off the Desktop is recommended.
- Portuguese regexes: JS `\b` doesn't treat accented letters as word characters.
