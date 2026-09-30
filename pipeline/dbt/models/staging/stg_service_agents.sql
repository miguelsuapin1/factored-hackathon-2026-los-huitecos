-- Staging: service_agents. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'hire_date': 'date',
    'avg_csat': 'num',
    'total_monthly_interactions': 'int'
} %}

{{ select_typed(spec, source('bronze', 'service_agents')) }}
