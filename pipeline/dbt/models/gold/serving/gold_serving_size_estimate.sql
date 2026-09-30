{{ config(schema='gold') }}
-- How big the slice will be in Postgres before it is loaded (Supabase free tier: 500 MB; our budget: 100 MB).
-- Estimate per row = its JSON text length (keys included, so it over-states the payload) + 24 bytes tuple
-- header, then × 1.5 for indexes and free space. Replaced by the real pg_total_relation_size after the load.
{% set tables = ['serving_customers', 'serving_products', 'serving_transactions', 'serving_fx_rates', 'serving_agent_pools'] %}
with s as (
  {% for t in tables %}
  select '{{ t }}' as table_name, count(*) as row_count, avg({{ row_json_bytes('x') }}) as avg_json_bytes
  from {{ ref(t) }} as x
  {{ 'union all' if not loop.last }}
  {% endfor %}
)
select
  table_name,
  row_count,
  avg_json_bytes,
  row_count * (avg_json_bytes + 24) * 1.5 / 1048576 as est_postgres_mb,
  sum(row_count * (avg_json_bytes + 24) * 1.5 / 1048576) over () as est_total_mb,
  (select count(*) from {{ ref('serving_customers') }}) as cohort_customers
from s
