# What didn't work (and what we learned)

Everything we tried and replaced, dropped or had to fix, in one place. Failures are part of the evidence the judges ask for ("measured failures", "be honest about what's missing").
**Evidence levels:** 📊 reproducible from a script/report in the repo · 📝 measured in an ad-hoc run (script not saved; numbers recorded here and in the decision log) · 🔎 observed (logs, screenshots, commit history).

## Modeling

| # | What we tried | Result | What replaced it / lesson | Evidence |
|---|---|---|---|---|
| M1 | Using the organizer transcripts to learn intents | 171K transcripts have 42 distinct customer texts; every label is "consulta_general" | Wrote our own labeled ES/PT phrase set. Check the data can teach the task before choosing the method | 📊 reports/data_quality.md, data-issues B1–B2 |
| M2 | v0: e5-small + softmax, 7 families per label | 64% CV accuracy vs 79% for keyword rules; errors grouped by **topic**, not intent | More varied scenarios (+70 training families, hard negatives) → 75.5%. **Data variety beat model changes** | 📝 first CV run; 📊 current reports/embedding_comparison.md |
| M3 | k-nearest-neighbours on embeddings (k = 1, 3, 5, 9) | 49–53% CV accuracy | Dropped: worse than softmax regression with few examples per intent | 📝 intent-model.md D7 |
| M4 | Concatenating two embedding models (e5 + paraphrase-MiniLM) | 65–66% CV (+2 points) | Dropped: small gain for double the cost | 📝 D7 |
| M5 | Embeddings + character TF-IDF features | 58–60% CV (worse) | Dropped | 📝 D7 |
| M6 | Embeddings + keyword-rule outputs as features | 79–81% CV | **Rejected on principle:** the keywords encode the author's knowledge of held-out phrases, contaminating the comparison with the baseline | 📝 D9 |
| M7 | paraphrase-multilingual-MiniLM (expected to capture intent better) | 69.7% CV, below e5-small (75.5%) | Kept e5-small for v1. Our intuition was wrong; measure instead | 📊 embedding_comparison.md |
| M8 | distiluse-base-multilingual | 74.8% CV | Not better than e5-small | 📊 |
| M9 | LaBSE | 79.9% CV (+4.3, significant) | **Too big for Vercel** (472 MB vs 250 MB limit). Kept as a stretch goal (own server) | 📊 D6 |
| M10 | Amazon Titan Text Embeddings V2 (1024 and 512 dims) | 80.1% / 78.5% CV | Beaten by Cohere (84.6%); also 0.5–1 s per call and a 60/min quota | 📊 D15 |
| M11 | Char TF-IDF + softmax as a second baseline | 76.2% test, asks on 61% of clear messages | Kept only as a reference row | 📊 reports/intent_eval_*.md |
| M12 | v1 (e5-small) as the live model | 85.7% test | Replaced by v2 (Cohere, 91.7%); **kept as the in-app fallback** | 📊 |
| M13 | Near-duplicate threshold 0.92 (calibrated on translations) | Over-flags short phrases that share one word (109 flags, 2 real near-copies) | Kept, with manual review; documented that cosine similarity alone overstates leakage for short texts | 📊 reports/split_leakage.md |

## Evaluation process

| # | What went wrong | Impact | Fix / lesson | Evidence |
|---|---|---|---|---|
| E1 | v1 test runs 1–2 crashed while formatting the report (sort on a dropped column) | Metrics were computed and logged before the crash; no results displayed | Fixed the sort; all runs kept in the log | 📊 reports/test_runs.jsonl, D13 |
| E2 | v1 run 3: macro-F1 confidence interval scored labels missing from a resample as 0 | Lower bound shown as 0.54 instead of 0.73 | Compute F1 over labels present in each resample | 📊 D13 |
| E3 | The test set was reused for v2 | Each reuse weakens it a little | Decided on CV/validation, committed before the run, reported v1 and v2. A fresh human-written test set is still needed | 📊 D15 |
| E4 | Keyword baseline written before the new training data | It dropped to 60% on new vocabulary, which would have been an unfair comparison | Extended the rules from training data only (v2 rules) | 📊 D8 |

## Production and infrastructure

| # | Problem | Cause | Fix / lesson | Evidence |
|---|---|---|---|---|
| P1 | Every production request returned 500 | onnxruntime-node needs its CommonJS files and native binary, which Vercel's file tracer didn't include | Explicit `outputFileTracingIncludes` (Linux x64 only) | 🔎 commit b770217, runtime logs |
| P2 | **The fallback crashing took down the primary path too** | The fallback module was imported at the top of the route | Lazy import; a broken fallback now only affects fallback traffic | 🔎 b770217 |
| P3 | First request after a deploy timed out, then the retry succeeded | **My first diagnosis (credentials) was incomplete.** The real main cause: loading the 118 MB fallback model at boot starved the first Bedrock call of CPU | Warm the fallback with `after()` (post-response); credentials get their own budget | 🔎 45d9389 (partial fix), f2f97cd (real fix), logs |
| P4 | Fallback confidences differ slightly from training (≤ 0.03) | Training embedded phrases in one batch; the 8-bit model calibrates per batch | Documented; embed one at a time before the next retrain | 🔎 parity check (28/28 labels matched) |
| P5 | Function over Vercel's 250 MB limit (287 MB runtime for every OS) | Package ships Mac/Windows/Linux binaries | Exclude non-Linux binaries (~204 MB total) | 🔎 next.config.ts |
| P6 | Build/type errors from `"name 2.ts"` files | The repo is on an iCloud-synced Desktop | tsconfig ignores the pattern; moving the repo recommended | 🔎 |
| P7 | No conversation memory: answers to clarifying questions misread, details re-asked | Phase 1 handles each message in isolation (known scope limit) | Fixed by steps 9 + 11 (conversation.md) | 🔎 docs/test-conversations.md |
| P8 | A refund demand overwrote the disputed amount ("devolviste 5000" replaced 120) (Miguel, 2026-09-29) | Details were merged on every turn, whatever the topic | Only dispute turns contribute details; unit test added. **Lesson:** "grounded in the text" isn't enough; the number must also be *about the charge* | 🔎 conversation.md C10, dialogue.test.ts |
| P9 | Using the intent model to read "review or agent?" answers (Miguel, 2026-09-29) | "revisen el cargo" scored `human_agent` 31%, dispute intents < 10%: trained on opening messages, not menu choices | Code reads menu choices with keywords, like yes/no. **Lesson:** a classifier answers the question it was trained on | 🔎 conversation.md C10 |

## Setup dead ends

| # | What we tried | What happened | What we did instead |
|---|---|---|---|
| S1 | AWS API MCP Server desktop extension | Crashes on start (`McpError` import error in its dependency) | Used the AWS MCP connector (OAuth via AWS Sign-in) |
| S2 | Vercel CLI for deploys | Logged into a different Vercel account (publink) | Vercel connector + Git-triggered deploys |
| S3 | Linking the repo in Vercel at project creation | Needed a GitHub login connection first; the connector can't relink an existing project | Recreated the project linked to Git |
| S4 | Running the embedding comparison through the AWS connector | Sandbox can't see the repo, and results would be too large to pass back | Least-privilege AWS profile for local scripts |
| S5 | Titan embeddings at full speed | New-account quota of 60 requests/min; ~15 min per run | Accepted for the comparison; Cohere batches 96 texts per call |
| S6 | Cohere models on day one | Blocked for a few hours by new-account verification | Retried after it cleared |
| S7 | Data Dictionary credentials | The first PDF version had none on page 1 | The organizers published an updated version |

## Gaps in this record

- The ad-hoc experiments (M3–M6) were run inline, not saved as scripts, so those numbers can't be regenerated exactly. A future `pipeline/experiments/` script could reproduce them against the git history's phrase set (commit `d5ccd02` for the 88-family version).
