-- Why customers contact the bank and where agent time is lost (the "problem backed by data").
-- Rebuilt from silver so the slides cite cleaned data. Handle time is missing on ~14% of contacts at random
-- (docs/data-issues.md F); time measures use the rows that have it.
with i as (
  select reason_category, channel, was_resolved, was_escalated, requires_followup, sentiment,
         cast(duration_seconds as {{ 'float64' if target.type == 'bigquery' else 'double' }}) as dur
  from {{ ref('silver_call_center_interactions') }}
),
by_reason as (
  select
    reason_category,
    count(*) as contacts,
    avg(case when was_resolved then 1.0 else 0.0 end) as fcr_rate,
    avg(case when was_escalated then 1.0 else 0.0 end) as escalation_rate,
    avg(case when requires_followup then 1.0 else 0.0 end) as followup_rate,
    avg(case when sentiment in ('negative', 'very_negative') then 1.0 else 0.0 end) as negative_sentiment_rate,
    avg(dur) / 60 as avg_handle_min,
    sum(dur) / 3600 as agent_hours,
    sum(case when not was_resolved then dur end) / 3600 as unresolved_agent_hours,
    avg(case when channel = 'phone' then 1.0 else 0.0 end) as phone_share
  from i
  group by 1
)
select
  reason_category,
  contacts,
  contacts / sum(contacts) over () as contact_share,
  fcr_rate,
  escalation_rate,
  followup_rate,
  negative_sentiment_rate,
  avg_handle_min,
  avg_handle_min / nullif(fcr_rate, 0) as agent_min_per_first_contact_resolution,
  agent_hours,
  agent_hours / sum(agent_hours) over () as agent_time_share,
  unresolved_agent_hours / sum(unresolved_agent_hours) over () as share_of_unresolved_time,
  phone_share
from by_reason
