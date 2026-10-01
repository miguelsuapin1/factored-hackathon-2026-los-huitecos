-- digital_events: staged rows + _reject_reasons (missing required field, or an older load of the same key).
-- customer_id is NOT required here: 24% of events are anonymous (pre-login), docs/data-issues.md A7.
-- Silver keeps the rows with no reasons; silver_quarantine.rejected_rows keeps the others.
{{ checked(ref('stg_digital_events'), "event_id", ['event_id', 'event_date']) }}
