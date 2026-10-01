{{ config(schema='gold') }}
-- Is the stratified sample a fair picture of the population? Share of each value in the sample vs in all
-- eligible customers / all window transactions. Scenario and synthetic customers are excluded here on purpose
-- (they are chosen for the demo, not to be representative).
{% set today = "cast('" ~ var('demo_today') ~ "' as date)" %}
with window_txn as (
  select * from {{ ref('silver_transactions') }}
  where transaction_date_local > {{ months_before(today, var('serving_months')) }} and transaction_date_local <= {{ today }}
),
pop_customers as (
  select * from {{ ref('silver_customers') }} where customer_id in (select customer_id from window_txn)
),
sample_ids as (select customer_id from {{ ref('serving_cohort') }} where in_stratified_sample),
sample_customers as (select * from pop_customers where customer_id in (select customer_id from sample_ids)),
sample_txn as (select * from window_txn where customer_id in (select customer_id from sample_ids)),
pairs as (
  select 'customer.country' as dimension, country as value, 'population' as grp from pop_customers
  union all select 'customer.country', country, 'sample' from sample_customers
  union all select 'customer.segment', segment, 'population' from pop_customers
  union all select 'customer.segment', segment, 'sample' from sample_customers
  union all select 'customer.status', customer_status, 'population' from pop_customers
  union all select 'customer.status', customer_status, 'sample' from sample_customers
  union all select 'transaction.status', transaction_status, 'population' from window_txn
  union all select 'transaction.status', transaction_status, 'sample' from sample_txn
  union all select 'transaction.currency', currency, 'population' from window_txn
  union all select 'transaction.currency', currency, 'sample' from sample_txn
  union all select 'transaction.type', transaction_type, 'population' from window_txn
  union all select 'transaction.type', transaction_type, 'sample' from sample_txn
),
counts as (
  select dimension, value, grp, count(*) as n,
         count(*) * 1.0 / sum(count(*)) over (partition by dimension, grp) as share
  from pairs group by 1, 2, 3
)
select
  p.dimension, p.value,
  p.n as population_n, s.n as sample_n,
  p.share as population_share, s.share as sample_share,
  (coalesce(s.share, 0) - p.share) * 100 as diff_pp
from counts as p
left join counts as s on s.dimension = p.dimension and s.value = p.value and s.grp = 'sample'
where p.grp = 'population'
