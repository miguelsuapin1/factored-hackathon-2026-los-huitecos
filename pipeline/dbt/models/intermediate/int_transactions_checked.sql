-- transactions: staged rows + _reject_reasons (missing required field, or an older load of the same key).
-- Silver keeps the rows with no reasons; silver_quarantine.rejected_rows keeps the others.
{{ checked(ref('stg_transactions'), "transaction_id", ['transaction_id', 'customer_id', 'product_id', 'transaction_date', 'amount', 'currency', 'transaction_status']) }}
