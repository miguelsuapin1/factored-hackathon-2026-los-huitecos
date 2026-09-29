"""Embed the phrase set with an Amazon Bedrock embedding model (candidate for serving from AWS).

Writes data/processed/phrase_embeddings_<tag>.f32/.json in the same format as scripts/embed_phrases.mjs,
so pipeline/compare_embeddings.py can score it on the same folds. Records per-message latency, since
unlike the local model every message is a network call.

Credentials: AWS profile `bedrock` (IAM user latam-bank-bedrock, allowed only bedrock:InvokeModel on
embedding models). Usage:
  uv run python pipeline/embed_bedrock.py titan1024    # amazon.titan-embed-text-v2:0, 1024 dims
  uv run python pipeline/embed_bedrock.py titan512
  uv run python pipeline/embed_bedrock.py cohere-mv3   # cohere.embed-multilingual-v3 (needs Marketplace access)
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
import numpy as np
from botocore.config import Config

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"
PROFILE, REGION = "bedrock", "us-east-1"

MODELS = {
    "titan1024": {"model": "amazon.titan-embed-text-v2:0", "dimensions": 1024},
    "titan512": {"model": "amazon.titan-embed-text-v2:0", "dimensions": 512},
    "cohere-mv3": {"model": "cohere.embed-multilingual-v3", "dimensions": 1024},
}


def client():
    cfg = Config(retries={"max_attempts": 8, "mode": "adaptive"}, read_timeout=30)
    return boto3.Session(profile_name=PROFILE, region_name=REGION).client("bedrock-runtime", config=cfg)


def embed_titan(rt, text, dims):
    body = json.dumps({"inputText": text, "dimensions": dims, "normalize": True})
    t0 = time.perf_counter()
    out = json.loads(rt.invoke_model(modelId="amazon.titan-embed-text-v2:0", body=body)["body"].read())
    return out["embedding"], (time.perf_counter() - t0) * 1000


def embed_cohere(rt, texts):
    body = json.dumps({"texts": texts, "input_type": "classification", "embedding_types": ["float"]})
    t0 = time.perf_counter()
    out = json.loads(rt.invoke_model(modelId="cohere.embed-multilingual-v3", body=body)["body"].read())
    vecs = np.array(out["embeddings"]["float"], dtype=np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs, (time.perf_counter() - t0) * 1000 / len(texts)


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "titan1024"
    spec = MODELS[tag]
    phrases = json.loads((PROC / "phrase_texts.json").read_text(encoding="utf-8"))
    texts = [p["text"] for p in phrases]
    rt = client()
    t0 = time.perf_counter()
    if tag.startswith("titan"):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda t: embed_titan(rt, t, spec["dimensions"]), texts))
        X = np.array([r[0] for r in results], dtype=np.float32)
        latencies = [r[1] for r in results]
    else:
        vecs, latencies = [], []
        for i in range(0, len(texts), 96):  # Cohere accepts up to 96 texts per call
            v, ms = embed_cohere(rt, texts[i:i + 96])
            vecs.append(v)
            latencies += [ms] * len(v)
        X = np.vstack(vecs)
    total = time.perf_counter() - t0
    # what a live customer waits: one message per call (batching above hides it)
    single = []
    for t in texts[:5]:
        if tag.startswith("titan"):
            single.append(embed_titan(rt, t, spec["dimensions"])[1])
        else:
            single.append(embed_cohere(rt, [t])[1])

    PROC.joinpath(f"phrase_embeddings_{tag}.f32").write_bytes(X.tobytes())
    PROC.joinpath(f"phrase_embeddings_{tag}.json").write_text(json.dumps({
        "config": {"model": spec["model"], "provider": "bedrock", "region": REGION, "dimensions": X.shape[1],
                   "normalize": True},
        "rows": X.shape[0], "dims": X.shape[1], "ids": [p["phrase_id"] for p in phrases],
        "embed_ms": round(total * 1000),
        "single_message_ms": round(float(np.median(single)), 1),
        "latency_ms": {"p50": round(float(np.percentile(latencies, 50)), 1),
                       "p95": round(float(np.percentile(latencies, 95)), 1)},
    }, indent=2))
    print(f"{tag}: {X.shape[0]} x {X.shape[1]} in {total:.1f}s; batched latency per message "
          f"p50 {np.percentile(latencies, 50):.0f} ms, p95 {np.percentile(latencies, 95):.0f} ms; "
          f"single-message call {np.median(single):.0f} ms")


if __name__ == "__main__":
    main()
