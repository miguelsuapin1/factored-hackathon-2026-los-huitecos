{# Value range, inclusive; NULLs pass (use not_null for those). #}
{% test between(model, column_name, min_value, max_value) %}
select {{ column_name }} as value
from {{ model }}
where {{ column_name }} < {{ min_value }} or {{ column_name }} > {{ max_value }}
{% endtest %}

{#
  Schema-drift contract on a bronze source (docs/data-issues.md A3): the table must have exactly the expected
  columns. A new, missing or renamed column fails the build loudly instead of shifting values downstream.
#}
{% test columns_match(model, expected) %}
{%- set lineage_cols = ['_source_file', '_loaded_at', 'year', 'month', 'day', 'filename'] -%}
with actual as (
  select lower(column_name) as column_name
  {% if target.type == 'bigquery' -%}
  from `{{ model.database }}`.{{ model.schema }}.INFORMATION_SCHEMA.COLUMNS
  {%- else -%}
  from information_schema.columns
  {%- endif %}
  where lower(table_name) = lower('{{ model.identifier }}')
  {% if target.type != 'bigquery' %}and lower(table_schema) = lower('{{ model.schema }}'){% endif %}
),
expected as (
  {% for c in expected %}select '{{ c }}' as column_name{{ ' union all ' if not loop.last }}{% endfor %}
)
select 'unexpected column' as problem, a.column_name
from actual a left join expected e using (column_name)
where e.column_name is null and a.column_name not in ({% for c in lineage_cols %}'{{ c }}'{{ ',' if not loop.last }}{% endfor %})
union all
select 'missing column' as problem, e.column_name
from expected e left join actual a using (column_name)
where a.column_name is null
{% endtest %}
