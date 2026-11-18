# FOORT Flight

A spaceship sandbox around a Kerr black hole or an ST3Cr ring fuzzball, with the view numerically ray traced in real
time on the GPU (WebGL2, as FOORT-GPU): gravitational lensing, redshift, Doppler shift, aberration and the finite speed of light.
It builds on [FOORT-GPU](https://github.com/drmayerson/foort-gpu), the validated black-hole and fuzzball viewer.

**Status:** Stage 2A, milestone G0 done (repository, vendoring, GPU capability; WebGL2 chosen over WebGPU, plan v1.1). The plan is
`FLIGHT_STAGE2A_PLAN.md`; progress reports are in `PROGRESS.md`, decisions in `DECISIONS.md`, credits in `CREDITS.md`.

## Pages

| page | what it does |
|---|---|
| `index.html` | landing page; checks WebGL2 and explains what to do without it |
| `caps.html` | WebGPU capabilities of this device (adapter, features, limits), with a JSON report |
| `observer.html` | G2 direct rendering: an observer (ZAMO, static, circular; boosted; any attitude) set up in the ship's coordinates; ship-frame redshift; blackbody or colour-map disc; stars or a picture |
| `tracer.html` | G1 tracer test: FOORT-GPU's tracer in the game's frame loop, static observer, FOORT or pinhole camera, debug views, load test |
| `latency.html` | WebGPU and WebGL2: correctness, the CPU-wait cost per GPU submission, and frame loops with a work budget |

FOORT Flight needs WebGL2 with float render targets and 6 draw buffers: any recent Chrome, Edge, Firefox or Safari,
on computers and most phones. Without it the page links to the FOORT-GPU viewer.

## Developer guide

- **No build step:** the committed files are served as they are (plain ES modules with JSDoc, `// @ts-check`).
- **Layout:** `js/` (the game: `gl/` WebGL2 tracer backend, scheduler and display; `camera/` the general tetrad camera and the ship camera; `physics/` the ship coordinates (Kerr–Schild, base Cartesian), observers, redshift; `render/` the blackbody table; `gpu/` the WebGPU code of the G0 tests), `shaders/glsl/` (the game's own GLSL; the tracer is loaded from `vendor/`), `vendor/foort-gpu/` (a snapshot of FOORT-GPU, never edited; see its
  `README.md`), `tools/` (offline tools), `dev/` (tests and scripts, Node.js ≥ 18).
- **Vendoring:** `sh tools/sync_foort_gpu.sh [../foort-gpu] [commit]` re-copies the snapshot from a FOORT-GPU commit
  and prints what changed; the commit is recorded in `vendor/foort-gpu/VERSION`.

```
cd dev
npm install
npm test                 # Vitest unit tests (node)
npm run test:e2e         # Playwright in installed Chrome with WebGPU
npm run typecheck        # tsc --checkJs
npm run serve            # http://127.0.0.1:8766/
node scripts/g0Report.mjs   # caps + latency reports into dev/reports/g0/
node scripts/g1Compare.mjs  # records vs the FOORT-GPU viewer (../foort-gpu at the vendored commit)
node scripts/g2Shots.mjs    # observer-view screenshots (dev/reports/img/g2/) and their shift factors
```
