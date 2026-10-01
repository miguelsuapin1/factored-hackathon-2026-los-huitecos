{#
  Shared silver rules. Adapter-dispatched where BigQuery and DuckDB differ (docs/decisions.md D-005).
#}

{#
  checked(relation, pk, required): every staged row plus `_reject_reasons`, an array that is empty for a
  good row. A row is rejected (goes to quarantine, never silently dropped) when a required field is missing
  or unparseable, or when a newer load of the same primary key exists (dedup keeps the latest load,
  docs/data-issues.md A1/A2: late files update, duplicates don't double count).
#}
{% macro checked(relation, pk, required) -%}{{ return(adapter.dispatch('checked', 'latam_bank')(relation, pk, required)) }}{%- endmacro %}

{% macro bigquery__checked(relation, pk, required) -%}
select
  r.*,
  cast({{ pk }} as string) as _record_key,
  array_concat(
    array(select c from unnest([
      {%- for col in required %}
      if({{ col }} is null, 'missing:{{ col }}', null){{ "," if not loop.last }}
      {%- endfor %}
    ]) as c where c is not null),
    if(row_number() over (partition by {{ pk }} order by _loaded_at desc, process_date desc, _source_file desc) > 1,
       ['duplicate_key:older_load'], cast([] as array<string>))
  ) as _reject_reasons
from {{ relation }} as r
{%- endmacro %}

{% macro duckdb__checked(relation, pk, required) -%}
select
  r.*,
  cast({{ pk }} as string) as _record_key,
  list_concat(
    list_filter([
      {%- for col in required %}
      case when {{ col }} is null then 'missing:{{ col }}' end{{ "," if not loop.last }}
      {%- endfor %}
    ], c -> c is not null),
    case when row_number() over (partition by {{ pk }} order by _loaded_at desc, process_date desc, _source_file desc) > 1
         then ['duplicate_key:older_load'] else []::varchar[] end
  ) as _reject_reasons
from {{ relation }} as r
{%- endmacro %}

{# Snapshot tables have no process_date: same rule, ordered by load only. #}
{% macro checked_snapshot(relation, pk, required) -%}{{ return(adapter.dispatch('checked_snapshot', 'latam_bank')(relation, pk, required)) }}{%- endmacro %}
{% macro bigquery__checked_snapshot(relation, pk, required) -%}
select
  r.*,
  cast({{ pk }} as string) as _record_key,
  array_concat(
    array(select c from unnest([
      {%- for col in required %}
      if({{ col }} is null, 'missing:{{ col }}', null){{ "," if not loop.last }}
      {%- endfor %}
    ]) as c where c is not null),
    if(row_number() over (partition by {{ pk }} order by _loaded_at desc, _source_file desc) > 1,
       ['duplicate_key:older_load'], cast([] as array<string>))
  ) as _reject_reasons
from {{ relation }} as r
{%- endmacro %}
{% macro duckdb__checked_snapshot(relation, pk, required) -%}
select
  r.*,
  cast({{ pk }} as string) as _record_key,
  list_concat(
    list_filter([
      {%- for col in required %}
      case when {{ col }} is null then 'missing:{{ col }}' end{{ "," if not loop.last }}
      {%- endfor %}
    ], c -> c is not null),
    case when row_number() over (partition by {{ pk }} order by _loaded_at desc, _source_file desc) > 1
         then ['duplicate_key:older_load'] else []::varchar[] end
  ) as _reject_reasons
from {{ relation }} as r
{%- endmacro %}

{% macro is_clean() -%}{{ return(adapter.dispatch('is_clean', 'latam_bank')()) }}{%- endmacro %}
{% macro bigquery__is_clean() -%}array_length(_reject_reasons) = 0{%- endmacro %}
{% macro duckdb__is_clean() -%}len(_reject_reasons) = 0{%- endmacro %}

{# flags([('C1_product_owner_mismatch', 'condition'), ...]) → array of the rule ids whose condition holds #}
{% macro flags(pairs) -%}{{ return(adapter.dispatch('flags', 'latam_bank')(pairs)) }}{%- endmacro %}
{% macro bigquery__flags(pairs) -%}
  array(select f from unnest([
  {%- for name, cond in pairs %}
    if(coalesce({{ cond }}, false), '{{ name }}', null){{ "," if not loop.last }}
  {%- endfor %}
  ]) as f where f is not null)
{%- endmacro %}
{% macro duckdb__flags(pairs) -%}
  list_filter([
  {%- for name, cond in pairs %}
    case when coalesce({{ cond }}, false) then '{{ name }}' end{{ "," if not loop.last }}
  {%- endfor %}
  ], f -> f is not null)
{%- endmacro %}

{# Calendar date of a UTC timestamp in an IANA time zone (docs/data-issues.md A2). #}
{% macro local_date(ts, tz) -%}{{ return(adapter.dispatch('local_date', 'latam_bank')(ts, tz)) }}{%- endmacro %}
{% macro bigquery__local_date(ts, tz) -%}date({{ ts }}, {{ tz }}){%- endmacro %}
{% macro duckdb__local_date(ts, tz) -%}cast(timezone({{ tz }}, cast({{ ts }} as timestamptz)) as date){%- endmacro %}

{# Lineage columns carried by every silver row. #}
{% macro lineage() -%}
  _source_file,
  _loaded_at,
  '{{ invocation_id }}' as _run_id
{%- endmacro %}

{# The quarantine rows of one table, in the shape of silver_quarantine.rejected_rows. #}
{% macro quarantine_rows(table_name, checked_relation_sql, pk) -%}{{ return(adapter.dispatch('quarantine_rows', 'latam_bank')(table_name, checked_relation_sql, pk)) }}{%- endmacro %}
{% macro bigquery__quarantine_rows(table_name, checked_relation_sql, pk) -%}
select '{{ table_name }}' as table_name, cast(q._record_key as string) as record_key, q._reject_reasons as reasons,
       to_json_string(q) as record, q._source_file, q._loaded_at, '{{ invocation_id }}' as _run_id
from ({{ checked_relation_sql }}) as q
where array_length(q._reject_reasons) > 0
{%- endmacro %}
{% macro duckdb__quarantine_rows(table_name, checked_relation_sql, pk) -%}
select '{{ table_name }}' as table_name, cast(q._record_key as varchar) as record_key, q._reject_reasons as reasons,
       cast(to_json(q) as varchar) as record, q._source_file, q._loaded_at, '{{ invocation_id }}' as _run_id
from ({{ checked_relation_sql }}) as q
where len(q._reject_reasons) > 0
{%- endmacro %}

{# Deterministic pseudo-random order for sampling (same seed → same cohort on every run and engine-specific). #}
{% macro stable_hash(expr) -%}{{ return(adapter.dispatch('stable_hash', 'latam_bank')(expr)) }}{%- endmacro %}
{% macro bigquery__stable_hash(expr) -%}farm_fingerprint({{ expr }}){%- endmacro %}
{% macro duckdb__stable_hash(expr) -%}hash({{ expr }}){%- endmacro %}

{% macro days_before(d, n) -%}{{ return(adapter.dispatch('days_before', 'latam_bank')(d, n)) }}{%- endmacro %}
{% macro bigquery__days_before(d, n) -%}date_sub({{ d }}, interval {{ n }} day){%- endmacro %}
{% macro duckdb__days_before(d, n) -%}cast({{ d }} - interval {{ n }} day as date){%- endmacro %}

{% macro months_before(d, n) -%}{{ return(adapter.dispatch('months_before', 'latam_bank')(d, n)) }}{%- endmacro %}
{% macro bigquery__months_before(d, n) -%}date_sub({{ d }}, interval {{ n }} month){%- endmacro %}
{% macro duckdb__months_before(d, n) -%}cast({{ d }} - interval {{ n }} month as date){%- endmacro %}

{% macro sha256_hex(expr) -%}{{ return(adapter.dispatch('sha256_hex', 'latam_bank')(expr)) }}{%- endmacro %}
{% macro bigquery__sha256_hex(expr) -%}to_hex(sha256({{ expr }})){%- endmacro %}
{% macro duckdb__sha256_hex(expr) -%}sha256({{ expr }}){%- endmacro %}

{# A local wall-clock time in an IANA zone → UTC timestamp. #}
{% macro local_to_utc(local_ts, tz) -%}{{ return(adapter.dispatch('local_to_utc', 'latam_bank')(local_ts, tz)) }}{%- endmacro %}
{% macro bigquery__local_to_utc(local_ts, tz) -%}timestamp(datetime({{ local_ts }}), {{ tz }}){%- endmacro %}
{% macro duckdb__local_to_utc(local_ts, tz) -%}timezone({{ tz }}, cast({{ local_ts }} as timestamp)){%- endmacro %}

{# Approximate stored size of a row: its JSON text (keys included, so a conservative over-estimate). #}
{% macro row_json_bytes(alias) -%}{{ return(adapter.dispatch('row_json_bytes', 'latam_bank')(alias)) }}{%- endmacro %}
{% macro bigquery__row_json_bytes(alias) -%}byte_length(to_json_string({{ alias }})){%- endmacro %}
{% macro duckdb__row_json_bytes(alias) -%}strlen(cast(to_json({{ alias }}) as varchar)){%- endmacro %}
