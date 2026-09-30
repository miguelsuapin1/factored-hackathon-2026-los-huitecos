-- The slice must fit the budget we set for Supabase (100 MB of the 500 MB free tier), leaving room for cases,
-- conversations and traces. Fails with the estimate if it doesn't.
select table_name, est_total_mb
from {{ ref('gold_serving_size_estimate') }}
where est_total_mb > 100
