{{ config(partition_by=({'field': 'process_date', 'data_type': 'date', 'granularity': 'month'} if target.type == 'bigquery' else none), cluster_by=['customer_id', 'session_id']) }}
-- Digital (app/web) events, 15.6M rows. Typed, deduplicated, IP country → ISO where it is a known country.
-- A7: 3.7M events (24%) have no customer_id, including ~584K logins; kept and flagged as anonymous.
select
  e.event_id, e.customer_id, e.session_id,
  e.event_date as event_ts, e.process_date,
  e.event_type, e.event_category, e.channel, e.platform, e.browser, e.app_version,
  e.page_url, e.page_title, e.action, e.element_id, e.product_id, e.event_value, e.duration_seconds,
  e.ip_address, coalesce(co.iso2, e.ip_country) as ip_country, e.ip_city, e.is_mobile,
  e.referrer, e.utm_source, e.utm_medium, e.utm_campaign,
  (e.customer_id is null) as anonymous_event,
  e._source_file, e._loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_digital_events_checked') }} as e
left join {{ ref('map_countries') }} as co on co.raw_value = e.ip_country
where {{ is_clean() }}
