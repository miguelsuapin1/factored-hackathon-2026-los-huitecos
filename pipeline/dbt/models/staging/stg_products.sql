-- Staging: products. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'current_balance': 'num',
    'credit_limit': 'num',
    'interest_rate': 'num',
    'opening_date': 'date',
    'expiration_date': 'date',
    'has_linked_app': 'bool',
    'days_past_due': 'int',
    'last_transaction_date': 'ts',
    'last_updated': 'ts'
} %}

{{ select_typed(spec, source('bronze', 'products')) }}
