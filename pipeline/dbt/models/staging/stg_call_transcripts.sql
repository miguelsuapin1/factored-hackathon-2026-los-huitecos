-- Staging: call_transcripts. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'process_date': 'date',
    'accent_confidence': 'num',
    'duration_seconds': 'int'
} %}

{{ select_typed(spec, source('bronze', 'call_transcripts')) }}
