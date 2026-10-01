-- Who is in the Supabase slice, and why. Two parts:
--  1. a stratified random sample (country × segment, proportional, fixed seed) of customers with at least one
--     transaction in the serving window; it is compared with the full population in gold_serving_representativeness;
--  2. guaranteed demo scenarios: up to `scenario_n` customers per scenario from the last 30 days before the demo
--     clock, plus the team's synthetic demo customers (seeds/demo_fixture_customers.csv).
-- A customer can be in both parts; cohort_reasons lists every reason.
{% set today = "cast('" ~ var('demo_today') ~ "' as date)" %}
{% set scenario_n = 5 %}
with window_txn as (
  select * from {{ ref('silver_transactions') }}
  where transaction_date_local > {{ months_before(today, var('serving_months')) }}
    and transaction_date_local <= {{ today }}
),
recent as (
  select * from window_txn where transaction_date_local > {{ days_before(today, 30) }}
),
eligible as (
  select c.customer_id, c.country, c.segment
  from {{ ref('silver_customers') }} as c
  where c.customer_id in (select customer_id from window_txn)
),
ranked as (
  select e.*,
         row_number() over (partition by country, segment order by {{ stable_hash("concat('" ~ var('cohort_seed') ~ "', customer_id)") }}) as rk,
         count(*) over (partition by country, segment) as stratum_n,
         count(*) over () as eligible_n
  from eligible as e
),
stratified as (
  select customer_id, 'stratified_sample' as reason
  from ranked
  where rk <= round({{ var('cohort_size') }} * stratum_n / eligible_n)
),
ambiguous as (  -- three or more approved charges within ±1% of each other (PL-2)
  select a.customer_id
  from recent as a join recent as b
    on a.customer_id = b.customer_id and a.currency = b.currency
   and abs(a.amount - b.amount) <= a.amount * 0.01
  where a.transaction_status = 'Approved' and b.transaction_status = 'Approved'
  group by a.customer_id, a.transaction_id
  having count(*) >= 3
),
scenario_candidates as (
  select distinct customer_id, 'scenario:pending' as reason from recent where transaction_status = 'Pending'
  union all select distinct customer_id, 'scenario:reversed' from recent where transaction_status = 'Reversed'
  union all select distinct customer_id, 'scenario:declined_with_code' from recent where transaction_status = 'Declined' and response_code is not null
  union all select distinct customer_id, 'scenario:declined_without_code' from recent where transaction_status = 'Declined' and response_code is null
  union all select distinct customer_id, 'scenario:approved_high_fraud_score' from recent where transaction_status = 'Approved' and fraud_score >= {{ var('fraud_cutoff') }}
  union all select distinct customer_id, 'scenario:foreign_charge' from recent where is_foreign
  union all select distinct customer_id, 'scenario:ambiguous_similar_amounts' from ambiguous
  union all select distinct customer_id, 'scenario:mexican_customer_in_usd' from recent where currency = 'USD' and transaction_country = 'MX'
),
scenarios as (
  select customer_id, reason from (
    select customer_id, reason,
           row_number() over (partition by reason order by {{ stable_hash("concat('" ~ var('cohort_seed') ~ "', reason, customer_id)") }}) as rk
    from scenario_candidates
  ) as s
  where rk <= {{ scenario_n }}
),
synthetic as (
  select customer_id, 'team_synthetic_demo' as reason from {{ ref('demo_fixture_customers') }}
),
all_reasons as (
  select * from stratified union all select * from scenarios union all select * from synthetic
)
select
  customer_id,
  array_agg(distinct reason order by reason) as cohort_reasons,
  max(case when reason = 'stratified_sample' then 1 else 0 end) = 1 as in_stratified_sample,
  max(case when reason = 'team_synthetic_demo' then 1 else 0 end) = 1 as is_synthetic
from all_reasons
group by customer_id
