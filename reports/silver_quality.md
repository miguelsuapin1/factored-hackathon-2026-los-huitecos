# Silver data quality

Generated 2026-09-30 09:32 UTC by `pipeline/dbt/quality_report.py` from `ops.ops_silver_quality` (dbt run `c7837f9e`). Do not edit by hand.
Rule ids are defined in [docs/data-issues.md](../docs/data-issues.md).

## Reconciliation: bronze = silver + quarantine

| table | bronze | silver | quarantined | unexplained |
|:--|--:|--:|--:|--:|
| digital_events | 15,620,994 | 15,620,994 | 0 | 0 |
| transactions | 4,425,008 | 4,425,008 | 0 | 0 |
| campaign_sends | 1,746,801 | 1,746,801 | 0 | 0 |
| call_center_interactions | 686,296 | 686,296 | 0 | 0 |
| products | 400,000 | 400,000 | 0 | 0 |
| satisfaction_surveys | 212,759 | 212,759 | 0 | 0 |
| call_transcripts | 171,321 | 171,321 | 0 | 0 |
| customers | 150,000 | 150,000 | 0 | 0 |
| complaints | 67,095 | 67,095 | 0 | 0 |
| daily_exchange_rates | 13,164 | 13,164 | 0 | 0 |
| service_agents | 1,200 | 1,200 | 0 | 0 |
| branches | 350 | 350 | 0 | 0 |
| marketing_campaigns | 200 | 200 | 0 | 0 |

## Rows touched per rule

| rule | table | rows |
|:--|:--|--:|
| A2_after_batch_cutoff | call_center_interactions | 228,318 |
| A2_after_batch_cutoff | transactions | 1,106,307 |
| A5_amount_usd_derived | transactions | 99,477 |
| C1_product_owner_mismatch | complaints | 44,570 |
| C2_origin_interaction_missing | complaints | 67,095 |
| C3_registration_branch_orphan | customers | 149,995 |
| D3_country_spelling_normalized | transactions | 40,515 |
| D6_mx_customer_with_dni | customers | 74,907 |
| E1_status_date_inconsistent | complaints | 772 |
| E2_compensation_exceeds_claim | complaints | 62 |
| E3_orphan_currency_nulled | complaints | 1,065 |
| E4_response_code_missing | transactions | 221,033 |
| E5_nps_category_derived | satisfaction_surveys | 3,274 |
| E6_duration_missing | call_transcripts | 24,029 |
| E7_decline_code_on_non_declined | transactions | 126,391 |
| subcategory_derived_from_category | complaints | 6,698 |
