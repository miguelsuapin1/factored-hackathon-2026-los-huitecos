-- No row is silently dropped: for every table, bronze = silver + quarantine. Returns the tables that don't add up.
{% set pairs = {
  'transactions': 'silver_transactions', 'call_center_interactions': 'silver_call_center_interactions',
  'call_transcripts': 'silver_call_transcripts', 'satisfaction_surveys': 'silver_satisfaction_surveys',
  'complaints': 'silver_complaints', 'campaign_sends': 'silver_campaign_sends', 'digital_events': 'silver_digital_events',
  'customers': 'silver_customers', 'products': 'silver_products', 'branches': 'silver_branches',
  'service_agents': 'silver_service_agents', 'marketing_campaigns': 'silver_marketing_campaigns',
  'daily_exchange_rates': 'silver_fx_rates'} %}
with counts as (
  {% for src, silver in pairs.items() %}
  select '{{ src }}' as table_name,
         (select count(*) from {{ source('bronze', src) }}) as bronze_rows,
         (select count(*) from {{ ref(silver) }}) as silver_rows,
         (select count(*) from {{ ref('rejected_rows') }} where table_name = '{{ src }}') as quarantined_rows
  {{ 'union all' if not loop.last }}
  {% endfor %}
)
select * from counts where bronze_rows <> silver_rows + quarantined_rows
