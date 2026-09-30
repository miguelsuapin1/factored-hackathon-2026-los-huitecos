"""Does adding Banking77 to TRAINING improve our intent model? Grouped CV, scored only on our phrases (D-004).

Rules, fixed before the first run (commit this file before running it, like the sealed test set):
  - Scored rows: our clear train+validation phrases (Spanish/Portuguese), 5-fold StratifiedGroupKFold with the
    same seed as pipeline/compare_embeddings.py (a family never spans folds), plus our VALIDATION ambiguous
    families for the ask rate. The test set is not read. No Banking77 row is ever scored.
  - Each fold's model trains on our fold-train phrases + (per variant) Banking77 rows; Banking77 rows get a
    sample weight so that their TOTAL weight = w x (number of our fold-train phrases), spread uniformly.
  - Variants: ours only (= the live v2 recipe); Banking77 all mapped rows; only its out_of_scope rows (hard
    negatives); all except out_of_scope. Each at w in {0.25, 0.5, 1.0}. C from C_GRID by out-of-fold macro-F1.
  - Threshold per variant: the lowest one minimizing mean decision cost (the same costs as train_intent.py:
    wrong action 5, acting on ambiguous 2, needless question 1) on the out-of-fold predictions. This is
    optimistic for every variant alike; it's used to compare variants, not to report a final number.
  - Decision: a variant replaces "ours only" only if its mean cost is lower AND its wrong-action rate is not
    higher. Accuracy difference is tested with an exact McNemar test on the same phrases.
  - Also reported: how many of our phrases have a Banking77 sentence with cosine >= 0.92 (translation-level
    similarity, the threshold of pipeline/split.py): a leakage check, no labels used.

Run: (cd pipeline && uv run python compare_banking77.py)   Writes reports/banking77_experiment.md.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import binomtest
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.model_selection import StratifiedGroupKFold

from compare_embeddings import SEED, load_emb
from split import MANIFEST, load
from train_intent import COST_ACTED_ON_AMBIGUOUS, COST_NEEDLESS_QUESTION, COST_WRONG_ACTION, THRESHOLDS

ROOT = Path(__file__).resolve().parent.parent
PROC = ROOT / "data" / "processed"
B77 = ROOT / "data" / "external" / "banking77" / "mapped.json"
REPORT = ROOT / "reports" / "banking77_experiment.md"
C_GRID = [1, 3, 10, 30, 100]
WEIGHTS = [0.25, 0.5, 1.0]
SUBSETS = {"all": lambda lab: np.ones(len(lab), bool), "out_of_scope only": lambda lab: lab == "out_of_scope",
           "without out_of_scope": lambda lab: lab != "out_of_scope"}


def costs(pred, conf, y, amb, t):
    act = conf >= t
    wrong = pred != y
    return np.where(amb, np.where(act, COST_ACTED_ON_AMBIGUOUS, 0),
                    np.where(act, np.where(wrong, COST_WRONG_ACTION, 0), COST_NEEDLESS_QUESTION))


def evaluate(proba, classes, y, amb, lang):
    pred, conf = classes[proba.argmax(1)], proba.max(1)
    best = min((costs(pred, conf, y, amb, t).mean(), t) for t in THRESHOLDS)
    t = min(t for c, t in ((costs(pred, conf, y, amb, t).mean(), t) for t in THRESHOLDS) if round(c, 6) == round(best[0], 6))
    act, clear = conf >= t, ~amb
    correct = pred == y
    return {
        "accuracy": correct[clear].mean(), "macro_f1": f1_score(y[clear], pred[clear], average="macro"),
        "es": correct[clear & (lang == "es")].mean(), "pt": correct[clear & (lang == "pt")].mean(),
        "threshold": t, "answers_without_asking": act[clear].mean(),
        "wrong_action_rate": (act & ~correct)[clear].mean(), "asks_on_ambiguous": (~act)[amb].mean(),
        "mean_cost": costs(pred, conf, y, amb, t).mean(), "_correct": correct[clear],
    }


def main() -> None:
    df, _, _ = load()
    manifest = json.loads(MANIFEST.read_text())
    df["split"] = df.family.map(manifest["families"])
    dev = df[(df.split != "test") & ~df.ambiguous].reset_index(drop=True)
    amb = df[(df.split == "validation") & df.ambiguous].reset_index(drop=True)
    Xd, _ = load_emb("cohere-mv3", dev.phrase_id)
    Xa, _ = load_emb("cohere-mv3", amb.phrase_id)
    y = dev.label.values
    folds = list(StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=SEED).split(dev, y, dev.family.values))

    rows_b = json.loads(B77.read_text(encoding="utf-8"))
    meta_b = json.loads((PROC / "banking77_embeddings_cohere-mv3.json").read_text())
    Xb = np.fromfile(PROC / "banking77_embeddings_cohere-mv3.f32", dtype=np.float32).reshape(meta_b["rows"], meta_b["dims"])
    yb = np.array([r["label"] for r in rows_b])

    # Leakage check (no labels): our phrases with a translation-level-similar Banking77 sentence.
    ours_all = df[df.split != "test"]
    Xo, _ = load_emb("cohere-mv3", ours_all.phrase_id)
    near = int(((Xo @ Xb.T).max(1) >= 0.92).sum())

    variants = [("ours only (v2 recipe)", None, 0.0)] + [(f"+ Banking77 {s}, w={w}", s, w) for s in SUBSETS for w in WEIGHTS]
    results = []
    for name, subset, w in variants:
        keep = SUBSETS[subset](yb) if subset else np.zeros(len(yb), bool)
        best = None
        for C in C_GRID:
            oof = np.zeros((len(dev), 7))
            amb_p = np.zeros((len(amb), 7))
            classes = None
            for tr, te in folds:
                Xtr = np.vstack([Xd[tr], Xb[keep]])
                ytr = np.concatenate([y[tr], yb[keep]])
                sw = np.concatenate([np.ones(len(tr)), np.full(keep.sum(), w * len(tr) / max(keep.sum(), 1))])
                m = LogisticRegression(C=C, max_iter=5000, random_state=SEED).fit(Xtr, ytr, sample_weight=sw)
                classes = m.classes_
                oof[te] = m.predict_proba(Xd[te])
                amb_p += m.predict_proba(Xa) / len(folds)
            proba = np.vstack([oof, amb_p])
            yy = np.concatenate([y, amb.label.values])
            is_amb = np.concatenate([np.zeros(len(dev), bool), np.ones(len(amb), bool)])
            lang = np.concatenate([dev.lang.values, amb.lang.values])
            r = evaluate(proba, classes, yy, is_amb, lang) | {"variant": name, "C": C, "b77_rows": int(keep.sum())}
            if best is None or r["macro_f1"] > best["macro_f1"]:
                best = r
        results.append(best)
        print(f"{name:42s} C={best['C']:<4} acc {best['accuracy']:.3f} cost {best['mean_cost']:.3f} "
              f"wrong {best['wrong_action_rate']:.3f} answers {best['answers_without_asking']:.3f} asks-amb {best['asks_on_ambiguous']:.3f}")

    base = results[0]
    eligible = [r for r in results[1:] if r["mean_cost"] < base["mean_cost"] and r["wrong_action_rate"] <= base["wrong_action_rate"]]
    winner = min(eligible, key=lambda r: (r["mean_cost"], -r["accuracy"])) if eligible else None
    for r in results:  # exact McNemar vs ours-only on the same clear phrases
        b = int((base["_correct"] & ~r["_correct"]).sum())
        c = int((~base["_correct"] & r["_correct"]).sum())
        r["mcnemar_p"] = binomtest(b, b + c, 0.5).pvalue if b + c else 1.0
        r["only_base_right"], r["only_variant_right"] = b, c

    cols = ["variant", "b77_rows", "C", "accuracy", "macro_f1", "es", "pt", "threshold", "answers_without_asking",
            "wrong_action_rate", "asks_on_ambiguous", "mean_cost", "only_base_right", "only_variant_right", "mcnemar_p"]
    table = pd.DataFrame(results)[cols].round(3)
    lines = [
        "# Banking77 as extra training data (grouped 5-fold CV, scored on our phrases only)",
        "",
        "_Generated by `pipeline/compare_banking77.py`. Do not edit by hand. Banking77 is training-only (docs/decisions.md D-004); "
        "the test set is not read._",
        "",
        f"Scored: {len(dev)} clear train+validation phrases ({dev.family.nunique()} families) out-of-fold, plus "
        f"{len(amb)} validation ambiguous phrases for the ask rate. Banking77: {len(rows_b)} mapped English rows.",
        "",
        table.to_markdown(index=False),
        "",
        f"**Decision rule** (fixed before running): replace \"ours only\" only if mean cost is lower and wrong-action rate isn't higher. "
        f"**Result: {winner['variant'] if winner else 'no variant qualifies; keep ours only'}.**",
        "",
        f"Leakage check: {near} of {len(ours_all)} of our non-test phrases have a Banking77 sentence at cosine ≥ 0.92.",
        "",
        "Thresholds are chosen on the same out-of-fold predictions they're scored on (optimistic for every variant alike); "
        "use this table to compare variants, not as a final score. `only_base_right` / `only_variant_right`: clear phrases "
        "that only one of the two gets right (McNemar's discordant pairs).",
        "",
    ]
    REPORT.write_text("\n".join(lines))
    print(f"winner: {winner['variant'] if winner else 'none'}; leakage near-dups {near}; wrote {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
