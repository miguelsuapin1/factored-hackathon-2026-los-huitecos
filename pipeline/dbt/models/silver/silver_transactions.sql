{{ config(partition_by=({'field': 'process_date', 'data_type': 'date', 'granularity': 'month'} if target.type == 'bigquery' else none), cluster_by=['customer_id']) }}
-- Transactions, the table the dispute lookup reads (docs/contracts.md K2).
--   A5  amount_usd missing on a non-USD row → derived from the daily rate on the transaction's UTC date
--       (clamped to the rate table's range) and flagged. USD rows: amount_usd = amount.
--   A6  the organizer's own amount_usd uses fixed rates (ARS 1/350, COP 1/4000), not the daily table;
--       kept as delivered, so derived and delivered values can differ by up to ~4%.
--   A2  transaction_date is UTC; transaction_date_local is the calendar day in the customer's home time zone.
--   D3  country spellings → ISO. E4/E7: response codes are kept verbatim and never interpreted.
with fx as (
  select date, source_currency, exchange_rate
  from {{ ref('silver_fx_rates') }}
  where target_currency = 'USD'
),
fx_range as (select min(date) as min_date, max(date) as max_date from fx)

select
  t.transaction_id,
  t.customer_id,
  t.product_id,
  t.transaction_date as transaction_ts,
  {{ local_date('t.transaction_date', 'c.timezone') }} as transaction_date_local,
  t.process_date,
  t.transaction_type,
  t.transaction_category,
  t.amount,
  t.currency,
  case
    when t.amount_usd is not null then t.amount_usd
    when t.currency = 'USD' then t.amount
    else round(t.amount * fx.exchange_rate, 2)
  end as amount_usd,
  (t.amount_usd is null and t.currency <> 'USD') as amount_usd_derived,
  case when t.amount_usd is null and t.currency <> 'USD' then fx.exchange_rate end as fx_rate_used,
  t.channel,
  t.branch_id,
  t.merchant_name,
  t.merchant_category,
  co.iso2 as transaction_country,
  t.transaction_city,
  (co.iso2 is not null and co.iso2 <> c.country) as is_foreign,
  t.transaction_status,
  t.response_code,
  t.is_fraud,
  t.fraud_score,
  t.latitude,
  t.longitude,
  {{ flags([
      ('A5_amount_usd_derived', "t.amount_usd is null and t.currency <> 'USD'"),
      ('A2_after_batch_cutoff', 'cast(t.transaction_date as date) > t.process_date'),
      ('D3_country_spelling_normalized', "t.transaction_country = 'Mexico'"),
      ('E4_response_code_missing', 't.response_code is null'),
      ('E7_decline_code_on_non_declined', "t.transaction_status in ('Pending', 'Reversed') and t.response_code <> '00'"),
      ('A5_no_fx_rate', "t.amount_usd is null and t.currency <> 'USD' and fx.exchange_rate is null"),
  ]) }} as _rule_flags,
  t._source_file, t._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_transactions_checked') }} as t
cross join fx_range
left join {{ ref('silver_customers') }} as c on c.customer_id = t.customer_id
left join {{ ref('map_countries') }} as co on co.raw_value = t.transaction_country
left join fx
  on fx.source_currency = t.currency
 and fx.date = least(greatest(cast(t.transaction_date as date), fx_range.min_date), fx_range.max_date)
where {{ is_clean() }}
