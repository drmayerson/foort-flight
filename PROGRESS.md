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

## G0b — WebGL2 alternative (2026-11-16)

The user asked whether Stage 2A needs WebGPU at all (the phone has none; FOORT-GPU uses WebGL2). `latency.html` now
runs the same measurements with WebGL2 as well (`js/gl/latencyGL.js`), also when WebGPU is missing: rays traced in a
fragment shader into 6 RGBA32F attachments (the 24-float record), 256² rays per chunk, the same synthetic loop.

- **Waiting** uses a fence polled on event-loop yields (never blocking), plus a 1-pixel `readPixels` for comparison.
- **Budget mode without timer queries** (the case for Firefox and the phone): each frame ends with a fence. With 2 or
  more frames in flight, or a frame interval over 20 ms, the chunk count drops by 20%; with at most 1 in flight and
  intervals under 18 ms for 4 frames, it grows by 1. Timer queries, where they exist, only measure.

**This laptop, Chrome 157, headed** (`dev/reports/g0/headed/latency_chrome.json`):

| | WebGL2 | WebGPU (same run) |
|---|---|---|
| CPU wait per submission | fence 2.0 ms, readPixels 1.2 ms | 8.5 ms |
| waiting per chunk | 1.6× slower (1.4 ms per wait) | 4.1× slower |
| chunk of ≈ 1.7 ms | 1843 iterations | 1024 iterations |
| 8 chunks/frame | 59.9 fps, p90 17.2 ms, GPU 11.4 ms (timer) | 59.9 fps, GPU 15.9 ms |
| budget | fences: 60.2 fps, settles at 6 chunks, GPU 12.2 ms, ≤ 1 frame in flight | timestamps 10 ms: 6 chunks |

- The synthetic loop runs about **2× more iterations per ms in WebGL2** than in WebGPU on this GPU (ANGLE/D3D11 vs
  Dawn/D3D12). FOORT-GPU's M0 found the real Kerr tracer equal in both; this loop is not the tracer, so it only says
  that WebGL2 is not slower here.
- The fence-based budget holds 60 fps without any GPU timing.
- **Still needed:** the same page in Firefox on the laptop, and on the phone (where only the WebGL2 part runs).

### G0b device runs (user, 2026-11-16)

Summary of the pasted reports: `dev/reports/g0/user/g0b_summary.json`.

| | laptop Firefox WebGPU | laptop Firefox WebGL2 | laptop Chrome WebGL2 | phone Chrome WebGL2 |
|---|---|---|---|---|
| works | yes | yes | yes | **yes** (WebGPU: no adapter) |
| timer queries | timestamps | **no** | yes | **no** |
| CPU wait | 101 ms | fence 5 ms, readPixels 2 ms | 2.0 / 1.2 ms | 2.5 / 1.3 ms |
| waiting per chunk | 25× slower | 2.5× | 1.6× | 1.7× |
| ≈ 1.5 ms chunk | 1024 iterations | 1229 | 1843 | 405 |
| 8 chunks per frame | 60 fps | 60 fps (≈ 12.8 ms GPU) | 60 fps | 24 fps, flat 41.8 ms |
| budget mode | 6 chunks, 336 chunks/s | fences: 10 chunks, 432 chunks/s, 60 fps | 6 chunks, 60 fps | 1 chunk (see below) |

- **Laptop, Firefox:** WebGL2 is at least as good as WebGPU: 60 fps in every loop, and the fence-driven budget took more work per second (432 vs 336 chunks/s; the WebGPU budget was capped at 10 ms) with no GPU timing at all. A wait costs 5 ms instead of 101 ms.
- **Phone:** WebGL2 works, with the float targets and 8 draw buffers the 24-float record needs. Its GPU does the loop about 3–4.5× slower than the laptop's (405 vs 1229–1843 iterations per 1.5 ms).
- **Phone frame rate:** as soon as any work was drawn, frames came every 41.8 ms exactly (24 Hz) for 2 and 8 chunks alike, with **0 frames in flight**: the GPU finished each frame's work well within the frame. So the 24 fps is not GPU load; it looks like the phone's display or power policy (a battery saver or adaptive refresh dropping to 24 Hz). The display-only loop ran at 60 fps median but with a p90 of 42 ms, as if switching.
- **Controller fix needed:** the fence budget treated every 41.8 ms interval as overload and fell to 1 chunk although nothing was in flight. The scheduler must use frames in flight as its overload signal and take the frame interval relative to the device's own refresh, not 16.7 ms. To do in the real scheduler (G1).

### Decision and CHECKPOINT G0 closed (2026-11-16)

- **F12: WebGL2** (user: "Switch to WebGL2"); **F11:** any modern browser with WebGL2, phones included. The plan is now **v1.1** (`FLIGHT_STAGE2A_PLAN.md`): Section 3 rewritten for WebGL2 and fence-based scheduling; G1 is now "WebGL2 tracer integration" (the vendored GLSL tracer unchanged, camera through the vielbein) instead of a WGSL port.
- **Landing page** now checks WebGL2 (float targets, 6 draw buffers, highp) and explains when it is missing. Tests: Vitest 8/8, Playwright 7/7, type check clean.
- **Carried into G1:** the scheduler judges overload from frames in flight and the device's own refresh interval (the phone's 24 Hz showed why).

## G1 — WebGL2 tracer integration, static observer (2026-11-18)

Branch `g1-tracer` (not merged, not pushed).

### Delivered

- **`js/gl/tracer.js`:** the game's tracer backend. It compiles FOORT-GPU's GLSL tracer **unchanged** from `vendor/` (closed-form Kerr; tabulated ST3Cr with G3 = G4 and texel reuse; BS3 for Normal; the other gate metrics too), takes the uniforms of the vendored `gpuTraceSetup`, the tables and fluid table from the vendored bake worker, and traces into 6 RGBA32F attachments (the 24-float record). It only issues draws; records are read back asynchronously (PBO + polled fence).
- **`js/camera/generalTetrad.js`:** the general pinhole camera through `uE` alone (any observer, attitude, boost, cube face), no shader change; `staticFrame` (FOORT's static observer), `boostFrame`, `rotateFrame`, `cubeFaceFrames`, `withCamera`.
- **`js/gl/scheduler.js`:** the per-frame scheduler: a ray budget per frame, centre-out chunks of 16-row bands, one fence per frame, timer queries where available (per tracer program), fences and the measured refresh interval otherwise.
- **`tracer.html`** (`js/g1Page.js`, `js/gl/debugDisplay.js`, `shaders/glsl/debug.glsl`): static-observer test page. Scenes from FOORT-GPU's quality gate, tiers, N = 256–1024, FOORT or pinhole camera, four-colour / redshift / steps / termination views; the four-colour screen turns with the azimuth while tracing, so stutter is visible; "keep tracing" load test. Linked from the landing page.
- **Scripts:** `g1Compare.mjs` (records vs the FOORT-GPU viewer, using the FOORT-GPU clone read-only), `g1Load.mjs` (frame pacing under continuous tracing), `g1Smoke.mjs` (load the page, screenshot).

### Tests

| suite | result |
|---|---|
| Vitest | 21/21: G0's 8; the pinhole camera equals FOORT's static vielbein (Kerr far and near, south hemisphere, ST3Cr); rays are null with unit local energy and point along the screen direction for static, boosted (v = 0.84 c) and rotated frames; cube faces centred on the six axes and seamless at their edges; chunking covers every pixel exactly once |
| Playwright | 10/10: G0's 7; Kerr (shadow, escapes, crossings, closed-form program); fuzzball through the tables with FOORT vs pinhole camera; frame pace while tracing |
| type check | clean |

### Records vs FOORT-GPU (`dev/reports/g1/compare.json`, `compare_log.txt`)

The 13 quality-gate scenes (Kerr a = 0, 0.94, 0.998; Johannsen; Manko–Novikov; Reissner–Nordström; ST3Cr λ = 0.05, 5e-3, 1e-3, 1e-4 and 0) × the Reference, High and Normal tiers, 128², against FOORT-GPU's viewer at the vendored commit:

| | result, all 39 cases |
|---|---|
| ours, FOORT's camera uniforms | **100% of pixels bit-identical** (all 24 floats) |
| ours, the general pinhole camera | **100% bit-identical** as well (its `uE` rounds to the same float32 values) |
| float32 noise floor (ε × (1 + 1e-6)), for scale | black holes: 100% class agreement, 0.01–0.15% of escape directions off by > 1e-3 rad; fuzzball λ > 0: 98.5–100% class agreement, 1.8–5.8% of directions off (chaos) |

So the game traces exactly what FOORT-GPU traces, and the camera path for general observers adds no error at all for static observers.

### Timings and frame pacing (this laptop, Chrome)

Full trace of one image, Normal tier (`dev/reports/g1/timing.json`):

| scene | N | FOORT-GPU (tiles back to back) | ours, inside a 60 fps frame loop |
|---|---|---|---|
| Kerr (5 scenes) | 512² | 77–87 ms | 133–167 ms (8–10 frames) |
| Johannsen / Manko–Novikov | 512² | 150 / 415 ms | 267 / 883 ms |
| ST3Cr λ = 0.05 … 1e-4 | 256² | 490–690 ms | 625–1470 ms (35–60 frames) |
| ST3Cr λ = 0 | 256² | 130 ms | 351 ms |

Ours takes about twice as long by design: the scheduler gives tracing half of each frame and leaves the rest to the display.

Frame pacing while tracing continuously, 512², headed window (`dev/reports/g1/load_headed.json`):

| scene | fps | frame p90 | worst frame |
|---|---|---|---|
| Kerr a = 0.94, 17° and 80° | 59.9 | 16.8 ms | 18–33 ms |
| ST3Cr λ = 0 (black hole) | 59.9 | 16.9 ms | 17 ms |
| ST3Cr λ = 5e-3 (fuzzball) | 59.9 median | **33 ms** | 50–100 ms |

### Finding: long fuzzball rays set a floor on frame time

The scheduler's per-frame log shows that near the fuzzball's centre **even the smallest chunk (16 × 16 rays) takes 30–46 ms of GPU time**, while 2700 rays of the outer image take 2.5 ms. A chunk costs about as much as its longest ray (up to 5000 table steps, chaotic trapped light), not its number of rays, so no ray budget can keep such frames under 16.7 ms: every other frame or so is dropped while the centre is traced. Kerr and the λ = 0 black hole have no such rays and stay at 60 fps.

**Proposed remedy (for G3, where cubemaps refresh continuously):** split long rays across frames. FOORT-GPU's tracer already has the pieces in its ray-compaction mode (stop rays at a step limit and store their state in attachments 6–7; resume listed rays), which needs 8 draw buffers (the laptop and the phone have 8). Two ways:
1. **Without touching the shader:** step-limited passes (mode 1), an asynchronous read-back of which rays are unfinished, an index texture, resume passes (mode 2) into a second record set, and a small merge pass of the game's own. More machinery, no upstream change.
2. **With a small upstream change in FOORT-GPU:** an "in-place resume" mode (resume a pixel's own ray if unfinished, else copy its record), which needs no read-back or index. Written up as an upstream note if chosen; the plan forbids editing the vendored copy.

Until then the fuzzball refresh drops to about 30 fps while its centre is traced; black holes are unaffected.

**User, 2026-11-18:** option 1 for now, provisionally (DECISIONS.md).

### Not covered yet

- Firefox and the phone: `tracer.html` is not published (the branch is unmerged). The fence-only path (no timer queries) ran here only in headless Chrome, where the e2e load test held a 60 fps median.
- G1 traces static observers only; moving observers and Kerr–Schild ship coordinates are G2.

### G1 device runs (user, 2026-11-18)

The published `tracer.html`, Normal tier, N = 512 (laptop) and the default scene sizes on the phone. The HUD's frame p90 covers the last 120 frames, which were after the trace when the user read it; the frame rate while tracing is frames / trace time:

| | trace | frames | fps while tracing |
|---|---|---|---|
| Kerr, laptop Firefox 160 (fences only) | 0.45 s | 27 | 60 |
| Fuzzball λ = 5e-3, laptop Firefox | 14.39 s | 535 | 37 |
| Kerr, phone (Xclipse 920, Chrome; fences only) | 1.21 s | 70 | 58 |
| Fuzzball λ = 5e-3, phone | 10.08 s | 437 | 43 |
| for comparison: fuzzball, laptop Chrome (timer queries) | 6.83 s | 286 | 42 |

- **Black holes:** full frame rate in all three browsers, the phone included; the fence-only budget works.
- **Fuzzball:** about 40 fps while its centre is traced, on every device: the long-ray floor of the finding above, not a browser issue. To be fixed in G3 (option 1).
- The HUD now prints "fps while tracing" for the last trace.

**CHECKPOINT G1:** tests pass; records bit-identical to FOORT-GPU on all 39 cases; device runs as above.
