#!/usr/bin/env bash
# Banking77 (PolyAI, Casanueva et al. 2020, CC BY 4.0) into data/external/banking77/ (git-ignored).
# Allowed for TRAINING ONLY, never evaluation (docs/decisions.md D-004). test.csv is downloaded for completeness
# and never read by any script: nothing may be scored on Banking77.
set -euo pipefail

BASE="https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/master/banking_data"
DEST="$(cd "$(dirname "$0")/.." && pwd)/data/external/banking77"
mkdir -p "$DEST"
for f in train.csv test.csv categories.json; do
  curl -fsSL "$BASE/$f" -o "$DEST/$f"
done
echo "Downloaded to $DEST:"
(cd "$DEST" && wc -l train.csv test.csv && shasum -a 256 train.csv test.csv categories.json)
