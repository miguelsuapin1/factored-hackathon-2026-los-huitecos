"""Train the intent classifier, compare it with two baselines, pick the abstention threshold, evaluate on test.

Models (same sealed split, see pipeline/split.py):
  keyword   hand-written rules (pipeline/keyword_baseline.py), the required baseline
  tfidf     character n-gram TF-IDF + multinomial logistic regression, a classic text model
  embed_lr  multilingual-e5-small embeddings + multinomial logistic (softmax) regression, our model

Discipline
- Hyperparameters (regularization C) and the confidence threshold are chosen on VALIDATION only.
- Final models are fit on TRAIN only, so the threshold is tuned on predictions the model hasn't trained on.
- TEST is evaluated once per run and every run is appended to reports/test_runs.jsonl.
- Confidence intervals resample whole families (phrases in a family aren't independent).

Run without flags to see validation results only (nothing written, test untouched).
Run with --test once to evaluate on test and write reports/intent_eval_<embedding>.md, reports/test_runs.jsonl
and src/lib/intent-model-<embedding>.json (weights for the app).
"""
import argparse
import hashlib
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score, precision_recall_fscore_support

import keyword_baseline
from split import MANIFEST, load, test_hash

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "reports" / "test_runs.jsonl"
# --embedding picks the embedding model; each gets its own report and exported weights.
#   e5small     local multilingual-e5-small (runs inside the app; the fallback)
#   cohere-mv3  Bedrock cohere.embed-multilingual-v3 (the primary, see docs/intent-model.md D15)
EMBEDDINGS = {"e5small": None, "cohere-mv3": "cohere-mv3", "titan1024": "titan1024", "labse": "labse"}

C_GRID = [0.1, 0.3, 1, 3, 10, 30, 100, 300]
THRESHOLDS = np.round(np.arange(0.10, 0.96, 0.01), 2)
# Cost of each outcome when choosing the threshold (a stated business assumption, not a measurement).
COST_WRONG_ACTION = 5       # acted on a clear message with the wrong intent
COST_ACTED_ON_AMBIGUOUS = 2  # acted on an ambiguous message instead of asking
COST_NEEDLESS_QUESTION = 1   # asked for clarification on a clear message
BOOTSTRAP = 2000
SEED = 2026


# ---------- data ----------
def get_data(embedding="e5small"):
    df, X, meta = load(EMBEDDINGS[embedding])
    manifest = json.loads(MANIFEST.read_text())
    split = df.family.map(manifest["families"])
    if test_hash(df, split) != manifest["test_sha256"]:
        raise SystemExit("test set does not match the sealed manifest; refusing to train")
    df["split"] = split.values
    return df, X, meta, manifest


# ---------- models ----------
def fit_lr(features, y, C):
    return LogisticRegression(C=C, max_iter=5000, random_state=SEED).fit(features, y)


def select_C(make_features, df, y_col="label"):
    """Pick C by macro-F1 on clear validation phrases; ties go to the smaller (simpler) C."""
    tr = (df.split == "train").values
    va = ((df.split == "validation") & ~df.ambiguous).values
    Ftr, Fva = make_features(tr, va)
    scores = []
    for C in C_GRID:
        m = fit_lr(Ftr, df[y_col][tr], C)
        scores.append((round(f1_score(df[y_col][va], m.predict(Fva), average="macro"), 4), -C, C))
    best = max(scores)
    return best[2], {C: s for s, _, C in scores}


# ---------- decisions ----------
def decision_cost(proba, classes, df_part, threshold):
    """Mean cost per phrase when the model acts only if max probability >= threshold."""
    conf = proba.max(1)
    pred = classes[proba.argmax(1)]
    act = conf >= threshold
    amb = df_part.ambiguous.values
    wrong = pred != df_part.label.values
    cost = np.where(amb, np.where(act, COST_ACTED_ON_AMBIGUOUS, 0),
                    np.where(act, np.where(wrong, COST_WRONG_ACTION, 0), COST_NEEDLESS_QUESTION))
    return cost.mean()


def select_threshold(proba, classes, df_part):
    costs = [(round(decision_cost(proba, classes, df_part, t), 5), t) for t in THRESHOLDS]
    best_cost = min(c for c, _ in costs)
    t = min(t for c, t in costs if c == best_cost)  # lowest threshold at the best cost = most automation
    return float(t), costs


def decision_metrics(pred, conf, df_part, threshold):
    clear, amb = ~df_part.ambiguous.values, df_part.ambiguous.values
    act = conf >= threshold
    correct = pred == df_part.label.values
    n_clear = clear.sum()
    return {
        "coverage": act[clear].mean(),                                    # clear messages handled without asking
        "selective_accuracy": correct[clear & act].mean() if (clear & act).any() else float("nan"),
        "wrong_action_rate": (act & ~correct)[clear].sum() / n_clear,     # the unsafe outcome
        "needless_question_rate": (~act)[clear].mean(),
        "ambiguous_asked_rate": (~act)[amb].mean() if amb.any() else float("nan"),
        "mean_cost": float(np.mean(np.where(amb, np.where(act, COST_ACTED_ON_AMBIGUOUS, 0),
                                            np.where(act, np.where(~correct, COST_WRONG_ACTION, 0),
                                                     COST_NEEDLESS_QUESTION)))),
    }


# ---------- evaluation helpers ----------
def family_bootstrap(df_part, pred, rng):
    fams = df_part.family.unique()
    by_fam = {f: np.where(df_part.family.values == f)[0] for f in fams}
    y = df_part.label.values
    accs, f1s = [], []
    for _ in range(BOOTSTRAP):
        idx = np.concatenate([by_fam[f] for f in rng.choice(fams, len(fams), replace=True)])
        accs.append((pred[idx] == y[idx]).mean())
        f1s.append(f1_score(y[idx], pred[idx], average="macro", labels=np.unique(y[idx]), zero_division=0))
    return np.percentile(accs, [2.5, 97.5]), np.percentile(f1s, [2.5, 97.5])


def ece(proba, y, classes, bins=10):
    conf, pred = proba.max(1), classes[proba.argmax(1)]
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            total += m.mean() * abs((pred[m] == y[m]).mean() - conf[m].mean())
    return total


def per_group_accuracy(df_part, pred, col):
    return {g: round(float((pred[m] == df_part.label.values[m]).mean()), 3)
            for g in sorted(df_part[col].unique()) for m in [df_part[col].values == g]}


def git_commit():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "unknown"


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true", help="evaluate on the sealed test set (logged)")
    ap.add_argument("--embedding", default="e5small", choices=list(EMBEDDINGS))
    args = ap.parse_args()
    REPORT = ROOT / "reports" / f"intent_eval_{args.embedding}.md"
    EXPORT = ROOT / "src" / "lib" / f"intent-model-{args.embedding}.json"
    df, X, meta, manifest = get_data(args.embedding)
    tr = (df.split == "train").values
    va = (df.split == "validation").values
    te = (df.split == "test").values
    va_clear, te_clear = va & ~df.ambiguous.values, te & ~df.ambiguous.values
    y = df.label.values
    rng = np.random.default_rng(SEED)
    results = {}

    # keyword baseline: no training, no confidence
    t0 = time.perf_counter()
    kw_pred = np.array([keyword_baseline.predict(t) for t in df.text])
    kw_ms = (time.perf_counter() - t0) * 1000 / len(df)
    results["keyword"] = {"pred": kw_pred, "proba": None, "ms": kw_ms, "C": None, "threshold": None}

    # tfidf + LR
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True, min_df=1)
    vec.fit(df.text[tr])

    def tfidf_features(a, b):
        return vec.transform(df.text[a]), vec.transform(df.text[b])

    C_tfidf, tfidf_scores = select_C(tfidf_features, df)
    m_tfidf = fit_lr(vec.transform(df.text[tr]), y[tr], C_tfidf)
    t0 = time.perf_counter()
    for t in df.text[te]:
        m_tfidf.predict_proba(vec.transform([t]))
    tfidf_ms = (time.perf_counter() - t0) * 1000 / te.sum()
    p_tfidf = m_tfidf.predict_proba(vec.transform(df.text))
    results["tfidf"] = {"proba": p_tfidf, "classes": m_tfidf.classes_, "ms": tfidf_ms, "C": C_tfidf,
                        "c_scores": tfidf_scores}

    # embeddings + softmax regression
    C_emb, emb_scores = select_C(lambda a, b: (X[a], X[b]), df)
    m_emb = fit_lr(X[tr], y[tr], C_emb)
    t0 = time.perf_counter()
    for i in np.where(te)[0]:
        m_emb.predict_proba(X[i:i + 1])
    emb_clf_ms = (time.perf_counter() - t0) * 1000 / te.sum()
    # per-message embedding cost: measured single-call latency for API models, batched average for local ones
    embed_ms = meta.get("single_message_ms") or meta["embed_ms"] / meta["rows"]
    p_emb = m_emb.predict_proba(X)
    results["embed_lr"] = {"proba": p_emb, "classes": m_emb.classes_, "ms": emb_clf_ms + embed_ms,
                           "clf_ms": emb_clf_ms, "embed_ms": embed_ms, "C": C_emb, "c_scores": emb_scores}

    # thresholds on validation (probabilistic models only)
    for name in ["tfidf", "embed_lr"]:
        r = results[name]
        r["pred"] = r["classes"][r["proba"].argmax(1)]
        r["threshold"], r["threshold_costs"] = select_threshold(r["proba"][va], r["classes"], df[va])

    # evaluate: validation (for the record) and test (once)
    rows, test_log = [], {}
    for name, r in results.items():
        pred = r["pred"]
        conf = r["proba"].max(1) if r["proba"] is not None else np.ones(len(df))
        thr = r["threshold"] if r["threshold"] is not None else 0.0
        parts = [("validation", va_clear, va)] + ([("test", te_clear, te)] if args.test else [])
        for part_name, clear_mask, all_mask in parts:
            dpart = df[clear_mask]
            acc = float((pred[clear_mask] == y[clear_mask]).mean())
            mf1 = float(f1_score(y[clear_mask], pred[clear_mask], average="macro"))
            row = {"model": name, "split": part_name, "n_clear": int(clear_mask.sum()),
                   "accuracy": acc, "macro_f1": mf1}
            if part_name == "test":
                acc_ci, f1_ci = family_bootstrap(dpart, pred[clear_mask], rng)
                row.update({"accuracy_ci": acc_ci.round(3).tolist(), "macro_f1_ci": f1_ci.round(3).tolist(),
                            "by_lang": per_group_accuracy(dpart, pred[clear_mask], "lang"),
                            "by_style": per_group_accuracy(dpart, pred[clear_mask], "style")})
                if r["proba"] is not None:
                    row["ece"] = round(float(ece(r["proba"][clear_mask], y[clear_mask], r["classes"])), 3)
            row.update({k: float(v) for k, v in decision_metrics(pred[all_mask], conf[all_mask],
                                                                 df[all_mask], thr).items()})
            row["ms_per_message"] = round(r["ms"], 3)
            rows.append(row)
            if part_name == "test":
                test_log[name] = {k: v for k, v in row.items() if k not in ("model", "split")}

    res = pd.DataFrame(rows)
    if not args.test:
        print(res[["model", "accuracy", "macro_f1", "coverage", "wrong_action_rate", "needless_question_rate",
                   "ambiguous_asked_rate", "mean_cost", "ms_per_message"]].round(3).to_string(index=False))
        print(f"validation only (no test, nothing written). thresholds: tfidf {results['tfidf']['threshold']}, "
              f"embed_lr {results['embed_lr']['threshold']}; C: tfidf {C_tfidf}, embed_lr {C_emb}")
        return

    # error analysis for our model on test
    r = results["embed_lr"]
    conf_emb = r["proba"].max(1)
    errs = df[te].assign(pred=r["pred"][te], conf=conf_emb[te].round(3))
    errs = errs[(errs.pred != errs.label) | errs.ambiguous]
    cm = pd.DataFrame(confusion_matrix(y[te_clear], r["pred"][te_clear], labels=r["classes"]),
                      index=r["classes"], columns=r["classes"])
    prf = pd.DataFrame(precision_recall_fscore_support(y[te_clear], r["pred"][te_clear], labels=r["classes"],
                                                       zero_division=0)[:3],
                       index=["precision", "recall", "f1"], columns=r["classes"]).T.round(3)

    # export weights for the app (TypeScript does: softmax(W·x + b))
    export = {
        "version": 1,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": git_commit(),
        "model": f"multinomial logistic regression over {meta['config']['model']} embeddings",
        "embedding": meta["config"],
        "labels": r["classes"].tolist(),
        "weights": np.round(m_emb.coef_, 6).tolist(),
        "bias": np.round(m_emb.intercept_, 6).tolist(),
        "threshold": r["threshold"],
        "training": {"C": C_emb, "n_train": int(tr.sum()), "split_seed": manifest["seed"],
                     "test_sha256": manifest["test_sha256"],
                     "cost_weights": {"wrong_action": COST_WRONG_ACTION,
                                      "acted_on_ambiguous": COST_ACTED_ON_AMBIGUOUS,
                                      "needless_question": COST_NEEDLESS_QUESTION}},
        "test_metrics": test_log["embed_lr"],
    }
    EXPORT.write_text(json.dumps(export, indent=1) + "\n")
    model_hash = hashlib.sha256(json.dumps({"w": export["weights"], "b": export["bias"]}).encode()).hexdigest()[:12]

    with RUNS.open("a") as f:
        f.write(json.dumps({"ts": export["created"], "git_commit": export["git_commit"], "model_hash": model_hash,
                            "embedding": args.embedding,
                            "test_sha256": manifest["test_sha256"][:16], "results": test_log}, default=float) + "\n")

    # report
    pct = lambda v: f"{100 * v:.1f}%"
    with REPORT.open("w") as f:
        f.write("# Intent classifier evaluation\n\n")
        f.write(f"_Generated by `pipeline/train_intent.py` on {export['created']} (commit {export['git_commit']}, "
                f"model {model_hash}). Split seed {manifest['seed']}; test set `{manifest['test_sha256'][:16]}…`. "
                f"Train {tr.sum()} phrases · validation {va.sum()} · test {te.sum()} "
                f"({te_clear.sum()} clear + {(te & df.ambiguous.values).sum()} ambiguous)._\n\n")
        f.write("## Test results (frozen model; every test run is logged in reports/test_runs.jsonl)\n\n")
        f.write("| Model | Accuracy (95% CI) | Macro-F1 (95% CI) | Spanish | Portuguese | Threshold | Coverage | "
                "Wrong actions | Needless questions | Ambiguous asked | Mean cost | ms / message |\n")
        f.write("|---|---|---|---|---|---|---|---|---|---|---|---|\n")
        for _, rw in res[res.split == "test"].iterrows():
            r = results[rw.model]
            f.write(f"| {rw.model} | {pct(rw.accuracy)} ({pct(rw.accuracy_ci[0])}–{pct(rw.accuracy_ci[1])}) | "
                    f"{rw.macro_f1:.3f} ({rw.macro_f1_ci[0]:.3f}–{rw.macro_f1_ci[1]:.3f}) | "
                    f"{pct(rw.by_lang['es'])} | {pct(rw.by_lang['pt'])} | "
                    f"{r['threshold'] if r['threshold'] is not None else 'none'} | {pct(rw.coverage)} | "
                    f"{pct(rw.wrong_action_rate)} | {pct(rw.needless_question_rate)} | {pct(rw.ambiguous_asked_rate)} | "
                    f"{rw.mean_cost:.3f} | {rw.ms_per_message:.2f} |\n")
        f.write("\n_Coverage, wrong actions and needless questions are shares of clear test messages; "
                "ambiguous asked is the share of ambiguous messages where the model asked instead of acting. "
                "Mean cost uses weights wrong action = 5, acting on ambiguous = 2, needless question = 1. "
                "The keyword baseline has no confidence, so it always acts. "
                f"embed_lr time = {results['embed_lr']['embed_ms']:.2f} ms embedding "
                f"({'single Bedrock call from Guatemala' if meta.get('single_message_ms') else 'batched, local Node'}) + "
                f"{results['embed_lr']['clf_ms']:.3f} ms classifier._\n\n")
        f.write("## Accuracy by style (test, clear messages)\n\n")
        styles = pd.DataFrame({rw.model: rw.by_style for _, rw in res[res.split == "test"].iterrows()}).T
        f.write(styles.map(pct).to_markdown() + "\n\n")
        f.write("## Validation (used to choose C and the threshold)\n\n")
        f.write(res[res.split == "validation"][["model", "n_clear", "accuracy", "macro_f1", "coverage",
                                                "wrong_action_rate", "ambiguous_asked_rate", "mean_cost"]]
                .round(3).to_markdown(index=False) + "\n\n")
        for name in ["tfidf", "embed_lr"]:
            f.write(f"- **{name}**: C = {results[name]['C']} (validation macro-F1 by C: "
                    + ", ".join(f"{c}: {s:.3f}" for c, s in results[name]["c_scores"].items())
                    + f"); threshold = {results[name]['threshold']}\n")
        tc = pd.DataFrame(results["embed_lr"]["threshold_costs"], columns=["cost", "threshold"])
        f.write("\n### embed_lr: validation cost by threshold\n\n")
        f.write(tc[tc.threshold.isin(np.round(np.arange(0.1, 0.96, 0.05), 2))][["threshold", "cost"]]
                .to_markdown(index=False) + "\n\n")
        f.write("## embed_lr on test: per-label scores and confusion matrix (clear messages)\n\n")
        f.write(prf.to_markdown() + "\n\n")
        f.write("Rows = true label, columns = predicted.\n\n" + cm.to_markdown() + "\n\n")
        f.write("## embed_lr on test: errors and ambiguous messages\n\n")
        f.write(errs.sort_values(["ambiguous", "conf"])[["phrase_id", "lang", "style", "label", "alt_label", "pred",
                                                           "conf", "text"]].to_markdown(index=False) + "\n")
    print(res[res.split == "test"][["model", "accuracy", "macro_f1", "coverage", "wrong_action_rate",
                                    "ambiguous_asked_rate", "mean_cost", "ms_per_message"]].round(3).to_string(index=False))
    print(f"thresholds: tfidf {results['tfidf']['threshold']}, embed_lr {results['embed_lr']['threshold']}; "
          f"C: tfidf {C_tfidf}, embed_lr {C_emb}")
    print(f"wrote {REPORT.relative_to(ROOT)}, {EXPORT.relative_to(ROOT)}; logged run to {RUNS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
