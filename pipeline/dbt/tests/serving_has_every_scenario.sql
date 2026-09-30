{{ config(enabled=not var('fixtures', false)) }}
-- Every demo scenario the policy engine needs is present in the slice (returns the missing ones).
with needed as (
  {% for s in ['pending', 'reversed', 'declined_with_code', 'declined_without_code', 'approved_high_fraud_score', 'foreign_charge', 'mexican_customer_in_usd'] %}
  select 'scenario:{{ s }}' as reason{{ ' union all' if not loop.last }}
  {% endfor %}
),
present as (
  select distinct r as reason
  from {{ ref('serving_cohort') }}{{ ',' if target.type == 'bigquery' else ' cross join' }} {{ 'unnest(cohort_reasons) as r' if target.type == 'bigquery' else '(select unnest(cohort_reasons) as r)' }}
)
select n.reason from needed as n left join present as p using (reason) where p.reason is null
