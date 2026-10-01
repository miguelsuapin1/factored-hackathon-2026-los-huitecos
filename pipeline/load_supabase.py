"""Load the serving slice (BigQuery gold_serving.*) into Supabase Postgres (build step 7).

Tables must exist first (supabase/migrations/20260930220000_serving_slice.sql). The load replaces their contents
in ONE transaction (all or nothing), checks every row count against the source, and records the load in
public.data_version. public.cases is never touched.

Needs:
  - Google login for BigQuery:   gcloud auth application-default login
  - SUPABASE_DB_URL in .env.local or .env (Supabase → Connect → "Session pooler" URI, with the DB password).
    Never commit it.

  uv run python pipeline/load_supabase.py --dry-run     # read BigQuery, show counts, write nothing
  uv run python pipeline/load_supabase.py               # load
  uv run python pipeline/load_supabase.py --source duckdb:data/processed/fixture.duckdb   # offline test data
"""
import argparse
import json
import os
import subprocess
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT = os.environ.get("GCP_PROJECT", "project-d49391de-51c4-49bf-aae")
DEMO_TODAY = "2026-06-17"

# target table → (source table in gold_serving, columns in load order). Parents before children.
TABLES = {
    "customers": ("serving_customers", ["customer_id", "first_name", "country", "timezone", "segment", "customer_status",
                                        "document_type", "document_number_sha256", "cohort_reasons", "data_source"]),
    "products": ("serving_products", ["product_id", "customer_id", "product_type", "currency", "product_status",
                                      "product_number_last4", "opening_date"]),
    "transactions": ("serving_transactions", ["transaction_id", "customer_id", "product_id", "transaction_ts",
                                              "transaction_date_local", "transaction_type", "amount", "currency",
                                              "amount_usd", "merchant_name", "merchant_category", "transaction_status",
                                              "response_code", "channel", "transaction_country", "is_foreign",
                                              "fraud_score", "data_source"]),
    "fx_rates": ("serving_fx_rates", ["date", "source_currency", "target_currency", "exchange_rate"]),
    "agent_pools": ("serving_agent_pools", ["country", "pool", "active_agents"]),
}


def env_value(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    for f in (ROOT / ".env.local", ROOT / ".env"):
        if not f.exists():
            continue
        raw = f.read_bytes()
        # Windows editors may save UTF-8 with a BOM or UTF-16 (e.g. PowerShell `echo ... > .env.local`).
        text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8-sig")
        for line in text.splitlines():
            line = line.strip().lstrip("\ufeff")
            if line.startswith("export "):
                line = line[7:].strip()
            if line.replace(" ", "").startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    near = sorted(p.name for p in ROOT.glob(".env*"))
    print(f"{name} not found. .env files in {ROOT}: {near or 'none'}")
    return None


def read_source(source: str) -> dict[str, list[tuple]]:
    """Every serving table as a list of tuples in TABLES column order."""
    out = {}
    if source == "bigquery":
        from google.cloud import bigquery
        client = bigquery.Client(project=PROJECT)
        for target, (table, cols) in TABLES.items():
            q = f"select {', '.join(cols)} from `{PROJECT}.gold_serving.{table}`"
            out[target] = [tuple(r.values()) for r in client.query(q).result()]
    elif source.startswith("duckdb:"):
        import duckdb
        con = duckdb.connect(source.removeprefix("duckdb:"), read_only=True)
        for target, (table, cols) in TABLES.items():
            out[target] = con.execute(f"select {', '.join(cols)} from gold_serving.{table}").fetchall()
    else:
        raise SystemExit(f"unknown source {source!r}")
    return out


def clean(v):
    if isinstance(v, float):
        return Decimal(str(round(v, 8)))
    return v


def git_commit() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001 - lineage is best effort
        return None


def load(url: str, data: dict[str, list[tuple]], source: str) -> None:
    import psycopg
    counts = {t: len(rows) for t, rows in data.items()}
    with psycopg.connect(url) as conn:  # one transaction: commit at the end, roll back on any error
        with conn.cursor() as cur:
            cur.execute("truncate public.transactions, public.products, public.customers, "
                        "public.fx_rates, public.agent_pools")
            for target, rows in data.items():
                cols = TABLES[target][1]
                with cur.copy(f"copy public.{target} ({', '.join(cols)}) from stdin") as copy:
                    for r in rows:
                        copy.write_row([clean(v) for v in r])
            for target, n in counts.items():
                cur.execute(f"select count(*) from public.{target}")
                got = cur.fetchone()[0]
                if got != n:
                    raise RuntimeError(f"{target}: loaded {got} rows, source has {n}; rolled back")
            # Step 8: test logins point at customers by id (no foreign key, so this truncate is allowed). A slice that
            # drops one of them would leave a login with no data: refuse it instead.
            cur.execute("select to_regclass('public.app_users') is not null")
            if cur.fetchone()[0]:
                cur.execute("select array_agg(username order by username) from public.app_users a where not exists "
                            "(select 1 from public.customers c where c.customer_id = a.customer_id)")
                lost = cur.fetchone()[0]
                if lost:
                    raise RuntimeError(f"test logins would lose their customer: {lost}; rolled back")
            cur.execute("insert into public.data_version (source, git_commit, row_counts, demo_today) "
                        "values (%s, %s, %s, %s)", (source, git_commit(), json.dumps(counts), DEMO_TODAY))
            cur.execute("select pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c "
                        "join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' "
                        "and c.relname = any(%s)", (list(TABLES) + ["data_version"],))
            size = cur.fetchone()[0]
    print(f"loaded and committed: {counts}; size on disk {size}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="bigquery", help="bigquery (default) or duckdb:<path>")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    data = read_source(a.source)
    print("source rows:", {t: len(r) for t, r in data.items()})
    if a.dry_run:
        return
    url = env_value("SUPABASE_DB_URL")
    if not url:
        raise SystemExit("SUPABASE_DB_URL is not set (put it in .env.local; see the docstring)")
    src = f"bigquery:{PROJECT}.gold_serving" if a.source == "bigquery" else a.source
    load(url, data, src)


if __name__ == "__main__":
    main()
