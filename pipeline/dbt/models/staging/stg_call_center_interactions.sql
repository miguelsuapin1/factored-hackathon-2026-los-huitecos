-- Staging: call_center_interactions. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'interaction_date': 'ts',
    'process_date': 'date',
    'duration_seconds': 'int',
    'wait_time_seconds': 'int',
    'was_resolved': 'bool',
    'requires_followup': 'bool',
    'sentiment_score': 'num',
    'was_escalated': 'bool',
    'has_transcript': 'bool',
    'has_recording': 'bool'
} %}

{{ select_typed(spec, source('bronze', 'call_center_interactions')) }}
