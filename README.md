# FOORT Flight

A spaceship sandbox around a Kerr black hole or an ST3Cr ring fuzzball, with the view numerically ray traced in real
time on the GPU (WebGPU): gravitational lensing, redshift, Doppler shift, aberration and the finite speed of light.
It builds on [FOORT-GPU](https://github.com/drmayerson/foort-gpu), the validated black-hole and fuzzball viewer.

**Status:** Stage 2A, milestone G0 (repository, vendoring, WebGPU capability). The plan is
`FLIGHT_STAGE2A_PLAN.md`; progress reports are in `PROGRESS.md`, decisions in `DECISIONS.md`, credits in `CREDITS.md`.

## Pages

| page | what it does |
|---|---|
| `index.html` | landing page; checks WebGPU and explains what to do without it |
| `caps.html` | WebGPU capabilities of this device (adapter, features, limits), with a JSON report |
| `latency.html` | hello compute, the CPU-wait cost per GPU submission, and 60 fps frame loops with a GPU-time budget |

FOORT Flight needs WebGPU: a recent Chrome or Edge, Safari 26+, or a recent Firefox. There is no WebGL2 fallback;
without WebGPU the page links to the FOORT-GPU viewer.

## Developer guide

- **No build step:** the committed files are served as they are (plain ES modules with JSDoc, `// @ts-check`).
- **Layout:** `js/` (the game: `gpu/` so far), `vendor/foort-gpu/` (a snapshot of FOORT-GPU, never edited; see its
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
```
