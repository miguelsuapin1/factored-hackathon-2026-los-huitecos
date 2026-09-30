-- complaints: staged rows + _reject_reasons (missing required field, or an older load of the same key).
-- Silver keeps the rows with no reasons; silver_quarantine.rejected_rows keeps the others.
{{ checked(ref('stg_complaints'), "complaint_id", ['complaint_id', 'customer_id', 'creation_date', 'category', 'status']) }}
