-- campaign_sends: staged rows + _reject_reasons (missing required field, or an older load of the same key).
-- Silver keeps the rows with no reasons; silver_quarantine.rejected_rows keeps the others.
{{ checked(ref('stg_campaign_sends'), "send_id", ['send_id', 'campaign_id', 'customer_id']) }}
