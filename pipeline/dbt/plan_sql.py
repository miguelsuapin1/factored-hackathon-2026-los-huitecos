"""Turn a compiled dbt project into ordered BigQuery statements (seeds, models, then tests).

Pairs with compile_offline.py when dbt can't log in to BigQuery itself: dbt still owns the SQL, the
dependency order and the tests; this script only wraps each compiled node the way `dbt run` would
(CREATE OR REPLACE VIEW / TABLE ... AS) and writes one .sql file per statement to target/plan/.
Run the files in order with any BigQuery client. The normal path remains `uv run dbt build --target bq`.

  uv run python compile_offline.py -s staging        # compile
  uv run python plan_sql.py -s staging               # -> target/plan/0001_view_stg_....sql, ...
"""
import argparse
import csv
import os
import json
import shutil
from graphlib import TopologicalSorter
from pathlib import Path

ROOT = Path(__file__).parent
TARGET = ROOT / "target"
LOCATION = os.environ.get("BQ_LOCATION", "us-east1")


def relation(node) -> str:
    return f"`{node['database']}`.`{node['schema']}`.`{node.get('alias') or node['name']}`"


def seed_sql(node) -> str:
    path = ROOT / node["original_file_path"]
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header, data = rows[0], rows[1:]
    types = node["config"].get("column_types") or {}
    cols = ", ".join(f"`{c}` {types.get(c, 'STRING')}" for c in header)

    def lit(v, c):
        if v == "":
            return "NULL"
        t = types.get(c, "STRING").upper()
        if t in ("INT64", "FLOAT64", "NUMERIC", "BOOL"):
            return v
        return "'" + v.replace("\\", "\\\\").replace("'", "\\'") + "'"

    values = ",\n".join("(" + ", ".join(lit(v, c) for v, c in zip(r, header)) + ")" for r in data)
    return (f"CREATE OR REPLACE TABLE {relation(node)} ({cols});\n"
            f"INSERT INTO {relation(node)} VALUES\n{values};")


def model_sql(node) -> str:
    cfg = node["config"]
    body = node["compiled_code"].strip().rstrip(";")
    head = ""
    if cfg["materialized"] == "view":
        return head + f"CREATE OR REPLACE VIEW {relation(node)} AS\n{body};"
    opts = []
    if cfg.get("partition_by"):
        p = cfg["partition_by"]
        g = p.get("granularity", "day")
        if p.get("data_type") == "date":
            field = p["field"] if g == "day" else f"date_trunc({p['field']}, {g})"
        else:
            field = f"timestamp_trunc({p['field']}, {g})"
        opts.append(f"PARTITION BY {field}")
    if cfg.get("cluster_by"):
        cb = cfg["cluster_by"]
        opts.append("CLUSTER BY " + ", ".join(cb if isinstance(cb, list) else [cb]))
    desc = (node.get("description") or "").replace("'", "\\'").replace("\n", " ")[:1000]
    opts.append(f"OPTIONS (description = '{desc}')")
    return head + f"CREATE OR REPLACE TABLE {relation(node)}\n" + "\n".join(opts) + f"\nAS\n{body};"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-s", "--select", nargs="*", default=None, help="dbt selection used at compile time")
    ap.add_argument("--no-tests", action="store_true")
    a = ap.parse_args()

    manifest = json.loads((TARGET / "manifest.json").read_text())
    results = json.loads((TARGET / "run_results.json").read_text())
    compiled = {r["unique_id"] for r in results["results"]}
    nodes = {k: v for k, v in manifest["nodes"].items()
             if k in compiled and v["resource_type"] in ("seed", "model", "test")}
    by_id = {r["unique_id"]: r for r in results["results"]}

    graph = {k: [d for d in v.get("depends_on", {}).get("nodes", []) if d in nodes] for k, v in nodes.items()}
    order = list(TopologicalSorter(graph).static_order())

    out = TARGET / "plan"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    tests = []
    schemas = sorted({(v["database"], v["schema"]) for v in nodes.values() if v["resource_type"] != "test"})
    # One statement per schema: BigQuery runs a multi-statement script in a single location, so the
    # datasets are created first, each pinned to the bucket's region.
    (out / "0000_schemas.sql").write_text("".join(
        f"CREATE SCHEMA IF NOT EXISTS `{d}`.`{s}` OPTIONS (location = '{LOCATION}');\n" for d, s in schemas))
    n = 0
    for uid in order:
        node = dict(nodes[uid])
        node["compiled_code"] = by_id[uid].get("compiled_code") or node.get("compiled_code")
        kind = node["resource_type"]
        if kind == "test":
            tests.append(node)
            continue
        n += 1
        sql = seed_sql(node) if kind == "seed" else model_sql(node)
        (out / f"{n:04d}_{kind}_{node['name']}.sql").write_text(sql + "\n")
    if tests and not a.no_tests:
        parts = []
        for t in tests:
            body = t["compiled_code"].strip().rstrip(";")
            parts.append(f"SELECT '{t['name']}' AS test, (SELECT COUNT(*) FROM (\n{body}\n)) AS failures")
        (out / f"{n + 1:04d}_tests.sql").write_text("\nUNION ALL\n".join(parts) + "\nORDER BY failures DESC, test;\n")
    print(f"{n} build statements, {len(tests)} tests -> {out}")


if __name__ == "__main__":
    main()
