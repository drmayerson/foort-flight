# Vendored FOORT-GPU snapshot

A copy of selected files of [FOORT-GPU](https://github.com/drmayerson/foort-gpu) at the commit in `VERSION`.

- **Never edit these files.** Wrap or extend them in `js/`. A needed fix is written up in `DECISIONS.md` as an upstream note for FOORT-GPU.
- **Update:** `sh tools/sync_foort_gpu.sh [../foort-gpu] [commit]` re-copies the list below from that commit (with `git archive`, never from FOORT-GPU's working tree) and prints the changed files.
- The relative paths are FOORT-GPU's own, so the modules' relative imports keep working.

| path | used for |
|---|---|
| `js/metrics/` | metric functions in double precision (all of them: `registry.js` imports every metric) |
| `js/bake/` | metric tables for the GPU (ST3Cr), Hermite lookup, bake worker |
| `js/fluid/` | disc fluid (GeneralCircularRadial, banded model), fluid table, emission |
| `js/noise/noiseField.js` | noise-field contract, loader and sampler |
| `js/camera/tetradCamera.js` | tetrad camera (extended in `js/camera/` to general observers) |
| `js/ref/cpuTracer.js`, `inspectWorker.js` | double-precision CPU reference tracer |
| `js/gpu/traceConfig.js`, `tiers.js` | view → tracer settings and the quality tiers (imported by `inspectWorker.js`; the tier idea) |
| `js/units.js`, `js/export.js`, `js/sky.js` | physical units, PNG/video export, sky picture list and credits |
| `noise/` | inoisy fields: `inoisy_lg21` (black holes) and the ST3Cr λ anchors 0, 1e-3, 5e-3, 0.05 |
| `sky/` | background pictures (credits in `CREDITS.md`) |
| `shaders/glsl/` | the GLSL tracer: **source for the WGSL port**, not loaded by the game |
| `tools/codegen/gen_metrics.py` | closed-form metric generator (to be extended to WGSL) |
| `bench/` (4 files) | the M0 WebGPU benchmark kernel (`kerrBench.wgsl`): a first WGSL Kerr tracer, reference for G1 |
