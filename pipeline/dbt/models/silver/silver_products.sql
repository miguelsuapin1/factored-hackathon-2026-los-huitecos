{{ config(cluster_by=['customer_id']) }}
-- Products (accounts, cards, loans). D1 product type → code; opening branch that doesn't exist → NULL + flag.
select
  p.product_id, p.customer_id,
  pt.code as product_type,
  p.product_number, p.currency, p.current_balance, p.credit_limit, p.interest_rate,
  p.opening_date, p.expiration_date,
  case when b.branch_id is not null then p.opening_branch_id end as opening_branch_id,
  p.product_status, p.opening_channel, p.has_linked_app, p.days_past_due,
  p.last_transaction_date, p.last_updated,
  {{ flags([
      ('C3_opening_branch_orphan', 'p.opening_branch_id is not null and b.branch_id is null'),
      ('D1_product_type_unmapped', 'pt.code is null'),
  ]) }} as _rule_flags,
  p._source_file, p._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_products_checked') }} as p
left join {{ ref('map_labels') }} as pt on pt.domain = 'product_type' and pt.raw_value = p.product_type
left join {{ ref('silver_branches') }} as b on b.branch_id = p.opening_branch_id
where {{ is_clean() }}
