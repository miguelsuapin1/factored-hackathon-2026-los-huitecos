-- Transcripts. B1/B2: customer_text has 42 templated values and detected_intents is always
-- "consulta_general", so this table is kept for completeness but never used for training or evaluation.
-- E6: duration missing on 14% of rows; the linked interaction's duration is missing too, so nothing can be
-- filled from it (checked 2026-09-30). Flagged instead.
select
  t.transcript_id, t.interaction_id, t.customer_id, t.agent_id, t.process_date,
  t.full_text, t.customer_text, t.agent_text, t.detected_language, t.detected_accent, t.accent_confidence,
  t.detected_keywords, t.mentioned_entities, t.detected_intents, t.main_topics, t.transcription_model,
  t.audio_quality,
  coalesce(t.duration_seconds, i.duration_seconds) as duration_seconds,
  (t.duration_seconds is null and i.duration_seconds is not null) as duration_from_interaction,
  {{ flags([
      ('E6_duration_missing', 't.duration_seconds is null and i.duration_seconds is null'),
      ('E6_duration_from_interaction', 't.duration_seconds is null and i.duration_seconds is not null'),
  ]) }} as _rule_flags,
  t._source_file, t._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_call_transcripts_checked') }} as t
left join (select interaction_id, duration_seconds from {{ ref('silver_call_center_interactions') }}) as i
  on i.interaction_id = t.interaction_id
where {{ is_clean() }}
