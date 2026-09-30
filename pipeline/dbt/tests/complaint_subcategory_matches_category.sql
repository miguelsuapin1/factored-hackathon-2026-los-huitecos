-- Filling a missing subcategory from the category is only valid while the two stay 1:1 (checked 2026-09-30).
select c.complaint_id, c.category, c.subcategory
from {{ ref('silver_complaints') }} as c
join {{ ref('map_complaint_category') }} as m on m.category = c.category
where c.subcategory <> m.subcategory_code
