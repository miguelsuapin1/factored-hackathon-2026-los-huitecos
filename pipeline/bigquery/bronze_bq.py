"""Bronze layer in BigQuery: raw organizer CSVs in Cloud Storage -> native tables, verbatim.

Mirrors pipeline/bronze.py (DuckDB): every column is loaded as STRING, nothing is cleaned,
and every row keeps its source file and load time. See docs/decisions.md D-003.

Two datasets are created in the bucket's region:
  raw_ext  external tables that read the CSVs in place (hive partitions year=/month=/day=)
  bronze   native copies of raw_ext plus _source_file and _loaded_at (lineage)

Usage:
  uv run python pipeline/bigquery/bronze_bq.py --print            # emit the SQL only
  uv run python pipeline/bigquery/bronze_bq.py                    # run it (needs gcloud auth)
  uv run python pipeline/bigquery/bronze_bq.py --verify           # row counts vs expected

Configuration comes from env vars (defaults are the team project):
  GCP_PROJECT   project-d49391de-51c4-49bf-aae
  GCS_BUCKET    factored_gt_latam_bank_raw   (files under raw/, copied by Storage Transfer from S3 data/)
  BQ_LOCATION   us-east1
"""
import argparse
import os

PROJECT = os.environ.get("GCP_PROJECT", "project-d49391de-51c4-49bf-aae")
BUCKET = os.environ.get("GCS_BUCKET", "factored_gt_latam_bank_raw")
LOCATION = os.environ.get("BQ_LOCATION", "us-east1")
PREFIX = f"gs://{BUCKET}/raw"

# Headers read from the files on 2026-09-29. Every daily file of a table has the same header
# (checked across all 7,671 files), so a fixed column list is safe; a new column in a future
# file would fail the load loudly instead of silently shifting values.
PARTITIONED = {
    "transactions": "transaction_id,transaction_date,process_date,product_id,customer_id,transaction_type,transaction_category,amount,currency,amount_usd,channel,branch_id,merchant_name,merchant_category,transaction_country,transaction_city,transaction_status,response_code,is_fraud,fraud_score,latitude,longitude",
    "call_center_interactions": "interaction_id,interaction_date,process_date,customer_id,agent_id,interaction_type,channel,contact_reason,reason_category,duration_seconds,wait_time_seconds,was_resolved,requires_followup,detected_sentiment,sentiment_score,customer_detected_accent,agent_used_accent,was_escalated,mentioned_products,has_transcript,has_recording",
    "call_transcripts": "transcript_id,interaction_id,process_date,customer_id,agent_id,full_text,customer_text,agent_text,detected_language,detected_accent,accent_confidence,detected_keywords,mentioned_entities,detected_intents,main_topics,transcription_model,audio_quality,duration_seconds",
    "satisfaction_surveys": "survey_id,survey_date,process_date,interaction_id,customer_id,agent_id,survey_type,send_channel,main_score,nps_category,question_1_text,question_1_response,question_2_text,question_2_response,question_3_text,question_3_response,open_comments,comment_sentiment,response_time_hours,campaign_response_rate",
    "complaints": "complaint_id,creation_date,process_date,customer_id,case_type,category,subcategory,reception_channel,affected_product_id,related_branch_id,origin_interaction_id,description,claimed_amount,currency,priority,status,assigned_agent_id,assignment_date,first_response_date,resolution_date,closing_date,sla_breached,resolution_days,resolution,compensation_granted,resolution_satisfaction,is_repeat_complainer",
    "campaign_sends": "send_id,send_date,process_date,campaign_id,customer_id,send_channel,template_used,subject,send_status,was_delivered,was_opened,open_date,was_clicked,click_date,click_count,had_conversion,conversion_date,conversion_value,open_device,open_country,failure_reason,send_cost",
    "digital_events": "event_id,event_date,process_date,customer_id,session_id,event_type,event_category,channel,platform,browser,app_version,page_url,page_title,action,element_id,product_id,event_value,duration_seconds,ip_address,ip_country,ip_city,is_mobile,referrer,utm_source,utm_medium,utm_campaign",
}
SNAPSHOTS = {
    "customers": "customer_id,document_number,document_type,first_name,last_name,date_of_birth,gender,email,mobile_phone,landline_phone,address,city,state,country,postal_code,detected_accent,segment,credit_score,estimated_monthly_income,occupation,marital_status,education_level,registration_date,registration_branch_id,customer_status,last_updated,accepts_marketing",
    "products": "product_id,customer_id,product_type,product_number,currency,current_balance,credit_limit,interest_rate,opening_date,expiration_date,opening_branch_id,product_status,opening_channel,has_linked_app,days_past_due,last_transaction_date,last_updated",
    "branches": "branch_id,branch_code,branch_name,branch_type,address,city,state,country,postal_code,geographic_zone,phone,email,opening_time,closing_time,has_atms,atm_count,has_teller_windows,teller_window_count,latitude,longitude,branch_opening_date,branch_status",
    "service_agents": "agent_id,employee_code,first_name,last_name,email,phone,native_accent,country_of_origin,assigned_branch_id,agent_type,experience_level,languages,specialty,hire_date,avg_csat,total_monthly_interactions,agent_status,work_shift",
    "marketing_campaigns": "campaign_id,campaign_name,description,campaign_type,campaign_objective,promoted_product,target_segment,target_country,start_date,end_date,budget,campaign_status,expected_conversion_rate",
    "daily_exchange_rates": "date,source_currency,target_currency,exchange_rate,buy_rate,sell_rate,source",
}

# Rows observed by the DuckDB bronze layer (reports/data_quality.md); BigQuery reproduced all 12
# exactly on 2026-09-29. digital_events was never loaded into DuckDB; its count is BigQuery's own.
EXPECTED = {
    "customers": 150_000, "products": 400_000, "branches": 350, "service_agents": 1_200,
    "marketing_campaigns": 200, "daily_exchange_rates": 13_164, "transactions": 4_425_008,
    "call_center_interactions": 686_296, "call_transcripts": 171_321,
    "satisfaction_surveys": 212_759, "complaints": 67_095, "campaign_sends": 1_746_801,
    "digital_events": 15_620_994,  # first loaded here (2026-09-29); the dictionary promises 10M
}

# Clustering only changes physical layout (faster, cheaper per-customer reads for the gold layer).
CLUSTER = {t: "customer_id" for t in [*PARTITIONED, "products"]}

CSV_OPTIONS = ("format = 'CSV', skip_leading_rows = 1, allow_quoted_newlines = true, "
               "encoding = 'UTF-8', null_marker = ''")


def cols(header: str) -> str:
    return ", ".join(f"`{c}` STRING" for c in header.split(","))


def ddl() -> list[str]:
    ds = lambda name: f"`{PROJECT}.{name}`"  # noqa: E731
    stmts = [
        f"CREATE SCHEMA IF NOT EXISTS {ds('raw_ext')} OPTIONS (location = '{LOCATION}', "
        "description = 'External tables over the organizer CSVs in Cloud Storage (read in place)')",
        f"CREATE SCHEMA IF NOT EXISTS {ds('bronze')} OPTIONS (location = '{LOCATION}', "
        "description = 'Bronze: organizer CSVs verbatim, all STRING, with _source_file and _loaded_at')",
    ]
    for t, header in PARTITIONED.items():
        stmts.append(
            f"CREATE OR REPLACE EXTERNAL TABLE `{PROJECT}.raw_ext.{t}` ({cols(header)})\n"
            "WITH PARTITION COLUMNS (year STRING, month STRING, day STRING)\n"
            f"OPTIONS ({CSV_OPTIONS}, uris = ['{PREFIX}/{t}/*'], "
            f"hive_partition_uri_prefix = '{PREFIX}/{t}')")
    for t, header in SNAPSHOTS.items():
        stmts.append(
            f"CREATE OR REPLACE EXTERNAL TABLE `{PROJECT}.raw_ext.{t}` ({cols(header)})\n"
            f"OPTIONS ({CSV_OPTIONS}, uris = ['{PREFIX}/{t}.csv'])")
    for t in [*PARTITIONED, *SNAPSHOTS]:
        src = f"{PREFIX}/{t}/" if t in PARTITIONED else f"{PREFIX}/{t}.csv"
        cluster = f"\nCLUSTER BY {CLUSTER[t]}" if t in CLUSTER else ""
        stmts.append(
            f"CREATE OR REPLACE TABLE `{PROJECT}.bronze.{t}`{cluster}\n"
            f"OPTIONS (description = 'Verbatim copy of {src}; see pipeline/bigquery/bronze_bq.py') AS\n"
            f"SELECT *, _FILE_NAME AS _source_file, CURRENT_TIMESTAMP() AS _loaded_at\n"
            f"FROM `{PROJECT}.raw_ext.{t}`")
    return stmts


def verify_sql() -> str:
    parts = [f"SELECT '{t}' AS table_name, COUNT(*) AS n, COUNT(DISTINCT _source_file) AS files "
             f"FROM `{PROJECT}.bronze.{t}`" for t in [*PARTITIONED, *SNAPSHOTS]]
    return "\nUNION ALL\n".join(parts) + "\nORDER BY table_name"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", action="store_true", help="print the SQL instead of running it")
    ap.add_argument("--verify", action="store_true", help="compare bronze row counts with EXPECTED")
    a = ap.parse_args()
    if a.print:
        print(";\n\n".join(ddl() + [verify_sql()]) + ";")
        return

    from google.cloud import bigquery  # imported lazily so --print works without GCP deps

    client = bigquery.Client(project=PROJECT, location=LOCATION)
    if not a.verify:
        for s in ddl():
            print(s.splitlines()[0][:100])
            client.query(s).result()
    bad = 0
    for row in client.query(verify_sql()).result():
        exp = EXPECTED[row.table_name]
        ok = row.n == exp
        bad += not ok
        print(f"{row.table_name:28s} {row.n:>12,} rows {row.files:>6,} files  "
              f"{'OK' if ok else f'MISMATCH (expected {exp:,})'}")
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
