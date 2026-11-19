#!/usr/bin/env bash
# Rebuild the committed analysis from a complete, verified training archive.
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo 'Usage: studies/flagship-toy-text/render.sh RUN NEW_OUTPUT_DIR' >&2
  exit 2
fi
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
run=$(cd -- "$1" && pwd -P)
mkdir -- "$2"
out=$(cd -- "$2" && pwd -P)
python=${PYTHON:-python3}
cd "$repo"
node experiment.mjs verify "$run"
node experiment.mjs export "$run" > "$out/checkpoints.csv"
for phase in validation test; do
  for reference in random q_learning; do
    "$python" analysis/analyze.py "$out/checkpoints.csv" --phase "$phase" --reference "$reference" \
      > "$out/paired-$phase-vs-$reference.csv"
    "$python" analysis/analyze.py "$out/checkpoints.csv" --phase "$phase" --reference "$reference" \
      --aggregate probability-of-improvement > "$out/pi-$phase-vs-$reference.csv"
  done
  "$python" analysis/analyze.py "$out/checkpoints.csv" --phase "$phase" --aggregate iqm \
    --anchors studies/flagship-toy-text/anchors.json > "$out/iqm-$phase.csv"
done
export SOURCE_DATE_EPOCH=0
export PYTHONHASHSEED=0
for metric in return completion; do
  "$python" analysis/plot_curves.py "$out/checkpoints.csv" "$out/validation-$metric.svg" \
    --phase validation --metric "$metric"
done
node experiment.mjs report "$run" "$out/report.html"
"$python" - "$run" "$out" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

run, out = map(Path, sys.argv[1:])
for svg in out.glob("validation-*.svg"):
    # Matplotlib leaves trailing separators in XML path data. A newline is
    # already an SVG whitespace delimiter, so strip the redundant spaces.
    text = svg.read_text(encoding="utf-8")
    svg.write_text("\n".join(line.rstrip() for line in text.split("\n")), encoding="utf-8")
manifest = Path("experiments/flagship-toy-text.json")
sealed = json.loads((run / "run.json").read_bytes())
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

identity = {
    "manifestSourceSha256": sha(manifest),
    "sealedManifestHash": sealed["hash"],
    "toolchain": sealed["body"]["toolchain"],
}
(out / "identity.json").write_text(json.dumps(identity, indent=2) + "\n")
plan = json.loads(manifest.read_bytes())
budget = plan["checkpoints"][0]
rows = [f"trials/lake4-slip/{arm}/0/{budget}.json" for arm in ("random", "q_learning")]
(out / "checkpoint-hashes.json").write_text(
    json.dumps({row: sha(run / row) for row in rows}, indent=2) + "\n"
)
PY
