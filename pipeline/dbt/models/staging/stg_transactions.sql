-- Staging: transactions. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'transaction_date': 'ts',
    'process_date': 'date',
    'amount': 'num',
    'amount_usd': 'num',
    'is_fraud': 'bool',
    'fraud_score': 'num',
    'latitude': 'num',
    'longitude': 'num'
} %}

{{ select_typed(spec, source('bronze', 'transactions')) }}
