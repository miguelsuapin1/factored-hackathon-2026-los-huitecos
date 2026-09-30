-- Surveys. E5: nps_category is recomputed from the score (0-6 Detractor, 7-8 Passive, 9-10 Promoter);
-- 3,274 NPS rows arrive without it. No score is ever 9-10, so there are no Promoters (reported, not fixed).
select
  s.survey_id, s.interaction_id, s.customer_id, s.agent_id,
  s.survey_date as survey_ts, s.process_date,
  s.survey_type, s.send_channel, s.main_score,
  case when s.survey_type = 'NPS' then
    case when s.main_score >= 9 then 'Promoter' when s.main_score >= 7 then 'Passive' else 'Detractor' end
  end as nps_category,
  s.question_1_text, s.question_1_response, s.question_2_text, s.question_2_response,
  s.question_3_text, s.question_3_response, s.open_comments, s.comment_sentiment,
  s.response_time_hours, s.campaign_response_rate,
  {{ flags([
      ('E5_nps_category_derived', "s.survey_type = 'NPS' and s.nps_category is null"),
      ('E5_nps_category_disagrees', "s.survey_type = 'NPS' and s.nps_category is not null and s.nps_category <> case when s.main_score >= 9 then 'Promoter' when s.main_score >= 7 then 'Passive' else 'Detractor' end"),
  ]) }} as _rule_flags,
  s._source_file, s._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_satisfaction_surveys_checked') }} as s
where {{ is_clean() }}
