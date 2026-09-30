{#
  Typed casts from the all-STRING bronze layer (docs/data-issues.md D5). Each cast returns NULL instead of
  failing; `_cast_errors` lists the columns whose non-null raw value could not be parsed, so bad values are
  counted (tests, silver quality report) instead of silently disappearing. The CSV readers already turn empty
  fields into NULL and strip the BOM, so no trimming is needed here.
  Dispatched per adapter so the same models run on BigQuery and on DuckDB (docs/decisions.md D-005).
#}

{% macro cast_to(col, kind) -%}{{ return(adapter.dispatch('cast_to', 'latam_bank')(col, kind)) }}{%- endmacro %}

{% macro bigquery__cast_to(col, kind) -%}
  {%- if kind == 'ts' -%}safe.parse_timestamp('%F %T', {{ col }})
  {%- elif kind == 'date' -%}safe.parse_date('%F', {{ col }})
  {%- elif kind == 'num' -%}safe_cast({{ col }} as float64)
  {%- elif kind == 'int' -%}safe_cast(safe_cast({{ col }} as float64) as int64)
  {%- elif kind == 'bool' -%}safe_cast({{ col }} as bool)
  {%- endif -%}
{%- endmacro %}

{% macro duckdb__cast_to(col, kind) -%}
  {%- if kind == 'ts' -%}try_strptime({{ col }}, '%Y-%m-%d %H:%M:%S')
  {%- elif kind == 'date' -%}try_cast({{ col }} as date)
  {%- elif kind == 'num' -%}try_cast({{ col }} as double)
  {%- elif kind == 'int' -%}try_cast(try_cast({{ col }} as double) as bigint)
  {%- elif kind == 'bool' -%}try_cast({{ col }} as boolean)
  {%- endif -%}
{%- endmacro %}

{% macro cast_errors(spec) -%}{{ return(adapter.dispatch('cast_errors', 'latam_bank')(spec)) }}{%- endmacro %}
{% macro bigquery__cast_errors(spec) -%}
  array(select c from unnest([
  {%- for col, kind in spec.items() %}
    if({{ col }} is not null and {{ cast_to(col, kind) }} is null, '{{ col }}', null){{ "," if not loop.last }}
  {%- endfor %}
  ]) as c where c is not null)
{%- endmacro %}
{% macro duckdb__cast_errors(spec) -%}
  list_filter([
  {%- for col, kind in spec.items() %}
    case when {{ col }} is not null and {{ cast_to(col, kind) }} is null then '{{ col }}' end{{ "," if not loop.last }}
  {%- endfor %}
  ], c -> c is not null)
{%- endmacro %}

{#
  select_typed(spec, relation): every bronze column, with the typed ones replaced in place, plus _cast_errors.
  spec = {'column': 'ts' | 'date' | 'num' | 'int' | 'bool'}; columns not listed stay STRING.
#}
{% macro select_typed(spec, relation) -%}
select
  * replace (
  {%- for col, kind in spec.items() %}
    {{ cast_to(col, kind) }} as {{ col }}{{ "," if not loop.last }}
  {%- endfor %}
  ),
  {{ cast_errors(spec) }} as _cast_errors
from {{ relation }}
{%- endmacro %}
