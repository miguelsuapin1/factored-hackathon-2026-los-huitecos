"""Embed the mapped Banking77 training rows with Cohere on Bedrock, exactly like the served model (training only, D-004).

Same model, input_type and normalization as pipeline/embed_bedrock.py (and the live app), so the vectors are
comparable with our phrase embeddings. Quota: 20 requests/min; 96 texts per call, ~105 calls, ~6 min.

Run: uv run python pipeline/embed_banking77.py   (after pipeline/banking77_map.py; AWS profile "bedrock")
Writes data/processed/banking77_embeddings_cohere-mv3.f32/.json (git-ignored).
"""
import json
import time
from pathlib import Path

import numpy as np

from embed_bedrock import client, embed_cohere

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "external" / "banking77" / "mapped.json"
PROC = ROOT / "data" / "processed"


def main() -> None:
    rows = json.loads(SRC.read_text(encoding="utf-8"))
    rt = client()
    vecs, t0 = [], time.perf_counter()
    for i in range(0, len(rows), 96):
        v, _ = embed_cohere(rt, [r["text"] for r in rows[i:i + 96]])
        vecs.append(v)
        print(f"\r{min(i + 96, len(rows))}/{len(rows)}", end="", flush=True)
    X = np.vstack(vecs)
    PROC.joinpath("banking77_embeddings_cohere-mv3.f32").write_bytes(X.tobytes())
    PROC.joinpath("banking77_embeddings_cohere-mv3.json").write_text(json.dumps({
        "config": {"model": "cohere.embed-multilingual-v3", "input_type": "classification", "normalize": True},
        "rows": X.shape[0], "dims": X.shape[1], "ids": [r["id"] for r in rows],
        "embed_s": round(time.perf_counter() - t0, 1),
    }, indent=2))
    print(f"\n{X.shape[0]} x {X.shape[1]} in {time.perf_counter() - t0:.0f}s")


if __name__ == "__main__":
    main()
