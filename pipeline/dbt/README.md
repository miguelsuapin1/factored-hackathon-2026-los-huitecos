# dbt: bronze → silver → gold (BigQuery, or DuckDB offline)

Decision: [docs/decisions.md](../../docs/decisions.md) D-003 (BigQuery) and D-005 (dbt). Rules: [docs/data-issues.md](../../docs/data-issues.md).

| Layer | Dataset | What |
|---|---|---|
| staging | `staging` | one view per bronze table: typed (`select_typed`), `_cast_errors`; `int_*_checked` adds `_reject_reasons` |
| silver | `silver` | 13 tables, full population: codes, ISO countries, local dates, derived USD, rule flags (`_rule_flags`), lineage (`_source_file`, `_loaded_at`, `_run_id`) |
| quarantine | `silver_quarantine.rejected_rows` | every row not in silver, with reasons. bronze = silver + quarantine (test) |
| gold (analytics) | `gold` | contact-reason metrics, dispute KPIs, human baseline, digital-events profile |
| gold (serving) | `gold_serving` | the Supabase slice: ~2,000 stratified customers + demo scenarios, minimised columns (docs/contracts.md K2) |
| ops | `ops.ops_silver_quality` | row counts and rule counts per run → `reports/silver_quality.md` |

## Run it

```bash
cd pipeline/dbt
# BigQuery (the team warehouse): log in once, then build everything and run all tests
gcloud auth application-default login
uv run dbt build --profiles-dir . --target bq
uv run python quality_report.py && uv run python serving_report.py      # regenerate the reports

# Offline, no Google account: synthetic fixture bronze in DuckDB (duplicates, late file, missing field)
uv run python fixtures/build_fixture_bronze.py
DBT_DUCKDB_PATH=../../data/processed/fixture.duckdb uv run dbt build --profiles-dir . --target duckdb --vars '{fixtures: true}'
uv run python fixtures/build_fixture_bronze.py --drift    # then `dbt test -s source:bronze.transactions` must FAIL (schema drift)
```

**Without dbt credentials** (how the first BigQuery build on 2026-09-30 was run, through an assistant's BigQuery connector):
`uv run python compile_offline.py` compiles to plain SQL with no login, and `uv run python plan_sql.py` writes the statements in
dependency order to `target/plan/` (datasets pinned to `us-east1`, then seeds, views, tables, tests). dbt still owns the SQL and the order;
only the execution is external. Prefer `dbt build` whenever a login is available.

## Key numbers (first full build, 2026-09-30)
- 23.5M bronze rows (23,495,188) → silver with **0 quarantined, 0 cast failures, 0 unexplained**; 84/84 silver data tests pass on BigQuery.
- Offline on DuckDB: 179/179 build steps pass, incl. 3 unit tests and `fixture_expectations` (since 2026-10-05; the 178/178 of 2026-09-30 had silently skipped it, [lessons-learned X6](../../docs/lessons-learned.md)). Check that `PASS fixture_expectations` is in the output.
- Serving slice: 2,040 customers, 23,052 transactions, ≈20 MB estimated. See [reports/serving_slice.md](../../reports/serving_slice.md).

## Variables (dbt_project.yml)
`demo_today` (2026-06-17), `cohort_size` (2000), `cohort_seed`, `serving_months` (12), `fraud_cutoff` (30, docs/policy.md PL-6).
