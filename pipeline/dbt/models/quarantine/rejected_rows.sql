{{ config(schema='silver_quarantine') }}
-- Every row that did not make it into silver, with the reasons, from all 13 tables. Silver never drops a row
-- silently: bronze = silver + rejected_rows, per table (tests/reconciliation_bronze_silver.sql).
{% set tables = {
  'transactions': 'int_transactions_checked', 'call_center_interactions': 'int_call_center_interactions_checked',
  'call_transcripts': 'int_call_transcripts_checked', 'satisfaction_surveys': 'int_satisfaction_surveys_checked',
  'complaints': 'int_complaints_checked', 'campaign_sends': 'int_campaign_sends_checked',
  'digital_events': 'int_digital_events_checked', 'customers': 'int_customers_checked',
  'products': 'int_products_checked', 'branches': 'int_branches_checked',
  'service_agents': 'int_service_agents_checked', 'marketing_campaigns': 'int_marketing_campaigns_checked',
  'daily_exchange_rates': 'int_daily_exchange_rates_checked'} %}
{% for name, model in tables.items() %}
{{ quarantine_rows(name, 'select * from ' ~ ref(model), '_record_key') }}
{{ 'union all' if not loop.last }}
{% endfor %}
