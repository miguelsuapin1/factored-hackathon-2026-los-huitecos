-- Rates to USD for the serving window (so the app can show an approximate USD value if it ever needs to).
{% set today = "cast('" ~ var('demo_today') ~ "' as date)" %}
select date, source_currency, target_currency, exchange_rate
from {{ ref('silver_fx_rates') }}
where target_currency = 'USD'
  and date > {{ months_before(today, var('serving_months')) }} and date <= {{ today }}
