-- Historical human-only service baseline for the evaluation report: first-contact resolution,
-- handle time, escalation and follow-up per contact reason, country and segment, with sample sizes.
-- Context for our system's numbers, not a like-for-like comparison (different cases, offline vs live).
select
  i.reason_category,
  cu.country,
  cu.segment,
  count(*) as contacts,
  avg(case when i.was_resolved then 1.0 else 0.0 end) as fcr_rate,
  avg(case when i.was_escalated then 1.0 else 0.0 end) as escalation_rate,
  avg(case when i.requires_followup then 1.0 else 0.0 end) as followup_rate,
  avg(i.duration_seconds) / 60 as avg_handle_min,
  avg(i.wait_time_seconds) / 60 as avg_wait_min,
  count(i.duration_seconds) as contacts_with_handle_time
from {{ ref('silver_call_center_interactions') }} as i
join {{ ref('silver_customers') }} as cu using (customer_id)
group by 1, 2, 3
