-- First profile of the 15.6M digital events (never analysed before). Monthly volume by event type and channel,
-- the anonymous share (A7) and errors, to size how much demand a digital assistant could see.
select
  {{ 'date_trunc(process_date, month)' if target.type == 'bigquery' else "date_trunc('month', process_date)" }} as month,
  event_type,
  event_category,
  channel,
  count(*) as events,
  sum(case when anonymous_event then 1 else 0 end) as anonymous_events,
  count(distinct session_id) as sessions,
  count(distinct customer_id) as customers
from {{ ref('silver_digital_events') }}
group by 1, 2, 3, 4
