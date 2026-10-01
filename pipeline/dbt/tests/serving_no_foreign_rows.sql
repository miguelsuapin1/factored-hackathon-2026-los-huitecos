-- Scoping at the source: every serving transaction and product belongs to a customer in the slice, and every
-- organizer transaction's product belongs to that same customer.
select t.transaction_id
from {{ ref('serving_transactions') }} as t
left join {{ ref('serving_products') }} as p on p.product_id = t.product_id
where t.data_source = 'organizer' and (p.product_id is null or p.customer_id <> t.customer_id)
