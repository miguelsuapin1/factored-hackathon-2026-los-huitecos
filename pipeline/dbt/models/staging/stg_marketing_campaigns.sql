-- Staging: marketing_campaigns. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'start_date': 'date',
    'end_date': 'date',
    'budget': 'num',
    'expected_conversion_rate': 'num'
} %}

{{ select_typed(spec, source('bronze', 'marketing_campaigns')) }}
