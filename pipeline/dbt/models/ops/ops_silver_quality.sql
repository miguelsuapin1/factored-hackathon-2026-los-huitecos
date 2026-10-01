{{ config(schema='ops', materialized='table') }}
-- One row per (table, measure): rows in bronze / silver / quarantine and how many rows each rule touched.
-- reports/silver_quality.md is generated from this table (pipeline/dbt/quality_report.py); never hand-edited.
{% set silver = {
  'transactions': 'silver_transactions', 'call_center_interactions': 'silver_call_center_interactions',
  'call_transcripts': 'silver_call_transcripts', 'satisfaction_surveys': 'silver_satisfaction_surveys',
  'complaints': 'silver_complaints', 'campaign_sends': 'silver_campaign_sends', 'digital_events': 'silver_digital_events',
  'customers': 'silver_customers', 'products': 'silver_products', 'branches': 'silver_branches',
  'service_agents': 'silver_service_agents', 'marketing_campaigns': 'silver_marketing_campaigns',
  'daily_exchange_rates': 'silver_fx_rates'} %}
{% set flagged = ['silver_transactions', 'silver_complaints', 'silver_call_center_interactions', 'silver_satisfaction_surveys',
                  'silver_call_transcripts', 'silver_customers', 'silver_products', 'silver_service_agents', 'silver_branches'] %}
{% set unnest_flag = 'unnest(_rule_flags) as f' if target.type == 'bigquery' else '(select unnest(_rule_flags) as f)' %}

{% for src, model in silver.items() %}
select '{{ src }}' as table_name, 'rows_bronze' as measure, count(*) as n from {{ source('bronze', src) }}
union all
select '{{ src }}', 'rows_silver', count(*) from {{ ref(model) }}
union all
select '{{ src }}', 'rows_quarantined', count(*) from {{ ref('rejected_rows') }} where table_name = '{{ src }}'
union all
{% endfor %}
{% for model in flagged %}
select '{{ model | replace("silver_", "") }}' as table_name, concat('rule:', f) as measure, count(*) as n
from {{ ref(model) }}{{ ',' if target.type == 'bigquery' else ' cross join' }} {{ unnest_flag }}
group by 1, 2
{{ 'union all' if not loop.last }}
{% endfor %}
