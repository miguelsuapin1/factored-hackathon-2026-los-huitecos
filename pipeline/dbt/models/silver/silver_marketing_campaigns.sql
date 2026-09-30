select
  m.campaign_id, m.campaign_name, m.description, m.campaign_type, m.campaign_objective, m.promoted_product,
  m.target_segment, co.iso2 as target_country, m.start_date, m.end_date, m.budget, m.campaign_status,
  m.expected_conversion_rate,
  m._source_file, m._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_marketing_campaigns_checked') }} as m
left join {{ ref('map_countries') }} as co on co.raw_value = m.target_country
where {{ is_clean() }}
