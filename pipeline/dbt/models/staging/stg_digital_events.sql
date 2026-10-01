-- Staging: digital_events. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'event_date': 'ts',
    'process_date': 'date',
    'event_value': 'num',
    'duration_seconds': 'num',
    'is_mobile': 'bool'
} %}

{{ select_typed(spec, source('bronze', 'digital_events')) }}
