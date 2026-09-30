{{ config(cluster_by=['customer_id']) }}
-- Campaign sends: typed and deduplicated only (not used by the dispute workflow).
select
  send_id, campaign_id, customer_id, send_date as send_ts, process_date, send_channel, template_used, subject,
  send_status, was_delivered, was_opened, open_date, was_clicked, click_date, click_count, had_conversion,
  conversion_date, conversion_value, open_device, open_country, failure_reason, send_cost,
  _source_file, _loaded_at, '{{ invocation_id }}' as _run_id
from {{ ref('int_campaign_sends_checked') }}
where {{ is_clean() }}
