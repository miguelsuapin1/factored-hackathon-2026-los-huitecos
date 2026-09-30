"""Write reports/silver_quality.md from the ops_silver_quality table (dbt model models/ops/ops_silver_quality.sql).

  uv run python pipeline/dbt/quality_report.py                  # reads BigQuery (gcloud login needed)
  uv run python pipeline/dbt/quality_report.py --json rows.json # rows exported from that table, as a JSON list
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "silver_quality.md"
PROJECT = os.environ.get("GCP_PROJECT", "project-d49391de-51c4-49bf-aae")
RULES = {  # rule id prefix → docs/data-issues.md section
    "A": "organizer claims", "B": "templated text", "C": "broken relationships", "D": "vocabulary",
    "E": "logical inconsistencies",
}


def load(path: str | None) -> list[dict]:
    if path:
        return json.loads(Path(path).read_text())
    from google.cloud import bigquery
    q = f"select table_name, measure, n from `{PROJECT}.ops.ops_silver_quality`"
    return [dict(r) for r in bigquery.Client(project=PROJECT).query(q).result()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--run-id", default="")
    a = ap.parse_args()
    rows = load(a.json)
    counts: dict[str, dict[str, int]] = {}
    rules: list[tuple[str, str, int]] = []
    for r in rows:
        if r["measure"].startswith("rows_"):
            counts.setdefault(r["table_name"], {})[r["measure"]] = int(r["n"])
        else:
            rules.append((r["measure"].removeprefix("rule:"), r["table_name"], int(r["n"])))

    lines = [
        "# Silver data quality",
        "",
        f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC by `pipeline/dbt/quality_report.py` from "
        "`ops.ops_silver_quality`" + (f" (dbt run `{a.run_id}`)" if a.run_id else "") + ". Do not edit by hand.",
        "Rule ids are defined in [docs/data-issues.md](../docs/data-issues.md).",
        "",
        "## Reconciliation: bronze = silver + quarantine",
        "",
        "| table | bronze | silver | quarantined | unexplained |",
        "|:--|--:|--:|--:|--:|",
    ]
    for t, c in sorted(counts.items(), key=lambda kv: -kv[1].get("rows_bronze", 0)):
        b, s, q = c.get("rows_bronze", 0), c.get("rows_silver", 0), c.get("rows_quarantined", 0)
        lines.append(f"| {t} | {b:,} | {s:,} | {q:,} | {b - s - q:,} |")
    lines += ["", "## Rows touched per rule", "", "| rule | table | rows |", "|:--|:--|--:|"]
    for rule, t, n in sorted(rules):
        lines.append(f"| {rule} | {t} | {n:,} |")
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
