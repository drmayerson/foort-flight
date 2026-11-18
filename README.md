# FOORT Flight

Fly a spaceship around a spinning black hole or a fuzzball, with the view ray traced in real time on your GPU:
gravitational lensing, the redshift and Doppler shift of everything you see, aberration, and the finite speed of light.
It runs in the browser at <https://drmayerson.github.io/foort-flight/>, with no installation, and builds on
[FOORT-GPU](https://github.com/drmayerson/foort-gpu), the validated black-hole and fuzzball viewer.

**Status:** Stage 2A (sandbox) complete, milestones G0–G8. The plan is `FLIGHT_STAGE2A_PLAN.md` (v1.1); progress
reports with all numbers are in `PROGRESS.md`, every design decision in `DECISIONS.md`, credits in `CREDITS.md`.

---

## Player guide

### What you need

A browser with WebGL2 and float render targets: any recent Chrome, Edge, Firefox or Safari, on computers and most
phones. A dedicated GPU helps, but integrated graphics run it at 60 fps. Without WebGL2 the page explains why and links
to the FOORT-GPU viewer. `about.html` lists the test pages, including a capability report.

### Two ways to fly

- **Free camera** (the start): move anywhere without inertia. You see through a local observer: a **ZAMO** (zero
  angular momentum: dragged around a spinning hole), a **static** (hovering) observer, or a **circular orbit**.
- **Spaceship** ("Board a ship", or a scenario): a body in free fall unless its engines fire. Engines off, you follow a
  geodesic and feel weightless; it takes thrust *not* to follow one. "Leave the ship" returns to the free camera at
  the same place.

### Controls

| | keyboard and mouse | gamepad | touch |
|---|---|---|---|
| look / turn | click the view, then the mouse (Esc releases); or drag | right stick | right half |
| move (free) / thrusters (ship) | W/S, A/D, R/F | left stick, triggers | left half |
| roll | Q / E | bumpers | |
| speed (free) / thrust level (ship) | wheel | d-pad | |
| main engine (ship) | Shift (hold) | A | |
| assists (ship, toggle) | 1 stop turning · 2 prograde · 3 retrograde · 4 at the hole · 5 away · 6 hover · 7 circularize · 8 match the ZAMO | | |
| time warp (ship) | `,` / `.` (off while thrusting) | | |
| pause · map · help | P · M · ? | start (pause) | |
| screenshot · video · photo mode | K · V · O | | |

### Scenarios

Choose one in the side panel: 1 parking orbit at 10 M; 2 hover at 6 M; 3 dive to the photon orbit and get out;
4 ride the ergosphere (try to hover: you can't); 5 fall into a black hole; 6 fuzzball cap dive and return; 7 the same
dive into the λ = 0 black hole; 8a/8b free tours of a black hole and a fuzzball of the same mass. A link can open one:
`?scenario=hover-6m`.

### What the screen tells you

- **HUD:** your clock τ and the outside (coordinate) clock t, and how fast t runs against τ; your distance r and
  latitude; your speed relative to the local ZAMO; thrust (in c⁴/GM and in g for a ship near Sgr A*); the shift of the
  light from ahead, from behind and from the whole sky (above 1: bluer and brighter); the tidal stretching across a
  100 m ship; whether your orbit is bound, plunging or escaping. Markers on the view: prograde, retrograde, the hole.
- **Map (M):** a flat coordinate map, "not what you see": the horizon, the ergoregion, the photon orbits and ISCOs, the
  disc, the fuzzball's sources, your path so far and your predicted path with the engines off (red if it ends in the
  hole).
- **Clocks card:** how much each clock has advanced since the start.
- **Units:** units of M, or the times and lengths of Sgr A*, M87* or a 10 M☉ hole.

### Physics notes

- Everything is in units of the mass M (G = c = 1): 1 M of time is 21 s for Sgr A*, 9 hours for M87*.
- **The view** is computed by tracing light rays backwards through the curved spacetime (FOORT's tracer, on the GPU, in
  float32). The disc emits as a blackbody whose colour and brightness you see shifted by gravity and by your motion;
  it flickers with a turbulence field, and you see each part of it as it was when its light left ("slow light").
- **Free fall feels like nothing;** hovering deep in the potential takes an enormous thrust (at 3 M around Sgr A*,
  about 3 × 10⁵ g). Inside a spinning hole's **ergoregion** nothing can hover at all: space is dragged around faster
  than light could move against it.
- **A fuzzball** (the ST3Cr ring fuzzball of string theory) has no horizon: you can fall into its cap and come back
  out, while the outside clock runs many times faster than yours. At λ = 0 the cap has receded down an infinitely long
  throat and it is a black hole again.
- The game is a sandbox, built for intuition; FOORT and FOORT-GPU remain the science tools. The physics tests and their
  numbers are in `PROGRESS.md` (G1: tracer records identical to FOORT-GPU's; G2: hovering blueshift and Doppler;
  G3: cubemap vs direct; G5: conservation, precession, ISCO, hyperbolic motion; G6: assists).

---

## Developer guide

### No build step

The committed files are served as they are: plain ES modules with JSDoc (`// @ts-check`), shaders fetched at runtime.
Development tooling lives in `dev/` (Node.js ≥ 18; `node_modules` is not committed).

```
cd dev
npm install
npm test                    # Vitest: physics, camera, scheduler, ship dynamics, assists (72 tests)
npm run test:e2e            # Playwright in installed Chrome (31 tests)
npm run typecheck           # tsc --checkJs
npm run serve               # http://127.0.0.1:8766/
node scripts/g5Harness.mjs  # ship-dynamics tests of plan 4.4, with numbers
node scripts/g3Compare.mjs  # cubemap vs direct trace per face size
node scripts/g1Compare.mjs  # records vs the FOORT-GPU viewer (needs ../foort-gpu at the vendored commit)
node scripts/g8Acceptance.mjs   # the acceptance timings (headed Chrome)
```

### Layout

| path | contents |
|---|---|
| `index.html`, `game.css`, `js/main.js` | the game: frame loop, modes, HUD, map, scenarios, export |
| `js/gl/` | WebGL2: `tracer.js` (runs the vendored GLSL tracer), `scheduler.js` (per-frame ray budget, fences), `cubemap.js` (cubemap tracing, ray splitting), `display.js` (shading, tone map, auto-exposure), `renderer.js` (all of it behind one interface), `context.js`, `debugDisplay.js` |
| `js/camera/` | `generalTetrad.js` (any observer and cube face through the tracer's `uE`), `shipCamera.js` (ship coordinates → tracer camera) |
| `js/physics/` | `spacetime.js` (both coordinate systems), `ksKerr.js`, `st3crCartesian.js`, `observers.js`, `refFrame.js` (ship → cubemap reference frame), `redshift.js`, `christoffel.js`, `ship.js` (forced geodesics, Fermi–Walker frame, events), `tidal.js` |
| `js/game/` | `freeMode.js`, `physicalMode.js`, `assists.js`, `controls.js`, `hud.js`, `map.js`, `predictor.js`, `scenarios.js`, `shipClock.js`, `units.js` |
| `js/ui/` | `controlList.js` (all settings, one list), `panels.js`, `persistence.js` |
| `js/render/` | `blackbody.js`, `defaults.js` (disc and tier defaults) |
| `shaders/glsl/` | the game's own GLSL: `shade.glsl` (emission, sky), `display.glsl` (direct trace), `cubedisplay.glsl` (cubemap), `tonemap.glsl`, `debug.glsl`. The tracer itself is FOORT-GPU's, loaded from `vendor/` |
| `scenarios/` | scenario JSON files and `index.json` |
| `vendor/foort-gpu/` | a snapshot of FOORT-GPU (never edited; see its README) |
| `tools/` | `sync_foort_gpu.sh` |
| `dev/` | tests, scripts, reports (images in `dev/reports/img/` are not committed) |
| `tracer.html`, `observer.html`, `cubemap.html`, `caps.html`, `latency.html`, `about.html` | milestone test pages |

### Vendoring and sync

`sh tools/sync_foort_gpu.sh [../foort-gpu] [commit]` re-copies the listed FOORT-GPU files from a commit (with
`git archive`, never from FOORT-GPU's working tree), checks the copy and prints what changed; the commit is in
`vendor/foort-gpu/VERSION`. Never edit vendored files; a needed fix is an upstream note in `DECISIONS.md`. After a sync,
run `node dev/scripts/g1Compare.mjs`: the game's records must stay bit-identical to the FOORT-GPU viewer's.

### Adding a scenario

Write `scenarios/<id>.json` and add `<id>` to `scenarios/index.json`:

```json
{ "id": "my-orbit", "title": "9. My orbit", "spacetime": { "id": "kerr", "params": { "a": 0.7 } }, "mode": "physical",
  "ship": { "r": 12, "theta": 80, "family": "zamo", "v": [0, 0.3, 0], "look": "prograde" },
  "level": 0.05, "assist": null, "timeRate": 20, "notes": "What to try." }
```

`family`: `zamo`, `static`, `circularPro`, `circularRetro`; `v`: velocity relative to that observer (towards the hole,
along +φ, north); `look`: `hole`, `out`, `prograde`, `retrograde`, `north`; `assist`: an assist id engaged at the start
(`hover`, `circularize`, …); free-mode scenarios give `camera: {r, theta, family}` instead of `ship`. A `goals` field is
reserved for missions (Stage 2B). Check a new scenario headless (engines off) as in PROGRESS G6, and the e2e test that
loads every scenario.

### How the view is made

1. **Tracer:** FOORT-GPU's GLSL tracer, unchanged, in fragment shaders writing a 24-float record per ray (termination,
   escape direction, three disc crossings, binned later crossings) to 6 float render targets. Its uniforms come from
   the vendored `gpuTraceSetup`; only the camera matrix `uE` is the game's: any observer, attitude or cube face is a
   pinhole through `uE` (`js/camera/generalTetrad.js`).
2. **Cubemap:** the six 90° faces around a *reference observer* (the local ZAMO boosted by the ship's velocity) in one
   atlas, traced in the background within half of each frame (`js/gl/scheduler.js`: a ray budget from GPU timer
   queries or fences; never a CPU wait). Long fuzzball rays are split across frames (FOORT-GPU's compaction mode).
3. **Display:** every frame, each screen pixel's direction goes ship frame → local ZAMO frame → reference frame (one
   4×4 matrix); time and azimuth are exact symmetries; the emission of the 4 nearest texels is blended; the redshift is
   the pixel's own. So turning, orbiting at fixed r and changing speed need no new trace; moving in r or θ refreshes
   the cubemap (≈ 0.3 s for a black hole, ≈ 3–4 s for the fuzzball on an integrated GPU).
4. **Ship:** forced geodesic equation with a Fermi–Walker triad in Kerr–Schild (Kerr) or base Cartesian (fuzzball)
   coordinates, Dormand–Prince 5(4) in double precision on the CPU (`js/physics/ship.js`).
