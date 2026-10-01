-- Staging: satisfaction_surveys. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'survey_date': 'ts',
    'process_date': 'date',
    'main_score': 'int',
    'question_1_response': 'num',
    'question_2_response': 'num',
    'question_3_response': 'num',
    'response_time_hours': 'num',
    'campaign_response_rate': 'num'
} %}

{{ select_typed(spec, source('bronze', 'satisfaction_surveys')) }}
