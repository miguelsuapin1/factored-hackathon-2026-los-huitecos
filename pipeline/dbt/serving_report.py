"""Write reports/serving_slice.md: what the Supabase slice contains, its estimated size and how representative
the stratified sample is (dbt models gold_serving_size_estimate, gold_serving_representativeness, serving_cohort).

  uv run python pipeline/dbt/serving_report.py                 # reads BigQuery (gcloud login needed)
  uv run python pipeline/dbt/serving_report.py --json rows.json # {"size": [...], "repr": [...], "reasons": [...]} exported from those tables
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "serving_slice.md"
PROJECT = os.environ.get("GCP_PROJECT", "project-d49391de-51c4-49bf-aae")


def load(path):
    if path:
        return json.loads(Path(path).read_text())
    from google.cloud import bigquery
    c = bigquery.Client(project=PROJECT)
    q = lambda s: [dict(r) for r in c.query(s).result()]  # noqa: E731
    return {
        "size": q(f"select * from `{PROJECT}.gold.gold_serving_size_estimate`"),
        "repr": q(f"select * from `{PROJECT}.gold.gold_serving_representativeness`"),
        "reasons": q(f"select r as reason, count(*) as customers from `{PROJECT}.gold_serving.serving_cohort`, unnest(cohort_reasons) r group by 1"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    d = load(ap.parse_args().json)
    size = sorted(d["size"], key=lambda r: -int(r["row_count"]))
    total = float(size[0]["est_total_mb"])
    L = ["# Serving slice (gold → Supabase)", "",
         f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC by `pipeline/dbt/serving_report.py`. Do not edit by hand.", "",
         f"**{int(size[0]['cohort_customers']):,} customers, estimated {total:.1f} MB in Postgres** (budget 100 MB of the 500 MB free tier). "
         "The estimate uses each row's JSON length (keys included) + 24 B × 1.5 for indexes, so it over-states; the real size is measured after the load.", "",
         "| table | rows | est. MB |", "|:--|--:|--:|"]
    L += [f"| {r['table_name']} | {int(r['row_count']):,} | {float(r['est_postgres_mb']):.2f} |" for r in size]
    L += ["", "## Why each customer is in the slice", "", "| reason | customers |", "|:--|--:|"]
    L += [f"| {r['reason']} | {int(r['customers']):,} |" for r in sorted(d["reasons"], key=lambda r: r["reason"])]
    L += ["", "`scenario:*` customers are picked (5 per scenario, fixed seed) so every policy path has real data; "
          "`team_synthetic_demo` are the team's labelled demo customers (seeds/demo_fixture_*.csv).", "",
          "## Is the stratified sample representative?", "",
          "Share of each value among eligible customers / window transactions vs in the stratified sample (scenario and synthetic customers excluded).", "",
          "| dimension | value | population | sample | diff (pp) |", "|:--|:--|--:|--:|--:|"]
    for r in sorted(d["repr"], key=lambda r: (r["dimension"], -int(r["population_n"]))):
        L.append(f"| {r['dimension']} | {r['value']} | {float(r['population_share'])*100:.2f}% | "
                 f"{float(r['sample_share'] or 0)*100:.2f}% | {float(r['diff_pp']):+.2f} |")
    worst = max(abs(float(r["diff_pp"])) for r in d["repr"])
    L += ["", f"Largest difference: {worst:.2f} percentage points."]
    OUT.write_text("\n".join(L) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
