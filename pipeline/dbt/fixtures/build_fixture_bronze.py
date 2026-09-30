"""Build a tiny, SYNTHETIC bronze layer in DuckDB to exercise the silver rules offline (docs/data-issues.md A1-A3).

TEAM-GENERATED FIXTURE DATA (Carlos, 2026-09-30), not organizer data. The organizer files contain no duplicates,
no late files and no schema drift, so these cases are injected on purpose:

  FIX-DUP   transaction TRX-FIX-DUP delivered twice (same row in two files)       → one copy kept, one quarantined
  FIX-LATE  TRX-FIX-LATE arrives Pending, then a later file says Reversed          → silver keeps the later load
  FIX-MISS  TRX-FIX-MISS has no amount                                              → quarantined, reason missing:amount
  FIX-DRIFT (with --drift) the transactions table gains an unexpected column       → columns_match test fails loudly

Every table has the exact organizer header plus the bronze lineage columns, all VARCHAR, as pipeline/bronze.py
and pipeline/bigquery/bronze_bq.py produce them.

  uv run python pipeline/dbt/fixtures/build_fixture_bronze.py [--drift] [--path data/processed/fixture.duckdb]
"""
import argparse
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "pipeline" / "bigquery"))
from bronze_bq import PARTITIONED, SNAPSHOTS  # noqa: E402  (the organizer headers, one source of truth)

T0, T1 = "2026-09-30 08:00:00", "2026-09-30 09:00:00"  # first load, later load

ROWS = {
    "branches": [dict(branch_id="SUC-FIX1", branch_name="Sucursal Fixture", country="México", has_atms="True", atm_count="2.0")],
    "service_agents": [dict(agent_id="AGT-FIX1", country_of_origin="Colombia", languages="español, portugués",
                            specialty="Fraudes", agent_status="Active", total_monthly_interactions="120.0")],
    "marketing_campaigns": [dict(campaign_id="CMP-FIX1", target_country="Colombia", start_date="2026-05-01", budget="1000.5")],
    "customers": [
        dict(customer_id="CLI-FIX-MX", document_number="FIX-0001", document_type="DNI", country="México", segment="Basic",
             customer_status="Active", registration_branch_id="SUC-FIX1", credit_score="650.0", registration_date="2024-01-01 10:00:00"),
        dict(customer_id="CLI-FIX-CO", document_number="FIX-0002", document_type="Pasaporte", country="Colombia", segment="Plus",
             customer_status="Active", registration_branch_id="SUC-NOPE", credit_score="700.0", registration_date="2024-02-01 10:00:00"),
    ],
    "products": [
        dict(product_id="PRD-FIX-MX", customer_id="CLI-FIX-MX", product_type="Tarjeta Crédito", currency="USD", opening_branch_id="SUC-FIX1"),
        dict(product_id="PRD-FIX-CO", customer_id="CLI-FIX-CO", product_type="Cuenta Ahorro", currency="COP"),
    ],
    "daily_exchange_rates": [
        dict(date=d, source_currency=c, target_currency="USD", exchange_rate=r, source="Fixture")
        for d in ("2026-06-15", "2026-06-16", "2026-06-17") for c, r in (("COP", "0.00025"), ("ARS", "0.0028"), ("MXN", "0.058"))
    ],
    "transactions": [
        dict(transaction_id="TRX-FIX-OK", transaction_date="2026-06-16 14:00:00", process_date="2026-06-16", product_id="PRD-FIX-CO",
             customer_id="CLI-FIX-CO", amount="400000.0", currency="COP", amount_usd=None, transaction_country="Colombia",
             transaction_status="Approved", response_code="00", is_fraud="False", fraud_score="12.5", merchant_name="Super Ahorro"),
        dict(transaction_id="TRX-FIX-DUP", transaction_date="2026-06-16 15:00:00", process_date="2026-06-16", product_id="PRD-FIX-MX",
             customer_id="CLI-FIX-MX", amount="25.0", currency="USD", amount_usd="25.0", transaction_country="Mexico",
             transaction_status="Approved", response_code="00", is_fraud="False", fraud_score="8.0", _file="day16_copy_a.csv"),
        dict(transaction_id="TRX-FIX-DUP", transaction_date="2026-06-16 15:00:00", process_date="2026-06-16", product_id="PRD-FIX-MX",
             customer_id="CLI-FIX-MX", amount="25.0", currency="USD", amount_usd="25.0", transaction_country="Mexico",
             transaction_status="Approved", response_code="00", is_fraud="False", fraud_score="8.0", _file="day16_copy_b.csv"),
        dict(transaction_id="TRX-FIX-LATE", transaction_date="2026-06-15 20:00:00", process_date="2026-06-15", product_id="PRD-FIX-MX",
             customer_id="CLI-FIX-MX", amount="230.0", currency="USD", amount_usd="230.0", transaction_country="México",
             transaction_status="Pending", response_code="05", is_fraud="False", fraud_score="9.9", _loaded=T0),
        dict(transaction_id="TRX-FIX-LATE", transaction_date="2026-06-15 20:00:00", process_date="2026-06-17", product_id="PRD-FIX-MX",
             customer_id="CLI-FIX-MX", amount="230.0", currency="USD", amount_usd="230.0", transaction_country="México",
             transaction_status="Reversed", response_code="14", is_fraud="False", fraud_score="9.9", _loaded=T1, _file="late_day17.csv"),
        dict(transaction_id="TRX-FIX-MISS", transaction_date="2026-06-17 07:30:00", process_date="2026-06-16", product_id="PRD-FIX-MX",
             customer_id="CLI-FIX-MX", amount=None, currency="USD", transaction_country="México", transaction_status="Declined"),
    ],
    "call_center_interactions": [dict(interaction_id="INT-FIX1", interaction_date="2026-06-16 12:00:00", process_date="2026-06-16",
                                      customer_id="CLI-FIX-MX", agent_id="AGT-FIX1", channel="Web", contact_reason="Queja",
                                      reason_category="Queja", detected_sentiment="Muy Negativo", was_resolved="False",
                                      duration_seconds=None)],
    "call_transcripts": [dict(transcript_id="TRS-FIX1", interaction_id="INT-FIX1", process_date="2026-06-16", customer_id="CLI-FIX-MX",
                              agent_id="AGT-FIX1", duration_seconds=None)],
    "satisfaction_surveys": [dict(survey_id="SRV-FIX1", survey_date="2026-06-16 13:00:00", process_date="2026-06-16",
                                  interaction_id="INT-FIX1", customer_id="CLI-FIX-MX", survey_type="NPS", main_score="6", nps_category=None)],
    "complaints": [dict(complaint_id="CMP-FIX1", creation_date="2026-06-16 13:30:00", process_date="2026-06-16", customer_id="CLI-FIX-MX",
                        category="Transactions", subcategory=None, affected_product_id="PRD-FIX-CO", status="Resolved",
                        resolution_date=None, claimed_amount=None, currency="MXN", sla_breached="False", is_repeat_complainer="False")],
    "campaign_sends": [dict(send_id="SND-FIX1", send_date="2026-06-16 09:00:00", process_date="2026-06-16", campaign_id="CMP-FIX1",
                            customer_id="CLI-FIX-CO", was_delivered="True")],
    "digital_events": [
        dict(event_id="EVT-FIX1", event_date="2026-06-16 10:00:00", process_date="2026-06-16", customer_id="CLI-FIX-MX",
             event_type="Login", ip_country="México", is_mobile="True"),
        dict(event_id="EVT-FIX2", event_date="2026-06-16 10:01:00", process_date="2026-06-16", customer_id=None,
             event_type="PageView", ip_country="Argentina", is_mobile="False"),
    ],
}


def build(path: Path, drift: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    con = duckdb.connect(str(path))
    con.execute("create schema bronze")
    for table in [*PARTITIONED, *SNAPSHOTS]:
        cols = (PARTITIONED.get(table) or SNAPSHOTS[table]).split(",")
        if drift and table == "transactions":
            cols = cols + ["promo_code"]  # FIX-DRIFT: a column the contract does not know
        part = table in PARTITIONED
        extra = ["year", "month", "day"] if part else []
        ddl = ", ".join(f'"{c}" varchar' for c in cols + extra) + ", _source_file varchar, _loaded_at timestamp"
        con.execute(f"create table bronze.{table} ({ddl})")
        for r in ROWS[table]:
            pd = r.get("process_date") or "2026-06-16"
            vals = [r.get(c) for c in cols]
            if part:
                vals += pd.split("-")
            src = f"fixtures/{table}/{r.get('_file', 'fixture.csv')}"
            vals += [src, r.get("_loaded", T0)]
            con.execute(f"insert into bronze.{table} values ({', '.join('?' * len(vals))})", vals)
    con.close()
    print(f"fixture bronze -> {path}{' (with schema drift)' if drift else ''}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--drift", action="store_true")
    ap.add_argument("--path", default=str(ROOT / "data" / "processed" / "fixture.duckdb"))
    a = ap.parse_args()
    build(Path(a.path), a.drift)
