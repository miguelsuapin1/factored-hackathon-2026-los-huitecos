-- Daily exchange rates, typed and deduplicated on (date, source, target). 12 pairs × 1,097 days.
-- Used to derive missing amount_usd (docs/data-issues.md A5/A6).
select
  date, source_currency, target_currency, exchange_rate, buy_rate, sell_rate, source,
  _source_file, _loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_daily_exchange_rates_checked') }}
where {{ is_clean() }}
