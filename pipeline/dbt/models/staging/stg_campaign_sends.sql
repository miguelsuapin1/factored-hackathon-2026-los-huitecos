-- Staging: campaign_sends. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'send_date': 'ts',
    'process_date': 'date',
    'was_delivered': 'bool',
    'was_opened': 'bool',
    'open_date': 'ts',
    'was_clicked': 'bool',
    'click_date': 'ts',
    'click_count': 'int',
    'had_conversion': 'bool',
    'conversion_date': 'ts',
    'conversion_value': 'num',
    'send_cost': 'num'
} %}

{{ select_typed(spec, source('bronze', 'campaign_sends')) }}
