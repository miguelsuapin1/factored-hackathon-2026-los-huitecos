-- Staging: daily_exchange_rates. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'date': 'date',
    'exchange_rate': 'num',
    'buy_rate': 'num',
    'sell_rate': 'num'
} %}

{{ select_typed(spec, source('bronze', 'daily_exchange_rates')) }}
