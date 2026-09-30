-- A5: every non-USD transaction has a USD amount, and every derived one says so and names its rate.
select transaction_id, currency, amount_usd, amount_usd_derived, fx_rate_used
from {{ ref('silver_transactions') }}
where amount_usd is null
   or (amount_usd_derived and fx_rate_used is null)
   or (not amount_usd_derived and fx_rate_used is not null)
   or (currency = 'USD' and amount_usd <> amount)
