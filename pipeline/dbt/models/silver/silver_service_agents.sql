-- Agents. Specialty → code; languages → flags used to route hand-offs (Portuguese speakers, fraud team).
select
  a.agent_id, a.employee_code, a.first_name, a.last_name, a.email, a.phone, a.native_accent,
  co.iso2 as country_of_origin,
  a.assigned_branch_id, a.agent_type, a.experience_level,
  a.languages,
  {{ 'regexp_contains(lower(a.languages), r"portugu")' if target.type == 'bigquery' else "regexp_matches(lower(a.languages), 'portugu')" }} as speaks_portuguese,
  {{ 'regexp_contains(lower(a.languages), r"ingl")' if target.type == 'bigquery' else "regexp_matches(lower(a.languages), 'ingl')" }} as speaks_english,
  sp.code as specialty,
  a.hire_date, a.avg_csat, a.total_monthly_interactions, a.agent_status, a.work_shift,
  {{ flags([('D1_specialty_unmapped', 'a.specialty is not null and sp.code is null')]) }} as _rule_flags,
  a._source_file, a._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_service_agents_checked') }} as a
left join {{ ref('map_countries') }} as co on co.raw_value = a.country_of_origin
left join {{ ref('map_labels') }} as sp on sp.domain = 'agent_specialty' and sp.raw_value = a.specialty
where {{ is_clean() }}
