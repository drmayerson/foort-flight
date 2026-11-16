# FOORT Flight progress

Milestone reports, newest last. Plan: `FLIGHT_STAGE2A_PLAN.md` (v1.0). Decisions: `DECISIONS.md`.

## G0 — repository, vendoring, WebGPU capability (2026-11-16)

Branch `g0-scaffold` (not merged, not pushed).

### Delivered

- **Scaffold:** `index.html` (landing page with the WebGPU check), `style.css`, `README.md`, `DECISIONS.md`, `CREDITS.md`, this file, the plan, `.gitignore`.
- **Vendored snapshot:** `vendor/foort-gpu/` = FOORT-GPU commit `7896677` (2026-11-16), 56 files, 34 MB (mostly the five inoisy fields at 6–8 MB each). `tools/sync_foort_gpu.sh` re-copies it from any commit with `git archive` and shows the diff; `vendor/foort-gpu/README.md` lists what is there and why.
- **`caps.html`:** adapter (vendor, architecture, fallback or not), all features, all limits (adapter maximum, WebGPU default, and what the device got after FOORT Flight asked for the maximum), `shader-f16` (with a compile test), `timestamp-query`, the canvas format, WebGL2 presence, a copyable JSON report.
- **`latency.html`** (`js/gpu/latency.js`), about 20 s, with a copyable JSON report:
  1. **hello compute:** 2²⁰ values written by a compute shader, read back, compared exactly;
  2. **CPU wait per submission:** a tiny dispatch awaited with `onSubmittedWorkDone`, and with a 16-byte `mapAsync` read-back (30 each);
  3. **chunks waited vs not:** 24 chunks of ≈ 2 ms GPU time, waited per chunk, vs submitted one by one with one wait at the end, vs one submission;
  4. **frame loops:** `requestAnimationFrame` with 0, 2 or 8 chunks plus a display pass per frame (one submission, no waits), and a **budget mode** that adapts the chunk count to 10 ms of GPU time per frame — the first version of the plan's per-frame scheduler.
- **No-WebGPU page:** when `navigator.gpu` is missing or no adapter/device can be created, the landing page and the latency page explain why and link to the FOORT-GPU viewer (plan Section 3).
- **`js/gpu/`:** `device.js` (adapter/device with raised limits and optional features), `timing.js` (stall-free `GpuTimer` on timestamp queries; statistics helpers), `latency.js`.
- **Dev tooling:** `dev/` with Vitest, Playwright (installed Chrome with WebGPU), `tsc --checkJs` (+ `@webgpu/types`); `dev/scripts/g0Report.mjs` runs both pages in Chrome and saves the JSON reports to `dev/reports/g0/`.

### Tests

| suite | result |
|---|---|
| `npm test` (Vitest) | 8/8 pass: timing statistics; the vendored snapshot records its commit and contains every path the sync script lists; vendored Kerr g_dd equals Boyer–Lindquist to 1e-12; ST3Cr has M_ADM = 1 and g_tt → −(1 − 2/r); units (Sgr A*: GM/c³ = 21.17 s); the tetrad camera loads |
| `npm run test:e2e` (Chrome 157, WebGPU) | 4/4 pass: landing page "WebGPU ready"; the no-WebGPU page (navigator.gpu removed) explains and links FOORT-GPU; `caps.html` gets the adapter's maximum storage binding; `latency.html` hello compute exact and all measurements complete |
| `npm run typecheck` | clean |

### Measurements on this development machine (Chrome 157, AMD RDNA 3 integrated GPU)

`dev/reports/g0/caps_chrome.json`, `latency_chrome.json` (headless) and `headed/latency_chrome.json` (a visible window).

- **Capabilities:** WebGPU on the real GPU (not a fallback adapter); `timestamp-query` and `shader-f16` (compiles) offered; every raised limit granted: storage-buffer binding 2 GiB, buffer 2 GiB, 1024 invocations per workgroup. A 6 × 384² cubemap of 24-float records (85 MB) fits easily.
- **CPU wait per submission:** median **8.2 ms** with `onSubmittedWorkDone`, 8.3–8.4 ms with a 16-byte `mapAsync` read-back (p10–p90 7.3–8.8 ms).
- **Chunks** (24 × 1.81 ms GPU, timed by timestamps; 43.4 ms of GPU work in total):

  | submission | wall time |
  |---|---|
  | wait after every chunk | 198 ms |
  | one submission per chunk, one wait at the end | 49 ms |
  | all chunks in one submission | 40–49 ms |

  Each wait costs **6.2 ms**: waiting per chunk is **4.0× slower**. So the plan's rule "never wait on the CPU per chunk" matters in Chrome too, not only in Firefox (FOORT-GPU M0: 75–100 ms per wait there).
- **Frame loops** (headed window; the GPU time is the median per frame from timestamps):

  | per frame | fps | frame p90 | GPU per frame | chunks per second |
  |---|---|---|---|---|
  | display only | 59.9 | 16.8 ms | 0.07 ms | — |
  | 2 chunks + display | 59.9 | 16.8 ms | 3.6 ms | 121 |
  | 8 chunks + display | 59.9 | 16.9 ms | 15.9 ms | 461 |
  | budget 10 ms (settles at 6 chunks) | 59.9 | 16.9 ms | 9.05 ms | 284 |

  With no waits, about 15 ms of compute per frame still keeps 60 fps; the CPU spends 0.2–0.4 ms per frame encoding. Headless Chrome paces frames less evenly (p90 25 ms in every setting, 46 fps at 8 chunks), so frame-rate numbers should come from a visible window.
- **What it means for G1–G3:** the trace budget per frame can be about 8–10 ms of GPU time on this machine at 60 fps (the display pass and the rest of the frame take the remainder), i.e. ≈ 5 chunks of 2 ms; GPU time comes from timestamp queries, read back asynchronously one or more frames late.

### Not yet measured: needs the user (CHECKPOINT G0)

The plan asks the user to open `caps.html` and the latency test on their laptop (Chrome and Firefox) and their phone (Samsung, Xclipse 920). Firefox and the phone cannot be driven from here. **WebGPU needs a secure context** (https or localhost), so the phone can only test the published pages: either `main` is published to GitHub Pages at this checkpoint, or the phone test waits.

- Laptop: `cd dev && npm run serve`, then <http://127.0.0.1:8766/caps.html> and <http://127.0.0.1:8766/latency.html>, in Chrome and in Firefox. Press "Copy report (JSON)" on each page and paste the four reports back.
- Phone: the same two pages at `https://drmayerson.github.io/foort-flight/` once published.

### Open issues

- **F11 (browser guidance)** waits for the Firefox and phone reports.
- **Sky picture licences:** the credits come from FOORT-GPU; the exact source pages of the two Hubble files are not recorded yet (`CREDITS.md`, to be settled by G8).
- The vendored ST3Cr bake and fluid modules are only import-tested so far; they are exercised from G1 on.
