-- The table the step-10 lookup reads (docs/contracts.md K2): the cohort's transactions for the `serving_months`
-- before the demo clock, plus the team's synthetic demo charges (data_source = 'team_synthetic').
-- Deliberately no is_fraud (that label only exists after a dispute is resolved, docs/policy.md PL-6).
-- Date filters in the lookup should use transaction_date_local (the customer's calendar day).
{% set today = "cast('" ~ var('demo_today') ~ "' as date)" %}
select
  t.transaction_id,
  t.customer_id,
  t.product_id,
  t.transaction_ts,
  t.transaction_date_local,
  t.transaction_type,
  t.amount,
  t.currency,
  t.amount_usd,
  t.merchant_name,
  t.merchant_category,
  t.transaction_status,
  t.response_code,
  t.channel,
  t.transaction_country,
  t.is_foreign,
  t.fraud_score,
  'organizer' as data_source
from {{ ref('silver_transactions') }} as t
where t.customer_id in (select customer_id from {{ ref('serving_customers') }} where data_source = 'organizer')
  and t.transaction_date_local > {{ months_before(today, var('serving_months')) }}
  and t.transaction_date_local <= {{ today }}
union all
select
  f.transaction_id,
  f.customer_id,
  cast(null as {{ 'string' if target.type == 'bigquery' else 'varchar' }}) as product_id,
  {{ local_to_utc('f.transaction_local_ts', 'c.timezone') }} as transaction_ts,
  cast(substr(f.transaction_local_ts, 1, 10) as date) as transaction_date_local,
  'Purchase' as transaction_type,
  f.amount,
  f.currency,
  case when f.currency = 'USD' then f.amount end as amount_usd,
  f.merchant_name,
  cast(null as {{ 'string' if target.type == 'bigquery' else 'varchar' }}) as merchant_category,
  f.transaction_status,
  f.response_code,
  f.channel,
  f.transaction_country,
  false as is_foreign,
  f.fraud_score,
  'team_synthetic' as data_source
from {{ ref('demo_fixture_transactions') }} as f
join {{ ref('demo_fixture_customers') }} as c using (customer_id)
