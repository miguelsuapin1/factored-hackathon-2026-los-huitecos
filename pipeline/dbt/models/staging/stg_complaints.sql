-- Staging: complaints. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'creation_date': 'ts',
    'process_date': 'date',
    'claimed_amount': 'num',
    'assignment_date': 'ts',
    'first_response_date': 'ts',
    'resolution_date': 'ts',
    'closing_date': 'ts',
    'sla_breached': 'bool',
    'resolution_days': 'int',
    'compensation_granted': 'num',
    'resolution_satisfaction': 'num',
    'is_repeat_complainer': 'bool'
} %}

{{ select_typed(spec, source('bronze', 'complaints')) }}
