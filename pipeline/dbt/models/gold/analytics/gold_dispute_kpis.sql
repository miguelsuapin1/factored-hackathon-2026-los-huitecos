-- The workflow's history: money-dispute complaints (unrecognized charge + wrongful fee, D-002) by country,
-- segment and subcategory. E1 rows (closed without a date) are excluded from resolution time.
with c as (
  select c.*, cu.country, cu.segment
  from {{ ref('silver_complaints') }} as c
  join {{ ref('silver_customers') }} as cu using (customer_id)
)
select
  subcategory,
  is_dispute,
  country,
  segment,
  count(*) as cases,
  avg(case when status in ('Open', 'In Process', 'Escalated') then 1.0 else 0.0 end) as still_open_rate,
  avg(case when sla_breached then 1.0 else 0.0 end) as sla_breach_rate,
  avg(case when reception_channel = 'Regulator' then 1.0 else 0.0 end) as via_regulator_rate,
  avg(case when is_repeat_complainer then 1.0 else 0.0 end) as repeat_complainer_rate,
  avg(case when not status_date_inconsistent and resolution_days is not null then resolution_days end) as avg_resolution_days,
  sum(case when status_date_inconsistent then 1 else 0 end) as e1_excluded_cases,
  sum(case when product_owner_mismatch then 1 else 0 end) as c1_links_removed
from c
group by 1, 2, 3, 4
