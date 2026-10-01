-- satisfaction_surveys: staged rows + _reject_reasons (missing required field, or an older load of the same key).
-- Silver keeps the rows with no reasons; silver_quarantine.rejected_rows keeps the others.
{{ checked(ref('stg_satisfaction_surveys'), "survey_id", ['survey_id', 'customer_id', 'survey_type', 'main_score']) }}
