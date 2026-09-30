-- The cohort's products. The full product number never leaves the warehouse (last 4 digits only).
select
  p.product_id,
  p.customer_id,
  p.product_type,
  p.currency,
  p.product_status,
  {{ 'right' if target.type == 'bigquery' else 'right' }}(p.product_number, 4) as product_number_last4,
  p.opening_date
from {{ ref('silver_products') }} as p
where p.customer_id in (select customer_id from {{ ref('serving_customers') }} where data_source = 'organizer')
