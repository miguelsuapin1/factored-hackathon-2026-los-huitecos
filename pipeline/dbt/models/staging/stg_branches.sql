-- Staging: branches. Every bronze column, typed where it isn't text (strings stay as loaded).
-- No rows are removed or changed; unparseable values become NULL and are listed in _cast_errors
-- (counted by tests and the silver quality report, docs/data-issues.md D5).
{% set spec = {
    'has_atms': 'bool',
    'atm_count': 'int',
    'has_teller_windows': 'bool',
    'teller_window_count': 'int',
    'latitude': 'num',
    'longitude': 'num',
    'branch_opening_date': 'date'
} %}

{{ select_typed(spec, source('bronze', 'branches')) }}
