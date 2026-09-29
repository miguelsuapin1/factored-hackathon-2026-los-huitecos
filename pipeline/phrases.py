"""Validate data/phrases/families.jsonl and expand it into data/phrases/phrases.csv.

Contract (fails loudly, never fixes silently):
- every family has a unique id, a known label, a scenario, and 3 Spanish + 3 Portuguese phrases
- the family id prefix matches its label (ambiguous families use AM)
- ambiguous families carry an alt_label that differs from the label
- no phrase text repeats anywhere in the set (compared case- and accent-insensitively)
"""
import csv
import json
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "phrases" / "families.jsonl"
OUT = ROOT / "data" / "phrases" / "phrases.csv"

LABELS = {
    "unrecognized_charge": "UC",
    "wrongful_fee": "WF",
    "transaction_status": "TS",
    "balance_check": "BC",
    "move_money": "MM",
    "human_agent": "HA",
    "out_of_scope": "OS",
}
STYLES = ["formal", "casual", "short"]
LANGS = ["es", "pt"]


def normalize(text: str) -> str:
    stripped = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return " ".join(stripped.lower().split())


def load() -> list[dict]:
    families = []
    for n, line in enumerate(SRC.read_text(encoding="utf-8").splitlines(), start=1):
        if line.strip():
            try:
                families.append(json.loads(line))
            except json.JSONDecodeError as e:
                sys.exit(f"{SRC.name}:{n}: invalid JSON ({e})")
    return families


def validate(families: list[dict]) -> list[str]:
    errors = []
    ids = Counter(f.get("family") for f in families)
    errors += [f"duplicate family id {i}" for i, c in ids.items() if c > 1]
    seen: dict[str, str] = {}
    for f in families:
        fid, label = f.get("family", "?"), f.get("label")
        ambiguous = f.get("ambiguous", False)
        if label not in LABELS:
            errors.append(f"{fid}: unknown label {label!r}")
            continue
        expected_prefix = "AM" if ambiguous else LABELS[label]
        if not fid.startswith(expected_prefix):
            errors.append(f"{fid}: id should start with {expected_prefix}")
        if ambiguous and (f.get("alt_label") not in LABELS or f.get("alt_label") == label):
            errors.append(f"{fid}: ambiguous family needs an alt_label different from its label")
        if not f.get("scenario"):
            errors.append(f"{fid}: missing scenario")
        for lang in LANGS:
            texts = f.get(lang, [])
            if len(texts) != len(STYLES) or not all(isinstance(t, str) and t.strip() for t in texts):
                errors.append(f"{fid}: needs exactly {len(STYLES)} non-empty {lang} phrases")
                continue
            for t in texts:
                key = normalize(t)
                if key in seen:
                    errors.append(f"{fid}: {t!r} duplicates a phrase in {seen[key]}")
                seen[key] = fid
    return errors


def expand(families: list[dict]) -> list[dict]:
    rows = []
    for f in families:
        for lang in LANGS:
            for i, text in enumerate(f[lang]):
                rows.append({
                    "phrase_id": f"{f['family']}-{lang}-{i}",
                    "family": f["family"],
                    "label": f["label"],
                    "alt_label": f.get("alt_label", ""),
                    "ambiguous": f.get("ambiguous", False),
                    "lang": lang,
                    "style": STYLES[i],
                    "text": text,
                    "source": f.get("source", "claude-generated"),
                    "scenario": f["scenario"],
                })
    return rows


def main() -> None:
    families = load()
    errors = validate(families)
    if errors:
        print("\n".join(errors))
        sys.exit(f"{len(errors)} contract violation(s) in {SRC.name}")
    rows = expand(families)
    with OUT.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    clear = [f for f in families if not f.get("ambiguous")]
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} phrases in {len(families)} families "
          f"({len(families) - len(clear)} ambiguous)")
    for label, n in sorted(Counter(f["label"] for f in clear).items()):
        print(f"  {label:20s} {n:3d} families  {n * 6:4d} phrases")


if __name__ == "__main__":
    main()
