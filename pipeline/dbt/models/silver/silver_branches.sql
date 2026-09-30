select
  b.branch_id, b.branch_code, b.branch_name, b.branch_type, b.address, b.city, b.state,
  co.iso2 as country, b.postal_code, b.geographic_zone, b.phone, b.email, b.opening_time, b.closing_time,
  b.has_atms, b.atm_count, b.has_teller_windows, b.teller_window_count, b.latitude, b.longitude,
  b.branch_opening_date, b.branch_status,
  {{ flags([('D3_country_unmapped', 'b.country is not null and co.iso2 is null')]) }} as _rule_flags,
  b._source_file, b._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_branches_checked') }} as b
left join {{ ref('map_countries') }} as co on co.raw_value = b.country
where {{ is_clean() }}
