# Serving slice (gold → Supabase)

Generated 2026-09-30 09:41 UTC by `pipeline/dbt/serving_report.py`. Do not edit by hand.

**2,040 customers, estimated 19.9 MB in Postgres** (budget 100 MB of the 500 MB free tier). The estimate uses each row's JSON length (keys included) + 24 B × 1.5 for indexes, so it over-states; the real size is measured after the load.

| table | rows | est. MB |
|:--|--:|--:|
| serving_transactions | 23,052 | 16.75 |
| serving_products | 6,110 | 1.94 |
| serving_customers | 2,040 | 1.04 |
| serving_fx_rates | 1,095 | 0.18 |
| serving_agent_pools | 12 | 0.00 |

## Why each customer is in the slice

| reason | customers |
|:--|--:|
| scenario:ambiguous_similar_amounts | 1 |
| scenario:approved_high_fraud_score | 5 |
| scenario:declined_with_code | 5 |
| scenario:declined_without_code | 5 |
| scenario:foreign_charge | 5 |
| scenario:mexican_customer_in_usd | 5 |
| scenario:pending | 5 |
| scenario:reversed | 5 |
| stratified_sample | 2,002 |
| team_synthetic_demo | 2 |

`scenario:*` customers are picked (5 per scenario, fixed seed) so every policy path has real data; `team_synthetic_demo` are the team's labelled demo customers (seeds/demo_fixture_*.csv).

## Is the stratified sample representative?

Share of each value among eligible customers / window transactions vs in the stratified sample (scenario and synthetic customers excluded).

| dimension | value | population | sample | diff (pp) |
|:--|:--|--:|--:|--:|
| customer.country | MX | 49.93% | 49.90% | -0.03 |
| customer.country | CO | 30.22% | 30.22% | +0.00 |
| customer.country | AR | 19.85% | 19.88% | +0.03 |
| customer.segment | Basic | 59.85% | 59.84% | -0.01 |
| customer.segment | Plus | 25.06% | 25.02% | -0.04 |
| customer.segment | Premium | 10.10% | 10.14% | +0.04 |
| customer.segment | Student | 4.98% | 5.00% | +0.01 |
| customer.status | Active | 85.12% | 85.96% | +0.84 |
| customer.status | Inactive | 9.95% | 9.14% | -0.81 |
| customer.status | Suspended | 2.93% | 2.80% | -0.13 |
| customer.status | Closed | 2.00% | 2.10% | +0.09 |
| transaction.currency | USD | 55.13% | 55.51% | +0.38 |
| transaction.currency | COP | 26.99% | 28.06% | +1.07 |
| transaction.currency | ARS | 17.88% | 16.43% | -1.45 |
| transaction.status | Approved | 92.01% | 91.97% | -0.04 |
| transaction.status | Declined | 5.00% | 5.03% | +0.03 |
| transaction.status | Pending | 1.99% | 2.00% | +0.01 |
| transaction.status | Reversed | 1.00% | 1.01% | +0.01 |
| transaction.type | Purchase | 24.45% | 25.28% | +0.83 |
| transaction.type | Withdrawal | 21.84% | 21.81% | -0.02 |
| transaction.type | Transfer | 20.24% | 20.02% | -0.22 |
| transaction.type | Payment | 16.68% | 16.09% | -0.59 |
| transaction.type | Deposit | 13.81% | 14.15% | +0.34 |
| transaction.type | Adjustment | 2.98% | 2.65% | -0.33 |

Largest difference: 1.45 percentage points.
