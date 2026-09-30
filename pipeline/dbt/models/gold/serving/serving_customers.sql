-- Customers the app may serve. Data minimisation: no names beyond the first name (greeting), no birth date,
-- contact details, address, income or credit score. The document number is kept only as a SHA-256 hash for the
-- step-8 test login (docs/contracts.md); the raw value never leaves the warehouse.
select
  c.customer_id,
  c.first_name,
  c.country,
  c.timezone,
  c.segment,
  c.customer_status,
  c.document_type,
  {{ sha256_hex('c.document_number') }} as document_number_sha256,
  k.cohort_reasons,
  'organizer' as data_source
from {{ ref('serving_cohort') }} as k
join {{ ref('silver_customers') }} as c using (customer_id)
where not k.is_synthetic
union all
select
  d.customer_id, d.first_name, d.country, d.timezone, d.segment, d.customer_status,
  cast(null as {{ 'string' if target.type == 'bigquery' else 'varchar' }}) as document_type,
  cast(null as {{ 'string' if target.type == 'bigquery' else 'varchar' }}) as document_number_sha256,
  k.cohort_reasons,
  'team_synthetic' as data_source
from {{ ref('serving_cohort') }} as k
join {{ ref('demo_fixture_customers') }} as d using (customer_id)
