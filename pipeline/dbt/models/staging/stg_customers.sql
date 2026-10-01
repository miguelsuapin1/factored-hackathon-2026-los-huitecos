-- Staging: customers. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'date_of_birth': 'date',
    'credit_score': 'int',
    'estimated_monthly_income': 'num',
    'registration_date': 'ts',
    'last_updated': 'ts',
    'accepts_marketing': 'bool'
} %}

{{ select_typed(spec, source('bronze', 'customers')) }}
