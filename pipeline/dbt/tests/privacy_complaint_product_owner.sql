-- C1 (privacy): a complaint may only point to a product owned by the same customer. Every such link in the
-- organizer data points to someone else's product, so silver must have removed all of them.
select c.complaint_id, c.customer_id, p.customer_id as product_owner
from {{ ref('silver_complaints') }} as c
join {{ ref('silver_products') }} as p on p.product_id = c.affected_product_id
where p.customer_id <> c.customer_id
