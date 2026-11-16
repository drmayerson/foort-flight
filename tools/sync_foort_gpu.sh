#!/usr/bin/env sh
# Re-copy the vendored FOORT-GPU snapshot into vendor/foort-gpu/ and show what changed.
#
# Usage (from the foort-flight root):
#   sh tools/sync_foort_gpu.sh [path-to-foort-gpu-clone] [commit]
# Defaults: ../foort-gpu and its HEAD.
#
# Files are taken from the given *commit* with `git archive`, never from the working tree, so uncommitted FOORT-GPU
# work is not vendored by accident. vendor/foort-gpu/VERSION records the commit hash and date.
# Never edit vendored files: wrap or extend them in js/ (plan Section 2). Upstream fixes go to DECISIONS.md.
set -eu

SRC="${1:-../foort-gpu}"
REV="${2:-HEAD}"
DEST="vendor/foort-gpu"

if [ ! -d "$SRC/.git" ]; then echo "not a git clone: $SRC" >&2; exit 1; fi
if [ ! -f FLIGHT_STAGE2A_PLAN.md ]; then echo "run from the foort-flight root" >&2; exit 1; fi

HASH=$(git -C "$SRC" rev-parse "$REV")
DATE=$(git -C "$SRC" show -s --format=%ci "$HASH")

# The vendored paths (plan Section 2). Keep this list in step with vendor/foort-gpu/README.md.
PATHS="
js/metrics
js/bake
js/fluid
js/noise/noiseField.js
js/camera/tetradCamera.js
js/ref/cpuTracer.js
js/ref/inspectWorker.js
js/gpu/traceConfig.js
js/gpu/tiers.js
js/units.js
js/export.js
js/sky.js
noise/inoisy_lg21.json
noise/inoisy_lg21.bin
noise/inoisy_st3cr_l0.json
noise/inoisy_st3cr_l0.bin
noise/inoisy_st3cr_l1e-3.json
noise/inoisy_st3cr_l1e-3.bin
noise/inoisy_st3cr_l5e-3.json
noise/inoisy_st3cr_l5e-3.bin
noise/inoisy_st3cr_l0.05.json
noise/inoisy_st3cr_l0.05.bin
sky
shaders/glsl
tools/codegen/gen_metrics.py
bench/kerrBench.wgsl
bench/benchGPU.js
bench/setup.js
bench/kerr.js
"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# shellcheck disable=SC2086
git -C "$SRC" archive "$HASH" $PATHS | tar -x -C "$TMP"
find "$TMP" -name .gitkeep -delete

# keep the hand-written README of the vendor folder
[ -f "$DEST/README.md" ] && cp "$DEST/README.md" "$TMP/README.md"
printf 'commit %s\ndate   %s\nsource https://github.com/drmayerson/foort-gpu\n' "$HASH" "$DATE" > "$TMP/VERSION"

if [ -d "$DEST" ]; then
  echo "== changes against the current snapshot =="
  diff -rq "$DEST" "$TMP" || true
fi
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -r "$TMP" "$DEST"
echo "vendored foort-gpu $HASH ($DATE) into $DEST"
echo "review with: git diff --stat -- $DEST"
