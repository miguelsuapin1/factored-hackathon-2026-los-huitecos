"""Compile the dbt project to plain BigQuery SQL WITHOUT Google credentials.

Used when dbt can't log in (e.g. a CI box or an assistant session): Google auth is replaced by anonymous
credentials and compilation runs with --no-introspect, so no query is ever sent. The compiled SQL lands in
target/compiled/ and target/run/-style files are NOT produced; run those statements with any BigQuery client.
The normal path is simply `uv run dbt build --target bq` after `gcloud auth application-default login`.
"""
import sys

import google.auth
from google.auth.credentials import AnonymousCredentials

google.auth.default = lambda *a, **k: (AnonymousCredentials(), None)  # noqa: E731

from dbt.cli.main import dbtRunner  # noqa: E402

args = ["compile", "--profiles-dir", ".", "--target", "bq", "--no-introspect", "--no-populate-cache", *sys.argv[1:]]
res = dbtRunner().invoke(args)
sys.exit(0 if res.success else 1)
