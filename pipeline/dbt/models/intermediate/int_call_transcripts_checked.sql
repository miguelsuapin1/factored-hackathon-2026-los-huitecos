-- call_transcripts: staged rows + _reject_reasons (missing required field, or an older load of the same key).
-- Silver keeps the rows with no reasons; silver_quarantine.rejected_rows keeps the others.
{{ checked(ref('stg_call_transcripts'), "transcript_id", ['transcript_id', 'interaction_id', 'customer_id']) }}
