{{ config(enabled=var('fixtures', false)) }}
-- Runs only on the synthetic fixture bronze (pipeline/dbt/fixtures/build_fixture_bronze.py, --vars '{fixtures: true}').
-- Each row returned is a broken expectation.
with checks as (
  -- FIX-DUP: two identical deliveries → exactly one in silver, one in quarantine as an older load
  select 'FIX-DUP kept once' as expectation,
         (select count(*) from {{ ref('silver_transactions') }} where transaction_id = 'TRX-FIX-DUP') = 1 as ok
  union all
  select 'FIX-DUP older copy quarantined',
         (select count(*) from {{ ref('rejected_rows') }} where record_key = 'TRX-FIX-DUP') = 1
  -- FIX-LATE: the later file wins (Pending → Reversed), the earlier load is quarantined, not double counted
  union all
  select 'FIX-LATE later load wins',
         (select max(transaction_status) from {{ ref('silver_transactions') }} where transaction_id = 'TRX-FIX-LATE') = 'Reversed'
  union all
  select 'FIX-LATE one row only',
         (select count(*) from {{ ref('silver_transactions') }} where transaction_id = 'TRX-FIX-LATE') = 1
  -- FIX-MISS: a transaction without an amount never reaches silver, and says why
  union all
  select 'FIX-MISS quarantined with reason',
         (select count(*) from {{ ref('rejected_rows') }} where record_key = 'TRX-FIX-MISS') = 1
         and (select count(*) from {{ ref('silver_transactions') }} where transaction_id = 'TRX-FIX-MISS') = 0
  -- A5: COP without amount_usd is derived from that day's rate (400000 × 0.00025 = 100)
  union all
  select 'A5 derived USD', (select max(amount_usd) from {{ ref('silver_transactions') }} where transaction_id = 'TRX-FIX-OK') = 100
  -- C1: the complaint's link to another customer's product is removed
  union all
  select 'C1 link removed', (select count(*) from {{ ref('silver_complaints') }} where affected_product_id is not null) = 0
  -- E1/E3: resolved without a date is flagged; a currency without an amount is dropped
  union all
  select 'E1 flagged', (select max(cast(status_date_inconsistent as int)) from {{ ref('silver_complaints') }}) = 1
  union all
  select 'E3 currency nulled', (select count(*) from {{ ref('silver_complaints') }} where currency is not null) = 0
  -- E5: NPS 6 without a category becomes Detractor
  union all
  select 'E5 recomputed', (select max(nps_category) from {{ ref('silver_satisfaction_surveys') }}) = 'Detractor'
  -- A7: anonymous events are kept and flagged
  union all
  select 'A7 anonymous kept', (select count(*) from {{ ref('silver_digital_events') }} where anonymous_event) = 1
  -- C3: an unknown registration branch is removed
  union all
  select 'C3 orphan branch nulled', (select registration_branch_id from {{ ref('silver_customers') }} where customer_id = 'CLI-FIX-CO') is null
)
select expectation from checks where not coalesce(ok, false)
