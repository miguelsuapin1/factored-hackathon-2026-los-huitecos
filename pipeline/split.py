"""Split the phrase set into train / validation / test by family, check for leakage, and seal the test set.

Rules
- Whole families go to one split (translations and rephrasings never cross).
- Clear families: per label, 60% train / 20% validation / 20% test.
- Ambiguous families never train: half validation, half test.
- Leakage check: a validation/test phrase whose cosine similarity to a train phrase from a different
  family is >= NEAR_DUP (about as close as a translation, see calibration below) is a near-duplicate.
  Among SEARCH_SEEDS fixed seeds we keep the assignment with the fewest same-label near-duplicates.
  This is decided from the phrases alone, before any model is trained.
- Sealing: the manifest stores a SHA-256 of the test phrases. Re-running verifies it; a changed test set
  fails unless --reseal is passed (and the reason goes in the commit message).
- New families after sealing: --add-to-train puts them in train only and records when (validation/test
  never change). Ambiguous families are refused, they never train.

Run: node scripts/embed_phrases.mjs first (needs data/processed/phrase_embeddings.*).
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
PHRASES = ROOT / "data" / "phrases" / "phrases.csv"
EMB = ROOT / "data" / "processed" / "phrase_embeddings"
MANIFEST = ROOT / "data" / "phrases" / "split_manifest.json"
REPORT = ROOT / "reports" / "split_leakage.md"

NEAR_DUP = 0.92          # median ES<->PT translation similarity is 0.927; different labels: p95 0.874
SEARCH_SEEDS = range(200)
FRACTIONS = (0.6, 0.2, 0.2)


def load():
    meta = json.loads((EMB.with_suffix(".json")).read_text())
    X = np.fromfile(EMB.with_suffix(".f32"), dtype=np.float32).reshape(meta["rows"], meta["dims"])
    df = pd.read_csv(PHRASES, keep_default_na=False).set_index("phrase_id").loc[meta["ids"]].reset_index()
    df["ambiguous"] = df["ambiguous"].astype(str) == "True"
    return df, X, meta


def assign(families: pd.DataFrame, seed: int) -> dict[str, str]:
    rng = np.random.default_rng(seed)
    out = {}
    for label, grp in families[~families.ambiguous].groupby("label"):
        fams = rng.permutation(sorted(grp.family))
        n_test = round(len(fams) * FRACTIONS[2])
        n_val = round(len(fams) * FRACTIONS[1])
        for i, f in enumerate(fams):
            out[f] = "test" if i < n_test else "validation" if i < n_test + n_val else "train"
    amb = rng.permutation(sorted(families[families.ambiguous].family))
    for i, f in enumerate(amb):
        out[f] = "validation" if i % 2 == 0 else "test"
    return out


def near_dups(df: pd.DataFrame, S: np.ndarray, split: pd.Series) -> pd.DataFrame:
    train = np.where(split == "train")[0]
    held = np.where(split != "train")[0]
    sub = S[np.ix_(held, train)]
    fam = df.family.values
    rows = []
    for a, b in zip(*np.where(sub >= NEAR_DUP)):
        i, j = held[a], train[b]
        if fam[i] != fam[j]:
            rows.append({"held_out": df.phrase_id[i], "split": split[i], "train": df.phrase_id[j],
                         "similarity": round(float(sub[a, b]), 3),
                         "same_label": df.label[i] == df.label[j],
                         "held_text": df.text[i], "train_text": df.text[j],
                         "held_label": df.label[i], "train_label": df.label[j]})
    return pd.DataFrame(rows)


def test_hash(df: pd.DataFrame, split: pd.Series) -> str:
    t = df[split.values == "test"].sort_values("phrase_id")
    payload = "\n".join(f"{r.phrase_id}\t{r.label}\t{r.text}" for r in t.itertuples())
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reseal", action="store_true", help="re-split and overwrite the sealed test set")
    ap.add_argument("--add-to-train", action="store_true",
                    help="assign families missing from the manifest to train (test set stays sealed)")
    args = ap.parse_args()

    df, X, meta = load()
    S = X @ X.T
    families = df.groupby("family").agg(label=("label", "first"), ambiguous=("ambiguous", "first")).reset_index()

    if MANIFEST.exists() and not args.reseal:
        manifest = json.loads(MANIFEST.read_text())
        missing = sorted(set(families.family) - set(manifest["families"]))
        if missing and not args.add_to_train:
            sys.exit(f"families not in the sealed manifest: {missing}. Use --add-to-train or --reseal.")
        if missing:
            ambiguous = set(families[families.ambiguous].family) & set(missing)
            if ambiguous:
                sys.exit(f"ambiguous families can't go to train: {sorted(ambiguous)}")
            manifest["families"].update({f: "train" for f in missing})
            manifest["families"] = dict(sorted(manifest["families"].items()))
            manifest.setdefault("added_to_train", []).append(
                {"date": datetime.now(timezone.utc).isoformat(timespec="seconds"), "families": missing})
        split = df.family.map(manifest["families"])
        if test_hash(df, split) != manifest["test_sha256"]:
            sys.exit("TEST SET CHANGED since it was sealed. Revert the edit or re-run with --reseal.")
        seed = manifest["seed"]
        if missing:
            MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
            print(f"added {len(missing)} families to train")
        print(f"manifest verified: test set unchanged (seed {seed})")
    else:
        best = None
        for seed in SEARCH_SEEDS:
            split = df.family.map(assign(families, seed))
            nd = near_dups(df, S, split)
            score = int(nd.same_label.sum()) if len(nd) else 0
            if best is None or score < best[0]:
                best = (score, seed)
            if score == 0:
                break
        seed = best[1]
        assignment = assign(families, seed)
        split = df.family.map(assignment)
        manifest = {
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "seed": seed, "near_dup_threshold": NEAR_DUP, "fractions": FRACTIONS,
            "embedding": meta["config"], "families": dict(sorted(assignment.items())),
            "test_sha256": test_hash(df, split),
        }
        MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"sealed new split (seed {seed}, chosen from {len(SEARCH_SEEDS)} for fewest near-duplicates)")

    nd = near_dups(df, S, split)
    counts = pd.crosstab(df.label + np.where(df.ambiguous, " (ambiguous)", ""), split).reindex(
        columns=["train", "validation", "test"], fill_value=0)
    fam_counts = pd.crosstab(families.label + np.where(families.ambiguous, " (ambiguous)", ""),
                             families.family.map(manifest["families"])).reindex(
        columns=["train", "validation", "test"], fill_value=0)

    REPORT.parent.mkdir(exist_ok=True)
    with REPORT.open("w") as f:
        f.write("# Phrase split and leakage check\n\n")
        f.write(f"_Generated by `pipeline/split.py`. Seed {seed}. Near-duplicate threshold: cosine ≥ {NEAR_DUP} "
                f"with `{meta['config']['model']}` ({meta['config']['dtype']}). Test set SHA-256: "
                f"`{manifest['test_sha256'][:16]}…`_\n\n")
        f.write("## Families per split\n\n" + fam_counts.to_markdown() + "\n\n")
        f.write("## Phrases per split\n\n" + counts.to_markdown() + "\n\n")
        f.write("## Near-duplicates across splits (different families)\n\n")
        if nd.empty:
            f.write("None. No validation or test phrase is as close to a training phrase as a translation would be.\n")
        else:
            same, diff = nd[nd.same_label], nd[~nd.same_label]
            f.write(f"- **Same label ({len(same)})**: leakage risk; the held-out phrase is nearly a copy of a training phrase.\n")
            f.write(f"- **Different label ({len(diff)})**: not leakage, but a label conflict worth reviewing "
                    "(near-identical wording, different intent).\n\n")
            cols = ["held_out", "split", "train", "similarity", "held_label", "train_label", "held_text", "train_text"]
            f.write(nd.sort_values("similarity", ascending=False)[cols].to_markdown(index=False) + "\n")
    print(f"wrote {REPORT.relative_to(ROOT)}")
    print(fam_counts.to_string())
    print(f"near-duplicates: {int(nd.same_label.sum()) if len(nd) else 0} same-label, "
          f"{int((~nd.same_label).sum()) if len(nd) else 0} different-label")


if __name__ == "__main__":
    main()
