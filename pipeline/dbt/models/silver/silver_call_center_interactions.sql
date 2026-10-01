{{ config(partition_by=({'field': 'process_date', 'data_type': 'date', 'granularity': 'month'} if target.type == 'bigquery' else none), cluster_by=['customer_id']) }}
-- Contact-center interactions: the demand side of the "problem backed by data".
--   D1 reason, sentiment and channel → codes (seeds/map_labels.csv); D2 contact_reason is identical to
--   reason_category in 100% of rows → dropped. D4 channel "Web" (video) accepted as web_video.
--   A2 interaction_date is UTC; 33% fall the day after process_date (08:00 UTC batch cutoff, not late data).
select
  i.interaction_id,
  i.customer_id,
  i.agent_id,
  i.interaction_date as interaction_ts,
  {{ local_date('i.interaction_date', 'cu.timezone') }} as interaction_date_local,
  i.process_date,
  i.interaction_type,
  ch.code as channel,
  rc.code as reason_category,
  i.duration_seconds,
  i.wait_time_seconds,
  i.was_resolved,
  i.requires_followup,
  i.was_escalated,
  se.code as sentiment,
  i.sentiment_score,
  i.customer_detected_accent,
  i.agent_used_accent,
  i.mentioned_products,
  i.has_transcript,
  i.has_recording,
  {{ flags([
      ('A2_after_batch_cutoff', 'cast(i.interaction_date as date) > i.process_date'),
      ('D1_reason_unmapped', 'rc.code is null'),
      ('D1_sentiment_unmapped', 'i.detected_sentiment is not null and se.code is null'),
      ('D4_channel_unmapped', 'ch.code is null'),
      ('D2_contact_reason_differs', 'i.contact_reason <> i.reason_category'),
  ]) }} as _rule_flags,
  i._source_file, i._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_call_center_interactions_checked') }} as i
left join {{ ref('map_labels') }} as rc on rc.domain = 'reason_category' and rc.raw_value = i.reason_category
left join {{ ref('map_labels') }} as se on se.domain = 'sentiment' and se.raw_value = i.detected_sentiment
left join {{ ref('map_labels') }} as ch on ch.domain = 'interaction_channel' and ch.raw_value = i.channel
left join {{ ref('silver_customers') }} as cu on cu.customer_id = i.customer_id
where {{ is_clean() }}
