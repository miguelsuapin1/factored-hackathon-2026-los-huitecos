-- daily_exchange_rates: staged rows + _reject_reasons (missing required field, or an older load of the same key).
-- Silver keeps the rows with no reasons; silver_quarantine.rejected_rows keeps the others.
{{ checked_snapshot(ref('stg_daily_exchange_rates'), "concat(cast(date as string), '|', source_currency, '|', target_currency)", ['date', 'source_currency', 'target_currency', 'exchange_rate']) }}
