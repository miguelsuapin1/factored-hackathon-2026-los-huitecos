"""Score the human-written held-out messages (build step 16, docs/evaluation.md EV-5).

Reads evals/human/messages.csv (written by people, by hand), checks every row, and scores two systems on the same
messages with the intent evaluation's definitions (pipeline/train_intent.py decision_metrics):
  - the served intent model, through POST /api/classify of a running app: whatever it serves (Cohere in production,
    the e5-small fallback without Bedrock); the report says which;
  - the keyword-rules baseline (pipeline/keyword_baseline.py), unchanged.
Writes reports/intent_eval_human.md and evals/results/human/predictions.json, and appends one line per run to
evals/results/human/runs.jsonl. --from re-scores saved predictions without the app.

Held out: these messages never enter data/phrases or split_manifest.json, and nothing is tuned on them. Rows are
frozen once scored (evals/human/manifest.json keeps a hash per id): a fix is a new row with a new id.

Usage: uv run python pipeline/score_human.py [--base http://localhost:3000] [--rate 15] [--from predictions.json]
       [--dry]   (check and score, but write nothing)
"""
import argparse
import hashlib
import http.cookiejar
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import f1_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import keyword_baseline  # noqa: E402

MESSAGES = ROOT / "evals" / "human" / "messages.csv"
MANIFEST = ROOT / "evals" / "human" / "manifest.json"
EXAMPLES = ROOT / "evals" / "human" / "examples.csv"  # Claude-written format examples: never scored
RESULTS = ROOT / "evals" / "results" / "human"
REPORT = ROOT / "reports" / "intent_eval_human.md"
PHRASES = ROOT / "data" / "phrases" / "phrases.csv"

LABELS = ["unrecognized_charge", "wrongful_fee", "transaction_status", "balance_check", "move_money", "human_agent", "out_of_scope"]
COLUMNS = ["id", "lang", "label", "ambiguous", "alt_label", "author", "written_on", "source", "text"]
# Same weights as train_intent.py (D11).
COST_WRONG_ACTION, COST_ACTED_ON_AMBIGUOUS, COST_NEEDLESS_QUESTION = 5, 2, 1
BOOTSTRAP, SEED = 2000, 2026


def fold(text: str) -> str:
    stripped = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return " ".join(stripped.lower().split())


def row_hash(r) -> str:
    # method and seed are frozen too: a row can't be relabeled "fresh" after its score is seen.
    return hashlib.sha256(f"{r.id}\t{r.lang}\t{r.label}\t{r.ambiguous}\t{r.alt_label}\t{r.method}\t{r.seed}\t{r.text}".encode()).hexdigest()


def load_messages(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        sys.exit(f"{path}: missing columns {missing}")
    # Optional provenance: "fresh" (own words) or "paraphrase" of an example in evals/human/examples.csv (seed = its id).
    for c, default in (("method", "fresh"), ("seed", "")):
        if c not in df.columns:
            df[c] = default
    for c in [*COLUMNS, "method", "seed"]:
        df[c] = df[c].str.strip()
    df.loc[df.method == "", "method"] = "fresh"
    return df


def check(df: pd.DataFrame) -> list[str]:
    errors = []
    examples = dict(pd.read_csv(EXAMPLES, dtype=str)[["id", "example"]].values) if EXAMPLES.exists() else {}
    for r in df.itertuples():
        where = f"{r.id or '(no id)'}"
        if not re.fullmatch(r"H\d{3,}", r.id):
            errors.append(f"{where}: id must look like H001")
        if r.source != "human":
            errors.append(f"{where}: source must be 'human' (this set is for messages written by people)")
        if r.lang not in ("es", "pt"):
            errors.append(f"{where}: lang must be es or pt")
        if r.label not in LABELS:
            errors.append(f"{where}: unknown label '{r.label}'")
        if r.ambiguous not in ("true", "false"):
            errors.append(f"{where}: ambiguous must be true or false")
        elif r.ambiguous == "true" and (r.alt_label not in LABELS or r.alt_label == r.label):
            errors.append(f"{where}: an ambiguous row needs an alt_label different from its label")
        elif r.ambiguous == "false" and r.alt_label:
            errors.append(f"{where}: alt_label only for ambiguous rows")
        if not r.author:
            errors.append(f"{where}: author is required (initials)")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", r.written_on):
            errors.append(f"{where}: written_on must be YYYY-MM-DD")
        if not r.text or len(r.text) > 500:
            errors.append(f"{where}: text must be 1-500 characters")
        if r.method not in ("fresh", "paraphrase"):
            errors.append(f"{where}: method must be fresh or paraphrase")
        elif r.method == "paraphrase" and r.seed not in examples:
            errors.append(f"{where}: a paraphrase needs seed = the id of its example in evals/human/examples.csv")
        elif r.method == "paraphrase" and fold(r.text) == fold(examples[r.seed]):
            errors.append(f"{where}: identical to example {r.seed}: rewrite it in your own words")
        elif r.method == "fresh" and r.seed:
            errors.append(f"{where}: seed only for paraphrases")
    for col in ("id",):
        dup = df[df[col].duplicated()][col].tolist()
        if dup:
            errors.append(f"duplicate ids: {dup}")
    folded = df.text.map(fold)
    dup = df[folded.duplicated()].id.tolist()
    if dup:
        errors.append(f"duplicate texts: {dup}")
    # Leakage: an exact copy of a training/validation/test phrase isn't a new human message.
    if PHRASES.exists():
        known = set(pd.read_csv(PHRASES, dtype=str).text.map(fold))
        leaked = df[folded.isin(known)].id.tolist()
        if leaked:
            errors.append(f"copies of phrases in data/phrases/phrases.csv: {leaked}")
    return errors


def check_frozen(df: pd.DataFrame) -> list[str]:
    if not MANIFEST.exists():
        return []
    frozen = json.loads(MANIFEST.read_text())["rows"]
    current = {r.id: row_hash(r) for r in df.itertuples()}
    errors = [f"{i}: scored before and since removed; keep it" for i in frozen if i not in current]
    errors += [f"{i}: changed after it was scored; restore it and add the fix as a new id" for i, h in frozen.items()
               if i in current and current[i] != h]
    return errors


def env_local() -> dict:
    path = ROOT / ".env.local"
    if not path.exists():
        return {}
    pairs = (line.split("=", 1) for line in path.read_text().splitlines() if "=" in line and not line.startswith("#"))
    return {k.strip(): v.strip() for k, v in pairs}


def classify_all(texts: list[str], base: str, rate: float) -> list[dict]:
    env = env_local()
    if not env.get("DEMO_USERNAME") or not env.get("DEMO_PASSWORD"):
        sys.exit("DEMO_USERNAME / DEMO_PASSWORD missing from .env.local: needed to sign in to /api/classify")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def post(path: str, body: dict) -> dict:
        headers = {"Content-Type": "application/json"}
        if env.get("VERCEL_AUTOMATION_BYPASS_SECRET"):  # protected Vercel previews (see evals/run.ts)
            headers["x-vercel-protection-bypass"] = env["VERCEL_AUTOMATION_BYPASS_SECRET"]
        req = urllib.request.Request(f"{base}{path}", data=json.dumps(body).encode(), method="POST", headers=headers)
        with opener.open(req, timeout=30) as resp:
            return json.loads(resp.read())

    try:
        post("/api/login", {"username": env["DEMO_USERNAME"], "password": env["DEMO_PASSWORD"]})
    except Exception as err:  # noqa: BLE001
        sys.exit(f"can't sign in at {base} ({err}): is the app running (npm run dev)?")
    out, gap, last = [], 60.0 / max(rate, 1), 0.0
    for i, text in enumerate(texts, 1):
        wait = last + gap - time.time()
        if wait > 0:
            time.sleep(wait)
        last = time.time()
        r = post("/api/classify", {"text": text})
        out.append({k: r[k] for k in ("intent", "confidence", "decision", "threshold", "model", "modelVersion", "fallbackReason")})
        print(f"  {i}/{len(texts)} {r['intent']} {r['confidence']:.2f} {r['decision']} ({r['model']})")
    return out


def metrics(df: pd.DataFrame, pred: np.ndarray, act: np.ndarray) -> dict:
    """train_intent.py decision_metrics, plus accuracy and macro-F1 on clear messages."""
    amb = (df.ambiguous == "true").values
    clear = ~amb
    y = df.label.values
    correct = pred == y
    n_clear = int(clear.sum())
    cost = np.where(amb, np.where(act, COST_ACTED_ON_AMBIGUOUS, 0),
                    np.where(act, np.where(~correct, COST_WRONG_ACTION, 0), COST_NEEDLESS_QUESTION))
    by_lang = {lang: float(correct[clear & (df.lang.values == lang)].mean()) if (clear & (df.lang.values == lang)).any() else None
               for lang in ("es", "pt")}
    return {
        "n_clear": n_clear,
        "n_ambiguous": int(amb.sum()),
        "accuracy": float(correct[clear].mean()) if n_clear else None,
        "macro_f1": float(f1_score(y[clear], pred[clear], average="macro", labels=np.unique(y[clear]), zero_division=0)) if n_clear else None,
        "by_lang": by_lang,
        "coverage": float(act[clear].mean()) if n_clear else None,
        "wrong_action_rate": float((act & ~correct)[clear].sum() / n_clear) if n_clear else None,
        "needless_question_rate": float((~act)[clear].mean()) if n_clear else None,
        "ambiguous_asked_rate": float((~act)[amb].mean()) if amb.any() else None,
        "mean_cost": float(cost.mean()),
    }


def paired_ci(df, model_pred, model_act, kw_pred) -> dict:
    """Bootstrap over clear messages: model minus keyword baseline, accuracy and wrong-action rate."""
    clear = (df.ambiguous == "false").values
    y = df.label.values[clear]
    m_ok, k_ok = (model_pred[clear] == y), (kw_pred[clear] == y)
    m_wrong = model_act[clear] & ~m_ok
    k_wrong = ~k_ok  # the keyword baseline always acts
    rng = np.random.default_rng(SEED)
    n = clear.sum()
    if n == 0:
        return {}
    idx = rng.integers(0, n, size=(BOOTSTRAP, n))
    acc = (m_ok[idx].mean(1) - k_ok[idx].mean(1))
    wrong = (m_wrong[idx].mean(1) - k_wrong[idx].mean(1))
    return {
        "accuracy_diff": float(m_ok.mean() - k_ok.mean()), "accuracy_diff_ci": np.percentile(acc, [2.5, 97.5]).tolist(),
        "wrong_action_diff": float(m_wrong.mean() - k_wrong.mean()), "wrong_action_diff_ci": np.percentile(wrong, [2.5, 97.5]).tolist(),
    }


def pct(v):
    return "n/a" if v is None else f"{100 * v:.1f}%"


def git_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def method_line(df) -> str:
    """How many were written fresh vs. paraphrased from Claude's examples, and the model's accuracy on each (clear rows)."""
    parts = []
    for method, name in (("fresh", "written fresh"), ("paraphrase", "paraphrased from Claude's examples (evals/human/examples.csv)")):
        sel = df.method == method
        clear = sel & (df.ambiguous == "false")
        acc = f", model accuracy {(df.model_pred[clear] == df.label[clear]).mean():.1%} on {int(clear.sum())} clear" if clear.any() else ""
        parts.append(f"{int(sel.sum())} {name}{acc}")
    return "- **Provenance:** " + "; ".join(parts) + ". A paraphrase inherits its example's wording, so the fresh number is the more honest one."


def write_report(df, served, m_model, m_kw, paired, meta) -> str:
    models = sorted({f"{s['model']}@{s['modelVersion']}" for s in served})
    fallback = sum(1 for s in served if s["model"] == "e5small")
    lines = [
        "# Intent model on human-written messages (step 16)", "",
        f"_Generated by `pipeline/score_human.py` on {meta['ts']} (commit {meta['commit']}). Do not edit by hand. "
        f"Messages: `evals/human/messages.csv`; predictions: `evals/results/human/predictions.json`._", "",
        "## Read this first", "",
        f"- **{len(df)} messages written by people** ({df.author.nunique()} author(s); {(df.lang == 'es').sum()} Spanish, "
        f"{(df.lang == 'pt').sum()} Portuguese; {m_model['n_ambiguous']} marked ambiguous). Never used for training or tuning.",
        f"- **Model served:** {', '.join(models)}." + (f" **{fallback} of {len(served)} answers came from the e5-small fallback**, not production's Cohere model." if fallback else ""),
        "- Single first messages, intent only; offline. Small sample: read the confidence intervals.",
        method_line(df), "",
        "## Model vs. keyword-rules baseline (same messages)", "",
        "| System | Accuracy | Macro-F1 | Spanish | Portuguese | Coverage | Wrong actions | Needless questions | Ambiguous asked | Mean cost |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for name, m in (("Served model", m_model), ("Keyword rules", m_kw)):
        f1 = "n/a" if m["macro_f1"] is None else f"{m['macro_f1']:.3f}"
        lines.append(f"| {name} | {pct(m['accuracy'])} | {f1} | {pct(m['by_lang']['es'])} | {pct(m['by_lang']['pt'])} | "
                     f"{pct(m['coverage'])} | {pct(m['wrong_action_rate'])} | {pct(m['needless_question_rate'])} | "
                     f"{pct(m['ambiguous_asked_rate'])} | {m['mean_cost']:.3f} |")
    lines += ["", f"_Accuracy, coverage, wrong actions and needless questions are shares of the {m_model['n_clear']} clear messages; "
              "ambiguous asked is the share of ambiguous ones where the system asked instead of acting. Mean cost weights: wrong action 5, "
              "acting on ambiguous 2, needless question 1 (D11). The keyword rules have no confidence, so they always act._", ""]
    if paired:
        lo, hi = paired["accuracy_diff_ci"]
        wlo, whi = paired["wrong_action_diff_ci"]
        lines += ["**Paired difference, model minus keyword rules** (bootstrap over clear messages, 2,000 resamples):", "",
                  f"- Accuracy: {100 * paired['accuracy_diff']:+.1f} points (95% CI {100 * lo:+.1f} to {100 * hi:+.1f}).",
                  f"- Wrong actions: {100 * paired['wrong_action_diff']:+.1f} points (95% CI {100 * wlo:+.1f} to {100 * whi:+.1f}); negative is safer.", ""]
    lines += ["## By label (clear messages)", "", "| Label | Messages | Model recall | Keyword recall |", "|---|---|---|---|"]
    clear = df[df.ambiguous == "false"]
    for label in LABELS:
        sel = clear.label == label
        if sel.any():
            lines.append(f"| {label} | {int(sel.sum())} | {pct((clear.model_pred[sel] == label).mean())} | {pct((clear.kw_pred[sel] == label).mean())} |")
    lines += ["", "## Every message the model got wrong or asked about", ""]
    misses = [r for r in df.itertuples() if r.model_pred != r.label or r.model_decision == "ask"]
    if misses:
        lines += ["| Id | Lang | Label | Model (confidence, decision) | Keyword | Text |", "|---|---|---|---|---|---|"]
        for r in misses:
            label = r.label + (f" / {r.alt_label}" if r.ambiguous == "true" else "")
            text = r.text.replace("|", "\\|")
            lines.append(f"| {r.id} | {r.lang} | {label} | {r.model_pred} ({r.model_conf:.2f}, {r.model_decision}) | {r.kw_pred} | {text} |")
    else:
        lines.append("_None._")
    lines += ["", "Context: the same model on the sealed synthetic test set is in `reports/intent_eval_cohere-mv3.md` "
              "(an upper bound: one author wrote training and test phrases, D1).", ""]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default="http://localhost:3000")
    ap.add_argument("--rate", type=float, default=15, help="messages per minute (Cohere quota: 20)")
    ap.add_argument("--from", dest="from_file", help="re-score saved predictions instead of calling the app")
    ap.add_argument("--messages", default=str(MESSAGES), help=argparse.SUPPRESS)  # for testing the scorer
    ap.add_argument("--report", help=argparse.SUPPRESS)  # with --messages: where to write the test report
    ap.add_argument("--dry", action="store_true", help="check and score, write nothing")
    args = ap.parse_args()

    df = load_messages(Path(args.messages))
    if df.empty:
        sys.exit(f"{args.messages} has no messages yet: see evals/human/README.md for how to write them.")
    errors = check(df) + (check_frozen(df) if Path(args.messages) == MESSAGES else [])
    if errors:
        sys.exit("refusing to score:\n  " + "\n  ".join(errors))

    if args.from_file:
        saved = {p["id"]: p["served"] for p in json.loads(Path(args.from_file).read_text())["predictions"]}
        missing = [i for i in df.id if i not in saved]
        if missing:
            sys.exit(f"{args.from_file} has no prediction for {missing}: run without --from")
        served = [saved[i] for i in df.id]
    else:
        served = classify_all(df.text.tolist(), args.base.rstrip("/"), args.rate)

    df["model_pred"] = [s["intent"] for s in served]
    df["model_conf"] = [s["confidence"] for s in served]
    df["model_decision"] = [s["decision"] for s in served]
    df["kw_pred"] = [keyword_baseline.predict(t) for t in df.text]
    model_pred, model_act = df.model_pred.values, (df.model_decision == "act").values
    kw_pred = df.kw_pred.values
    m_model = metrics(df, model_pred, model_act)
    m_kw = metrics(df, kw_pred, np.ones(len(df), dtype=bool))
    paired = paired_ci(df, model_pred, model_act, kw_pred)
    meta = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "commit": git_commit()}

    print(f"\nserved model: accuracy {pct(m_model['accuracy'])}, wrong actions {pct(m_model['wrong_action_rate'])}, "
          f"coverage {pct(m_model['coverage'])} | keyword: accuracy {pct(m_kw['accuracy'])}, wrong actions {pct(m_kw['wrong_action_rate'])}")
    if args.dry:
        return
    if Path(args.messages) != MESSAGES:
        # A test file never touches the real manifest, results or report.
        if args.report:
            Path(args.report).write_text(write_report(df, served, m_model, m_kw, paired, meta))
            print(f"wrote test report {args.report}")
        return

    RESULTS.mkdir(parents=True, exist_ok=True)
    if not args.from_file:
        (RESULTS / "predictions.json").write_text(json.dumps({
            "meta": {**meta, "base": args.base},
            "predictions": [{"id": r.id, "served": s} for r, s in zip(df.itertuples(), served)],
        }, indent=2, ensure_ascii=False) + "\n")
        MANIFEST.write_text(json.dumps({"note": "Hash per scored row: edits are refused (pipeline/score_human.py).",
                                        "rows": {r.id: row_hash(r) for r in df.itertuples()}}, indent=2) + "\n")
    with (RESULTS / "runs.jsonl").open("a") as f:
        f.write(json.dumps({**meta, "n": len(df), "models": sorted({f"{s['model']}@{s['modelVersion']}" for s in served}),
                            "rescored_from": args.from_file, "model": m_model, "keyword": m_kw, "paired": paired}) + "\n")
    REPORT.write_text(write_report(df, served, m_model, m_kw, paired, meta))
    print(f"wrote {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
