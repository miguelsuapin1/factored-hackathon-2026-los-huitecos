-- call_center_interactions: staged rows + _reject_reasons (missing required field, or an older load of the same key).
-- Silver keeps the rows with no reasons; silver_quarantine.rejected_rows keeps the others.
{{ checked(ref('stg_call_center_interactions'), "interaction_id", ['interaction_id', 'customer_id', 'interaction_date', 'reason_category']) }}
