"""Jev (TypeSafe) vs our intent classifier on the validation phrases: could Jev be the second opinion (build step 15)?

Each validation phrase is sent to Jev as one Choice question over our seven intents, with the label definitions and
tie-break rules from data/phrases/LABELING_GUIDE.md as the option descriptions. Its answers are compared with the
served model (Cohere Embed Multilingual v3 + softmax regression, fitted exactly as train_intent.py fits it) on the same
phrases, with the same decision metrics (act when confident, otherwise ask; costs from D11).

Rows in the report:
  cohere          the served model at its served threshold
  jev default     Jev acting when its own `confidence` >= 0.5 (TypeSafe's documented starting point; untuned)
  jev tuned       Jev's top probability at the cost-optimal threshold chosen ON validation (optimistic: chosen and
                  scored on the same phrases, like any threshold here)
  cohere + jev    the second opinion: act only if Cohere would act AND Jev picks the same intent; otherwise ask

Validation only: the sealed test set is never read (get_data checks its hash; nothing is appended to
reports/test_runs.jsonl). The phrases are team-generated and synthetic, so read the shape, not the levels (D7).
Jev answers are cached in data/processed/jev_validation.jsonl (git-ignored) so the report can be rebuilt for free.

The threshold the app uses for Jev is chosen here, on validation, by the same rule as ours (D11: the lowest threshold at
the minimum mean cost), over a grid that reaches 0.99 (Jev's probabilities are sharper than ours), with a check of how
it moves under other cost weights. It is exported with the question to src/lib/intent-model-jev.json, which the app
reads, so the app asks exactly the question measured here.

Usage: (cd pipeline && uv run python jev_validation.py [--refresh])   # needs TYPESAFE_API_KEY in .env.local
Writes reports/intent_jev_validation.md and src/lib/intent-model-jev.json
"""
import argparse
import asyncio
import hashlib
import json
import os
import time
from datetime import datetime, timezone

import numpy as np
from sklearn.metrics import f1_score

import train_intent as ti

MODEL = "jev-1.13.0"  # pinned, not jev-latest: an alias can move under a tuned threshold (docs.typesafe.ai/models)
PRICE_PER_MTOK = 0.042  # USD per million input tokens; output is free (docs.typesafe.ai/models, 2026-10-02)
CONCURRENCY = 8
CACHE = ti.ROOT / "data" / "processed" / "jev_validation.jsonl"
REPORT = ti.ROOT / "reports" / "intent_jev_validation.md"
SERVED = ti.ROOT / "src" / "lib" / "intent-model-cohere-mv3.json"
EXPORT = ti.ROOT / "src" / "lib" / "intent-model-jev.json"
JEV_THRESHOLDS = np.round(np.arange(0.10, 0.996, 0.01), 2)  # to 0.99: on validation Jev's optimum sat at the old 0.95 cap
NEAR = 0.01  # thresholds within this much of the minimum mean cost count as near-optimal (as cost_sensitivity.py)
SENSITIVITY = [(w, a, 1) for w in (2, 3, 5, 10, 20) for a in (1, 2, 3)]  # (wrong action, acted on ambiguous, needless)
JEV_DEFAULT_CONFIDENCE = 0.5

# The question. Instructions and option descriptions are in English (Jev's strongest language, docs "Language
# support"); the customer's message stays in its own language. Descriptions follow LABELING_GUIDE.md, tie-breaks included,
# because Jev reads literally (docs "Jev 1.13 jaggedness": put boundary cases in the criteria).
INSTRUCTIONS = (
    "`message` is one message a customer of a bank in Latin America wrote to the bank's chat assistant, in Spanish or "
    "Portuguese. What does the customer want? Pick the one category that best describes the main request."
)
CRITERIA = {
    "unrecognized_charge": "The customer sees a charge, purchase, withdrawal or transfer they did NOT make or do not "
                           "recognize at all: an unknown merchant, possible fraud, a cloned, lost or stolen card with "
                           "charges on it.",
    "wrongful_fee": "The customer recognizes the charge or the bank fee but says it is wrong: charged twice (duplicated), "
                    "the wrong amount, a fee or bank product that should not apply (insurance, alerts, annual fee), or "
                    "charged after cancelling.",
    "transaction_status": "The customer asks what happened to a specific transaction or an existing claim: declined, "
                          "pending, not arrived, when a refund arrives, what 'reversed' means, how their claim is going.",
    "balance_check": "The customer asks for a balance, an amount owed, a limit or recent movements, with no problem "
                     "attached.",
    "move_money": "The main request is for the assistant itself to move money: refund it, reverse it, transfer, pay or "
                  "credit a compensation now.",
    "human_agent": "The customer asks to talk to a person: an advisor, a supervisor, a phone call, a phone number, an "
                   "escalation.",
    "out_of_scope": "Anything else: other products (loans, insurance sales, limit increases, blocking a card with no "
                    "charges), app access, branch hours, greetings, thanks, or anything not about banking.",
}
QUESTION_VERSION = hashlib.sha256(json.dumps([MODEL, INSTRUCTIONS, CRITERIA]).encode()).hexdigest()[:12]


def load_env():
    """TYPESAFE_API_KEY from .env.local unless already set (never printed)."""
    path = ti.ROOT / ".env.local"
    if "TYPESAFE_API_KEY" in os.environ or not path.exists():
        return
    for line in path.read_text().splitlines():
        if line.startswith("TYPESAFE_API_KEY="):
            value = line.split("=", 1)[1].strip().strip('"')
            if value:
                os.environ["TYPESAFE_API_KEY"] = value


def read_cache():
    if not CACHE.exists():
        return {}
    rows = [json.loads(line) for line in CACHE.read_text().splitlines() if line.strip()]
    return {r["phrase_id"]: r for r in rows if r["question_version"] == QUESTION_VERSION}


async def ask_jev(phrases):
    """One request per phrase (each message is its own state). Returns {phrase_id: answer row}."""
    from typesafe_sdk import AsyncTypeSafeClient, Choice

    question = Choice(instructions=INSTRUCTIONS, criteria=CRITERIA)
    sem = asyncio.Semaphore(CONCURRENCY)
    out = {}
    async with AsyncTypeSafeClient(model=MODEL) as client:
        async def one(pid, text):
            async with sem:
                t0 = time.perf_counter()
                r = await client.system_one(state={"message": text}, questions={"intent": question})
                ms = (time.perf_counter() - t0) * 1000
            a = r.choices["intent"]
            out[pid] = {"phrase_id": pid, "question_version": QUESTION_VERSION, "model": r.model, "choice": a.choice,
                        "confidence": a.confidence, "probabilities": a.probabilities,
                        "input_tokens": r.usage.input_tokens, "ms": round(ms, 1)}
        await asyncio.gather(*(one(pid, text) for pid, text in phrases))
    return out


def pct(v):
    return "n/a" if v is None or (isinstance(v, float) and np.isnan(v)) else f"{100 * v:.1f}%"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", action="store_true", help="ask Jev again even for cached phrases")
    args = ap.parse_args()

    df, X, _, _ = ti.get_data("cohere-mv3")  # refuses to run if the sealed test set changed
    tr, va = (df.split == "train").values, (df.split == "validation").values
    df_va = df[va].reset_index(drop=True)

    # The served model, refitted the way train_intent.py fits it, scored on validation.
    C, _ = ti.select_C(lambda a, b: (X[a], X[b]), df)
    model = ti.fit_lr(X[tr], df.label.values[tr], C)
    proba = model.predict_proba(X[va])
    c_conf, c_pred = proba.max(1), model.classes_[proba.argmax(1)]
    served_t = json.loads(SERVED.read_text())["threshold"]

    # Jev, cached.
    cache = {} if args.refresh else read_cache()
    todo = [(pid, text) for pid, text in zip(df_va.phrase_id, df_va.text) if pid not in cache]
    if todo:
        load_env()
        if not os.environ.get("TYPESAFE_API_KEY"):
            raise SystemExit("TYPESAFE_API_KEY is not set (add it to .env.local)")
        print(f"asking Jev ({MODEL}) about {len(todo)} phrases…")
        fresh = asyncio.run(ask_jev(todo))
        cache.update(fresh)
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text("".join(json.dumps(cache[pid], ensure_ascii=False) + "\n" for pid in df_va.phrase_id))
    jev = [cache[pid] for pid in df_va.phrase_id]
    labels = list(CRITERIA)
    j_proba = np.array([[r["probabilities"][label] for label in labels] for r in jev])
    j_pred = np.array([r["choice"] for r in jev])
    j_top = j_proba.max(1)
    j_conf = np.array([r["confidence"] for r in jev])

    # Jev's top-probability threshold, chosen on validation with the same rule and costs as ours (optimistic: chosen and
    # scored on the same phrases, as Cohere's was).
    def choose(weights):
        w_wrong, w_amb, w_needless = weights
        amb, wrong = df_va.ambiguous.values, j_pred != df_va.label.values
        costs = []
        for t in JEV_THRESHOLDS:
            act = j_top >= t
            c = np.where(amb, np.where(act, w_amb, 0), np.where(act, np.where(wrong, w_wrong, 0), w_needless)).mean()
            costs.append((round(float(c), 5), float(t)))
        best = min(c for c, _ in costs)
        near = [t for c, t in costs if c <= best + NEAR]
        return min(t for c, t in costs if c == best), best, (min(near), max(near))
    current = (ti.COST_WRONG_ACTION, ti.COST_ACTED_ON_AMBIGUOUS, ti.COST_NEEDLESS_QUESTION)
    j_t, _, j_band = choose(current)
    grid = [(w, *choose(w)) for w in SENSITIVITY]

    agree = j_pred == c_pred
    clear = ~df_va.ambiguous.values
    y = df_va.label.values
    rng = np.random.default_rng(ti.SEED)

    def row(name, pred, conf, t, note):
        m = ti.decision_metrics(pred, conf, df_va, t)
        (lo, hi), _ = ti.family_bootstrap(df_va[clear].reset_index(drop=True), pred[clear], rng)
        by_lang = ti.per_group_accuracy(df_va[clear].reset_index(drop=True), pred[clear], "lang")
        return {"name": name, "note": note, "acc": (pred[clear] == y[clear]).mean(), "ci": (lo, hi),
                "f1": f1_score(y[clear], pred[clear], average="macro"), "es": by_lang.get("es"), "pt": by_lang.get("pt"), **m}

    rows = [
        row("cohere", c_pred, c_conf, served_t, f"served threshold {served_t:.2f}"),
        row("jev default", j_pred, j_conf, JEV_DEFAULT_CONFIDENCE, "Jev confidence ≥ 0.5, untuned"),
        row("jev tuned", j_pred, j_top, j_t, f"top probability ≥ {j_t:.2f}, tuned on validation"),
        # Second opinion: Cohere's decision, but asking whenever Jev picks a different intent.
        row("cohere + jev", c_pred, np.where(agree, c_conf, 0.0), served_t, "Cohere acts only if Jev agrees"),
    ]

    ms = np.array([r["ms"] for r in jev if r.get("ms") is not None])
    tokens = np.array([r["input_tokens"] or 0 for r in jev])
    dis = clear & ~agree
    lines = [
        "# Jev vs. our intent classifier (validation)", "",
        f"_Generated by `pipeline/jev_validation.py` on {datetime.now(timezone.utc).isoformat(timespec='seconds')} "
        f"(commit {ti.git_commit()}). Do not edit by hand. Validation set only: {len(df_va)} phrases "
        f"({int(clear.sum())} clear + {int((~clear).sum())} ambiguous; {int((df_va.lang == 'es').sum())} ES, "
        f"{int((df_va.lang == 'pt').sum())} PT). The sealed test set is not read._", "",
        f"Jev model `{jev[0]['model']}` (pinned `{MODEL}`), one Choice per phrase over our seven intents, instructions and "
        f"option descriptions in English from `data/phrases/LABELING_GUIDE.md` (question version `{QUESTION_VERSION}`). "
        f"Ours: Cohere Embed Multilingual v3 + softmax regression (C = {C}), refitted as `train_intent.py` does.", "",
        "**Read this first.** The phrases are team-generated and synthetic (an upper bound, D7). Only `cohere` and "
        "`jev default` use a threshold not chosen on these phrases (Cohere's was chosen on this same validation set in "
        "D11, so it is optimistic too). `jev tuned` picks its threshold here: optimistic by construction. The honest "
        "comparison needs the human-written messages (step 16).", "",
        "| System | Decision rule | Accuracy, clear (95% CI) | Macro-F1 | ES | PT | Coverage | Wrong actions | "
        "Needless questions | Ambiguous asked | Mean cost |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(f"| {r['name']} | {r['note']} | {pct(r['acc'])} ({pct(r['ci'][0])}–{pct(r['ci'][1])}) | {r['f1']:.3f} | "
                     f"{pct(r['es'])} | {pct(r['pt'])} | {pct(r['coverage'])} | {pct(r['wrong_action_rate'])} | "
                     f"{pct(r['needless_question_rate'])} | {pct(r['ambiguous_asked_rate'])} | {r['mean_cost']:.3f} |")
    lines += [
        "", "_Accuracy and macro-F1 are the top choice on clear phrases, whatever the confidence. Coverage, wrong actions "
        "and needless questions are shares of clear phrases; ambiguous asked is the share of ambiguous ones where the "
        "system asked. Mean cost: wrong action 5, acting on an ambiguous message 2, needless question 1 (D11). The CI "
        "resamples whole families (D12)._", "",
        "## Jev's threshold (exported to the app)", "",
        f"**{j_t:.2f}** on Jev's top probability: the lowest threshold at the minimum mean cost with D11's weights "
        f"(wrong action 5, acting on ambiguous 2, needless question 1), searched from 0.10 to 0.99. Near-optimal band "
        f"(mean cost within {NEAR} of the minimum): {j_band[0]:.2f}–{j_band[1]:.2f}. Chosen on these {len(df_va)} phrases, so "
        "it is a starting point to check on human-written messages, not a measurement of how Jev will do on real customers.", "",
        f"What it rests on: Jev's probabilities come rounded to two decimals. Its top probability is "
        f"{np.median(j_top[clear & (j_pred == y)]):.2f} (median) when it's right on a clear phrase, at most "
        f"{(j_top[clear & (j_pred != y)].max() if (clear & (j_pred != y)).any() else float('nan')):.2f} when it's wrong, and at most "
        f"{j_top[~clear].max():.2f} on an ambiguous phrase ({df_va.phrase_id[np.argmax(np.where(~clear, j_top, -1))]}). The "
        "threshold sits one step above the most confident ambiguous phrase, so a single phrase decides it: read the band, "
        "not the point.", "",
        "How it moves with the cost weights (needless question = 1):", "",
        "| Wrong action | Acted on ambiguous | Threshold | Near-optimal band | Mean cost |", "|---|---|---|---|---|",
        *[f"| {w[0]}{' **(D11)**' if w == current else ''} | {w[1]} | {t:.2f} | {b[0]:.2f}–{b[1]:.2f} | {c:.3f} |"
          for w, t, c, b in grid],
        "", "## Agreement", "",
        f"- Same top intent on {pct(agree[clear].mean())} of clear phrases and {pct(agree[~clear].mean())} of ambiguous ones.",
        f"- Where they disagree on a clear phrase ({int(dis.sum())}): Cohere right {int((c_pred[dis] == y[dis]).sum())}, "
        f"Jev right {int((j_pred[dis] == y[dis]).sum())}, neither {int(((c_pred[dis] != y[dis]) & (j_pred[dis] != y[dis])).sum())}.",
        f"- Where they agree on a clear phrase, both are wrong on {int((agree & clear & (c_pred != y)).sum())}.", "",
        "## Cost and latency (Jev)", "",
        f"- {len(jev)} requests, {int(tokens.sum()):,} input tokens ({tokens.mean():.0f} per message): "
        f"${tokens.sum() * PRICE_PER_MTOK / 1e6:.5f} at ${PRICE_PER_MTOK}/M input tokens (output is free).",
        (f"- Request latency p50 {np.percentile(ms, 50):.0f} ms, p95 {np.percentile(ms, 95):.0f} ms "
         f"({CONCURRENCY} in parallel, measured from the machine that ran this script, not from Vercel)." if len(ms) else "- Latency: n/a (cached)."),
        "", "## Jev's mistakes and ambiguous phrases", "",
        "| Phrase | Lang | Label (alt) | Jev | Jev conf | Cohere | Cohere top p | Text |", "|---|---|---|---|---|---|---|---|",
    ]
    show = (j_pred != y) | ~clear
    for i in np.where(show)[0]:
        r = df_va.iloc[i]
        alt = f" ({r.alt_label})" if isinstance(r.alt_label, str) and r.alt_label else ""
        text = r.text.replace("|", "/")
        lines.append(f"| {r.phrase_id}{' (amb.)' if r.ambiguous else ''} | {r.lang} | {r.label}{alt} | {j_pred[i]} | "
                     f"{j_conf[i]:.2f} | {c_pred[i]} | {c_conf[i]:.2f} | {text} |")
    REPORT.write_text("\n".join(lines) + "\n")
    # The app's config: the exact question measured here and its threshold (docs/intent-model.md D14, D18).
    EXPORT.write_text(json.dumps({
        "model": MODEL, "question_version": QUESTION_VERSION, "labels": labels,
        "instructions": INSTRUCTIONS, "criteria": CRITERIA,
        "threshold": j_t, "threshold_on": "top probability", "threshold_band": list(j_band),
        "chosen_on": f"validation ({len(df_va)} phrases), D11 cost weights", "git_commit": ti.git_commit(),
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {REPORT.relative_to(ti.ROOT)} and {EXPORT.relative_to(ti.ROOT)} (threshold {j_t:.2f}, band {j_band[0]:.2f}–{j_band[1]:.2f})")
    for r in rows:
        print(f"  {r['name']:<13} acc {pct(r['acc'])}  ES {pct(r['es'])}  PT {pct(r['pt'])}  "
              f"wrong {pct(r['wrong_action_rate'])}  cost {r['mean_cost']:.3f}")


if __name__ == "__main__":
    main()
