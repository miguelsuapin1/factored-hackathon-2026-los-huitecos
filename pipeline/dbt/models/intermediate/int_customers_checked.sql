-- customers: staged rows + _reject_reasons (missing required field, or an older load of the same key).
-- Silver keeps the rows with no reasons; silver_quarantine.rejected_rows keeps the others.
{{ checked_snapshot(ref('stg_customers'), "customer_id", ['customer_id', 'country', 'segment']) }}
