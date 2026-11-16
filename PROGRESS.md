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

## G0 device round (2026-11-16)

G0 was merged to `main` and published (user: "Merge and push"). The user ran the published pages on the laptop
(Firefox 160) and the phone (Samsung, Xclipse 920, Chrome 157). Reports: `dev/reports/g0/user/`. The laptop is also the
machine Claude Code runs on, so the Chrome numbers above are the same laptop in Chrome.

### Laptop: Firefox 160 vs Chrome 157

| | Firefox 160 | Chrome 157 (headed) |
|---|---|---|
| adapter name | hidden by Firefox | amd / rdna-3 |
| `timestamp-query`, `shader-f16` | yes, yes (compiles) | yes, yes |
| storage binding / buffer | 2 GiB / 2 GiB, all raised limits granted | 2 GiB / 2 GiB |
| hello compute | exact | exact |
| CPU wait per submission (median) | **100 ms** (p10–p90 100–101; read-back 101 ms) | 8.2 ms |
| 24 chunks, waited each / not waited | 2515 ms / 100 ms: **25× slower** | 198 / 49 ms: 4× |
| busy chunk (same 1024 iterations) | 1.43 ms GPU | 1.81 ms GPU |
| frame loop, display only | 59.9 fps, p90 16.7 ms | 59.9 fps, p90 16.8 ms |
| frame loop, 8 chunks (≈ 10–16 ms GPU) | 59.9 fps, p90 16.7 ms, 484 chunks/s | 59.9 fps, p90 16.9 ms, 461 chunks/s |
| budget 10 ms | settles at 7 chunks, 336 chunks/s, 59.9 fps | 6 chunks, 284 chunks/s |

- **Firefox's wait is a fixed ≈ 100 ms** (the spread is 1 ms), like a polling interval, slightly worse than FOORT-GPU's M0 (75–100 ms). Any CPU wait in the frame loop would drop Firefox to 10 fps.
- **Without waits Firefox is as good as Chrome**, even slightly faster per chunk on this GPU, with perfectly even frame pacing. Timestamp results arrive about 6 frames late (≈ 100 ms), and the budget scheduler still held 8.6 ms median, p90 10.0 ms against a 10 ms budget.
- **Consequence for the design (confirms plan Section 3):** nothing in the per-frame path may wait on the GPU; read-backs (timestamps, the staleness metric, screenshots, the map's GPU data if any) are asynchronous and tolerate ≈ 100 ms delay in Firefox. The scheduler must work with GPU times that are several frames old.
- Firefox gave the device its defaults for limits FOORT Flight did not ask to raise (e.g. 16 sampled textures per stage, 4 bind groups, 8192² textures, though the adapter offers 64, 8, 16384). G1 adds the limits it needs to `RAISED_LIMITS`.

### Phone: Samsung (Xclipse 920), Chrome 157

- **caps.html:** `navigator.gpu` exists, but the high-performance adapter request returned **no adapter**. As the plan expected, Chrome's Android WebGPU does not cover this GPU (it is documented for Qualcomm and ARM GPUs). WebGL2 is available, so FOORT-GPU still runs there.
- **latency.html crashed** on that path: the page replaced its results table with the explanation, then wrote the results into the table that no longer existed. Fixed; an e2e test covers it.
- **Retry added:** `createGpu` now asks for a high-performance core adapter, then any core adapter, then a **compatibility-mode** adapter (Chrome can offer WebGPU compatibility mode on OpenGL ES where core WebGPU is unavailable). Both pages report each request and its outcome. **The phone needs a second run of the two pages** once this fix is published.

### Fixes in this round

- `latency.html` without WebGPU: the explanation goes in its own box; the report and "Copy" still appear (e2e test).
- Adapter request sequence core high-performance → core → compatibility, reported as `attempts`; `featureLevel` reported (e2e test with the core requests stubbed out).
- `caps.html`'s "default" column was empty in Firefox: an adapter may create only one device (Firefox enforces it), so the defaults now come from a second adapter.
- The latency page's frame loops are guarded: if they fail (e.g. compatibility mode without storage buffers in fragment shaders), the other results are still reported.

Tests: Vitest 8/8, Playwright 6/6 (Chrome with WebGPU), type check clean.

### F11 (browser guidance): proposal for the user

Recommend **Chrome or Edge**, and **support Firefox** as a fully working browser (60 fps here, given the no-wait design), with a note that Firefox reacts more slowly to some actions that need a GPU read-back (≈ 0.1 s). The phone question stays open until the second phone run.

### Phone, second run (2026-11-16)

`dev/reports/g0/user/caps_phone_2.json`: all three adapter requests (core high-performance, core, compatibility)
return **no adapter**. Chrome 157 on this phone exposes `navigator.gpu` but no WebGPU device, not even in
compatibility mode. FOORT Flight cannot run there; the phone gets the explanation page with the link to FOORT-GPU
(WebGL2 works). Possible later check, not for players: Chrome's `chrome://flags/#enable-unsafe-webgpu` would show whether
it is a blocklist or missing support.
