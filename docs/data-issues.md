# Data issue register

Every issue found in the organizer dataset (LATAM Bank v1.0.0, S3 `data/` prefix, downloaded 2026-09-25), with the evidence, why it matters, and the rule the silver layer applies. Counts are reproducible: run `pipeline/bronze.py`, then `pipeline/dq_checks.py`, which regenerates [reports/data_quality.md](../reports/data_quality.md).

**Principle:** bronze keeps raw data untouched (all VARCHAR, plus `filename` and `_loaded_at` lineage). Silver fixes types, vocabulary and keys, and **flags** anything it can't fix; it never silently drops a row. Every rule is a named check with a count in the pipeline run log.

Severity: 🔴 affects the service's correctness or privacy · 🟠 affects analysis or evaluation validity · 🟡 cosmetic/normalization.

## A. Organizer claims that don't hold

| ID | Claim (dictionary) | Observed | Impact | Handling |
|---|---|---|---|---|
| A1 🟠 | ~2% duplicate records | **0** exact duplicates, 0 repeated primary keys, 0 "same content, new ID" in all 12 tables | We can't demonstrate dedup on real data | Keep the dedup step (PK + content hash, idempotent) and prove it with a **labeled test fixture** of injected duplicates, as the brief allows for static data |
| A2 🟠 | Late-arriving partitions | 0 rows filed in a partition later than their event. 33% of interactions carry a timestamp the *day after* `process_date`, but always between 00:00 and 07:59 UTC: this is a **fixed 08:00 UTC batch cutoff**, not lateness | A naive `date(event) = process_date` check would flag 228K false "late" rows | Derive `event_date` in a documented timezone and keep `process_date` as the batch key. Late-arrival handling (upsert on PK with `_loaded_at`) is shown with a fixture |
| A3 🟠 | Schema evolution | All files of each table have identical headers | Same as A1 | `read_csv(union_by_name=true)` plus a column contract that fails on unknown columns; shown with a fixture |
| A4 🟡 | Row counts (e.g. 800K interactions, 80K complaints) | 11–16% fewer rows in every fact table; dimensions exact. Exchange rates: 13,164 rows vs "3,000" (1,097 days × 12 currency pairs, which is correct) | Totals quoted from the dictionary would be wrong | Always quote observed counts from our reports |
| A5 🔴 | "All transactions include local currency and USD conversion" | **No MXN anywhere.** All 2.2M transactions of Mexican customers are in USD, and all products are USD/COP/ARS. `amount_usd` is null for 99,477 non-USD transactions | Balances and amounts shown to Mexican customers would be in the wrong currency | Treat `currency` as the source of truth (never assume the local currency). Fill `amount_usd` from `daily_exchange_rates` on the transaction date and flag `amount_usd_derived=true`. Report as a data limitation |

## B. Text data is templated (it can't train or evaluate language understanding)

| ID | Observed | Impact | Handling |
|---|---|---|---|
| B1 🔴 | `call_transcripts.customer_text`: **42 distinct values** across 171K rows, all variations of "check my credit-card / savings balance", **regardless of the call's topic** (a "Queja" call says the same thing) | Transcripts carry no signal about why the customer called. An intent model trained on them would learn nothing, and evaluating on them would be leakage-prone and meaningless | Don't use transcripts for training or evaluation. Build a **team-generated, labeled utterance set** in ES + PT (sources and generation method documented, split by template/paraphrase family to prevent leakage) |
| B2 🟠 | `detected_intents` = `consulta_general` on 100% of non-null rows | The organizer intent labels are unusable | Ignore. Intent labels are ours (B1) |
| B3 🟠 | `complaints.description`: 5 distinct values ("Queja relacionada con {category}"). `resolution`: 5. Survey `open_comments`: 13 | No free-text evidence for disputes, and no text for retrieval/RAG | Use the structured fields only. RAG grounding must come from a team-written **policy corpus**, labeled synthetic |
| B4 🟠 | All text is Spanish (`detected_language = es` 100%). **No Portuguese in the dataset** | The required PT demo has no organizer data behind it | PT evaluation cases are team-generated. Reported as a language-coverage limitation |

## C. Broken relationships (privacy and grounding)

| ID | Observed | Impact | Handling |
|---|---|---|---|
| C1 🔴 | `complaints.affected_product_id` belongs to **a different customer in 44,570 / 44,570** cases | A dispute tool that trusts this link would show a customer **someone else's product**: an unauthorized disclosure | Never follow this FK. Silver sets it to null with flag `product_owner_mismatch=true`. The service resolves products only through `products.customer_id = session.customer_id` |
| C2 🟠 | `complaints.origin_interaction_id` is **100% null** | Complaints can't be linked to the originating contact, and there's no lineage from a call to its case | Report as a limitation. Our system writes that link for every case it creates |
| C3 🟡 | `customers.registration_branch_id` never matches `branches.branch_id` (149,995 / 150,000 orphans) | Branch-level analysis per customer is impossible | Null the FK and flag it. Not needed by the service |
| C4 🟠 | Complaint claims have no link to a transaction (no `transaction_id` column) | Disputes can't be matched to the disputed charge from historical data | Our dispute intake **requires** the customer to identify the transaction (clarification step), which the tool then verifies against `transactions` |

## D. Vocabulary and encoding

| ID | Observed | Handling |
|---|---|---|
| D1 🟡 | Labels are in Spanish while the dictionary documents English: `reason_category` (Transaccional, Producto, Queja, Técnico, Comercial, **Retención**, a 6th category not in the dictionary), `detected_sentiment` (Negativo, Muy Positivo…), `document_type = Pasaporte` | Map to canonical English codes with an explicit mapping table (versioned, in the repo). Unknown values fail the contract |
| D2 🟡 | `contact_reason` is identical to `reason_category` in 100% of rows. No finer reason exists | Drop `contact_reason` in silver (redundant) |
| D3 🟡 | Country spelled `México` (customers, 2.1M transactions) and `Mexico` (40,515 transactions) | Normalize to ISO codes `MX`/`CO`/`AR` |
| D4 🟡 | Channel `Web` (video calls) is not in the documented list | Accept, and add it to the contract |
| D5 🟡 | Files start with a UTF-8 BOM; integers stored as floats (`250.0`); booleans as `True`/`False` strings | Parse with explicit types in silver |
| D6 🟠 | Mexican customers all have `document_type = DNI` (the dictionary says CURP; DNI is Argentine). Colombian customers have CC/CE/Pasaporte | Document it. Don't use `document_type` for identity logic (identity comes from the authenticated session anyway) |

## E. Logical inconsistencies

| ID | Observed | Handling |
|---|---|---|
| E1 🟠 | 772 complaints `Resolved`/`Closed` without `resolution_date` | Flag `status_date_inconsistent` and exclude from resolution-time metrics |
| E2 🟡 | 62 complaints with `compensation_granted > claimed_amount` | Flag. Keep for analysis |
| E3 🟡 | 1,065 complaints with `currency` set but `claimed_amount` null | Null the orphan currency |
| E4 🟠 | 17,664 non-approved transactions (Declined/Pending/Reversed) with null `response_code`; 203K approved with null code | Treat a null code as `unknown`. The service must say "reason unavailable" instead of guessing |
| E5 🟠 | NPS scores only go from 2 to 7 (no Promoters exist); CSAT never reaches 5; 3,274 NPS rows lack `nps_category` | Recompute `nps_category` from the score. Report satisfaction as relative (by reason), not absolute |
| E6 🟡 | `call_transcripts.duration_seconds` null in 14% of rows despite NOT NULL | Take the value from `call_center_interactions.duration_seconds` if available, otherwise flag |
| E7 🟠 | **Pending and Reversed transactions carry decline response codes** (05, 14, 51, 54; e.g. 21,191 Pending with `05`), spread evenly like the Declined ones (Miguel, 2026-09-30) | Response codes can't explain a transaction's outcome. The service reads `transaction_status` only and never states a decline reason (docs/policy.md PL-5) |
| E8 🟠 | **Complaint amounts carry no signal** (Miguel, 2026-09-30): `claimed_amount` is uniform 0–5,000 in every currency (5,000 COP ≈ 1 USD, yet same distribution as USD); `priority` doesn't depend on it (average ~2,530 at every level); `compensation_granted` (an amount, on 6.9% of complaints, median 253) is unrelated to it (correlation 0.03) and to priority (~7% at every level) | No amount-based policy rule can be justified from this data (docs/policy.md). Don't compare claimed amounts across currencies |

## F. Injected nulls (the "~5% nulls" claim)

Nulls appear in round proportions: exactly 10%, 15%, 20%, 30% or 50% per column (e.g. `credit_score` 15.0%, `estimated_monthly_income` 20.0%, `landline_phone` 50.0%, `wait_time_seconds` 30.0%). They're random, not tied to meaning. Handling: keep them as null (no imputation for service facts; the assistant says "not available"), and report the null rate per column in every pipeline run. Full table: [reports/data_quality.md](../reports/data_quality.md#null--blank-values).

## G. Things the data can't tell us (limitations to report)

- **No real signal by segment, country or accent.** FCR, escalation and sentiment are identical (±0.2 pp) across all groups. Our fairness breakdowns will be measured on our own evaluation set, not inherited from this data.
- **Escalation rate (~10%) and wait time (median 2.0 min) are identical for every contact reason**, so they can't be used to prioritize.
- **Complaint outcomes are identical across subcategories** (SLA breach ~20%, median resolution 15–16 days, ~75% still open).
- **Time-of-day demand is flat** (uniform over 24 h). Only the weekday pattern (Tue–Fri high, Sunday ≈ half) and the contact-reason mix carry signal.
- `digital_events` (10M rows, 3.6 GB) is not downloaded or profiled yet.
