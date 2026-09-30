# Intent model: model card and decision log

The component that reads a customer message and decides what they want. It is the **learned component** the challenge asks us to evaluate against a baseline. Everything here is reproducible from the repo (commands at the end).

## Summary

| | |
|---|---|
| **What it does** | Classifies a message into 7 intents and gives a confidence. Below the threshold the system **asks a clarifying question instead of acting** |
| **Primary model (v2)** | Cohere Embed Multilingual v3 on Amazon Bedrock (1024 numbers per message, not trained by us) → multinomial logistic ("softmax") regression (trained by us). Threshold 0.70 |
| **Fallback (v1)** | multilingual-e5-small running inside the app (384 numbers) → softmax regression. Threshold 0.61. Used when Bedrock times out, throttles or fails (D16) |
| **Intents** | unrecognized_charge · wrongful_fee · transaction_status · balance_check · move_money · human_agent · out_of_scope |
| **Training data** | 720 team-generated phrases (Spanish + Portuguese), 120 scenario families. No real customer text exists in the organizer data |
| **Test result (v2)** | 91.7% accuracy (95% CI 85.7–97.6%) on 84 held-out clear phrases; **0 wrong actions**; handles 64% of clear messages without asking (keyword rules: 82.1% accuracy, 17.9% wrong actions) |
| **Cost** | v2: ~0.2 s per message (one Bedrock call), cents per million tokens; quota 20 messages/minute. v1: ~2 ms, no API |
| **Artifacts** | `src/lib/intent-model-cohere-mv3.json` (v2) and `src/lib/intent-model-e5small.json` (v1): weights, bias, threshold, labels, embedding settings, test metrics |
| **Status** | Offline evaluation on synthetic data. Not measured on real traffic |

## Results (test set: 84 clear + 30 ambiguous phrases)

| | Keyword rules (baseline) | TF-IDF + softmax | v1: e5-small + softmax | **v2: Cohere + softmax** |
|---|---|---|---|---|
| Accuracy (95% CI) | 82.1% (71.4–91.7) | 76.2% (59.5–91.7) | 85.7% (73.8–96.4) | **91.7% (85.7–97.6)** |
| Macro-F1 (95% CI) | 0.819 (0.730–0.907) | 0.732 (0.610–0.931) | 0.856 (0.732–0.966) | **0.917 (0.842–0.978)** |
| Spanish / Portuguese | 83.3% / 81.0% | 76.2% / 76.2% | 83.3% / 88.1% | **92.9% / 90.5%** |
| **Wrong actions** (acted, and wrong) | 17.9% | 1.2% | 0.0% | **0.0%** |
| Needless questions (asked on a clear message) | 0% (can't ask) | 60.7% | 57.1% | **35.7%** |
| Ambiguous messages where it asked | 0% | 80.0% | 70.0% | **93.3%** |
| Mean decision cost (lower is better) | 1.184 | 0.596 | 0.579 | **0.298** |
| Model hash / frozen commit | - | - | `21f25214ab61` / `9a3c0b6` | `cdc00ad95d9a` / `51ee21d` |

Full reports: [v1](../reports/intent_eval_e5small.md) · [v2](../reports/intent_eval_cohere-mv3.md).

**Paired comparisons (family bootstrap on the same test phrases):**

| Comparison | Difference | 95% CI | Verdict |
|---|---|---|---|
| v1 accuracy − keyword rules | +3.5 pts | −11.9 to +19.0 | not significant |
| v1 wrong actions: rules − v1 | 17.8 pts fewer | 8.3 to 28.6 | **significant** |
| v2 accuracy − keyword rules | +9.6 pts | −2.4 to +21.4 | borderline (p ≈ 0.06) |
| v2 accuracy − v1 | +6.0 pts | −3.6 to +16.7 | not significant on test (CV: +9.1, CI +5.1 to +13.2, significant) |
| v2 coverage − v1 (messages handled without asking) | +21.5 pts | +7.1 to +38.1 | **significant** |

**How to read the v1 result** (kept for the record; v2 follows the same pattern with higher coverage):
1. **Accuracy is not significantly better than the rules.** Paired family bootstrap: +3.5 points, 95% CI −11.9 to +19.0. With 84 test phrases in 14 families we can't claim a real difference.
2. **Safety is significantly better.** Wrong actions drop by 17.8 points (95% CI 8.3–28.6). All 12 of the model's test errors had confidence below 0.61, so the system would have asked instead of acting. The rules have no confidence, so all 15 of theirs would have been acted on.
3. **The cost is many clarifying questions:** 57% of clear messages. This is the main weakness (see Limitations).
4. **Errors are complementary:** only 3 phrases fooled both. Rules and model disagreeing is a useful signal to ask (idea for build step 15).

## Decision log

Each entry: what we chose, what else we considered, and why.

### D1. Train our own phrase set instead of using the organizer transcripts
- **Chose:** 158 families written by us (Claude-generated, labeled team-generated), in Spanish and Portuguese.
- **Alternatives:** train on `call_transcripts` / `complaints.description`.
- **Why:** the organizer text is templated. 171K transcripts contain 42 distinct customer texts that ignore the call's topic, and every intent label is "consulta_general" ([data-issues B1–B3](data-issues.md#b-text-data-is-templated-it-cant-train-or-evaluate-language-understanding)). There's also no Portuguese. A model trained on it would learn nothing.
- **Cost:** one author wrote everything, so style is uniform and results are an upper bound. The human-written test messages (build step 16) will give the honest number.

### D2. Group phrases into families and split by family
- **Chose:** each family = one scenario × {formal, casual, short} × {Spanish, Portuguese}. Whole families go to train, validation or test.
- **Alternative:** a random split by phrase.
- **Why:** the multilingual model maps a sentence and its translation to nearly the same point (median similarity 0.927). A random split would put a phrase in train and its translation in test, and the test score would measure memory, not understanding. This is the "leakage prevention" the judges ask for.

### D3. Three splits, test sealed with a hash
- **Chose:** 60/20/20 by family per label. Ambiguous families only in validation and test. Test fingerprinted (SHA-256) in `split_manifest.json`; any edit makes the scripts refuse to run.
- **Why:** hyperparameters and the threshold need data the model didn't train on (validation). Test must stay untouched until the end, and the hash proves it did.

### D4. Near-duplicate check at similarity ≥ 0.92
- **Chose:** flag any held-out phrase as close to a training phrase from another family as a translation would be. Calibrated from measured similarities: translations median 0.927, different labels 95th percentile 0.874.
- **Finding:** with this model, short phrases score high just by sharing a word, so most flags were keyword overlap, not copies. Two real near-copies were found and fixed on the training side.

### D5. Softmax regression on frozen embeddings (not fine-tuning, not an LLM)
- **Chose:** keep the pretrained embedding model fixed; train only a linear layer (7 × 384 weights + 7 biases).
- **Alternatives considered:** fine-tuning a transformer (needs GPU, more data, hard to reproduce, too big for 10 days); k-nearest-neighbours (tested: ~50% in cross-validation, much worse); asking Claude to classify (planned as a comparison and second opinion; adds latency, cost and an external call per message).
- **Why:** trains in seconds, deterministic, gives probabilities we can threshold, runs in ~2 ms without an API, and is easy to explain. Softmax regression is logistic regression for more than two classes: each intent gets a score from a weighted sum of the 384 embedding numbers, and softmax turns scores into probabilities that add up to 1.

### D6. Embedding model: `multilingual-e5-small`
- **Chose:** e5-small, 8-bit quantized (118 MB), with the "query: " prefix it expects.
- **Compared with grouped 5-fold cross-validation** over train + validation (test untouched), [reports/embedding_comparison.md](../reports/embedding_comparison.md):

  | Model | CV accuracy | Size | Fits Vercel (250 MB)? |
  |---|---|---|---|
  | **multilingual-e5-small** | **75.5%** | 118 MB | ✅ |
  | distiluse-base-multilingual-cased-v2 | 74.8% | 135 MB | ✅ |
  | paraphrase-multilingual-MiniLM-L12-v2 | 69.7% | 118 MB | ✅ |
  | LaBSE | 79.9% | 472 MB | ❌ |

- **Why cross-validation, not the validation set:** validation has 84 clear phrases in 14 families; one family flipping moves accuracy ~7 points. Grouped CV scores all train+validation phrases once each.
- **Why not LaBSE:** best score, but 4× over Vercel's function size limit. Worth revisiting if we move serving to a container (for example on AWS).
- **Surprise:** the paraphrase-trained model, which I expected to capture intent better, did worse.

### D7. Adding training data after the first validation run
- **What happened:** the first version (7 families per label) scored ~64% in cross-validation, below the keyword rules (79%). The errors were whole families: the model grouped messages by **topic** ("card", "loan") instead of **intent** ("I didn't make this purchase"). Example: "Perdí mi tarjeta y veo compras que no son mías" → predicted transaction_status.
- **Tried first, on train + validation only:** kNN (worse), two embedding models concatenated (+2 points), adding character TF-IDF (worse), adding keyword features (81%, rejected in D9).
- **Chose:** 70 new training-only families (10 per label), written to cover missing scenarios and **hard negatives**, messages that share words with another intent ("¿Cuánto he pagado de comisiones?" is a balance question, not a wrongful fee). Result: 75.5% CV accuracy, fold spread down from ±15 to ±4 points.
- **Safeguards:** the test set was not changed (hash verified), the new families were checked against test scenarios, and one that was too close (TS14, "terminal error, did it go through?") was replaced.
- **Honest consequence:** the new data was written after seeing validation errors, so **validation scores are optimistic from here on**. Only the test set is an unbiased judge.

### D8. The keyword baseline is a fair baseline, not a strawman
- **Chose:** rules written from the label definitions, then extended from the new training phrases (never validation or test), like a team maintaining its router.
- **Why:** beating a weak baseline proves nothing. Before the extension the rules fell to 60% on the new data; after it, 80% in CV.
- **Bias disclosed:** the same author wrote the rules and the test phrases, which favors the rules.

### D9. The learned model does not use the keywords as inputs
- **Considered:** embeddings + keyword-rule signals scored 81% in CV.
- **Rejected because:** the keywords encode the author's knowledge of the phrases, including held-out ones, so the score is contaminated and the comparison with the baseline would no longer be clean. Kept as an idea for a future version validated on human-written data.

### D10. Choose C on validation macro-F1
- **Chose:** C = 10 (regularization; smaller C = simpler model). Grid 0.1–300; ties go to the smaller C. Validation macro-F1 was flat between C = 3 and 10 (0.800 vs 0.801).
- **Why macro-F1:** it weighs every intent equally, so a rare intent can't be ignored.

### D11. The threshold comes from an explicit cost, not a guess
- **Chose:** threshold 0.61, the value that minimizes mean cost on validation with **wrong action = 5, acting on an ambiguous message = 2, needless question = 1**.
- **Why:** it turns "when should the bot ask?" into a stated business trade-off anyone can challenge. Raising the wrong-action cost pushes the threshold up (more questions); lowering it gives more automation.
- **Caveat:** the weights are an assumption, not a measurement. With real traffic they'd come from the cost of a mistaken dispute vs the cost of one more message.

### D12. Confidence intervals by family bootstrap
- **Chose:** resample whole families (not phrases) 2,000 times.
- **Why:** the six phrases in a family are rephrasings of one scenario, so they're not independent. Resampling phrases would make intervals look far too narrow.

### D13. Test runs are logged, and the code was frozen before each model's test run
- **Chose:** commit `9a3c0b6` froze code, data and settings before any test evaluation. `--test` must be passed explicitly, and every test run is appended to [reports/test_runs.jsonl](../reports/test_runs.jsonl).
- **What the log shows:** v1: 4 runs, all with the same model (`21f25214ab61`) and identical quality metrics. Runs 1–2 crashed while formatting the report (a sort bug) after metrics were computed; no results were displayed. Run 3 had a bug in the macro-F1 confidence interval (a label missing from a resample was scored as 0). Run 4 is the reported one. No model setting changed between runs. v2: 1 run (`cdc00ad95d9a`), after commit `51ee21d` recorded the decision (D15).

### D14. Train in Python, serve in JavaScript, share one config
- **Chose:** embeddings are computed with Transformers.js, the same library, model file and settings the Vercel app uses (`src/lib/embedding-config.json`). Python only trains the linear layer and exports its weights.
- **Why:** if training and serving computed embeddings differently (another library, precision or prefix), the weights would silently stop matching. Verified: the exported JSON reproduces the test accuracy on its own.

### D15. v2: Cohere multilingual embeddings from Amazon Bedrock as the primary model (decided 2026-09-29, before its test run)
- **Why revisit:** v1 (e5-small) was chosen partly because it fits inside a Vercel function (250 MB). Serving the embedding model from an API removes that limit, so we compared API models on the same grouped cross-validation (test untouched):

  | Model | CV accuracy | vs e5-small (paired, 95% CI) | Single-message latency | Quota |
  |---|---|---|---|---|
  | multilingual-e5-small (v1) | 75.5% | - | ~2 ms, in-app | none |
  | LaBSE (local, 472 MB) | 79.9% | +4.3 (+0.7 to +8.0) | ~5 ms + a server we'd host | our server |
  | Titan Text Embeddings V2 @1024 (Bedrock) | 80.1% | +4.6 (+0.6 to +8.6) | 0.5–1 s | 60 requests/min |
  | **Cohere Embed Multilingual v3 (Bedrock)** | **84.6%** | **+9.1 (+5.1 to +13.2)** | **~0.2–0.5 s** | **20 requests/min** |

  Cohere also beats LaBSE: +4.7 points (95% CI +0.9 to +8.6).
- **Chose:** Cohere embeddings (`input_type: classification`) + the same softmax regression. Validation: 92.9% accuracy, threshold 0.70, 0 wrong actions, needless questions down from 52% to 36%.
- **Costs accepted:** ~0.2–0.5 s per message (the Haiku reply takes longer anyway); a hard quota of **20 requests/minute** on this account, a documented capacity limit (production would need provisioned throughput); a dependency on AWS. Every Bedrock call costs cents per million tokens, paid from the account's credits.
- **Test discipline:** decided from cross-validation and validation only, committed before running the test. The test set is being reused once (v1 was evaluated on it); both v1 and v2 results are reported. The strongest evidence remains the future human-written test set.

### D16. e5-small stays as the automatic fallback (not LaBSE)
- **Chose:** if the Bedrock call times out, is throttled or fails after one bounded retry, classify with the v1 e5-small model running inside the app. The trace records which model answered.
- **Why not LaBSE:** it's more accurate than e5 (+4.3), but it would need its own server. A fallback's job is to work when the primary doesn't; e5 needs no network, while a LaBSE server on AWS would likely fail together with Bedrock. Kept as a stretch goal.
- **Consequence:** during an outage the system is less accurate but still safe (v1 had 0 wrong actions on test); it asks for clarification more often.

### D17. Banking77 as extra training data: tried, rejected on measurement (Miguel, 2026-09-30)
- **Permission and limits:** organizers allow Banking77 for training only, never evaluation (docs/decisions.md D-004).
- **How:** 9,917 of its 10,003 English training rows mapped to our intents by [pipeline/banking77_map.py](../pipeline/banking77_map.py) (each category tied to a LABELING_GUIDE rule; "compromised card" excluded), embedded with the same Cohere settings as production. [pipeline/compare_banking77.py](../pipeline/compare_banking77.py) added them to training in 9 variants (all rows / only out_of_scope / all but out_of_scope, each at total weight 0.25, 0.5 and 1× our phrases) and scored **only our Spanish/Portuguese phrases** with the same grouped 5-fold CV as D15. The decision rule was committed before the run (commit `2e45482`): replace v2 only if the decision cost is lower **and** wrong actions don't increase.
- **Result** ([reports/banking77_experiment.md](../reports/banking77_experiment.md)): **no variant qualifies; v2 stays.**
  - Accuracy doesn't move: 84.6% for ours only vs 83.2–84.8% with Banking77; every McNemar p ≥ 0.13.
  - It makes the model **more confident, not more right**: it answers more clear messages without asking (61% → up to 70%) but **wrong actions rise** (2.1% → 3.0–3.7%) and it **asks less on ambiguous messages** (90% → 70–83%). The lowest-cost variant got there by asking less, which the rule forbids.
  - Its out-of-scope questions, expected to be the most useful part, hurt most (83.2–83.6%): English card-support questions pull Spanish/Portuguese phrases toward `out_of_scope`.
  - Leakage check: 0 of our 834 non-test phrases has a Banking77 sentence at cosine ≥ 0.92.
- **Why, most likely:** it's English and in-domain for a UK app (top-ups, virtual cards), while our customers write Spanish/Portuguese about a Latin American bank. Cross-lingual embeddings carry the topic but also the other product's boundaries.
- **Caveat: the scoring favours our own style.** The phrases it's scored on were written by the same single author as our training phrases, so a model trained only on them has a home advantage; this can't show whether Banking77's real human phrasing helps with real customers. The conclusion is "on our phrases, it doesn't help and makes the model less careful", not "it can't help". **Re-run the same script scored on Person 3's human-written messages** (step 16) once they exist; that's allowed, since the scoring is on their messages, never on Banking77.
- **What would test it better (not done):** a small machine-translated Spanish/Portuguese subset of the dispute-related categories (labelled as translated), judged the same way. Only worth it if Person 3's human-written messages show a gap it could fill.

## Errors worth knowing (test)

- **ATM withdrawal not made (UC05)** is mostly misread as transaction status or move money. No training scenario covers "cash I didn't withdraw"; the model generalizes poorly to unseen scenarios.
- **Very short messages are the weakest style** (75% vs 96% for formal). "cupo disponible" and "limite disponível" are predicted out of scope.
- **Ambiguous messages it acted on (9 of 30):** e.g. "hay algo en mis movimientos que no entiendo" → unrecognized_charge at 0.81. In the full system the dispute flow still confirms before opening anything.

## Limitations

- **Synthetic, single-author data.** Real customers write differently. Treat 85.7% as an upper bound until human-written tests exist.
- **Small test set** (84 clear + 30 ambiguous phrases). Intervals are wide (±11 points).
- **Many clarifying questions** (57% of clear messages). Improvable with more training scenarios, conversation context (the next turn often resolves it), and entity extraction. It's also a direct consequence of the cost weights.
- **Portuguese not reviewed by a native speaker.**
- **Small train/serve difference in the fallback (e5-small).** Training embedded the phrases in one batch; the app embeds one message at a time. The 8-bit quantized model calibrates activations per batch, so confidences differ by up to 0.03 (labels matched on all 14 checked phrases). Fix for the next retrain: embed phrases one at a time. Cohere is computed server-side per text and matched within 0.01.
- **Only the message is used.** No account context yet (for example, whether the customer actually has a pending transaction).

## Reproduce

```bash
uv run python pipeline/phrases.py           # validate families -> phrases.csv
node scripts/embed_phrases.mjs              # embeddings with the served model
uv run python pipeline/split.py             # verify the sealed split
(cd pipeline && uv run python compare_embeddings.py)   # model selection (CV)
(cd pipeline && uv run python train_intent.py)         # validation only
(cd pipeline && uv run python train_intent.py --test)  # test (logged)
```
