# FOORT Flight — Stage 2A plan (sandbox spaceship around black holes and fuzzballs)

Status: v1.0 (2026-11-16). Owner: Daniel Mayerson. Executor: Claude Code, in a **new repository** (working name `foort-flight`, decision F1).

Stage 2A is the sandbox version of a spaceship game: you fly freely around a Kerr black hole or an ST3Cr ring fuzzball, and the view is numerically ray traced in real time, with gravitational lensing, redshift, Doppler, aberration and finite light-travel time. Missions come later (Stage 2B).

---

## 0. Working agreement

- **Read first:** this file. Then skim the FOORT-GPU repository (`https://github.com/drmayerson/foort-gpu`): `README.md`, `DECISIONS.md`, `FOORT_GPU_STAGE1_PLAN.md` and `FOORT_GPU_STAGE1B_PLAN.md`. FOORT-GPU is the validated science viewer this game builds on; its decision log explains many float32 and GPU pitfalls that also apply here.
- **Milestones:** work milestone by milestone (Section 9). Each milestone ends in a **CHECKPOINT**:
  - run the tests;
  - append a report to `PROGRESS.md`, with numbers, screenshots or short clips, and open issues;
  - commit, then **stop and wait for the user's go-ahead**.
- **Decisions:** record every non-trivial choice in `DECISIONS.md`. Section 11 lists open decisions with proposed defaults; use the default and flag it if unanswered.
- **The repository:**
  - The user creates the empty GitHub repository and enables GitHub Pages (main branch, root). If the `gh` CLI is authenticated, Claude Code may offer to create it, but only with the user's explicit approval.
  - Work on feature branches; merge to `main` (= published at `https://drmayerson.github.io/<repo>/`) only at approved checkpoints.
  - Never modify FOORT-GPU or the `drmayerson.github.io` repository. A homepage link is added by the user, or in G8 with approval, as a separate change in that repository.
- **No build step:** as in FOORT-GPU, the committed files are served as-is. Use plain ES modules + JSDoc (`// @ts-check`), shader files fetched at runtime, and dev tooling only in `dev/` (Vitest, Playwright; `node_modules` git-ignored).
- **Language:** English UI (translation deferred).

---

## 1. Goals and scope

### 1.1 Stage 2A goals

1. **Spacetimes:** Kerr (spin a) and the ST3Cr ring fuzzball (λ, including λ = 0, the supersymmetric black hole), both in units of their ADM mass (M = 1), exactly as in FOORT-GPU.
2. **Two flight modes:**
   - **Free mode (kinematic):** move the camera anywhere, without inertia or curvature effects on the motion. The camera is a chosen local observer (default: ZAMO).
   - **Physical mode:** a spaceship on a timelike worldline, geodesic when the engines are off and correctly accelerated when they fire. The player must counteract the geodesic motion with thrusters to follow a different path.
3. **Real-time view** of the accretion disc and the sky, with all relativistic effects:
   - lensing;
   - gravitational redshift/blueshift;
   - Doppler and aberration from the ship's velocity;
   - slow light;
   - the disc flickering with the inoisy fields, with the redshift visible in colour and brightness.
4. **Sandbox tools:**
   - a HUD with proper time and coordinate ("outside") time, redshift, g-load and orbit status;
   - a flat map view with the predicted trajectory;
   - flight assists;
   - scenario presets;
   - physical units;
   - screenshot and video export.

### 1.2 Out of scope for 2A (Stage 2B or later)

- Missions and scoring (but keep a scenario format that can grow into them; Section 7.6).
- Other metrics.
- In-world objects such as beacons or other ships (they need ray shooting toward objects).
- Rendering from inside a horizon.
- A WebGL2 fallback, multiplayer, sound and translation.

---

## 2. What to reuse from FOORT-GPU (vendoring)

**Vendor a snapshot; do not link live.** Copy the pure-math modules and data from FOORT-GPU at a recorded commit into `vendor/foort-gpu/`, plus `vendor/foort-gpu/VERSION` (commit hash, date). Provide `tools/sync_foort_gpu.sh`, which re-copies them and shows the diff.

- Never edit vendored files. Wrap or extend them in `js/`.
- If a vendored module needs a fix, write it up in `DECISIONS.md` as an upstream note for FOORT-GPU.

**What to vendor** (adapt the list to the actual repo at the time):

| From FOORT-GPU | Use in the game |
|---|---|
| `js/metrics/` (`common.js`, `kerr.js`, `st3cr.js`, `st3crBH.js`, `closedForm.js`, the registry entries for Kerr/ST3Cr, `rescaleToUnitMass`) | metric functions in double precision |
| `js/bake/` (bake, Hermite, worker, client) | metric tables for the GPU (ST3Cr) |
| `js/fluid/` (GeneralCircularRadial incl. the banded model, fluid table, emission) | disc fluid and emission |
| `js/noise/noiseField.js` + `noise/inoisy_lg21.*` and `noise/inoisy_st3cr_*.*` (the λ anchors) | disc flicker |
| `js/camera/tetradCamera.js` | tetrad camera (extended here to general observers) |
| `js/ref/cpuTracer.js` (+ `inspectWorker.js`) | CPU reference tracer for tests and the map view |
| `js/units.js` | physical units and presets |
| `js/export.js` | PNG/video export (adapt) |
| `sky/*.jpg` | sky backgrounds (check and record each image's licence and credit in `CREDITS.md`) |
| `shaders/glsl/*` | **source for the WGSL port** (not loaded by the game) |
| `tools/codegen/gen_metrics.py` | extend to emit WGSL as well as GLSL |

Also carry over FOORT-GPU's hard-won conventions:
- the pole-distance polar coordinate δ with a hemisphere sign;
- axis reflection;
- `x = log(r − r0)` radial coordinate;
- horizon capture tested at every RK stage;
- the residual-over-background tables;
- the 24-float record (3 crossings + 8 tail bins);
- the static tail;
- constraint projection for horizonless metrics;
- the quality-tier idea.

---

## 3. Platform: WebGPU-first

- **WebGPU compute shaders (WGSL)** for all ray tracing; a fragment pass for display. There is no WebGL2 fallback in 2A: if `navigator.gpu` is missing or adapter creation fails, show a clear page that explains why and links to the FOORT-GPU viewer.
- **Known risks** (check them in G0 and report):
  - **Firefox WebGPU latency.** In FOORT-GPU's M0 benchmark, every CPU wait on a submitted tile cost about 75–100 ms in Firefox. Therefore **never wait on the CPU per chunk.** Submit a frame's worth of trace work (sized by a GPU-time budget) together with the display pass, and measure with timestamp queries when available. Use `onSubmittedWorkDone` or mapped read-backs only occasionally, and asynchronously.
  - **The user's phone** (Samsung, Xclipse 920 GPU): Chrome's WebGPU on Android is documented for Qualcomm and ARM GPUs, so it may be unavailable there. Report what the capability page says.
  - **Limits:** `maxStorageBufferBindingSize`, `maxBufferSize`, `maxComputeInvocationsPerWorkgroup`. Request higher limits where available.
- **Precision:** f32 only (WGSL has no f64). All metric, fluid, camera-frame and ship-dynamics computations are in JS doubles; the GPU integrates rays only.

---

## 4. Physics design

### 4.1 Units and spacetimes

- **Units:** c = G = M = 1 everywhere internally. The ST3Cr family keeps fixed P = 2, q0 = 50 and variable λ ∈ [0, ~0.193), in units of M_ADM = 24 through FOORT-GPU's `rescaleToUnitMass`.
- **Physical units** come from the vendored `units.js` presets (Sgr A*, M87*, 10 M☉, custom). Time unit GM/c³ = 4.925 µs per M☉; length unit GM/c² = 1.477 km per M☉.
- **Thrust and g-load:** shown in c²/(GM) (dimensionless) and in g for the chosen mass. Example: hovering at r = 3M around a Schwarzschild hole needs a = M/(r²√(1 − 2M/r)) ≈ 0.19 c⁴/(GM), i.e. ≈ 3×10⁵ g for Sgr A* and ≈ 180 g for M87*.

### 4.2 Coordinates

The ship must cross the rotation axis, and may approach the horizon; the rays use FOORT-GPU's tracer coordinates. Therefore:

- **Ship coordinates (CPU, doubles):**
  - **Kerr:** **Cartesian Kerr–Schild** (horizon-penetrating and regular on the axis). g = η + f l⊗l, with f = 2Mr³/(r⁴ + a²z²) and l_μ = (1, (rx + ay)/(r² + a²), (ry − ax)/(r² + a²), z/r). Here r is defined by x² + y² + z² = r² + a²(1 − z²/r²). Verify the signature, the sign conventions and the relation to Boyer–Lindquist (dt_KS = dt_BL + 2Mr/Δ dr, dφ_KS = dφ_BL + a/Δ dr, x + iy = (r + ia) sin θ e^{iφ_KS}, z = r cos θ) against FOORT's `KerrSchildMetric` and the vendored BL Kerr, numerically.
  - **ST3Cr:** **Cartesian coordinates of the flat base**: (x, y, z) = r(sin θ cos φ, sin θ sin φ, cos θ). The metric is ds² = −Q^{−1/2}(dt + ω_φ dφ)² + Q^{1/2}(dx² + dy² + dz²), with dφ = (x dy − y dx)/(x² + y²). It is regular on the axis away from the D6 centres, because ω_φ ∝ sin²θ there; verify numerically. Obtain Q and ω_φ from the vendored g_dd (g_tt = −Q^{−1/2}, ω_φ = g_tφ/g_tt).
  - **Christoffel symbols** on the CPU by 4th-order central differences in double. The metric is stationary, so only the 3 spatial derivatives are needed. Use a step ~1e-5 × the local length scale, and validate against analytic Kerr Christoffels.
- **Ray coordinates (GPU):** keep FOORT-GPU's tracer coordinates: BL-like (t, x = log(r − r0), δ, φ) for Kerr, and (t, x = log r, δ, φ) on the base for ST3Cr. At each trace, transform the camera event and tetrad from ship coordinates into tracer coordinates with the Jacobian (KS → BL outside the horizon; Cartesian → spherical base).
- **Rendering from inside a horizon is out of scope:**
  - Kerr: crossing r₊ ends the flight (F2).
  - ST3Cr at λ = 0: the horizon is at base r = 0, at the end of an infinitely long AdS₂ throat in proper distance, though reached in finite proper time. The flight ends at r < r_cut, with an explanation.
  - ST3Cr at λ > 0: there is no horizon. The ship can enter the cap and come back.
- **Fuzzball singularities.** Contact with a D6 centre or the D0 ring (singular in the 4D description, smooth in the full string theory) ends the flight with an explanation (F3). Use the vendored singularity positions and distances.

### 4.3 Observers and the local frame

- **Free-mode observer families** (selectable):
  - **ZAMO** (default; exists everywhere outside the Kerr horizon and everywhere in ST3Cr): u = (∂_t + ω ∂_φ)/α, with ω = −g_tφ/g_φφ and α² = −(g_tt − g_tφ²/g_φφ).
  - **Static observer** (u ∝ ∂_t; it does not exist inside the Kerr ergoregion — grey out the option there, and explain why).
  - **Circular-orbit observer** (where circular orbits exist), with a "prograde/retrograde" choice.
  - In free mode the camera's attitude is free.
- **Physical mode:** the observer is the ship. Its 4-velocity u comes from the integration (4.4), and its spatial triad is Fermi–Walker transported plus attitude rotations.
- **Camera tetrad:** e₍₀₎ = u, and e₍₁₂₃₎ the ship's forward/right/up axes, orthonormal. For a pixel with local look direction d̂ (unit 3-vector in the ship frame), the backward-traced (past-directed) photon momentum is k^(a) ∝ (−1, d̂). This is FOORT's convention (its camera looks along −r with pflat = (−1, −r/D, …)); check it numerically against FOORT-GPU's `fromStaticObserver` for a static observer.
- **Observed redshift.** The trace keeps FOORT's normalization: p_t = −1 at infinity, and g_∞ = E_∞/E_em in the record. The ship sees g_ship = (E_ship/E_∞) g_∞, with E_ship/E_∞ = (−k·u_ship)/(−k_t) computed per pixel from the local photon momentum. This contains the gravitational blueshift of the hovering observer and the Doppler factor of the ship's motion.
  - **Test (Schwarzschild):** a static observer at r sees light from infinity blueshifted by 1/√(1 − 2M/r).
  - **Test (flat limit, far away):** relativistic Doppler and aberration formulas.

### 4.4 Ship dynamics (physical mode; CPU, JS doubles)

- **Equations, in proper time τ:**
  - dx^μ/dτ = u^μ
  - du^μ/dτ = −Γ^μ_αβ u^α u^β + a^μ, with a^μ = Σᵢ aⁱ e₍ᵢ₎^μ (thrust in the ship frame; a·u = 0 by construction)
  - de₍ᵢ₎^μ/dτ = −Γ^μ_αβ u^α e₍ᵢ₎^β + (a·e₍ᵢ₎) u^μ + Ωᵢʲ e₍ⱼ₎^μ (Fermi–Walker transport plus the attitude rotation rate Ω from reaction wheels)
- **Integrator:** RK4 or an embedded RK45 with adaptive substeps per frame. Every N steps, re-orthonormalize (u first, then Gram–Schmidt of the triad). Monitor u·u + 1 and triad orthonormality (HUD debug panel).
- **Time:** game time = proper time. Each frame advances τ by (wall dt) × (time rate). Time warp multiplies the rate, capped by integrator stability and disabled while thrusting (decision F8).
- **Ending events:** horizon (Kerr: r < r₊(1 + ε) in KS r; ST3Cr-BH: r < r_cut); fuzzball singularity contact; escape beyond a large radius (offer "return"); numerical failure (NaN; restore the last good state).
- **Optional Δv budget** with the relativistic rocket equation: off by default in the sandbox (F10).
- **Tests:**
  - **Conservation with engines off (Kerr):** E, L_z, the Carter constant and u·u over many orbits; relative drift ≤ 1e-8 per orbit at default settings.
  - **Coordinate consistency:** KS vs BL integration of the same geodesic outside the horizon.
  - **Circular orbits:** a circular orbit at r = 10M stays circular, with the analytic period.
  - **ISCO:** an orbit just inside it plunges.
  - **Hovering thrust:** the hover autopilot's thrust equals the analytic static-observer acceleration (Schwarzschild, and Kerr outside the ergoregion).
  - **Geodetic precession (Fermi–Walker frame):** after one circular orbit in Schwarzschild, a non-rotating triad turns by 2π[1 − (1 − 3M/r)^{1/2}] relative to the radial direction.
  - **Flat-limit hyperbolic motion** (far from the hole, constant proper acceleration).
  - **ST3Cr:** conservation of E and L_z (stationary, axisymmetric); a cap dive and return; singularity detection.

### 4.5 Disc, sky and colours

- **Disc:** FOORT-GPU's model (Johnson-SU envelope, fluid table with the banded model default for horizonless metrics, inoisy fields with the λ anchors and the coverage guard, static binned tail, slow light).
- **Emission time:** t_em = t_ship + dt_k, with t_ship the ship's coordinate time. Near a deep potential, the ship's t runs fast relative to τ, so the disc flickers faster — this is physical; mention it in the HUD help.
- **Colour modes** (F6):
  - **FOORT colormap:** monochrome intensity Σ F g^p J with a colour map, as in FOORT-GPU.
  - **Blackbody (default in the game):** the disc emits as a blackbody with temperature T_em(r) (a smooth profile scaled by an artistic temperature T₀, so the shifts span the visible range). The observed temperature is g_ship T_em; the colour comes from a blackbody RGB lookup table, and the bolometric intensity scales as g⁴. Use HDR with auto-exposure ("eye adaptation") and a filmic tone map.
- **Sky:** a background image at infinity, looked up by escape direction (vendored `sky/` images; plus a procedural starfield option).
  - Brightness scales with g⁴.
  - Colour shift: estimate an effective temperature per sky texel from its colour, multiply by g, and re-map to RGB. This is approximate; say so in the help.
  - Point-star magnification is out of scope.

---

## 5. Rendering design

### 5.1 Why not trace every pixel every frame

A full FOORT-GPU-quality trace of a 1024² image takes about a second on the user's integrated GPU. Moving cameras need a new image every frame, so direct tracing would be far too slow. Use the symmetries instead.

### 5.2 The local-sky cubemap (Kerr and ST3Cr are stationary and axisymmetric)

- **What a cubemap holds:** at camera event (t, r, θ, φ), what each direction shows depends only on (r, θ) and on the local frame. Trace a **cubemap of records** (FOORT-GPU's 24-float record, one per texel), for a reference observer at (r_c, θ_c): the ZAMO there, boosted by a **reference velocity** v_ref (the ship's ZAMO-frame velocity at trace time).
- **Display per frame**, for each screen pixel:
  1. direction in the ship frame → Lorentz transform to the reference frame, using the relative boost between the ship's current ZAMO-frame velocity and v_ref;
  2. cubemap lookup;
  3. shift all stored φ by φ_ship − φ_c and all times by t_ship − t_c (exact, by the symmetries);
  4. compute the ship-frame redshift (4.3);
  5. evaluate the emission, noise and tail.
- **Lookups never blend records.** Evaluate the emission at the 4 nearest texels and blend the resulting intensities. Records cannot be blended across discontinuities; the display cost is small.
- **Turning, moving in φ and t, and changing velocity are free** (no re-trace), as long as the relative boost stays modest. Only changes of (r, θ), or a large change of velocity, need a new cubemap.
- **Refresh policy:**
  - Trace new cubemaps continuously in the background within a per-frame GPU-time budget, progressively (coarse faces first), double-buffered.
  - The display uses the newest complete cubemap; optionally cross-fade (in intensity, not records) between the old and new ones over a few frames.
  - **Staleness metric:** the predicted image error from the displacement in (r, θ) since the reference, in pixels, using the Jacobian of escape direction and crossing position from neighbouring texels. Refresh priority follows it.
  - Expose the budget and the face resolution as quality settings.
- **Resolution:** the face resolution comes from the tier (F5; e.g. 128/256/384 per face). Aberration concentrates the forward view, which is why the reference frame is boosted with the ship, so the needed resolution stays near the screen's.
- **Memory:** 6 × 256² × 24 floats ≈ 38 MB per cubemap; double-buffered ≈ 75 MB. Use smaller faces on phones.
- **Validation:** for moving observers in Kerr and ST3Cr, compare the cubemap renderer with a direct per-pixel trace of the same observer (5.3). Errors must come only from cubemap resolution and staleness. Report sky error in pixels and emission L1, as in FOORT-GPU's quality gate.

### 5.3 Direct per-pixel tracing (reference and stills)

The same WGSL tracer with a general tetrad camera renders the screen directly. Use it:
- as the validation reference for the cubemap;
- for paused "photo mode" stills at full quality;
- for screenshots, optionally.

### 5.4 Scheduling and quality

- **Per-frame budget:**
  - the display pass;
  - plus N trace chunks (cubemap texels or direct pixels), with N adapted so that frame time ≤ 16.7 ms (or 33 ms in a low-power mode);
  - no CPU fences per chunk.
- **Tiers** after FOORT-GPU (Reference / High / Normal): integrator settings (Normal: FOORT-GPU's error-controlled RK at tolerance 0.1, which passed its quality gate), face resolution and refresh budget. Choose them automatically by a startup probe; the user can override them.
- **Kerr:** closed-form WGSL shader (generated by the extended codegen). **ST3Cr:** tabulated, with the G3 = G4 identity and texel reuse as in FOORT-GPU. Bake new tables in a worker when λ changes (λ changes are not allowed mid-flight in physical mode; they reset the scene).

---

## 6. The map view (not lensed)

A separate panel, or a picture-in-picture toggle with `m`. It is a flat, explicitly labelled **coordinate map** ("map — not what you see") in Cartesian KS (Kerr) or base (ST3Cr) coordinates. It draws:

- top-down and side views;
- the horizon and ergosurface (Kerr), or the D6 centres, D0 ring and cap scale (ST3Cr);
- photon-orbit and ISCO circles in the equatorial plane where they exist;
- the disc extent;
- the ship with its velocity;
- the **predicted trajectory** with engines off (CPU integration ahead, e.g. 2–3 orbits or until an ending event, updated a few times per second), plus the trail of the past path;
- pan and zoom.

Draw it on a 2D canvas (or a simple WebGPU line pass).

---

## 7. Gameplay and UI (sandbox)

### 7.1 Modes

- **Free / physical toggle.**
  - Physical → free keeps position and attitude.
  - Free → physical starts with the current observer's 4-velocity (a ZAMO will start falling). Offer "start in circular orbit here" and "start hovering here (engines on)" as alternatives.

### 7.2 Controls (F9)

| Action | Keyboard + mouse | Gamepad |
|---|---|---|
| attitude | mouse look (pointer lock); Q/E roll | right stick, bumpers |
| translation thrust (physical) / movement (free) | W/S forward/back, A/D left/right, R/F up/down | left stick + triggers |
| thrust level | scroll wheel (free mode: speed) | d-pad |
| main engine on/off (physical) | Shift (hold) | A button |
| assists | number keys (7.3) | menu |
| time warp | `,` / `.` | — |
| pause | `p` | start |
| map | `m` | — |
| photo mode | `o` | — |
| screenshot / record | `s` / `r` | — |
| help overlay | `?` | — |

Touch: basic on-screen sticks (attitude and thrust) for phones and tablets. Key remapping is out of scope for 2A.

### 7.3 Flight assists (physical mode)

- **Kill rotation.**
- **Point:** prograde / retrograde / radial in / radial out / toward the hole / toward a marker.
- **Hover here:** thrust equal to minus the local static-observer acceleration. Unavailable inside the ergoregion, where no static observer exists — explain it in the HUD; this is a teaching moment.
- **Circularize at the current r** (where circular orbits exist).
- **Match ZAMO** (null out the ZAMO-frame velocity).
- **Autopilots use the same thrust limits as the player, and never act silently:** the HUD shows when an assist is active.

### 7.4 HUD

- **Clocks:** proper time τ, coordinate time t ("outside clock"), and their ratio dt/dτ.
- **Position:** r (in M and physical units), the latitude θ.
- **Speed:** relative to the local ZAMO (v and γ).
- **Thrust:** proper acceleration (c²/GM and g).
- **Redshift readouts:** the colour/redshift factor of light from straight ahead and behind; the outside universe's average blueshift.
- **Orbit status:** bound / unbound / plunging / escaping; with E, L_z and (Kerr) the Carter constant in expert mode.
- **Tidal acceleration** across a ship length (from the tidal tensor; meaningful with a mass preset: "spaghettification" warning).
- **Markers:** prograde, retrograde and assist targets; the ISCO and photon-orbit distances.
- **Quality and frame time.**

### 7.5 Panels

Normal and expert panels, generated from one control list, as in FOORT-GPU:

- **Normal:**
  - spacetime (black hole / fuzzball, spin or λ);
  - mode;
  - scenario;
  - units preset;
  - time rate;
  - colour mode;
  - quality (shown);
  - export.
- **Expert:**
  - all physics parameters (fluid model, Johnson parameters, noise field, tail);
  - integrator and tier details;
  - cubemap resolution and budget;
  - debug views (cubemap staleness, refresh map, direct-vs-cubemap difference, termination, delays);
  - ship-integrator diagnostics.
- **Persistence:** settings and the last scenario in localStorage; the URL can encode a scenario.

### 7.6 Scenarios (sandbox presets; a JSON format that can later carry mission goals)

Each scenario is `{ id, title, spacetime, params, mode, ship: { x, u, attitude } | observer, units, notes, goals? }`. Initial set:

1. Parking orbit at 10 M around Kerr a = 0.9 (prograde).
2. Hover at 6 M (watch the universe blueshift).
3. Dive to the photon orbit and get out.
4. Ride the ergosphere (try to hover — you can't).
5. Fall into Kerr (the flight ends at the horizon).
6. Fuzzball cap dive and return (λ = 5e-3), with the outside clock running fast.
7. The same dive into the λ = 0 black hole (no return).
8. Free mode: tour of the disc, equal-mass Kerr and fuzzball side by side, as two scenarios.

---

## 8. Repository layout (proposed)

```
<repo>/
  index.html  style.css  README.md  PROGRESS.md  DECISIONS.md  CREDITS.md  FLIGHT_STAGE2A_PLAN.md
  caps.html                      WebGPU capability report
  js/
    main.js                      bootstrap, WebGPU device, loop
    gpu/                         device.js, tracer.js (dispatch, budget), cubemap.js, display.js, timing.js
    physics/                     ksKerr.js, st3crCartesian.js, christoffel.js, ship.js (forced geodesic + FW frame),
                                 observers.js (ZAMO, static, circular), redshift.js, tidal.js, events.js
    camera/                      generalTetrad.js (extends vendored TetradCamera), transforms.js (ship -> tracer coords)
    game/                        modes.js, controls.js (keyboard, mouse, gamepad, touch), assists.js, scenarios.js, hud.js, map.js
    ui/                          panels.js (normal/expert from one control list), persistence.js
    export/                      screenshot.js, video.js
  shaders/wgsl/                  common.wgsl, trace_closed_kerr.wgsl, trace_tabulated.wgsl, cubemap_trace.wgsl,
                                 display.wgsl, sky.wgsl, tonemap.wgsl
  scenarios/                     *.json
  vendor/foort-gpu/              snapshot + VERSION (never edited)
  noise/  sky/                   (vendored data, or symlinks to vendor paths)
  tools/                         sync_foort_gpu.sh, codegen (WGSL output)
  dev/                           package.json, tests (unit, e2e), scripts, reports (images git-ignored)
```

---

## 9. Milestones

### G0 — Repository, vendoring, WebGPU capability

**Deliverables:**
- repo scaffold;
- the vendored snapshot and sync script;
- `caps.html` (adapter, features, limits, f16 and timestamp support);
- dev tooling with Playwright running WebGPU in Chrome;
- a WebGPU "hello compute" plus a timing harness that measures CPU-wait latency per submission.

**CHECKPOINT G0:** the user opens `caps.html` and the latency test on their laptop (Chrome and Firefox) and phone. Record what works, and decide on the default browser guidance.

### G1 — WGSL tracer core, static observer

**Deliverables:**
- port `common.glsl`, the closed-form Kerr and the tabulated tracer (ST3Cr, with G3 = G4 and texel reuse) to WGSL, with the record format unchanged (24 floats);
- error-controlled RK (Normal) and RK4 + FOORT step (Reference);
- a static-observer test page;
- the per-frame budget scheduler (no per-chunk CPU waits).

**Tests:** WGSL vs FOORT-GPU WebGL2 records on identical rays (same scenes as FOORT-GPU's quality gate): agreement at FOORT-GPU's exactness noise floor; timings on the user's laptop vs FOORT-GPU.

**CHECKPOINT G1.**

### G2 — General observers and direct rendering

**Deliverables:**
- the KS Kerr and Cartesian ST3Cr metrics (CPU), with transforms ship coordinates ↔ tracer coordinates;
- the general tetrad camera (any event, any 4-velocity, any attitude);
- observer families (ZAMO, static, circular);
- ship-frame redshift;
- direct per-pixel rendering of the disc (both colour modes) and the sky.

**Tests:** KS ↔ BL metric and transform checks; static-observer images identical to G1; hovering blueshift; flat-limit Doppler and aberration; screenshots of a boosted observer at several γ.

**CHECKPOINT G2.**

### G3 — Cubemap renderer

**Deliverables:** Section 5.2: boosted-reference cubemap tracing, the display lookup with symmetry shifts and residual aberration, intensity blending, progressive double-buffered refresh within the budget, the staleness metric, and debug views.

**Tests:** cubemap vs direct rendering for static, orbiting and fast (γ = 2–5) observers in Kerr and ST3Cr: sky error (px) and emission L1 at each face resolution; frame time at 60 fps on the user's laptop while turning; refresh rates while moving radially.

**CHECKPOINT G3** (key milestone): the user flies a scripted camera path and judges smoothness and correctness.

### G4 — Free mode

**Deliverables:**
- free-flight controls (keyboard, mouse, gamepad, basic touch);
- the observer-family selector;
- a basic HUD (clocks, r, redshift, frame time);
- sky selection and colour modes;
- normal and expert panels;
- persistence.

**CHECKPOINT G4:** the user plays free mode in Kerr and in the fuzzball.

### G5 — Ship dynamics

**Deliverables:** Section 4.4 in full (integrator, Fermi–Walker frame, attitude, ending events, time warp), plus a headless test harness.

**Tests:** all of Section 4.4's tests, with numbers.

**CHECKPOINT G5.**

### G6 — Physical mode

**Deliverables:**
- thrust controls;
- assists (7.3);
- the full HUD (7.4);
- the map view with trajectory prediction (6);
- mode switching (7.1);
- scenarios 1–8 (7.6).

**Tests:** e2e scenario loads; assists reaching their targets (hover holds r to 1e-3 M over 100 M; circularize gives eccentricity < 1e-3); ending events trigger correctly.

**CHECKPOINT G6:** the user plays the scenarios.

### G7 — Units, teaching overlays, quality, export

**Deliverables:**
- physical units throughout (HUD, map, time rate, g-loads, tidal warnings);
- teaching overlays (short help cards per scenario; the "why can't I hover here" ergoregion explanation; the clock-comparison panel);
- automatic tiers and phone defaults;
- PNG screenshots (with the scenario/state embedded) and video (fixed proper-time steps; WebM or MP4, feature-detected);
- photo mode (direct trace at full quality while paused).

**CHECKPOINT G7.**

### G8 — Polish, documentation, acceptance (Stage 2A done)

**Deliverables:**
- README (player guide, controls, physics notes, developer guide: vendoring and sync, adding a scenario, the tracer and cubemap design);
- `DECISIONS.md` complete;
- `CREDITS.md`;
- a cross-device performance report;
- with approval, a homepage link (a separate change in `drmayerson.github.io`).

**Acceptance (initial; revise at G0/G3).** On the user's AMD laptop:

| Case | Target |
|---|---|
| display while turning (Kerr, auto tier) | 60 fps |
| cubemap refresh, Kerr | full 6 × 256² in ≤ 1 s, coarse in ≤ 0.2 s |
| cubemap refresh, fuzzball | ≤ 5 s full, coarse ≤ 0.5 s |
| ship integration plus prediction | ≤ 2 ms per frame on the CPU |

**CHECKPOINT G8.**

---

## 10. Physics notes for the implementer (from the design discussion)

- **What the player feels.** In physical mode, engines off means free fall: the player feels weightless. Effort is needed to *not* follow a geodesic (hovering), not to follow one. Gravity's "felt" effect is the thrust needed to stay put, plus tides.
- **Where the redshift shows.** A hovering observer deep in the potential sees the outside universe and the disc blueshifted; free fall cancels much of that through Doppler. The two modes and the observer families show this contrast directly — make it visible in the HUD.
- **Ergoregion (Kerr).** No static observers exist there; even infinite thrust cannot hold a ship static. The hover assist must say so rather than fail silently.
- **Fuzzball versus black hole.** A fuzzball has no horizon: a ship can dive into the cap and return. The outside clock then shows a large elapsed coordinate time compared with the proper time (deep throat). At λ → 0 the cap recedes down an ever longer throat; at λ = 0 there is a horizon and no return.
- **Coordinates are not views.** Straight lines in coordinates are not straight in the view, and objects can have several images; hence the separate map.
- **Real accelerations are huge** in physical units (Section 4.1); show them, but let the sandbox use dimensionless thrust.

---

## 11. Open decisions (proposed defaults)

| ID | Decision | Proposed default |
|---|---|---|
| F1 | Repository name | `foort-flight` (alternatives: `bh-flight`, `blackhole-flight`) |
| F2 | Crossing a horizon | the flight ends with an explanation screen; rendering inside is Stage 2B or later |
| F3 | Touching a fuzzball singularity | the flight ends, with an explanation (4D singular, smooth in string theory) |
| F4 | Default free-mode observer | ZAMO |
| F5 | Cubemap face resolution per tier | 128 / 256 / 384 |
| F6 | Default disc colour mode | blackbody (FOORT colormap selectable) |
| F7 | Default units | dimensionless, with g-loads also shown for Sgr A* |
| F8 | Time rate | 1 s wall = 1 M of proper time by default; time warp up to 100×, disabled while thrusting |
| F9 | Controls | keyboard + mouse primary, gamepad supported, basic touch |
| F10 | Fuel / Δv budget | off by default (sandbox) |
| F11 | Browser guidance | decided at G0 from the user's devices (Chrome recommended if Firefox latency persists) |
