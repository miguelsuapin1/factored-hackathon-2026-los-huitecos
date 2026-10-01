-- Customers. Identity fields stay here (the warehouse); the serving slice drops or hashes them.
-- Rules: D1 document type → code (Pasaporte → PASSPORT), D3 country → ISO + home time zone,
-- C3 registration branch that doesn't exist → NULL + flag, D6 Mexican customers carry DNI (documented only).
select
  c.customer_id,
  c.document_number,
  dt.code as document_type,
  c.first_name, c.last_name, c.date_of_birth, c.gender, c.email, c.mobile_phone, c.landline_phone,
  c.address, c.city, c.state,
  co.iso2 as country,
  co.timezone,
  c.postal_code, c.detected_accent, c.segment, c.credit_score, c.estimated_monthly_income,
  c.occupation, c.marital_status, c.education_level, c.registration_date,
  case when b.branch_id is not null then c.registration_branch_id end as registration_branch_id,
  c.customer_status, c.last_updated, c.accepts_marketing,
  {{ flags([
      ('C3_registration_branch_orphan', 'c.registration_branch_id is not null and b.branch_id is null'),
      ('D6_mx_customer_with_dni', "co.iso2 = 'MX' and dt.code = 'DNI'"),
      ('D1_document_type_unmapped', 'c.document_type is not null and dt.code is null'),
      ('D3_country_unmapped', 'co.iso2 is null'),
  ]) }} as _rule_flags,
  c._source_file, c._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_customers_checked') }} as c
left join {{ ref('map_countries') }} as co on co.raw_value = c.country
left join {{ ref('map_labels') }} as dt on dt.domain = 'document_type' and dt.raw_value = c.document_type
left join {{ ref('silver_branches') }} as b on b.branch_id = c.registration_branch_id
where {{ is_clean() }}
