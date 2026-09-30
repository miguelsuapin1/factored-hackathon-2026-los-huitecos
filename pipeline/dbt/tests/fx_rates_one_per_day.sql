-- One rate per currency pair and day (the key the USD derivation joins on).
select date, source_currency, target_currency, count(*) as n
from {{ ref('silver_fx_rates') }}
group by 1, 2, 3
having count(*) > 1
