{{ config(cluster_by=['customer_id']) }}
-- Complaints (PQR). The two money-dispute subcategories are the workflow's history (docs/decisions.md D-002).
--   C1  affected_product_id points to ANOTHER customer's product in 100% of linked rows → set to NULL and
--       flagged; never follow it (privacy). C2 origin_interaction_id is always empty (kept, flagged).
--   Subcategory missing → derived from category (1:1 in the data, seeds/map_complaint_category.csv).
--   E1 Resolved/Closed without resolution_date → flagged, excluded from resolution-time metrics.
--   E2 compensation above the claim → flagged. E3 currency without an amount → currency set to NULL.
select
  c.complaint_id,
  c.customer_id,
  c.creation_date as created_ts,
  {{ local_date('c.creation_date', 'cu.timezone') }} as created_date_local,
  c.process_date,
  c.case_type,
  c.category,
  coalesce(sub.code, cat.subcategory_code) as subcategory,
  (c.subcategory is null) as subcategory_derived,
  coalesce(cat.is_dispute, false) as is_dispute,
  c.reception_channel,
  case when p.customer_id = c.customer_id then c.affected_product_id end as affected_product_id,
  (c.affected_product_id is not null and (p.customer_id is null or p.customer_id <> c.customer_id)) as product_owner_mismatch,
  c.related_branch_id,
  c.origin_interaction_id,
  c.description,
  c.claimed_amount,
  case when c.claimed_amount is not null then c.currency end as currency,
  c.priority,
  c.status,
  c.assigned_agent_id,
  c.assignment_date,
  c.first_response_date,
  c.resolution_date,
  c.closing_date,
  c.sla_breached,
  c.resolution_days,
  c.resolution,
  c.compensation_granted,
  c.resolution_satisfaction,
  c.is_repeat_complainer,
  (c.status in ('Resolved', 'Closed') and c.resolution_date is null) as status_date_inconsistent,
  {{ flags([
      ('C1_product_owner_mismatch', 'c.affected_product_id is not null and (p.customer_id is null or p.customer_id <> c.customer_id)'),
      ('C2_origin_interaction_missing', 'c.origin_interaction_id is null'),
      ('subcategory_derived_from_category', 'c.subcategory is null'),
      ('E1_status_date_inconsistent', "c.status in ('Resolved', 'Closed') and c.resolution_date is null"),
      ('E2_compensation_exceeds_claim', 'c.compensation_granted > c.claimed_amount'),
      ('E3_orphan_currency_nulled', 'c.currency is not null and c.claimed_amount is null'),
      ('subcategory_disagrees_with_category', 'sub.code is not null and sub.code <> cat.subcategory_code'),
  ]) }} as _rule_flags,
  c._source_file, c._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_complaints_checked') }} as c
left join {{ ref('map_complaint_category') }} as cat on cat.category = c.category
left join {{ ref('map_labels') }} as sub on sub.domain = 'complaint_subcategory' and sub.raw_value = c.subcategory
left join {{ ref('silver_products') }} as p on p.product_id = c.affected_product_id
left join {{ ref('silver_customers') }} as cu on cu.customer_id = c.customer_id
where {{ is_clean() }}
